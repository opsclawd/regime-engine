---
title: Derived Timeframe Aggregation Pattern
date: 2026-05-06
category: best-practices
module: engine
problem_type: best_practice
component: service_object
severity: low
applies_when:
  - Adding a derived timeframe that aggregates from stored source candles rather than ingesting separately
  - Extending RegimeReadTimeframe with a new value that has no corresponding CandleIngestTimeframe
  - Building a read-plan that decides between direct and derived candle sources based on config
  - Deciding whether to persist aggregated candles or compute them at read time
  - Adding metadata tracing fields to responses that serve derived data
related_components:
  - http
  - engine/candles
tags:
  - candle-aggregation
  - derived-timeframe
  - read-plan
  - regime-engine
  - metadata-tracing
  - ohlcv
---

# Derived Timeframe Aggregation Pattern

## Context

The regime-engine originally migrated from 1h to 15m candle ingestion (documented in [15m Candle Timeframe Migration](./15m-candle-timeframe-migration-2026-05-06.md)). Once 15m was the only stored timeframe, consumers that needed 1h regime signals had no way to get them without separately ingesting 1h candles — duplicating data pipelines and storage. The friction was: **how do you serve a coarser-grained view from a finer-grained source of truth, without duplicating ingest or storage?**

The m41 migration had already split `CandleIngestTimeframe` (`"15m"` only) from `RegimeReadTimeframe` (`"15m" | "1h"`), but the `"1h"` option was a placeholder that validation rejected. Milestone m42 filled it in by aggregating 15m candles into 1h candles at read time.

## Guidance

### 1. Keep aggregation pure — no store access, no logging, no domain imports

The `aggregateCandles` function takes `Candle[]` and a target timeframe, produces `Candle[]`. It has zero imports from the engine domain layer (`marketRegime/`) and no I/O. This makes it trivially testable, deterministic, and safe to call from any context:

```ts
// src/engine/candles/aggregateCandles.ts
export const aggregateCandles = (
  candles: Candle[],
  target: AggregationTargetTimeframe
): Candle[] => {
  // Groups into buckets, validates alignment & completeness,
  // derives OHLCV. Incomplete/misaligned buckets silently skipped.
};
```

The aggregator enforces two integrity checks before emitting a derived candle: **exact count** (a 1h bucket must have exactly 4 source candles) and **sequential alignment** (timestamps must match `bucketOpen + i * sourceTimeframeMs`). Misaligned, incomplete, or non-integer timestamps are silently skipped — the handler decides whether to throw based on the result count.

### 2. Compute all read parameters in a single plan function

The handler should never compute cutoffs, limits, or metadata hints inline. A pure `buildRegimeCandleReadPlan` function produces everything the handler needs:

```ts
// src/engine/marketRegime/regimeCandleReadPlan.ts
export const buildRegimeCandleReadPlan = (
  input: BuildRegimeCandleReadPlanInput
): RegimeCandleReadPlan => {
  // For "15m" (direct): sourceCutoff, sourceLimit, DirectMetadataHints
  // For "1h" (derived): sourceCutoff, sourceLimit (4x + buffer),
  //                      derivedCutoff, DerivedMetadataHints
};
```

The plan encodes:

- **Source multiplier**: 1h needs 4× source candles, plus a buffer (`DERIVED_SOURCE_READ_BUFFER_15M = 32`) for alignment gaps.
- **Dual cutoffs**: for derived timeframes, the plan computes both `sourceCutoffUnixMs` (source freshness) and `derivedCutoffUnixMs` (derived freshness). These differ because a source candle can be recent enough to read, but the derived candle it belongs to may still be incomplete (e.g., only 2 of 4 source bars available).
- **Metadata hints**: `DirectMetadataHints` vs `DerivedMetadataHints` as a discriminated union so the handler can spread them into the response.

Prefer narrowing on the plan's discriminated union (`plan.metadataHints.derivedTimeframe`) rather than checking `query.timeframe === "1h"` when branching, so the type system carries whether `derivedCutoffUnixMs` is present.

### 3. Handler orchestrates; never computes domain logic

