# Derived 1h Candle Aggregation Design

Date: 2026-05-06
Issue: https://github.com/opsclawd/regime-engine/issues/42

## Purpose

Regime Engine should keep provider-ingested candles canonical at `15m` while allowing the primary market-regime classifier to run on complete derived `1h` candles. The `15m` direct regime read remains available for diagnostics and later early-warning or veto work.

This design adds an on-demand in-memory `1h` derivation path for `GET /v1/regime/current?timeframe=1h`. It does not add derived candle storage and does not re-enable provider-ingested `1h` candles.

## Goals

- Keep `POST /v1/candles` restricted to provider `15m` candles.
- Widen only the regime-read timeframe contract to `15m | 1h`.
- Derive complete `1h` candles from stored latest-revision `15m` candles.
- Classify direct `15m` requests with the `15m` market-regime config.
- Classify derived `1h` requests with the restored `1h` market-regime config.
- Exclude incomplete or future current-hour aggregates from classification.
- Make direct-vs-derived reads observable in the public API response metadata.
- Keep aggregation deterministic, pure, and reusable for later derived timeframes.

## Non-Goals

- No provider-ingested `1h` candles.
- No materialized derived candle table or migration.
- No broad candle read service abstraction.
- No full multi-timeframe classifier.
- No `15m` veto or early-warning policy.
- No on-chain execution logic.

## Public Contract

`CandleIngestTimeframe` remains narrow:

```ts
export type CandleIngestTimeframe = "15m";
```

`RegimeReadTimeframe` becomes:

```ts
export type RegimeReadTimeframe = "15m" | "1h";
```

`RegimeCurrentResponse.metadata` becomes stricter where values are always known:

```ts
metadata: {
  engineVersion: string;
  configVersion: string;
  candleCount: number;
  sourceTimeframe: "15m";
  sourceCandleCount: number;
  derivedTimeframe?: "1h";
  aggregationVersion?: "ohlcv-agg-v1";
}
```

For direct `15m` reads:

- `candleCount` is the classified `15m` candle count.
- `sourceTimeframe` is `"15m"`.
- `sourceCandleCount` equals `candleCount`.
- `derivedTimeframe` is omitted.
- `aggregationVersion` is omitted.

For derived `1h` reads:

- `candleCount` is the derived `1h` candle count used for classification.
- `sourceTimeframe` is `"15m"`.
- `sourceCandleCount` is the actual number of `15m` rows returned by the store before aggregation and derived-cutoff filtering.
- `derivedTimeframe` is `"1h"`.
- `aggregationVersion` is `"ohlcv-agg-v1"`.

## Components

### `src/engine/candles/aggregateCandles.ts`

A dumb, pure candle math utility.

Responsibilities:

- Accept source candles plus target timeframe.
- Support `aggregateCandles(candles, "1h")`.
- Sort input internally by `unixMs`.
- Aggregate only exact complete `HH:00`, `HH:15`, `HH:30`, `HH:45` source buckets.
- Skip incomplete buckets.
- Skip misaligned source candles.
- Never synthesize missing source candles.
- Never aggregate across hour boundaries.
- Emit sorted derived candles.

The utility has no store access, no market-regime config access, no metadata construction, and no logging.

Derived `1h` OHLCV formula:

- `open`: first `15m` open.
- `high`: maximum high across the four `15m` candles.
- `low`: minimum low across the four `15m` candles.
- `close`: last `15m` close.
- `volume`: sum of volume across the four `15m` candles.
- `unixMs`: `1h` bucket open timestamp.

### `src/engine/marketRegime/regimeCandleReadPlan.ts`

A tiny pure helper for regime-specific read policy and math.

Responsibilities:

- Decide the stored source timeframe for a requested regime-read timeframe.
- Compute source read limits.
- Compute source and derived cutoffs.
- Return static metadata hints for direct and derived reads. The handler fills count fields after reading and selecting candles.

For direct `15m`, the helper returns:

- `sourceTimeframe: "15m"`
- `sourceCutoffUnixMs` using the `15m` timeframe and `15m` freshness config.
- `sourceLimit = max(volLongWindow, minCandles) + READ_BUFFER`
- no `derivedCutoffUnixMs`
- direct static metadata hints.

