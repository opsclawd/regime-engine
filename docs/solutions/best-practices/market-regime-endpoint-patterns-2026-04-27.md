---
title: "Market Regime Endpoint Patterns: Per-Slot Batch Ingestion, Stateful Cutoff, and Four-Band Suitability"
date: "2026-04-27"
category: best-practices
module: engine
problem_type: best_practice
component: service_object
severity: low
last_updated: "2026-05-07"
applies_when:
  - Adding candle ingestion endpoints with per-slot decision trees in SQLite
  - Building stateless regime classification read endpoints from raw ledger data
  - Implementing go/no-go suitability scoring with band precedence
  - Designing batch write patterns where partial success is the normal case
  - Adding grace-window cutoffs for time-bucketed data aggregation
symptoms:
  - Unclear how to structure batch writes where each item independently succeeds or fails
  - Need for market-only regime classification without portfolio hysteresis
  - Uncertainty about CLMM suitability scoring semantics (safety gates vs scoring)
  - Questions about excluding in-progress time buckets from computations related_components:
  - http
  - ledger
  - engine/marketRegime
  - engine/regime
tags:
  - fastify
  - sqlite
  - candle-ingestion
  - regime-classification
  - clmm-suitability
  - batch-decision-tree
  - freshness
  - token-auth
  - idempotency
---

# Market Regime Endpoint Patterns: Per-Slot Batch Ingestion, Stateful Cutoff, and Four-Band Suitability

## Context

The regime-engine had one data path: `/v1/plan` ingests a brief, computes a full plan, and writes to the plan ledger. Two new needs emerged:

1. **Token-guarded candle data ingestion** — an external service pushes batches of OHLCV candles per feed. Each candle slot might already exist, might need updating, or might be too stale to accept. A batch endpoint must decide per-slot what happens (insert / idempotent / revise / reject) atomically.

2. **Public market regime classification** — consumers need to know "is this market trending up, down, or choppy right now?" and "should we deploy a CLMM position?" without needing portfolio or autopilot state. This must be computed from raw candle data on every request, with no persisted regime state.

The existing [Fastify+SQLite ingestion patterns](./fastify-sqlite-ingestion-endpoint-patterns-2026-04-18.md) cover auth, transactions, and error handling. The patterns below address what that doc doesn't: per-slot batch decisions, stateless read-through computation, and market-only classification with suitability scoring.

## Guidance

### 1. Per-Slot Decision Tree Inside a Single Transaction

When ingesting a batch where each item independently resolves to one of several outcomes, run the decision tree **row-by-row inside a single `BEGIN IMMEDIATE`** transaction. This prevents races between check-and-insert and guarantees the response is a consistent snapshot.

```typescript
// src/ledger/candlesWriter.ts — inside BEGIN IMMEDIATE:
for (const candle of validatedCandles) {
  const existing = selectCandleRevision(db, feedHash, candle.unixMs);
  const canonicalJson = toCanonicalJson(candle);

  if (!existing) {
    insertCandle(db, {
      feedHash,
      slotUnixMs: candle.unixMs,
      ingestId,
      revision: 1,
      candleJson: canonicalJson
    });
    result.inserted++;
  } else if (existing.candleJson === canonicalJson) {
    result.idempotent++; // exact match, skip
  } else if (existing.revision < MAX_REVISION) {
    insertCandle(db, {
      feedHash,
      slotUnixMs: candle.unixMs,
      ingestId,
      revision: existing.revision + 1,
      candleJson: canonicalJson
    });
    result.revised++;
  } else {
    result.rejected++;
    result.rejections.push({ unixMs: candle.unixMs, reason: "CANDLE_STALE_REVISION" });
  }
}
```

Key rules:

- **`CANDLE_STALE_REVISION` is a rejection reason, not an HTTP error.** The client gets a 200 with `{ rejected: N, rejections: [...] }`. Partial success is the normal case for batch ingestion.
- **Canonical JSON comparison** ensures structurally identical data doesn't burn a revision slot.
- **Revision cap (3)** prevents unbounded growth. If a slot has been revised 3 times, further changes are rejected.

