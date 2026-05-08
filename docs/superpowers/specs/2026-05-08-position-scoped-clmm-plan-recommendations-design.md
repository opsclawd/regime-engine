# Position Scoped CLMM Plan Recommendations Design

**Issue:** #47
**Date:** 2026-05-08
**Status:** Approved

## Problem

`POST /v1/plan` currently returns portfolio/autopilot-level actions from
caller-supplied market candles. It can emit `REQUEST_ENTER_CLMM` and
`REQUEST_REBALANCE`, even though `clmm-v2` does not yet support opening
positions, adding liquidity, range selection, or rebalance execution.

That makes the existing planner too ambiguous for a Position Detail UX. A
general market-level response cannot honestly say that a specific Orca
Whirlpool LP position should be exited.

This work intentionally corrects the public `/v1/plan` contract before
`clmm-v2` begins consuming it. There is no live production `/v1/plan` consumer
in the repo; local tests, harnesses, fixtures, and docs should be updated to the
new contract rather than preserving legacy portfolio mode.

## Goals

- Keep `POST /v1/plan` as the only actionable planning endpoint.
- Make `/v1/plan` position-scoped from the public contract down.
- Keep `GET /v1/regime/current` as the general market/feed insight endpoint.
- Make `/v1/plan` store-backed: read candles from regime-engine storage using
  `market.source`, `market.network`, `market.poolAddress`, and
  `market.timeframe`.
- Remove inline `market.candles` from the public MVP planning contract.
- Require active LP position state, portfolio state, and autopilot state.
- Return explicit `scope.kind = "position"` and `scope.positionId`.
- Restrict MVP actions to `HOLD`, `STAND_DOWN`, and `REQUEST_EXIT_CLMM`.
- Persist position-scoped plans in the existing plan ledger with `planId` and
  `planHash`.
- Preserve plan/result lifecycle: `/v1/execution-result` links back by
  `planId` and `planHash`.

## Non-Goals

- Do not add a new planning endpoint.
- Do not preserve ambiguous public legacy portfolio planning behavior.
- Do not support inline candle fallback in the production MVP contract.
- Do not emit `REQUEST_ENTER_CLMM` or `REQUEST_REBALANCE` from the public
  position-scoped `/v1/plan` path.
- Do not open positions, add liquidity, select ranges, rebalance, build Solana
  transactions, sign wallets, submit transactions, or reconcile execution.
- Do not make `clmm-v2` responsible for market-data sourcing.

## Architecture

`POST /v1/plan` becomes the only actionable planning endpoint and is
position-scoped from the public contract down. The HTTP handler still parses and
returns v1 contract payloads, but the application path changes:
`GeneratePlanUseCase` depends on `CandleReadPort`, `ClockPort`, and
`PlanLedgerWritePort`.

`GET /v1/regime/current` remains a market insight/read endpoint. `/v1/plan`
shares lower-level market-regime helpers with it, including candle read
planning, candle store access, 15m-to-1h aggregation, indicator computation,
regime classification, freshness, and CLMM suitability. `/v1/plan` must not
call the current-regime use case or decorate `RegimeCurrentResponse`.

Add a new pure position-plan engine module, likely under
`src/engine/plan/positionPlan.ts` or `src/engine/positionPlan/`, to build the
MVP recommendation from market context, freshness, suitability, position,
portfolio, autopilot state, and churn config.

The legacy `buildPlan` internals may remain temporarily if useful for helpers
or tests, but they are no longer the public `/v1/plan` implementation. No
public `/v1/plan` path may expose the legacy allocation/rebalance/enter action
path.

## Request Contract

The MVP `PlanRequest` is position-scoped and store-backed.

```ts
type PlanRequest = {
  schemaVersion: "1.0";
  asOfUnixMs: number;

  market: {
    symbol: string;
    source: string;
    network: string;
    poolAddress: string;
    timeframe: "15m" | "1h";
  };

  position: {
    positionId: string;
    walletId?: string;
    observedAtUnixMs: number;
    breachQualifiedAtUnixMs?: number;
    lowerBoundPrice: number;
    upperBoundPrice: number;
    currentPrice: number;
    rangeState: "in-range" | "below-range" | "above-range";
    breachQualified: boolean;
    distanceToLowerPct?: number;
    distanceToUpperPct?: number;
    liquidityUsd?: number;
    unclaimedFeesUsd?: number;
    inventorySkewSolPct?: number;
    inventorySkewUsdcPct?: number;
  };

  portfolio: {
    navUsd: number;
    solUnits: number;
    usdcUnits: number;
  };

  autopilotState: {
    activeClmm: boolean;
    stopouts24h: number;
    redeploys24h: number;
    cooldownUntilUnixMs: number;
    standDownUntilUnixMs: number;
    strikeCount: number;
  };

  regimeState?: {
    current: "UP" | "DOWN" | "CHOP";
    barsInRegime: number;
    pending: "UP" | "DOWN" | "CHOP" | null;
    pendingBars: number;
  };

  config: PlanRequestConfig;
};
```