For derived `1h`, the helper returns:

- `sourceTimeframe: "15m"`
- `sourceCutoffUnixMs` using the `15m` timeframe and `15m` freshness config.
- `derivedCutoffUnixMs` using the `1h` timeframe and `1h` freshness config.
- `requiredDerivedBars = max(volLongWindow, minCandles) + READ_BUFFER`
- `sourceLimit = requiredDerivedBars * 4 + DERIVED_SOURCE_READ_BUFFER_15M`
- derived static metadata hints.

Constants:

```ts
const READ_BUFFER = 50;
const FIFTEEN_MINUTES_PER_HOUR = 4;
const DERIVED_SOURCE_READ_BUFFER_15M = 32;
```

### `src/http/handlers/regimeCurrent.ts`

The handler owns orchestration.

Responsibilities:

- Parse and validate the requested regime-read timeframe.
- Select market-regime config by requested timeframe.
- Build a regime candle read plan.
- Read latest-revision source candles from the existing candle store path.
- For direct `15m`, classify source candles directly.
- For derived `1h`, aggregate source `15m` candles, filter by derived cutoff, and classify derived candles.
- Preserve response `timeframe` as the requested timeframe.
- Pass caller-supplied metadata additions to `buildRegimeCurrent`.

### `src/engine/marketRegime/buildRegimeCurrent.ts`

`buildRegimeCurrent` remains source-agnostic.

It may accept caller-supplied metadata additions, but it must not decide whether the candles are direct or derived. It receives already-selected candles, computes regime response fields, and merges the supplied metadata fields into `metadata`.

## Handler Flow

### Direct `timeframe=15m`

1. Validate the query.
2. Load `MARKET_REGIME_CONFIG["15m"]`.
3. Build a read plan for `15m`.
4. Read stored latest-revision `15m` candles using `sourceCutoffUnixMs` and `sourceLimit`.
5. If the source read returns zero rows, return existing `CANDLES_NOT_FOUND`.
6. Call `buildRegimeCurrent` with the source candles and requested feed timeframe `15m`.
7. Return metadata with `sourceTimeframe: "15m"` and `sourceCandleCount` equal to the classified candle count.

### Derived `timeframe=1h`

1. Validate the query.
2. Load `MARKET_REGIME_CONFIG["1h"]`.
3. Build a read plan for `1h`.
4. Read stored latest-revision `15m` candles using `sourceCutoffUnixMs` and `sourceLimit`.
5. If the source read returns zero rows, return existing `CANDLES_NOT_FOUND`.
6. Aggregate complete `1h` candles with `aggregateCandles(sourceCandles, "1h")`.
7. Filter derived candles with `unixMs <= derivedCutoffUnixMs`.
8. If filtering leaves zero derived candles, return `CANDLES_NOT_FOUND` with a derived-specific message.
9. Call `buildRegimeCurrent` with derived candles, requested feed timeframe `1h`, and `MARKET_REGIME_CONFIG["1h"]`.
10. Return metadata identifying the source and aggregation:
    - `sourceTimeframe: "15m"`
    - `sourceCandleCount: sourceCandles.length`
    - `derivedTimeframe: "1h"`
    - `aggregationVersion: "ohlcv-agg-v1"`

If derived aggregation/filtering returns nonzero but fewer than `MARKET_REGIME_CONFIG["1h"].suitability.minCandles`, call `buildRegimeCurrent` and let the existing insufficient-samples response behavior apply.

## Cutoff And No-Lookahead Rules

Direct `15m` reads use the `15m` config and the `15m` closed-candle cutoff.

Derived `1h` reads compute two cutoffs:

- `sourceCutoffUnixMs`: based on the `15m` timeframe and `15m` freshness config.
- `derivedCutoffUnixMs`: based on the `1h` timeframe and `1h` freshness config.

The handler must:

1. Read source `15m` rows up to `sourceCutoffUnixMs`.
2. Aggregate complete `1h` buckets from source rows.
3. Filter derived candles with `unixMs <= derivedCutoffUnixMs`.
4. Classify only the filtered derived candles.

A derived `1h` candle for `HH:00` may use only `HH:00`, `HH:15`, `HH:30`, and `HH:45` source candles. It must not use future candles and must not be emitted unless the full bucket exists.