### 2. Grace-Window Cutoff for "Closed" Candles

A candle is only eligible for regime computation if it's **closed** — enough time has passed after the candle's period ended that the data is complete. A grace window prevents half-formed candles from entering calculations.

```typescript
// src/engine/marketRegime/closedCandleCutoff.ts
// Signature updated in m42 — now takes explicit params, not a Timeframe enum
function closedCandleCutoffUnixMs(
  nowUnixMs: number,
  timeframeMs: number,
  closedCandleDelayMs: number
): number {
  // Snaps to bar boundaries, then subtracts one full bar + grace delay
  return Math.floor((nowUnixMs - closedCandleDelayMs) / timeframeMs) * timeframeMs - timeframeMs;
}
// A 15m candle at slot 14:00 is closed after 14:20 (one period + 5min grace)
```

Why a grace window instead of a strict boundary:

- Candle providers often lag by 1-2 minutes
- A strict `asOf - timeframeMs` would exclude candles that are complete but not yet ingested
- The `closedCandleDelayMs` parameter makes the grace window configurable per timeframe

### 3. Freshness Classification from Candle Age

Once you know which candles are closed, classify how fresh the latest one is. Freshness is now a structured result with boolean flags and numeric thresholds, configurable per timeframe:

```typescript
// src/engine/marketRegime/freshness.ts
// Returns a FreshnessResult object with softStale/hardStale booleans and numeric fields
// Thresholds come from MARKET_REGIME_CONFIG[timeframe].freshness
function computeFreshness(
  latestClosedUnixMs: number,
  nowUnixMs: number,
  freshnessConfig: FreshnessConfig
): FreshnessResult {
  // softStale: age exceeds soft threshold
  // hardStale: age exceeds hard threshold
  // Also provides ageSeconds, softStaleSeconds, hardStaleSeconds for telemetry
}
```

This is a **pure function** — no state, no DB, no side effects. It feeds directly into suitability scoring.

**Note (m42):** For derived 1h reads, the handler uses `buildRegimeCandleReadPlan` which computes separate cutoffs for source (15m) and derived (1h) timeframes. The freshness classification uses the derived timeframe's thresholds when aggregation is applied.

### 4. Four-Band CLMM Suitability with Band Precedence

Suitability uses precedence-ordered bands. The highest-severity band wins. The implementation uses early-return logic rather than a band array:

```typescript
// src/engine/marketRegime/evaluateMarketClmmSuitability.ts
// Semantics: UNKNOWN > BLOCKED > CAUTION > ALLOWED
// Implementation: early returns check minCandles/hardStale first, then blocks, then cautions

function evaluateMarketClmmSuitability(
  regime: MarketRegime,
  freshnessResult: FreshnessResult,
  candleCount: number,
  config: FreshnessConfig
): ClmmSuitability {
  // UNKNOWN: insufficient data (too few candles or hard-stale data)
  if (candleCount < config.minCandles) return { band: "UNKNOWN", reasons: [...] };
  if (freshnessResult.hardStale) return { band: "UNKNOWN", reasons: [...] };

  // BLOCKED: regime conditions make CLMM unsafe
  const blockedReasons = [...];
  if (blockedReasons.length > 0) return { band: "BLOCKED", reasons: blockedReasons };

  // CAUTION: data quality concerns but regime allows
  const cautionReasons = [...];
  if (cautionReasons.length > 0) return { band: "CAUTION", reasons: cautionReasons };

  // ALLOWED: all clear
  return { band: "ALLOWED", reasons: [...] };
}
```

Critical design rule: **a single `BLOCKED` reason makes the entire result `BLOCKED`** regardless of how many `ALLOWED` reasons exist. This is not a scoring model — it's a safety gate. The precedence order `UNKNOWN > BLOCKED > CAUTION > ALLOWED` means missing data is always the worst outcome.

