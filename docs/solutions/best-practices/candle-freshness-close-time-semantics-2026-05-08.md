---
title: Candle Freshness Close-Time Semantics for Derived Timeframes
date: 2026-05-08
category: best-practices
module: engine/marketRegime
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - Computing data freshness (staleness) for timeframes derived by aggregating shorter candles
  - Measuring how old the last candle is when the stored timestamp is bucket-open, not bucket-close
  - Adding or modifying freshness fields for regime or plan endpoints
  - Deciding whether age should be measured from candle open or candle close
related_components:
  - contract/v1
  - http
tags:
  - candle-freshness
  - derived-timeframe
  - staleness
  - regime-engine
  - close-time
  - aggregation
---

# Candle Freshness Close-Time Semantics for Derived Timeframes

## Context

The regime-engine stores candles with `unixMs` as the bucket-open timestamp (e.g., a 1h candle covering `[01:00, 02:00)` has `unixMs = 01:00`). The freshness calculation originally measured `ageSeconds` from this open timestamp. For direct 15m candles, open-age and close-age differ by only 15 minutes — tolerable. But for derived 1h candles aggregated from 15m source data, the open-age reported a 1h candle that closed at 02:00 as being **108 minutes old** at 02:48 (measuring from 01:00 open), when the data was actually only **48 minutes old** (measuring from 02:00 close). This made healthy 1h data appear hard-stale, triggering false `DATA_HARD_STALE` reasons and blocking trading signals.

The fix moved to **close-time semantics**: `computeFreshness` now receives `timeframeMs` alongside the open timestamp, computes `lastCandleCloseUnixMs = lastCandleOpenUnixMs + timeframeMs`, and measures `ageSeconds` from the close boundary. For 15m candles, close = open + 15m; for 1h candles, close = open + 1h — no special-casing needed.

## Guidance

### 1. `computeFreshness` owns the open→close conversion

Callers pass `lastCandleOpenUnixMs` plus `timeframeMs`. The function emits both `lastCandleOpenUnixMs/Iso` and `lastCandleCloseUnixMs/Iso`, computes `ageMs = max(0, now - close)`, and derives staleness from the close age. No caller should compute close timestamps independently.

```ts
// src/engine/marketRegime/freshness.ts
export const computeFreshness = (
  nowUnixMs: number,
  lastCandleOpenUnixMs: number,
  timeframeMs: number,
  config: FreshnessConfig
): FreshnessResult => {
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    throw new Error("timeframeMs must be a positive finite number");
  }
  const lastCandleCloseUnixMs = lastCandleOpenUnixMs + timeframeMs;
  const ageMs = Math.max(0, nowUnixMs - lastCandleCloseUnixMs);
  return {
    generatedAtIso: new Date(nowUnixMs).toISOString(),
    lastCandleOpenUnixMs,
    lastCandleOpenIso: new Date(lastCandleOpenUnixMs).toISOString(),
    lastCandleCloseUnixMs,
    lastCandleCloseIso: new Date(lastCandleCloseUnixMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    softStale: ageMs >= config.softStaleMs,
    hardStale: ageMs >= config.hardStaleMs,
    softStaleSeconds: Math.floor(config.softStaleMs / 1000),
    hardStaleSeconds: Math.floor(config.hardStaleMs / 1000)
  };
};
```

### 2. Thread `timeframeMs` from config, not from the handler

Both `buildRegimeCurrent` and `generatePlanUseCase` already have `config: MarketTimeframeConfig` in scope, which exposes `timeframeMs`. Pass it directly — don't reconstruct it from the timeframe string in the handler.

### 3. Make open/close explicit in the contract type

The `RegimeCurrentFreshness` interface mirrors `FreshnessResult` with `lastCandleOpenUnixMs`, `lastCandleOpenIso`, `lastCandleCloseUnixMs`, `lastCandleCloseIso`. The legacy `lastCandleUnixMs` / `lastCandleIso` fields are removed entirely — no aliases, no deprecated compatibility fields. Explicit naming prevents the ambiguity that caused the original bug.

### 4. Clamp future-close to `ageSeconds: 0`

When `now` is before the candle's close time (e.g., the current hour hasn't finished), `ageMs` would go negative. `Math.max(0, now - close)` clamps to zero, preventing negative ages and false stale flags.

### 5. Validate `timeframeMs` at the boundary

`computeFreshness` throws on non-positive, NaN, or infinite `timeframeMs`. This catches misconfiguration early (e.g., a zero or undefined timeframe slipping through) rather than producing silently wrong ages.

## Why This Matters

- **Derived timeframes report correct staleness** — a 1h candle that closed 5 minutes ago reports 5m old, not 65m old.
- **Single conversion point** — `computeFreshness` is the only place that knows how to turn bucket-open into bucket-close. No duplicated logic across callers.
- **Explicit naming** — `lastCandleOpenUnixMs` vs `lastCandleCloseUnixMs` eliminates the ambiguity of `lastCandleUnixMs`.
- **Zero-delta for direct timeframes** — for 15m candles, close-age is only 15m more than open-age, making the old behavior "work" by accident. The fix makes all timeframes use the same correct semantics.
- **Contract clarity** — API consumers see both open and close timestamps, making it unambiguous when the data window ends.

## When to Apply

- When adding a new timeframe to `RegimeReadTimeframe` (e.g., `"4h"`) — the `timeframeMs` and `computeFreshness` path will automatically compute correct close-time ages.
- When building any staleness or freshness check on time-series data where timestamps represent interval starts (bucket-open) rather than interval ends.
- When designing API response shapes for real-time data freshness — always expose both `open` and `close` timestamps so consumers can reason about data currency.

## Examples

### Before: derived 1h candle reported 108m stale at 02:48

```ts
// Old: age from open time (01:00) → 108 minutes at 02:48
const lastCandleUnixMs = candles[candles.length - 1].unixMs; // 01:00
const ageMs = nowUnixMs - lastCandleUnixMs; // 02:48 - 01:00 = 108m
// Result: hardStale: true at 90m threshold
```

### After: derived 1h candle reports 48m stale at 02:48

```ts
// New: age from close time (02:00) → 48 minutes at 02:48
const lastCandleOpenUnixMs = candles[candles.length - 1].unixMs; // 01:00
const freshness = computeFreshness(nowUnixMs, lastCandleOpenUnixMs, config.timeframeMs, {
  softStaleMs: config.freshness.softStaleMs,
  hardStaleMs: config.freshness.hardStaleMs
});
// Result: freshness.ageSeconds = 48 * 60, softStale: false, hardStale: false
```

### Test assertion for legacy field absence

```ts
// Ensure legacy fields are not in the response
const result = computeFreshness(now, open, ONE_HOUR_MS, config) as unknown as Record<
  string,
  unknown
>;
expect(result.lastCandleUnixMs).toBeUndefined();
expect(result.lastCandleIso).toBeUndefined();
```

## Related

- [Derived Timeframe Aggregation Pattern](./derived-candle-aggregation-pattern-2026-05-06.md) — how 1h candles are aggregated from 15m source data at read time. This freshness fix applies to the output of that aggregation.
- [15m Candle Timeframe Migration](./15m-candle-timeframe-migration-2026-05-06.md) — the migration that established 15m as the only stored timeframe.
- GitHub #52 — "Derived candle freshness reports stale when data is healthy"