`market.candles` is not part of the public MVP contract. If inline candles are
needed later, they should be introduced as an explicit debug/test override, not
as the production planning path.

## Validation

Use existing deterministic v1 validation error envelopes where possible, with
new codes for position-specific failures.

Required position validation:

- `position` is required.
- `position.positionId` is non-empty.
- `position.observedAtUnixMs` is a non-negative integer.
- `position.breachQualified` is required.
- `position.rangeState` is one of `in-range`, `below-range`, `above-range`.
- `lowerBoundPrice > 0`.
- `upperBoundPrice > 0`.
- `currentPrice > 0`.
- `lowerBoundPrice < upperBoundPrice`.
- Optional economics fields remain optional for MVP and do not affect exit
  policy.

Position freshness and timestamp rules:

```ts
const MAX_POSITION_OBSERVATION_AGE_MS = 60_000;
```

- If `position.observedAtUnixMs > asOfUnixMs`, return
  `400 INVALID_POSITION_OBSERVED_AT`.
- If `asOfUnixMs - position.observedAtUnixMs > 60_000`, return
  `503 PLAN_POSITION_STATE_STALE`.
- If `position.breachQualified && position.breachQualifiedAtUnixMs == null`,
  return `400 BREACH_QUALIFIED_AT_REQUIRED`.
- If `position.breachQualifiedAtUnixMs` is present and greater than
  `asOfUnixMs`, return `400 INVALID_BREACH_QUALIFIED_AT`.
- Do not reject a qualified breach merely because
  `breachQualifiedAtUnixMs` is older than 60 seconds when the latest
  `observedAtUnixMs` is fresh and the position is still out of range.

## Response Contract

The MVP response is explicitly scoped to the LP position.

```ts
type PlanResponse = {
  schemaVersion: "1.0";
  planId: string;
  planHash: string;
  asOfUnixMs: number;

  scope: {
    kind: "position";
    positionId: string;
    poolAddress: string;
    symbol: string;
  };

  regime: "UP" | "DOWN" | "CHOP";

  targets: {
    solBps: number;
    usdcBps: number;
    allowClmm: boolean;
  };

  actions: Array<{
    type: "HOLD" | "STAND_DOWN" | "REQUEST_EXIT_CLMM";
    reasonCode: string;
  }>;

  constraints: {
    cooldownUntilUnixMs: number;
    standDownUntilUnixMs: number;
    notes: string[];
  };

  nextRegimeState: RegimeState;
  reasons: PlanReason[];
  telemetry: Record<string, number | string | boolean>;

  marketData: {
    source: string;
    network: string;
    poolAddress: string;
    requestedTimeframe: "15m" | "1h";
    sourceTimeframe: string;
    candleCount: number;
    sourceCandleCount: number;
    freshness: RegimeCurrentFreshness;
    derivedTimeframe?: string;
    aggregationVersion?: string;
  };
};
```

`targets` remain in the response for continuity, but the MVP planner does not
emit rebalance or enter actions. `allowClmm` reflects suitability and stand-down
constraints; it is advisory metadata, not an instruction to open or add
liquidity.

## Market Data Flow

`/v1/plan` reads closed candles only. It must not include in-progress candles at
the `asOfUnixMs` boundary.

1. Parse the position-scoped `PlanRequest`.
2. Build the candle read plan from `market.timeframe` and `asOfUnixMs`, matching
   `/v1/regime/current` closed-candle semantics.
3. Read source candles from `CandleReadPort` using `market.symbol`,
   `market.source`, `market.network`, `market.poolAddress`, and the source
   timeframe.
4. For `timeframe = "15m"`, classify stored 15m candles directly.
5. For `timeframe = "1h"`, derive complete 1h candles from stored 15m candles
   and filter to closed derived bars.
6. Compute indicators, regime, freshness, and CLMM suitability from the
   classified candle set.
7. Apply the position recommendation policy.
8. Canonicalize, hash, persist the request and response in the existing plan
   ledger, and return the plan.

For `/v1/plan`, a market read is unavailable when closed candles are missing,
the closed-candle count is below the configured minimum for the requested
timeframe, data is hard-stale, or aggregation produces no complete requested
timeframe bars. Return `503 PLAN_MARKET_DATA_UNAVAILABLE` in those cases. Do
not ask `clmm-v2` for inline candles. Do not fabricate a plan from incomplete
data.

If regime-engine successfully produces a market read and suitability is still
`UNKNOWN`, an in-range position returns `HOLD` with data-quality reasons.
`UNKNOWN` is not an affirmative exit signal while the position remains in range.

## Recommendation Policy

Risk-reducing exits take precedence over stand-down. Stand-down blocks new or
risk-on CLMM activity, but must not hide a confirmed out-of-range position or a
`BLOCKED` active position.

Action precedence:

1. If `position.rangeState` is `below-range` or `above-range` and
   `position.breachQualified === true`, return `REQUEST_EXIT_CLMM`.