### 5. Stateless Read-Through from Ledger Data

The `/v1/regime/current` endpoint computes everything from raw candle data on every request. No regime state is persisted. The pipeline is:

```
parseRegimeCurrentQuery → buildRegimeCandleReadPlan → getLatestCandlesForFeed
  → [aggregate15mTo1h if derived] → buildRegimeCurrent → response
```

`buildRegimeCandleReadPlan` replaces the handler-level cutoff and limit computation. It produces a `RegimeCandleReadPlan` (discriminated union: `direct` or `derived` mode) with all read parameters: source cutoff, source limit, derived cutoff (if applicable), and source metadata. For derived 1h reads, the handler aggregates 15m candles into 1h buckets before passing them to `buildRegimeCurrent`. See [Derived Timeframe Aggregation Pattern](./derived-candle-aggregation-pattern-2026-05-06.md).

This pattern trades compute cost for correctness guarantees:

- No stale regime state
- No migration when classification logic changes
- No background job to maintain
- Response always reflects the latest available candle data

The trade-off: every request does a DB read + indicator computation. For a microservice with bounded request volume, this is acceptable. If throughput becomes a concern, add a short-lived cache with candle-cutoff invalidation — don't add persisted regime state.

### 6. Market-Only Classification is Deliberately Simplified

`classifyMarketRegime` wraps `classifyRegime` with config-driven parameters:

```typescript
// src/engine/marketRegime/classifyMarketRegime.ts
function classifyMarketRegime(
  telemetry: IndicatorTelemetry,
  config: MarketTimeframeConfig["regime"]
): Regime {
  // Loops classifyRegime for config.confirmBars iterations
  // 15m config: confirmBars=2 (one confirmation bar required)
  // 1h config: confirmBars=1 (immediate classification)
  // minHoldBars=0 for both — market regime can flip on next call
}
```

This deliberately provides some confirmation for 15m (confirmBars=2) while keeping 1h immediate (confirmBars=1), but disables portfolio-level hysteresis for both:

- `confirmBars: 1` means **no REGIME_CONFIRM_PENDING** — the market regime is always resolved
- `minHoldBars: 0` means **no REGIME_MIN_HOLD_ACTIVE** — the market regime can flip freely

The full `/v1/plan` pipeline uses hysteresis (state + confirm + hold) because portfolio changes have real cost. Market-only classification exists for informational queries where the cost of being wrong is low and responsiveness matters.

## Why This Matters

| Pattern                    | If you skip it                         | What it prevents                                                         |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| Per-slot decision tree     | Batch either all-succeeds or all-fails | Partial success is the normal case — clients need per-item feedback      |
| Grace-window cutoff        | Using raw `asOf - timeframe`           | Half-formed candles skew regime classification                           |
| Freshness classification   | Not surfacing data staleness           | Stale decisions presented as confident                                   |
| Four-band precedence       | Summing scores or majority-voting      | A single hard block must override all allows — safety-first              |
| Stateless read-through     | Caching regime state in DB             | Stale regimes after classification logic updates                         |
| Market-only classification | Reusing full plan classification       | Confirm/hold hysteresis delays regime visibility for read-only consumers |

## When to Apply

- **Per-slot decision tree**: Any batch ingestion where items can independently succeed/fail/revise. Particularly when idempotency and revision caps matter.
- **Grace-window cutoff**: Any system that aggregates time-bucketed data and needs to exclude in-progress buckets.
- **Freshness classification**: Any read endpoint that computes from data that ages — the consumer needs to know how much to trust the result.
- **Four-band suitability**: Any go/no-go decision where safety concerns must override permissive signals. Not for nuanced scoring — for clear gates.
- **Stateless read-through**: Any query endpoint where correctness > throughput, and the underlying data changes slowly enough that per-request computation is feasible.
- **Market-only classification**: Any "what's happening right now?" query that should not be burdened with portfolio-level hysteresis.