```ts
// src/http/handlers/regimeCurrent.ts
const plan = buildRegimeCandleReadPlan({ requestedTimeframe, nowUnixMs });
const sourceCandles = await readCandles(plan.sourceTimeframe, plan.sourceLimit, ...);

let classifiedCandles = sourceCandles;
if (query.timeframe === "1h") {
  const aggregated = aggregateCandles(sourceCandles, "1h");
  classifiedCandles = aggregated.filter(c => c.unixMs <= plan.derivedCutoffUnixMs!);
  if (classifiedCandles.length === 0) {
    throw candlesNotFoundError(/* derived-specific message */);
  }
}

const response = buildRegimeCurrent({
  metadata: { ...plan.metadataHints, sourceCandleCount: sourceCandles.length }
});
```

No cutoff math, no limit multiplication, no metadata assembly in the handler.

### 4. Make derivation transparent via metadata

Callers must know whether data was aggregated. The response metadata exposes this:

```ts
// src/contract/v1/types.ts
export interface RegimeCurrentMetadata {
  engineVersion: string;
  configVersion: string;
  candleCount: number;
  sourceTimeframe: "15m"; // always present — reveals physical store
  sourceCandleCount: number; // how many 15m rows were read
  derivedTimeframe?: "1h"; // present only when aggregation was applied
  aggregationVersion?: "ohlcv-agg-v1"; // algorithm version for cache-busting
}
```

The `metadataHints` from the plan spread directly into this shape — no handler-side branching needed for metadata construction.

### 5. Use Record<UnionType, ...> to force exhaustive config

When `"1h"` was added to `RegimeReadTimeframe`, the TypeScript compiler immediately flagged every file that accessed `MARKET_REGIME_CONFIG` — because it's typed as `Record<RegimeReadTimeframe, MarketTimeframeConfig>`. Add the union member first, let the compiler enumerate every missing implementation, then fill in the config entry.

## Why This Matters

- **Storage stays canonical** — only 15m candles are stored; 1h is a derived view, not a duplicate pipeline.
- **Read-time derivation is observable** — metadata fields let callers reason about provenance; `aggregationVersion` enables cache-busting when the algorithm changes.
- **The compiler enforces completeness** — `Record<RegimeReadTimeframe, ...>` forces every downstream lookup to handle new timeframes.
- **Handler stays thin** — cutoffs, limits, multipliers, and metadata are all in the plan; the handler is a pure orchestrator.

## Examples

### Aggregation internals (bucket validation and OHLCV derivation)

```ts
const buckets = new Map<number, Candle[]>();
for (const candle of candles) {
  if (!Number.isInteger(candle.unixMs)) continue; // skip non-integer timestamps
  if (candle.unixMs % srcMs !== 0) continue; // skip misaligned timestamps
  const bucketOpen = Math.floor(candle.unixMs / bucketMs) * bucketMs;
  // ... assign to bucket
}

for (const [bucketOpen, sources] of buckets) {
  if (sources.length !== required) continue; // incomplete bucket → skip
  sources.sort((a, b) => a.unixMs - b.unixMs);
  let complete = true;
  for (let i = 0; i < required; i += 1) {
    if (sources[i].unixMs !== bucketOpen + i * srcMs) {
      // sequential alignment check
      complete = false;
      break;
    }
  }
  if (!complete) continue;

  // Derive OHLCV from source candles
  out.push({
    unixMs: bucketOpen,
    open: sources[0].open,
    high: Math.max(...sources.map((s) => s.high)),
    low: Math.min(...sources.map((s) => s.low)),
    close: sources[required - 1].close,
    volume: sources.reduce((sum, s) => sum + s.volume, 0)
  });
}
```

## Related

- [15m Candle Timeframe Migration Pattern](./15m-candle-timeframe-migration-2026-05-06.md) — the m41 migration that established `CandleIngestTimeframe` vs `RegimeReadTimeframe`. This doc extends that pattern with read-time derivation.
- [Market Regime Endpoint Patterns](./market-regime-endpoint-patterns-2026-04-27.md) — per-slot candle batch ingestion, timeframe-aware cutoff logic, stateless read-through pipeline.
- GitHub #41 — "Switch Gecko candle ingestion and regime pipeline to 15m candles"
- GitHub #42 — "Add derived 1h candle aggregation from canonical 15m candles"
