# GeckoTerminal Candle Collector Design

- **Issue:** [#18](https://github.com/opsclawd/regime-engine/issues/18)
- **Date:** 2026-05-01
- **Status:** Approved design, pending written-spec review
- **Target repo:** `regime-engine`

## Problem

`regime-engine` already owns candle ingestion through `POST /v1/candles` and
market-regime reads through `GET /v1/regime/current`. The missing piece is an
external producer that fetches SOL/USDC 1h OHLCV candles from GeckoTerminal and
posts normalized batches to the existing candle ingest endpoint.

The collector must live in this repo for deployment convenience, but it must
behave like a separate service:

- no Fastify app startup
- no direct SQLite or Postgres writes
- no imports from `src/app.ts`, `src/server.ts`, `src/http/routes.ts`,
  `src/ledger/store.ts`, `src/ledger/candleStore.ts`,
  `src/ledger/candlesWriter.ts`, or `src/ledger/pg/db.ts`
- only HTTP interaction with `regime-engine`: `POST /v1/candles`

Provider docs checked during design:

- GeckoTerminal API getting started: <https://apiguide.geckoterminal.com/getting-started>
- GeckoTerminal API authentication: <https://apiguide.geckoterminal.com/authentication>
- GeckoTerminal pool OHLCV reference: <https://docs.coingecko.com/reference/pool-ohlcv-contract-address>
- GeckoTerminal FAQ / public limits: <https://apiguide.geckoterminal.com/faq>

## Goals

- Add a separate GeckoTerminal collector worker entrypoint.
- Use zero new runtime dependencies.
- Use built-in Node 22 APIs: global `fetch`, `AbortController`, and
  `node:timers/promises`.
- Fetch a configured Solana SOL/USDC GeckoTerminal pool.
- Fetch only `1h` candles for MVP.
- Fetch a rolling 200-candle window by default.
- Normalize Gecko Unix-second OHLCV rows into the existing candle ingest
  contract, which uses Unix milliseconds.
- Validate and dedupe provider rows locally before POSTing.
- Use a corruption guard to avoid posting when the provider shape or data
  quality looks broken.
- POST to `/v1/candles` with `X-Candles-Ingest-Token`.
- Use bounded local retry/backoff and provider-scoped rate limiting.
- Run a sequential immediate-start loop with graceful Railway shutdown.
- Document the two-service Railway deployment model.

## Non-goals

- No provider registry.
- No generic collector framework.
- No future-timeframe abstraction.
- No pool discovery or rotation.
- No Birdeye, CoinGecko paid API, websocket ingestion, or on-chain aggregation.
- No changes to `/v1/candles` or `/v1/regime/current`.
- No on-chain execution code.

## Module Boundaries

Add a small worker slice:

```text
src/workers/geckoCollector.ts
src/workers/gecko/config.ts
src/workers/gecko/geckoClient.ts
src/workers/gecko/normalize.ts
src/workers/gecko/ingestClient.ts
src/workers/gecko/retry.ts
src/workers/gecko/logger.ts
```

Allowed shared imports are limited to contract types/constants such as
`Candle`, `CandleIngestResponse`, and `SCHEMA_VERSION`.

### `src/workers/geckoCollector.ts`

Responsibilities:

- parse config by calling `parseGeckoCollectorConfig(process.env)`
- use an ESM entrypoint guard so importing this module in tests does not start
  the collector loop
- install `SIGTERM` and `SIGINT` handlers
- run one cycle immediately on startup
- sleep after each completed or failed cycle
- prevent overlapping cycles by using a sequential async loop
- check shutdown state between phases
- create the GeckoTerminal provider rate limiter once per collector process and
  reuse it across cycles and retry attempts

Exports:

```ts
export function runOneCycle(config: GeckoCollectorConfig, deps?: GeckoCollectorDeps): Promise<void>;

export function runCollector(
  config?: GeckoCollectorConfig,
  deps?: GeckoCollectorDeps
): Promise<void>;
```

`GeckoCollectorDeps` is only a test seam for logger, sleep, now, fetch/random
indirection where needed. It is not a framework.

Entrypoint guard:

```ts
if (isMainModule(import.meta.url, process.argv[1])) {
  void runCollector();
}
```

`isMainModule` can compare `import.meta.url` with `pathToFileURL(process.argv[1]).href`.
Tests import `runOneCycle` and `runCollector` without starting the worker.

### `src/workers/gecko/config.ts`

Responsibilities:

- parse env vars
- apply defaults
- validate MVP constraints
- fail fast with clear config errors

Exports:

```ts
export type GeckoCollectorConfig = {
  regimeEngineUrl: URL;
  candlesIngestToken: string;
  geckoSource: "geckoterminal";
  geckoNetwork: "solana";
  geckoPoolAddress: string;
  geckoSymbol: "SOL/USDC";
  geckoTimeframe: "1h";
  geckoLookback: number;
  geckoPollIntervalMs: number;
  geckoMaxCallsPerMinute: number;
  geckoRequestTimeoutMs: number;
};

export function parseGeckoCollectorConfig(env?: NodeJS.ProcessEnv): GeckoCollectorConfig;
```

Hard-required env:

| Variable               | Rule                             |
| ---------------------- | -------------------------------- |
| `REGIME_ENGINE_URL`    | absolute URL                     |
| `CANDLES_INGEST_TOKEN` | non-empty                        |
| `GECKO_POOL_ADDRESS`   | explicit non-empty; do not infer |

Defaulted env, validated if present:

| Variable                     | Default         | Rule                       |
| ---------------------------- | --------------- | -------------------------- |
| `GECKO_SOURCE`               | `geckoterminal` | must equal `geckoterminal` |
| `GECKO_NETWORK`              | `solana`        | must equal `solana`        |
| `GECKO_SYMBOL`               | `SOL/USDC`      | must equal `SOL/USDC`      |
| `GECKO_TIMEFRAME`            | `1h`            | must equal `1h`            |
| `GECKO_LOOKBACK`             | `200`           | positive integer           |
| `GECKO_POLL_INTERVAL_MS`     | `300000`        | positive integer           |
| `GECKO_MAX_CALLS_PER_MINUTE` | `6`             | positive integer           |
| `GECKO_REQUEST_TIMEOUT_MS`   | `10000`         | positive integer           |

### `src/workers/gecko/geckoClient.ts`

Responsibilities:

- build the GeckoTerminal OHLCV URL
- apply the provider-scoped rate limiter before each provider call
- fetch with a per-request timeout controller
- convert non-OK HTTP responses into typed `HttpError`s
- parse and return JSON as `unknown`

Exports:

```ts
export type GeckoOhlcvPayload = unknown;

export function fetchGeckoOhlcv(
  config: GeckoCollectorConfig,
  deps?: GeckoFetchDeps
): Promise<GeckoOhlcvPayload>;
```

The provider URL is assembled with `URL` and `URLSearchParams`, not raw string
interpolation. Path segments are encoded:

```text
https://api.geckoterminal.com/api/v2/networks/{network}/pools/{poolAddress}/ohlcv/hour?aggregate=1&limit={GECKO_LOOKBACK}
```

For MVP, `GECKO_TIMEFRAME=1h` maps to Gecko `hour` with `aggregate=1`.
The request sends `Accept: application/json`. GeckoTerminal public API access
does not require provider authentication for this MVP path.

### `src/workers/gecko/normalize.ts`

Responsibilities:

- treat provider JSON as untrusted `unknown`
- accept only the documented OHLCV list shape
- convert Unix seconds to Unix milliseconds
- validate rows independently
- handle duplicate timestamps
- sort final candles by `unixMs ASC`
- produce structured stats and corruption-guard decisions

Exports:

```ts
export type NormalizationStats = {
  providerRowCount: number;
  malformedRowCount: number;
  misalignedRowCount: number;
  invalidOhlcvRowCount: number;
  duplicateIdenticalDroppedCount: number;
  duplicateConflictDroppedCount: number;
  totalDroppedCount: number;
  corruptionDroppedCount: number;
  validCount: number;
  dropReasons: Record<string, number>;
};

export type NormalizationResult = {
  validCandles: Candle[];
  stats: NormalizationStats;
};

export function normalizeGeckoOhlcv(
  payload: unknown,
  config: GeckoCollectorConfig
): NormalizationResult;

export function shouldPostNormalizedBatch(
  stats: NormalizationStats,
  config: GeckoCollectorConfig
): boolean;
```

### `src/workers/gecko/ingestClient.ts`

Responsibilities:

- build the `CandleIngestRequest`
- POST to `/v1/candles`
- send `X-Candles-Ingest-Token`
- fetch with a per-request timeout controller
- convert non-OK HTTP responses into typed `HttpError`s
- validate the expected ingest response shape
- treat `200` with `rejectedCount > 0` as success with warning, not retry

Exports:

```ts
export function postCandles(
  config: GeckoCollectorConfig,
  candles: Candle[],
  sourceRecordedAtIso: string,
  deps?: IngestClientDeps
): Promise<CandleIngestResponse>;
```

`sourceRecordedAtIso` is set once per successfully fetched batch and reused
across ingest retries.

The `/v1/candles` response is validated strictly before logging success:

- `schemaVersion === "1.0"`
- `insertedCount`, `revisedCount`, `idempotentCount`, and `rejectedCount` are
  non-negative integers
- `rejections` is an array
- every rejection has integer `unixMs`, reason `"STALE_REVISION"`, and string
  `existingSourceRecordedAtIso`

### `src/workers/gecko/retry.ts`

Responsibilities:

- retry small async operations with bounded exponential backoff
- expose retryable HTTP classification
- expose provider-scoped rate limiter
- keep jitter injectable for deterministic tests

Exports:

```ts
export type HttpErrorOptions = {
  statusCode: number;
  responseBody?: string;
  retryable?: boolean;
  message?: string;
};

export class HttpError extends Error {
  statusCode: number;
  responseBody?: string;
  retryable: boolean;
  constructor(options: HttpErrorOptions);
}

export class ProtocolError extends Error {}
export class RequestTimeoutError extends Error {}

export type RetryOptions = {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitterMs: (attempt: number) => number;
  sleep: typeof import("node:timers/promises").setTimeout;
  shouldContinue?: () => boolean;
};

export function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T>;

export function createRateLimiter(
  maxCallsPerMinute: number,
  deps?: {
    sleep?: typeof import("node:timers/promises").setTimeout;
    now?: () => number;
  }
): () => Promise<void>;

export function isRetryableHttpStatus(status: number): boolean;
```

`createRateLimiter` is only for GeckoTerminal provider calls. It is not applied
to `/v1/candles` ingest POSTs.

The rate limiter is constructed once in `runCollector` and injected into cycle
dependencies. It must not be recreated inside each `fetchGeckoOhlcv` call,
because that would reset spacing across cycles and retries. `now?: () => number`
is injectable for deterministic rate-limiter tests.

### `src/workers/gecko/logger.ts`

Responsibilities:

- provide minimal structured console helpers or a small injected logger type
- no logging framework
- no runtime dependency
- no generic observability layer

## Collector Lifecycle

The worker starts by parsing env. Config errors are fatal and exit nonzero.
Runtime cycle failures log and continue after the configured sleep interval.

Sequential loop:

```ts
while (!shutdownRequested) {
  await runOneCycle(config);
  await sleep(config.geckoPollIntervalMs, undefined, { signal: shutdownSleepSignal });
}
```

The first cycle runs immediately on startup. The worker does not wait one full
interval before proving env, provider access, normalization, ingest auth, and
`regime-engine` connectivity.

`runOneCycle`:

```text
1. Log gecko_cycle_started.
2. Fetch Gecko OHLCV with provider rate limit, timeout, and retry.
3. If shutdown was requested during fetch, return before normalization or ingest.
4. Set sourceRecordedAtIso once for the fetched batch.
5. Normalize, validate, dedupe, and sort candles.
6. If shutdown was requested after normalization, return before ingest.
7. Apply zero-valid and corruption guards.
8. POST valid candles to /v1/candles with timeout and retry.
9. Log ingest counts and cycle completion.
```

If the zero-valid or corruption guard blocks a batch, `runOneCycle` logs a
controlled skipped-ingest cycle and returns. This is not a process crash. The
outer loop then sleeps normally.

Shutdown rules:

- SIGTERM/SIGINT during sleep: abort sleep and exit.
- SIGTERM/SIGINT during Gecko fetch: let fetch finish or hit request timeout,
  then return without starting ingest.
- SIGTERM/SIGINT during ingest POST: let ingest finish or hit request timeout,
  then exit.
- Never start another cycle after shutdown.

The shutdown signal prevents new phases and cycles. It is not passed directly
to in-flight fetch/ingest requests, because those requests should complete or
hit their own request timeout.

Fetch and ingest clients create their own per-request timeout controllers. If
shutdown is requested during a retry backoff, the collector should not start the
next provider or ingest attempt.

## Retry, Rate Limit, And HTTP Errors

Use local helpers only.

Retry policy for Gecko fetch and ingest POST:

| Rule            | Value                                                      |
| --------------- | ---------------------------------------------------------- |
| max attempts    | 3                                                          |
| initial backoff | 1000ms                                                     |
| max backoff     | 30000ms                                                    |
| formula         | `initialBackoffMs * 2 ** (attempt - 1)` capped at max      |
| jitter          | bounded and injectable/mocked in tests                     |
| retry           | HTTP 429, HTTP 5xx, network error, request timeout         |
| no retry        | non-429 HTTP 4xx                                           |
| no retry        | successful `/v1/candles` response with `rejectedCount > 0` |

`fetch` does not throw for HTTP failures, so clients must convert responses:

- `429` and `5xx` become retryable `HttpError`s.
- non-429 `4xx` becomes non-retryable `HttpError`.
- `2xx` with invalid JSON or unexpected response shape becomes `ProtocolError`
  and fails the cycle.
- timeout aborts become `RequestTimeoutError` and are retryable until attempts
  are exhausted.
- network or transport failures are retryable until attempts are exhausted.
- protocol and programmer errors are non-retryable unless explicitly classified
  as retryable.

`HttpError` constructor shape:

```ts
type HttpErrorOptions = {
  statusCode: number;
  responseBody?: string;
  retryable?: boolean;
  message?: string;
};

new HttpError({
  statusCode,
  responseBody,
  retryable: isRetryableHttpStatus(statusCode),
  message: `HTTP ${statusCode}`
});
```

Provider rate limiting:

- scoped only to GeckoTerminal provider calls
- first provider call is immediate
- retries are also provider calls and are rate limited
- one provider request is in flight at a time
- one limiter is created per collector process and reused across cycles/retries
- subsequent provider calls are spaced by at least
  `60000 / GECKO_MAX_CALLS_PER_MINUTE` milliseconds
- default `GECKO_MAX_CALLS_PER_MINUTE=6`, so at most one provider call every
  10 seconds after the first call

## Normalization And Corruption Guard

The normalizer reads the documented GeckoTerminal envelope:

```text
payload.data.attributes.ohlcv_list
```

It accepts rows shaped as:

```text
[timestampSeconds, open, high, low, close, volume]
```

Conversion:

```text
unixMs = timestampSeconds * 1000
```

Per-row validation:

- each row must be an array
- each row must have length exactly `6`; missing fields or extra fields are
  malformed
- `timestampSeconds` is an integer
- `unixMs` is an integer aligned to the 1h boundary
- `open`, `high`, `low`, and `close` are finite and `> 0`
- `volume` is finite and `>= 0`
- `high >= max(open, close, low)`
- `low <= min(open, close, high)`

Malformed top-level provider envelopes, missing OHLCV lists, and non-array
OHLCV lists are protocol failures. They fail the cycle and do not POST.

Parseable rows are validated independently:

- non-array rows, rows with `length !== 6`, rows with missing fields, rows with
  extra fields, misaligned rows, or invalid-OHLCV rows are dropped locally
- exact duplicate rows are deduped
- conflicting duplicate timestamps drop all rows for that timestamp
- final valid candles are sorted by `unixMs ASC`

Duplicate policy:

| Case                                | Behavior                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| same `unixMs` and identical OHLCV   | keep one, count `duplicateIdenticalDroppedCount`, warn                        |
| same `unixMs` and conflicting OHLCV | drop all rows for that timestamp, count `duplicateConflictDroppedCount`, warn |

Dropped-count accounting:

```text
totalDroppedCount =
  malformedRowCount +
  misalignedRowCount +
  invalidOhlcvRowCount +
  duplicateIdenticalDroppedCount +
  duplicateConflictDroppedCount

corruptionDroppedCount =
  malformedRowCount +
  misalignedRowCount +
  invalidOhlcvRowCount +
  duplicateConflictDroppedCount
```

Exact duplicate rows do not trigger the corruption guard by themselves because
they do not change candle truth after dedupe.

Posting guard:

```ts
if (validCount === 0) {
  warn and skip POST;
}

if (providerRowCount > 0 && corruptionDroppedCount / providerRowCount > 0.10) {
  warn and fail cycle without POST;
}

if (config.geckoLookback >= 50 && validCount < 50) {
  warn and fail cycle without POST;
}
```

The worker posts the valid subset only when the guard passes.
When the guard does not pass, it logs and returns from `runOneCycle`; the
collector process stays alive and the outer loop sleeps normally.

## Ingest POST

`ingestClient.ts` builds the existing contract:

```ts
{
  schemaVersion: SCHEMA_VERSION,
  source: config.geckoSource,
  network: config.geckoNetwork,
  poolAddress: config.geckoPoolAddress,
  symbol: config.geckoSymbol,
  timeframe: "1h",
  sourceRecordedAtIso,
  candles
}
```

The URL is built with `new URL("/v1/candles", config.regimeEngineUrl)`.

Headers:

```text
Content-Type: application/json
X-Candles-Ingest-Token: <CANDLES_INGEST_TOKEN>
```

Successful response logging includes:

- `insertedCount`
- `revisedCount`
- `idempotentCount`
- `rejectedCount`
- `candleCountFetched`
- `candleCountPosted`
- `sourceRecordedAtIso`

`rejectedCount > 0` is a warning because stale historical revisions can be
normal. It is not retryable.

## Logging

Use compact structured console output or an injected logger type. Events:

- `gecko_collector_started`
- `gecko_cycle_started`
- `gecko_fetch_failed`
- `gecko_fetch_succeeded`
- `gecko_normalization_warn`
- `gecko_corruption_guard_blocked`
- `gecko_ingest_failed`
- `gecko_ingest_succeeded`
- `gecko_cycle_failed`
- `gecko_cycle_completed`
- `gecko_collector_shutdown_requested`
- `gecko_collector_shutdown_complete`

Common context:

- `provider=geckoterminal`
- `network`
- `poolAddress`
- `symbol`
- `timeframe`
- `attempt`
- `statusCode`
- `errorCode` or `errorMessage`

Secret redaction rule:

- never log `CANDLES_INGEST_TOKEN`
- never log request headers containing `X-Candles-Ingest-Token`
- never log unredacted full config objects
- if config context is needed, log only non-secret fields such as provider,
  network, pool address, symbol, timeframe, lookback, poll interval, and timeout

## Package Scripts

Add scripts:

```json
{
  "start": "node --env-file-if-exists=.env dist/src/server.js",
  "dev:gecko": "tsx watch src/workers/geckoCollector.ts",
  "start:gecko": "node --env-file-if-exists=.env dist/src/workers/geckoCollector.js"
}
```

`start:gecko` must point to `dist/src/workers/geckoCollector.js` because the
repo builds under `dist/src/...`.

The existing `build` script should continue to compile the worker through
`tsconfig.build.json`. No bundler or runtime dependency is added.

## Deployment Docs

Do not modify `railway.toml` to start the collector. The collector runs as a
second Railway service from the same repo with a service-specific start command
override.

Document two Railway services:

| Service                         | Build        | Start              |
| ------------------------------- | ------------ | ------------------ |
| `regime-engine-web`             | `pnpm build` | `pnpm start`       |
| `regime-engine-gecko-collector` | `pnpm build` | `pnpm start:gecko` |

The web service must continue to use `pnpm start`. The collector service uses
the same build command but overrides only the start command.

Docs to update during implementation:

- `README.md`: add a GeckoTerminal collector section, local commands, env table,
  and two-service Railway notes.
- `docs/runbooks/railway-deploy.md`: add second-service instructions and
  verification notes.
- `.env.example`: add worker env vars using placeholders only.

`.env.example` should use:

```text
GECKO_POOL_ADDRESS=<confirm-before-production>
```

unless the canonical GeckoTerminal SOL/USDC pool has already been selected.

Docs must include a deployment checkbox to confirm the canonical SOL/USDC
GeckoTerminal pool address before production deployment.

## Tests

All HTTP tests use mocked `fetch`. Tests must not call GeckoTerminal.

Config parser:

- required env validation
- defaults
- invalid absolute URL
- missing token
- missing pool address
- invalid positive integers
- wrong network/timeframe/source
- `GECKO_SYMBOL` defaults to `SOL/USDC` and rejects any other value

Gecko client:

- URL construction uses `URL` and `URLSearchParams`
- path segments are encoded
- first provider call is immediate
- provider rate limiter is created once per collector process, not per fetch
- provider calls after the first are spaced by `60000 / maxCallsPerMinute`
- retries are rate limited
- injectable `now?: () => number` makes limiter tests deterministic
- request timeout
- timeout aborts become `RequestTimeoutError`
- network/transport failures are retryable
- protocol/programmer errors are non-retryable unless explicitly classified
- 429/5xx converted to retryable `HttpError`
- non-429 4xx converted to non-retryable `HttpError`
- invalid 2xx JSON is `ProtocolError`

Normalizer:

- Unix seconds to Unix milliseconds
- 1h timestamp alignment
- non-array rows are malformed
- rows with `length !== 6` are malformed, including missing or extra fields
- malformed rows dropped
- invalid OHLCV rows dropped
- exact duplicate kept once and excluded from corruption guard
- conflicting duplicate timestamp drops all rows for that timestamp
- `corruptionDroppedCount / providerRowCount > 0.10` blocks POST
- division by zero is guarded
- `config.geckoLookback >= 50 && validCount < 50` blocks POST
- final candles sorted by `unixMs ASC`

Ingest client:

- payload shape matches `CandleIngestRequest`
- `X-Candles-Ingest-Token` header is set
- token and token-bearing request headers are never logged
- URL uses `/v1/candles` relative to `REGIME_ENGINE_URL`
- 429/5xx retry
- non-429 4xx no retry
- 200 with `rejectedCount > 0` warns and succeeds without retry
- response validates `schemaVersion === "1.0"` and all count fields as
  non-negative integers
- invalid response JSON is `ProtocolError`

Retry helper:

- max 3 attempts
- `initialBackoffMs * 2 ** (attempt - 1)`
- max backoff cap
- bounded injectable jitter
- retryable vs non-retryable error behavior

Collector loop:

- first cycle runs immediately
- sleeps after cycle completes
- runtime cycle failure logs then sleeps
- startup config failure is fatal
- shutdown during sleep exits
- shutdown after fetch skips ingest
- shutdown during ingest lets request finish or timeout
- no overlapping cycles
- ESM entrypoint guard prevents imports from starting the loop

Package/docs:

- `start:gecko` points to `dist/src/workers/geckoCollector.js`
- `start` points to `dist/src/server.js`
- README/runbook document two Railway services
- `.env.example` uses placeholders, including
  `GECKO_POOL_ADDRESS=<confirm-before-production>`

## Acceptance Mapping

This design satisfies issue #18 by adding only the external GeckoTerminal
collector worker, package scripts, tests, and deployment docs. It does not
reimplement candle ingestion, candle storage, closed-candle selection,
freshness checks, classification, or CLMM suitability. Those remain owned by
the existing `regime-engine` HTTP and engine paths.