## Examples

### Before: Single-row ingestion (brief writer)

```typescript
// The brief writer inserts one row per request
// No per-item decisions, no batch semantics
const existing = selectBrief(db, briefHash);
if (existing) throw new LedgerWriteError("BRIEF_ALREADY_EXISTS");
insertBrief(db, brief);
```

### After: Per-slot batch ingestion with independent outcomes

```typescript
// Candle writer: each slot makes an independent decision
// 200 response with mixed results — partial success is normal
const result = { inserted: 0, idempotent: 0, revised: 0, rejected: 0, rejections: [] };

for (const candle of validatedCandles) {
  const existing = selectCandleRevision(db, feedHash, candle.unixMs);
  if (!existing) { insertCandle(...); result.inserted++; }
  else if (existing.candleJson === canonicalJson) { result.idempotent++; }
  else if (existing.revision < MAX_REVISION) { insertCandle(...); result.revised++; }
  else { result.rejected++; result.rejections.push({...}); }
}
```

### Before: Regime computation only available through /v1/plan

Full pipeline with autopilot state, hysteresis, and plan ledger writes. No way to ask "what's the market regime?" without running the entire planning engine.

### After: Lightweight regime query

```typescript
// GET /v1/regime/current?symbol=SOL&source=coingecko&network=mainnet&poolAddress=...&timeframe=15m
// GET /v1/regime/current?symbol=SOL&source=coingecko&network=mainnet&poolAddress=...&timeframe=1h
// No auth, no ledger writes, stateless computation
const query = parseRegimeCurrentQuery(request.query);
const plan = buildRegimeCandleReadPlan({ requestedTimeframe: query.timeframe, nowUnixMs });
// Read 15m candles always (1h derives from them at read time)
const candles = await getLatestCandlesForFeed(store, { ...query, ...plan });
const regimeCurrent = buildRegimeCurrent({ candles, metadata: { ...plan.sourceMetadata, sourceCandleCount: candles.length }, ... });
```

### Four-band suitability in practice

```
Input: regime=CHOP, freshness=fresh
→ UNKNOWN: []  → skip
→ BLOCKED: ['MARKET_CHOPPY']  → WINS
→ Result: { band: 'BLOCKED', reasons: ['MARKET_CHOPPY'] }
```

```
Input: regime=UP, freshness=soft-stale
→ UNKNOWN: []  → skip
→ BLOCKED: []  → skip
→ CAUTION: ['CANDLE_DATA_SOFT_STALE']  → WINS
→ Result: { band: 'CAUTION', reasons: ['CANDLE_DATA_SOFT_STALE'] }
```

## Related

- [Fastify+SQLite Ingestion Endpoint Patterns](./fastify-sqlite-ingestion-endpoint-patterns-2026-04-18.md) — Shared auth, idempotency, and transaction patterns that the candle endpoint follows
- [Regime-engine Deploy Docs Gap](../documentation-gaps/regime-engine-deploy-docs-smoke-tests-runbook-2026-04-19.md) — Deploy readiness and operational verification for the full API surface including these new endpoints
- `src/engine/marketRegime/config.ts` — Committed per-timeframe config (15m primary; 1h derived via aggregation, see [Derived Timeframe Aggregation Pattern](./derived-candle-aggregation-pattern-2026-05-06.md))
- `src/engine/candles/aggregateCandles.ts` — Pure OHLCV 15m→1h aggregation utility with telemetry
- `src/engine/marketRegime/regimeCandleReadPlan.ts` — Read-plan abstraction (discriminated union: direct vs derived)
- `src/ledger/candlesWriter.ts` — Per-slot decision tree + `BEGIN IMMEDIATE`
- `src/engine/marketRegime/evaluateMarketClmmSuitability.ts` — Four-band decision tree
- GitHub #17 — "Add market-data-backed current regime endpoint for CLMM Regime page"
- GitHub #18 — "Add GeckoTerminal candle collector for regime-engine candle ingestion"
