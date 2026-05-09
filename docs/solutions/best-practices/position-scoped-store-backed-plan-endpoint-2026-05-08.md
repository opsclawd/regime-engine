---
title: Position-Scoped Store-Backed Plan Endpoint
date: 2026-05-08
category: best-practices
module: engine
problem_type: best_practice
component: service_object
severity: high
applies_when:
  - Converting an inline-data endpoint to a store-backed, entity-scoped endpoint
  - Designing position-scoped plan computation with action precedence rules
  - Adding 503 error semantics for market-data unavailability or stale position state
  - Wiring CandleReadPort and ClockPort through composition for store-backed use cases
  - Maintaining contract backward compatibility during a major request schema change
symptoms:
  - Endpoint accepts large inline data payloads that should come from the store
  - Plan computation logic scattered across handler, use case, and engine modules
  - No clear action precedence when multiple exit conditions overlap
  - Contract validation doesn't enforce position identity or breach timestamps
root_cause: missing_abstraction
resolution_type: code_fix
related_components:
  - contract/v1
  - engine/plan
  - engine/regime
  - engine/churn
  - engine/allocation
  - application/use-cases
  - composition
  - http
  - ledger
tags:
  - position-scoped
  - store-backed
  - plan-endpoint
  - action-precedence
  - clean-architecture
  - contract-evolution
  - regime-engine
---

# Position-Scoped Store-Backed Plan Endpoint

## Context

The regime-engine project converted `POST /v1/plan` from an inline-candle endpoint (where the request body included raw market candles) to a position-scoped, store-backed CLMM recommendation endpoint (where the request references a position and the engine reads candles from its own DB via a port). This was a 15-task cross-stack feature touching contract types, engine logic, HTTP handlers, ledger persistence, and integration tests. The scale of the change exposed several patterns worth capturing.

## Guidance

### 1. Types-first progressive refactoring

Define new contract types first, let typecheck errors propagate, then resolve them task by task. This creates a roadmap encoded in compile errors.

```typescript
// Task 1: Define the new shape — every downstream file now has intentional type errors
export interface PlanRequestPosition {
  positionId: string;
  observedAtUnixMs: number;
  lowerBoundPrice: number;
  upperBoundPrice: number;
  currentPrice: number;
  rangeState: RangeState;
  breachQualified: boolean;
  breachQualifiedAtUnixMs?: number;
}

// Tasks 2–15: Resolve errors progressively, each task targeting one module
```

This works especially well when a change ripples across all layers (contract → engine → use case → HTTP → tests). Each task produces a green typecheck by the end, and the type system guarantees nothing was missed.

### 2. Pure engine module with no IO dependencies

Engine modules should be pure functions that accept pre-computed inputs and return results. No ports, no DB, no HTTP.

```typescript
// positionPlan.ts — pure, testable, deterministic
export function buildPositionPlan(input: PositionPlanInput): PlanResponse {
  // Action precedence (highest to lowest):
  // 1. qualified range breach exit → REQUEST_EXIT_CLMM
  // 2. suitability-blocked + activeClmm → REQUEST_EXIT_CLMM
  // 3. stand-down active → STAND_DOWN
  // 4. otherwise → HOLD
}
```

The use-case layer handles IO (reading candles, persisting plans) and feeds pre-computed results into this pure function.

### 3. Deterministic hashing: `undefined` vs missing keys

`toCanonicalJson` throws on `undefined` values. When a request type has optional fields, `stripUndefined` must run before canonicalization:

```typescript
// BUG: optional fields with undefined values blow up canonical JSON
const sig = toCanonicalJson(req); // throws if optional field is undefined

// FIX: strip undefined before hashing
const sig = toCanonicalJson(stripUndefined(req));
```

This matters for `requestSignature` and any hash that feeds `planHash`. An optional field that is `undefined` (key present) vs missing (key absent) produces different canonical JSON.

### 4. Store-backed use case via ports

Instead of receiving data inline, the use case reads from the store through a port interface:

```typescript
export function createGeneratePlanUseCase(deps: {
  candleReadPort: CandleReadPort;
  clock: ClockPort;
  planLedgerWritePort: PlanLedgerWritePort;
  engineVersion: string;
}) {
  return async (req: PlanRequest): Promise<PlanResponse> => {
    // validate position staleness (60s max age)
    // build candle read plan → read from store → aggregate if derived
    // compute indicators → classify regime → evaluate freshness/suitability
    // buildPositionPlan → persist via ledger port
  };
}
```

The HTTP handler no longer validates candle structure — it validates position metadata. The engine doesn't know where candles come from.

### 5. Test isolation with unique poolAddresses

Integration tests that POST candles then POST plans must not share store state. Each test gets its own `poolAddress`:

```typescript
const poolAddress = `PoolTest${testId}`;
await api.post("/v1/candles", { poolAddress, candles: [...], timeframe: "1h" });
const res = await api.post("/v1/plan", { market: { poolAddress, ... } });
```

Reusing a pool across tests causes candle contamination — one test's candles bleed into another's regime computation.

### 6. Timestamp anchoring for freshness boundary tests

When testing staleness/freshness windows, avoid anchoring to exact boundary timestamps. A candle at `12:00:00Z` sits exactly on the hard-stale line. Anchor to `12:15:00Z` instead:

```typescript
// Fragile: exactly on the boundary
const FIXED_NOW =
  Math.floor(Date.parse("2026-05-08T12:00:00.000Z") / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;

// Safe: clearly inside the window
const FIXED_NOW =
  Math.floor(Date.parse("2026-05-08T12:15:00.000Z") / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
```

### 7. Action precedence as explicit if-chain

Action precedence in `buildPositionPlan` is an ordered if-chain where earlier conditions shadow later ones. This makes precedence audible in code review and trivially testable:

```
qualified range breach exit > suitability-blocked exit > stand-down > hold
```

Never use parallel boolean flags that combine into an action. Always use explicit precedence.

## Why This Matters

- **Types-first** prevents the "last mile" problem where a field rename is missed in a distant handler. Compile errors are a todo list that can't be forgotten.
- **Pure engine modules** make the core logic testable without mocking HTTP, DB, or time. If `buildPositionPlan` needs a DB call, the design is wrong.
- **`stripUndefined` before `toCanonicalJson`** is not obvious. The bug manifests as a runtime throw in a hash function far from the optional field definition.
- **Unique poolAddresses** in tests prevent the #1 source of flaky integration tests: shared mutable state in the store.
- **Timestamp anchoring** off the boundary prevents tests that pass at 12:00:00.000 but fail at 12:00:00.500.
- **Explicit precedence if-chains** prevent the "two flags both true, which action wins?" class of bugs.

## When to Apply

- **Types-first**: Any feature that changes the contract shape and ripples across 3+ layers. Not worth it for a one-file change.
- **Pure engine modules**: Any time you're tempted to inject a port into an engine function. Stop. The use case should compute and pass data in.
- **`stripUndefined`**: Any time you hash or canonicalize a request/response type that has optional fields. Always.
- **Unique test poolAddresses**: Any integration test that writes then reads from a shared store.
- **Timestamp anchoring off-boundary**: Any test involving time windows, staleness checks, or freshness logic.
- **Explicit precedence if-chains**: Any decision logic with 3+ mutually exclusive outcomes where priority matters.

## Examples

### Before — inline candles in request

```typescript
interface PlanRequest {
  market: { candles: Candle[]; symbol: string; timeframe: string };
}
// buildPlan(candles) — engine knew about candle arrays
```

### After — position-scoped, store-backed

```typescript
interface PlanRequest {
  market: { source: string; network: string; poolAddress: string; timeframe: RegimeReadTimeframe };
  position: PlanRequestPosition;
}
// Use case reads candles from DB → computes regime pipeline → calls buildPositionPlan(computedInputs)
```

### Before — hash crashes on undefined optional

```typescript
const sig = toCanonicalJson(request);
// TypeError if optional field is undefined
```

### After — strip undefined before canonicalization

```typescript
const sig = toCanonicalJson(stripUndefined(request));
// Deterministic, stable hash; missing key ≠ key with undefined
```

### Before — tests share pool state

```typescript
const pool = "test-pool"; // reused across tests — candles bleed
```

### After — unique pool per test

```typescript
const poolAddress = "PoolTestUnique1";
```

## Related

- Extends: [market-regime-endpoint-patterns](./market-regime-endpoint-patterns-2026-04-27.md) — evolves `/v1/plan` from portfolio-scoped to position-scoped
- Uses: [clean-architecture-seam](./clean-architecture-seam-candle-ingestion-2026-05-08.md) (CandleReadPort), [extract-use-cases-behind-ports](./extract-use-cases-behind-ports-2026-05-08.md) (use-case pattern), [composition-root-pattern](./composition-root-pattern-2026-05-08.md) (wiring), [fastify-sqlite-ingestion](./fastify-sqlite-ingestion-endpoint-patterns-2026-04-18.md) (canonical JSON, Zod), [additive-v2-sr-thesis-storage](./additive-v2-sr-thesis-storage-2026-04-30.md) (planHash), [derived-candle-aggregation-pattern](./derived-candle-aggregation-pattern-2026-05-06.md) (CandleReadPort + read plan)
- GitHub Issue: #47 — `feat: add position-scoped CLMM plan recommendations`