2. If `clmmSuitability.status === "BLOCKED"` and
   `autopilotState.activeClmm === true`, return `REQUEST_EXIT_CLMM`.
3. If `churnGovernor.shouldStandDown`, return `STAND_DOWN`.
4. Otherwise return `HOLD`.

Policy implications:

- `below-range` or `above-range` with `breachQualified = false` returns `HOLD`
  with a warning/reason, not `REQUEST_EXIT_CLMM`.
- `CAUTION` plus in-range returns `HOLD` with warning reasons.
- `UNKNOWN` plus in-range returns `HOLD` with data-quality or error reasons.
- `ALLOWED` plus in-range returns `HOLD`.
- Optional economics fields such as `liquidityUsd`, `unclaimedFeesUsd`, and
  inventory skew are recorded in telemetry/reasons when useful, but the MVP
  exit policy does not depend on them.

## Plan Ledger And Execution Result Linkage

The existing plan ledger remains the audit source for planned recommendations.
`GeneratePlanUseCase` writes the full position-scoped request and response
through `PlanLedgerWritePort`. Canonical request hashing, canonical plan JSON,
`planId`, and `planHash` remain deterministic.

`POST /v1/execution-result` continues to verify `(planId, planHash)` and write
linked execution results. No new linkage endpoint is needed. Because the plan
response includes `scope.kind = "position"` and `scope.positionId`, ledger rows
retain the position scope needed for auditability.

Execution-result validation may continue to accept the full `PlanActionType`
union during this design if older tests require it, but all position-scoped
plans generated by public `/v1/plan` must contain only `HOLD`, `STAND_DOWN`, or
`REQUEST_EXIT_CLMM`.

## OpenAPI And Documentation

Update OpenAPI for `/v1/plan` to describe the position-scoped store-backed
request, scoped response, new 400 position validation errors, and 503 planning
dependency errors:

- `PLAN_MARKET_DATA_UNAVAILABLE`
- `PLAN_POSITION_STATE_STALE`
- `INVALID_POSITION_OBSERVED_AT`
- `BREACH_QUALIFIED_AT_REQUIRED`
- `INVALID_BREACH_QUALIFIED_AT`

Update README, architecture docs, harness docs, and demo fixtures so `/v1/plan`
is described as the position-scoped actionable recommendation endpoint. Remove
or revise language that says `/v1/plan` accepts inline candles or emits enter
and rebalance actions.

## Testing

Add or update tests for:

- Required `market.source`, `market.network`, `market.poolAddress`, and
  `market.timeframe`.
- Required `position`.
- Required `position.breachQualified`.
- Required finite positive price fields and `lowerBoundPrice < upperBoundPrice`.
- `INVALID_POSITION_OBSERVED_AT` when `observedAtUnixMs > asOfUnixMs`.
- `PLAN_POSITION_STATE_STALE` when the latest position observation is older
  than 60 seconds.
- `BREACH_QUALIFIED_AT_REQUIRED` when a qualified breach has no
  `breachQualifiedAtUnixMs`.
- `INVALID_BREACH_QUALIFIED_AT` when `breachQualifiedAtUnixMs > asOfUnixMs`.
- Store-backed candle reads using the same candle store access as
  `/v1/regime/current`.
- `PLAN_MARKET_DATA_UNAVAILABLE` for missing closed candles, insufficient
  closed candles, hard-stale data, and no complete derived bars.
- `REQUEST_EXIT_CLMM` for qualified below-range and above-range positions.
- `HOLD` for below-range or above-range positions with
  `breachQualified = false`.
- `REQUEST_EXIT_CLMM` for `BLOCKED` suitability with `activeClmm = true`.
- `STAND_DOWN` only after exit checks.
- `HOLD` for in-range `UNKNOWN`, `CAUTION`, and `ALLOWED` market reads.
- Proof that public position-scoped `/v1/plan` never emits
  `REQUEST_ENTER_CLMM` or `REQUEST_REBALANCE`.
- Plan ledger persistence with position-scoped request and response JSON.
- `/v1/execution-result` linkage against a position-scoped plan by
  `planId` and `planHash`, including idempotent replay.
- Harness and demo fixtures using the new position-scoped request shape.

Required validation before PR:

```bash
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run build
pnpm run boundaries
```

Run `pnpm run test:pg` when a local Postgres test database is available. If it
is unavailable locally, note that explicitly in the PR validation section.

## Risks

- This is a breaking `/v1/plan` contract change. That is intentional because
  there is no live `clmm-v2` consumer yet and ambiguity must be removed before
  integration.
- Reusing market-regime helpers without coupling to `RegimeCurrentResponse`
  requires careful factoring so the read endpoint and plan endpoint share logic
  but not response contracts.
- The legacy planner can still emit unsupported actions internally. The public
  `/v1/plan` route must not call that action path.
- `UNKNOWN` suitability must be handled carefully: it should keep in-range
  positions on `HOLD` with data-quality reasons, while true market-read
  unavailability should fail with `503 PLAN_MARKET_DATA_UNAVAILABLE`.