## Configuration

`MARKET_REGIME_CONFIG` should become:

```ts
export const MARKET_REGIME_CONFIG: Record<RegimeReadTimeframe, MarketTimeframeConfig> = {
  "15m": {
    // existing post-#41 15m config
  },
  "1h": {
    // restored 1h config
  }
};
```

`MarketTimeframeConfig.timeframe` should use `RegimeReadTimeframe`.

The `15m` config remains the post-#41 direct diagnostic config. The `1h` config is restored for primary market-regime classification.

## Validation

Validation remains split:

```ts
const CANDLE_INGEST_TIMEFRAMES = ["15m"] as const;
const REGIME_READ_TIMEFRAMES = ["15m", "1h"] as const;
```

Required behavior:

- `POST /v1/candles` accepts `timeframe: "15m"`.
- `POST /v1/candles` rejects `timeframe: "1h"`.
- `GET /v1/regime/current?timeframe=15m` validates.
- `GET /v1/regime/current?timeframe=1h` validates.
- Unsupported regime-read timeframes still reject.

No shared vague `SupportedTimeframe` should be introduced.

## Testing Plan

### Aggregation Utility

Add tests under `src/engine/candles/__tests__/aggregateCandles.test.ts`:

- Four aligned `15m` candles produce one `1h` candle.
- Open, high, low, close, and volume are correct.
- Output `unixMs` is the `1h` bucket open timestamp.
- Input order does not matter.
- Output is sorted ascending.
- Incomplete buckets are skipped.
- Missing middle candles skip the bucket.
- Misaligned source timestamps are skipped.
- Aggregation never crosses hour boundaries.

### Read Plan

Add tests under `src/engine/marketRegime/__tests__/regimeCandleReadPlan.test.ts`:

- Direct `15m` uses source timeframe `15m`.
- Direct `15m` computes source cutoff from the `15m` config.
- Direct `15m` uses `max(volLongWindow, minCandles) + READ_BUFFER`.
- Derived `1h` uses source timeframe `15m`.
- Derived `1h` computes `sourceCutoffUnixMs` from the `15m` config.
- Derived `1h` computes `derivedCutoffUnixMs` from the `1h` config.
- Derived `1h` computes `sourceLimit = requiredDerivedBars * 4 + DERIVED_SOURCE_READ_BUFFER_15M`.
- Metadata hints match direct and derived reads.

### Contract Validation

Update validation tests:

- `POST /v1/candles` still accepts `15m`.
- `POST /v1/candles` still rejects `1h`.
- `GET /v1/regime/current?timeframe=15m` accepts.
- `GET /v1/regime/current?timeframe=1h` accepts.
- Unsupported regime-read timeframes still reject.

### Regime Current Handler

Update e2e tests:

- Direct `15m` reads stored `15m` candles and returns `timeframe: "15m"`.
- Direct `15m` metadata includes `sourceTimeframe: "15m"` and `sourceCandleCount === candleCount`.
- Derived `1h` reads stored `15m` candles and returns `timeframe: "1h"`.
- Derived `1h` classifies with `MARKET_REGIME_CONFIG["1h"]`.
- Derived `1h` metadata includes `sourceTimeframe`, `sourceCandleCount`, `derivedTimeframe`, and `aggregationVersion`.
- Derived path excludes incomplete current-hour buckets.
- Derived zero usable candles returns `CANDLES_NOT_FOUND`.
- Derived nonzero-but-insufficient candles uses existing insufficient-samples behavior.
- Latest-revision duplicate handling occurs through the existing store query before aggregation.

## Acceptance Criteria

- `CandleIngestTimeframe` remains `"15m"`.
- `RegimeReadTimeframe` becomes `"15m" | "1h"`.
- Provider ingestion remains `15m` only.
- `GET /v1/regime/current?timeframe=1h` derives complete `1h` candles from stored latest-revision `15m` rows.
- Incomplete current-hour aggregates are not classified.
- Missing source buckets are not synthesized.
- Classification uses the config for the requested regime-read timeframe.
- Response timeframe remains the requested timeframe.
- Metadata makes direct-vs-derived reads observable.
- No database storage or migration is added for derived candles.
- No provider `1h` ingestion path is added.
