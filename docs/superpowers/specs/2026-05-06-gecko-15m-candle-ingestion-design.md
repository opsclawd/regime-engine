# Gecko 15m Candle Ingestion Design

- **Issue:** [#41](https://github.com/opsclawd/regime-engine/issues/41)
- **Follow-up:** [#42](https://github.com/opsclawd/regime-engine/issues/42)
- **Date:** 2026-05-06
- **Status:** Approved design, pending written-spec review
- **Target repo:** `regime-engine`

## Problem

`regime-engine` currently treats `1h` as the only candle timeframe across several
different concepts: candle ingest contract, stored candle feed identity, Gecko
collector config, GeckoTerminal OHLCV URL construction, normalization alignment,
OpenAPI, docs, and the temporary market-regime read path.

That is no longer the desired architecture. The canonical provider candle layer
must store GeckoTerminal SOL/USDC candles at 15-minute granularity. The primary
regime classifier should return to `1h` only after #42 derives complete 1h
candles from stored 15m data. Provider-ingested `1h` candles must not remain as
a silent compatibility path or a second source of truth.

## Goals

- Make canonical provider candle ingestion and storage `15m` only.
- Retire the vague shared `SupportedTimeframe` type where practical.
- Add separate timeframe types for candle ingestion and regime reads.
- Keep #41 behavior `15m` only for both `POST /v1/candles` and the temporary
  `GET /v1/regime/current` path.
- Configure GeckoTerminal OHLCV requests for 15-minute candles with
  `include_empty_intervals=true`.
- Retune the temporary market-regime read config for 15m bars so real-time
  lookback horizons do not shrink by 75%.
- Keep `buildRegimeCurrent` source-agnostic.
- Avoid any database migration.
- Document #41 as a breaking consumer contract change until #42 restores derived
  `1h` regime reads.

## Non-Goals

- No derived 1h candle aggregation in #41.
- No `GET /v1/regime/current?timeframe=1h` support in #41.
- No provider-ingested `1h` fallback.
- No runtime timeframe switching.
- No full multi-timeframe production support.
- No 15m veto or early-warning regime logic.
- No storage schema change unless implementation discovers a concrete failing
  reason.
- No on-chain OHLCV aggregation or execution logic.

## Architecture

Introduce domain-specific timeframe types in `src/contract/v1/types.ts`:

```ts
export type CandleIngestTimeframe = "15m";
export type RegimeReadTimeframe = "15m";
```

Delete or retire `SupportedTimeframe` anywhere it currently hides the difference
between stored provider candles and regime read requests. The ingest contract
uses `CandleIngestTimeframe`; the regime current query and response use
`RegimeReadTimeframe`.

The ledger schema remains unchanged. Both SQLite and Postgres candle revision
stores already keep `timeframe` as part of the feed identity string, and the
existing indexes are keyed by timeframe. #41 should keep writing and reading
stored candles with `timeframe = "15m"` only.

`MARKET_REGIME_CONFIG` becomes keyed by `"15m"` only for this transitional
state. The config is explicitly temporary; #42 will add
`RegimeReadTimeframe = "1h"`, read stored `15m` candles, derive complete 1h
buckets, and run the classifier against restored 1h config.

`buildRegimeCurrent` stays source-agnostic. It should not know whether candles
were provider-ingested, stored, or derived. It receives a feed identity, candles,
config, and version metadata, then returns a regime response. The handler owns
which candles to read and which timeframe identity to report.

## Component Changes

### Contract Types

Update `src/contract/v1/types.ts`:

- Add `CandleIngestTimeframe = "15m"`.
- Add `RegimeReadTimeframe = "15m"`.
- Remove `SupportedTimeframe` from candle ingest and regime current types.
- Set `CandleIngestRequest.timeframe` to `CandleIngestTimeframe`.
- Set `RegimeCurrentQuery.timeframe` and `RegimeCurrentResponse.timeframe` to
  `RegimeReadTimeframe`.

If other older plan or report fixtures use arbitrary market timeframe strings,
leave those unrelated fields unchanged.

### Contract Validation

Update `src/contract/v1/validation.ts`:

- Replace the shared allowlist with separate constants:

```ts
const CANDLE_INGEST_TIMEFRAMES = ["15m"] as const;
const REGIME_READ_TIMEFRAMES = ["15m"] as const;
```

- Use a 15m ingest alignment map:

```ts
const CANDLE_INGEST_TIMEFRAME_TO_MS: Record<CandleIngestTimeframe, number> = {
  "15m": 15 * 60 * 1000
};
```

- `parseCandleIngestRequest` must reject `timeframe: "1h"`.
- `parseRegimeCurrentQuery` must reject `timeframe=1h` until #42.
- Existing malformed OHLCV, duplicate `unixMs`, batch size, and schema version
  errors keep their current taxonomy.

### Market Regime Config

Update `src/engine/marketRegime/config.ts` to use `15m`:

```ts
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const MARKET_REGIME_CONFIG: Record<"15m", MarketTimeframeConfig> = {
  "15m": {
    timeframe: "15m",
    timeframeMs: FIFTEEN_MINUTES_MS,
    indicators: {
      volShortWindow: 32,
      volLongWindow: 84,
      trendWindow: 56,
      compressionWindow: 80
    },
    regime: {
      confirmBars: 2,
      minHoldBars: 0,
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },
    suitability: {
      allowedVolRatioMax: 1.3,
      extremeVolRatio: 1.6,
      extremeCompression: 0.18,
      minCandles: 120
    },
    freshness: {
      closedCandleDelayMs: 2 * 60 * 1000,
      softStaleMs: 25 * 60 * 1000,
      hardStaleMs: 35 * 60 * 1000
    }
  }
};
```

This preserves approximately the old real-time horizons while using 15m bars.
Thresholds can be refined later, but the implementation must not reuse old 1h
bar counts on 15m candles.

### Regime Current Handler

`src/http/handlers/regimeCurrent.ts` keeps the existing stateless direct-read
shape, but all lookups use the validated `RegimeReadTimeframe = "15m"`.

The handler:

1. Parses `timeframe=15m`.
2. Selects `MARKET_REGIME_CONFIG["15m"]`.
3. Computes the 15m closed-candle cutoff.
4. Reads stored `15m` candles from the configured candle store.
5. Calls source-agnostic `buildRegimeCurrent`.
6. Returns `timeframe: "15m"`.

If a caller sends `timeframe=1h`, the request fails validation in #41. #42 owns
restoring `1h` as a derived read timeframe.

### Gecko Collector Config

Update `src/workers/gecko/config.ts`:

- Allow/default only `GECKO_TIMEFRAME=15m`.
- Default `GECKO_POLL_INTERVAL_MS` to `60000`.
- Keep `GECKO_LOOKBACK=200`, which represents about 50 hours of 15m candles and
  remains below the 1000-row ingest cap.
- Reject `GECKO_TIMEFRAME=1h` and other unsupported values.

### GeckoTerminal URL Construction

Update `src/workers/gecko/geckoClient.ts` so `"15m"` maps explicitly to
GeckoTerminal minute candles:

```text
/api/v2/networks/{network}/pools/{poolAddress}/ohlcv/minute
  ?aggregate=15
  &include_empty_intervals=true
  &limit={GECKO_LOOKBACK}
```

Build the URL with `URL` and `URLSearchParams` as today, not raw concatenation.
Path segments remain encoded. Unsupported collector timeframes throw before any
provider request is made.

Current GeckoTerminal/CoinGecko docs confirm the OHLCV endpoint supports:

- `timeframe` path values including `minute`
- `aggregate=15`
- `limit` up to 1000
- `include_empty_intervals`
- Unix-second OHLCV timestamps

Docs checked during design:

- <https://docs.coingecko.com/reference/pool-ohlcv-contract-address>
- <https://apiguide.geckoterminal.com/>

### Gecko Normalization

Update `src/workers/gecko/normalize.ts`:

- Replace the timeframe map with `15m` only.
- Remove the hidden fallback to 1h alignment.
- Throw `ProtocolError` for unsupported `config.geckoTimeframe`.
- Continue converting Gecko timestamps from Unix seconds to Unix milliseconds.
- Continue dropping malformed, invalid OHLCV, misaligned, and conflicting
  duplicate rows using the existing stats model.

Misaligned 15m rows should be dropped and counted. Unsupported timeframe config
is a protocol/configuration failure, not a silent alignment choice.

### OpenAPI And Docs

Update `src/http/openapi.ts`, `.env.example`, `README.md`, and deployment docs:

- Document `POST /v1/candles` as accepting `timeframe: "15m"` only.
- Document temporary
  `GET /v1/regime/current?...&timeframe=15m`.
- Mark #41 as a breaking consumer contract change for callers still using
  `timeframe=1h`.
- State that #42 restores `timeframe=1h` for primary regime reads by deriving
  1h candles from stored 15m data.
- Update Gecko env examples:

```env
GECKO_TIMEFRAME=15m
GECKO_LOOKBACK=200
GECKO_POLL_INTERVAL_MS=60000
```

## Data Flow

### Gecko Ingestion

1. Worker config resolves `GECKO_TIMEFRAME=15m`.
2. Gecko client requests:
   `/ohlcv/minute?aggregate=15&include_empty_intervals=true&limit=200`.
3. Normalization validates the untrusted payload and emits 15m-aligned candles.
4. Worker posts those candles to `POST /v1/candles` with `timeframe: "15m"`.
5. Contract validation rejects any non-15m timeframe and any misaligned `unixMs`.
6. Candle stores persist revisions under the feed identity that includes
   `timeframe = "15m"`.

### Temporary Regime Read

1. Caller requests `GET /v1/regime/current?...&timeframe=15m`.
2. Handler validates the query as `RegimeReadTimeframe`.
3. Handler reads stored `15m` candles directly.
4. Handler calls `buildRegimeCurrent` with 15m config.
5. Response reports `timeframe: "15m"` and existing metadata.

There is no derived candle aggregation in this flow.

## Error Handling

- `POST /v1/candles` with `timeframe: "1h"` returns the existing validation error
  shape.
- `GET /v1/regime/current?...&timeframe=1h` returns the existing validation
  error shape.
- Misaligned 15m ingest candles return `MALFORMED_CANDLE`.
- Duplicate `unixMs` values in an ingest batch return
  `DUPLICATE_CANDLE_IN_BATCH`.
- Gecko collector config rejects unsupported `GECKO_TIMEFRAME`, including `1h`.
- Gecko URL construction throws if asked to map an unsupported timeframe.
- Gecko normalization throws `ProtocolError` if config somehow contains an
  unsupported timeframe.
- Existing network, timeout, retry, corruption guard, and ingest response
  validation behavior remain unchanged.

## Testing Plan

Update or add tests in the existing colocated suites.

### Contract Validation

`src/contract/v1/__tests__/candles.validation.test.ts`:

- accepts valid `timeframe: "15m"` payload
- rejects `timeframe: "1h"` with validation error
- rejects misaligned 15m `unixMs`
- still rejects malformed OHLCV
- still rejects duplicate `unixMs`

`src/contract/v1/__tests__/regimeCurrent.validation.test.ts`:

- accepts `timeframe=15m`
- rejects `timeframe=1h`
- still rejects missing selectors and array query values

### Gecko Worker

`src/workers/gecko/__tests__/config.test.ts`:

- defaults `GECKO_TIMEFRAME` to `15m`
- defaults `GECKO_POLL_INTERVAL_MS` to `60000`
- accepts explicit `GECKO_TIMEFRAME=15m`
- rejects `GECKO_TIMEFRAME=1h`
- rejects other unsupported timeframes

`src/workers/gecko/__tests__/geckoClient.test.ts`:

- builds `/ohlcv/minute`
- asserts `aggregate=15`
- asserts `include_empty_intervals=true`
- asserts `limit=200`
- keeps encoded network and pool path coverage

`src/workers/gecko/__tests__/normalize.test.ts`:

- converts Unix seconds to Unix milliseconds
- accepts 15m-aligned timestamps
- drops/counts misaligned 15m rows
- throws `ProtocolError` for unsupported timeframe config
- proves there is no 1h fallback

### Regime Current

Update market-regime config and handler tests:

- `GET /v1/regime/current?...timeframe=15m` returns a valid response using 15m
  config.
- `GET /v1/regime/current?...timeframe=1h` returns validation error in #41.
- Build-regime tests use 15m response identity while keeping
  `buildRegimeCurrent` source-agnostic.
- Snapshot tests are updated only where the expected timeframe/config values
  necessarily change.

### Ledger And Existing Fixtures

No ledger behavior change is expected. Tests that write candle feed identities
should use `15m` for candle ingest/regime-current paths. Unrelated plan,
weekly-report, and S/R timeframe fixtures can keep their existing values when
they are not testing the candle ingest contract.

## Deployment Coordination

#41 is a breaking consumer contract change until #42 lands.

Before deploying #41:

- Confirm GeckoTerminal still returns reliable SOL/USDC 15m pool OHLCV data.
- Update Gecko collector service env:
  - `GECKO_TIMEFRAME=15m`
  - `GECKO_LOOKBACK=200`
  - `GECKO_POLL_INTERVAL_MS=60000`
- Identify every BFF/frontend/config consumer of
  `GET /v1/regime/current?...timeframe=1h`.
- Either coordinate those consumers to call `timeframe=15m` temporarily or deploy
  #41 only in a window where #42 follows immediately.
- Do not keep `1h` in #41 as a compatibility fallback.

After #42:

- Primary regime consumers should return to `timeframe=1h`.
- The read path should derive complete 1h buckets from stored 15m candles.
- Response metadata should show:

```ts
metadata: {
  sourceTimeframe: "15m",
  derivedTimeframe: "1h"
}
```

## Acceptance Criteria

- `POST /v1/candles` accepts valid `timeframe: "15m"` payloads.
- `POST /v1/candles` rejects `timeframe: "1h"`.
- `POST /v1/candles` rejects 15m candles whose `unixMs` is not aligned to
  `15 * 60 * 1000`.
- `GET /v1/regime/current` accepts `timeframe=15m`.
- `GET /v1/regime/current` rejects `timeframe=1h` until #42.
- `GET /v1/regime/current` uses `MARKET_REGIME_CONFIG["15m"]`.
- `buildRegimeCurrent` remains source-agnostic.
- Gecko collector allows/defaults `GECKO_TIMEFRAME=15m`.
- Gecko collector rejects `GECKO_TIMEFRAME=1h`.
- Gecko collector requests `/ohlcv/minute` with `aggregate=15`,
  `include_empty_intervals=true`, and `limit=200` by default.
- Gecko normalization validates 15m alignment and has no hidden 1h fallback.
- Candle stores continue using timeframe as part of feed identity without schema
  changes.
- No database migration is added.
- Docs/env examples are updated from `1h` to `15m` for ingestion/storage.
- Docs explicitly state that primary derived 1h regime reads are tracked in #42.
- Docs mark #41 as a breaking consumer contract change until #42.
- Tests cover contract validation, collector config, Gecko URL construction,
  normalization, and regime-current query validation.

## #42 Boundary

#42 is the derived 1h read-path PR. It should:

- Add `RegimeReadTimeframe = "1h"` while keeping `CandleIngestTimeframe = "15m"`.
- Read stored 15m candles for regime-current requests.
- Aggregate only complete 4x15m buckets into 1h candles.
- Exclude incomplete current-hour aggregates.
- Run the classifier on restored 1h config.
- Return metadata showing `sourceTimeframe = "15m"` and
  `derivedTimeframe = "1h"`.
- Never reintroduce provider-ingested 1h candles as a canonical source.
