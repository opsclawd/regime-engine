# Position Scoped CLMM Plan Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `POST /v1/plan` into a position-scoped, store-backed recommendation endpoint that emits only `HOLD`, `STAND_DOWN`, or `REQUEST_EXIT_CLMM`, removes inline `market.candles`, requires LP position state, and persists position-scoped plans through the existing plan ledger with deterministic `planId` and `planHash`.

**Architecture:** A new pure orchestrator `src/engine/plan/positionPlan.ts` builds the recommendation from market context (sourced via the same `CandleReadPort`, candle read plan, aggregation, indicator, regime, freshness, and CLMM suitability helpers used by `GET /v1/regime/current`), the request's position state, autopilot state, and churn config. `GeneratePlanUseCase` gains `CandleReadPort`, `ClockPort`, and `engineVersion` deps alongside the existing `PlanLedgerWritePort`, performs candle reads with closed-only semantics, raises `PlanMarketDataUnavailableError` and `PlanPositionStateStaleError` for 503 cases, and writes canonical request/response JSON through the ledger port. The HTTP handler maps the new errors to `503` envelopes and the new 400 position validation codes flow naturally through `ContractValidationError`. The legacy `src/engine/plan/buildPlan.ts` and its determinism snapshot are deleted; `src/engine/churn/governor.ts` is reused by the new engine; `src/engine/allocation/**`, `src/engine/regime/classifier.ts`, and `src/engine/chopGate.ts` are not in the new public path but remain in the codebase for now (their own unit tests still exercise them). This is an intentional breaking contract change with no live consumer.

**Tech Stack:** Node 22, pnpm 10, TypeScript (NodeNext, strict), Fastify 5, Zod 3, `node:sqlite`, Drizzle ORM + `postgres` driver, Vitest. Boundary rules in `.dependency-cruiser.cjs` already prohibit `src/application/**` from importing `src/adapters/**`, `src/ledger/**`, `src/composition/**`, or framework npm packages — new code must respect those rules.

---

## File Map

**Create — contract:**

- (none — extending existing files)

**Create — application errors:**

- `src/application/errors/planErrors.ts` — `PlanMarketDataUnavailableError` and `PlanPositionStateStaleError` classes mirroring `RegimeCandlesNotFoundError` (`details: RegimeApplicationErrorDetail[]`). Used by `GeneratePlanUseCase`. No `src/adapters/**` imports.

**Create — engine:**

- `src/engine/plan/positionPlan.ts` — pure `buildPositionPlan(input)` that takes `{ asOfUnixMs, position, portfolio, autopilotState, regimeState?, config, market: { feed, regime, telemetry, freshness, clmmSuitability, candleCount, sourceCandleCount, sourceTimeframe, derivedTimeframe?, aggregationVersion?, requestedTimeframe } }` and returns `PlanResponse`. Computes action precedence (range-state exit → suitability-blocked exit → stand-down → hold), churn-derived `STAND_DOWN`, `nextRegimeState`, `targets` (advisory), reasons aggregation, telemetry, canonical hashing, and `scope`. Pure: no I/O, no `Date.now`. Sorts candles internally if needed.
- `src/engine/plan/__tests__/positionPlan.snapshot.test.ts` — determinism + canonical-hash snapshot for a fixed position-scoped plan input.
- `src/engine/plan/__tests__/positionPlan.policy.test.ts` — action precedence unit tests (qualified breach exit, BLOCKED-with-active exit, stand-down hold, in-range CAUTION/UNKNOWN/ALLOWED holds, breach precedence over stand-down, optional economics fields recorded only in telemetry).

**Modify — contract types:**

- `src/contract/v1/types.ts` — replace `PlanRequest` (drop `market.candles`, add `market.{source, network, poolAddress}` and `timeframe: "15m" | "1h"`, add `position`, drop nothing from existing `portfolio` / `autopilotState` / `regimeState` / `config`). Replace `PlanResponse` (add `scope: { kind: "position", positionId, poolAddress, symbol }`, add `marketData: { source, network, poolAddress, requestedTimeframe, sourceTimeframe, candleCount, sourceCandleCount, freshness, derivedTimeframe?, aggregationVersion? }`; keep `targets`, `actions`, `constraints`, `nextRegimeState`, `reasons`, `telemetry`, `regime`, `planId`, `planHash`, `asOfUnixMs`, `schemaVersion`). `PlanActionType` stays unchanged so `/v1/execution-result` validation keeps accepting all values, but a new `MvpPlanActionType = "HOLD" | "STAND_DOWN" | "REQUEST_EXIT_CLMM"` is added and used inside the position plan.

**Modify — contract validation:**

- `src/contract/v1/validation.ts` — replace `planRequestSchema` with the position-scoped schema (no `market.candles`, requires `market.{source, network, poolAddress, timeframe}`, requires the `position` block, validates `lowerBoundPrice < upperBoundPrice`, `breachQualified` boolean required, `rangeState` enum, `position.observedAtUnixMs` non-negative integer). Add a `superRefine` for `observedAtUnixMs <= asOfUnixMs` and `breachQualifiedAtUnixMs` rules. The position-staleness check (60_000ms) and breach-qualified-at-required check are _not_ expressed in the Zod schema — they are enforced in the use case so they can map to `503` and to specific error codes.

**Modify — contract errors:**

- `src/contract/v1/errors.ts` — add error codes `PLAN_MARKET_DATA_UNAVAILABLE`, `PLAN_POSITION_STATE_STALE`, `INVALID_POSITION_OBSERVED_AT`, `BREACH_QUALIFIED_AT_REQUIRED`, `INVALID_BREACH_QUALIFIED_AT` to `ERROR_CODES`. Add helper constructors `planMarketDataUnavailableError`, `planPositionStateStaleError`, `invalidPositionObservedAtError`, `breachQualifiedAtRequiredError`, `invalidBreachQualifiedAtError`. The first two return 503; the last three return 400.

**Modify — application use case:**

- `src/application/use-cases/generatePlanUseCase.ts` — change deps to `{ candleReadPort, clock, engineVersion, planLedgerWritePort }`. New flow: validate position-staleness and breach-qualified-at rules (raising classed errors), build the candle read plan (reuse `buildRegimeCandleReadPlan`), read source candles, aggregate if derived, raise `PlanMarketDataUnavailableError` on insufficient/missing/hard-stale data, compute indicators / regime / freshness / suitability via the same helpers as `getCurrentRegimeUseCase`, call `buildPositionPlan`, write through `planLedgerWritePort`, return the plan.

**Modify — HTTP handler:**

- `src/adapters/http/handlers/plan.ts` — map the four new typed errors to their `ContractValidationError` envelopes (`planMarketDataUnavailableError`, `planPositionStateStaleError`, plus the two breach-qualified-at 400s; `invalidPositionObservedAtError` is also handled here for completeness). `INVALID_POSITION_OBSERVED_AT` is raised by the schema's `superRefine` and surfaces as a `VALIDATION_ERROR` envelope; the handler does not need to special-case it, but the error-code constant must exist for tests that grep for it.

**Modify — composition:**

- `src/composition/buildApplication.ts` — pass `candleReadPort`, `clock`, `engineVersion: process.env.npm_package_version ?? "0.0.0"` to `createGeneratePlanUseCase`.

**Modify — OpenAPI:**

- `src/adapters/http/openapi.ts` — update `/v1/plan` POST entry: summary "Compute a position-scoped plan", document `400` (validation incl. position codes), `503` (`PLAN_MARKET_DATA_UNAVAILABLE`, `PLAN_POSITION_STATE_STALE`).

**Modify — fixtures:**

- `fixtures/demo/01-uptrend.json`, `02-chop.json`, `03-downtrend.json`, `04-whipsaw.json` — replace inline `market.candles` with the new position-scoped request shape (`market: { symbol, source, network, poolAddress, timeframe }`, full `position` block, retained `portfolio`, `autopilotState`, `config`). The harness loads these and now requires candles to already exist in the ledger; the harness is updated accordingly (Task 11).

**Modify — harness:**

- `scripts/harness.ts` — accept an optional `candles` array per fixture step and ingest them via `POST /v1/candles` with `X-Candles-Ingest-Token` before calling `POST /v1/plan`. Update fixtures to inline candle arrays under a top-level `candles` field so harness behavior remains end-to-end.

**Modify — docs:**

- `README.md` — describe `/v1/plan` as the position-scoped actionable recommendation endpoint; remove "inline candles" language; note that candles are read from storage by `(source, network, poolAddress, timeframe)`.
- `architecture.md` — update the "Plan generation (`POST /v1/plan`)" data flow section to describe the store-backed, position-scoped flow with the updated step list.
- `documentation.md` — append a new milestone section reflecting the contract change. (Don't rewrite earlier milestones — they describe historical state.)

**Modify — tests (must change because contract changes):**

- `src/contract/v1/__tests__/validation.test.ts` — replace the `validPlanRequestFixture` with a position-scoped one; add tests for the new validation errors raised by the schema (`INVALID_POSITION_OBSERVED_AT`, `BREACH_QUALIFIED_AT_REQUIRED`, missing required fields, `lowerBoundPrice >= upperBoundPrice`).
- `src/contract/v1/__tests__/canonicalHash.snapshot.test.ts` — regenerate snapshots for the new position-scoped request/response shapes.
- `src/application/use-cases/__tests__/generatePlanUseCase.test.ts` — rewrite for new dependencies. Cases: happy path returns a position-scoped response and writes once; staleness raises `PlanPositionStateStaleError`; missing closed candles raises `PlanMarketDataUnavailableError`; insufficient closed candles raises `PlanMarketDataUnavailableError`; derived 1h with no complete bars raises `PlanMarketDataUnavailableError`; qualified below-range emits `REQUEST_EXIT_CLMM`; in-range fresh ALLOWED returns `HOLD`; BLOCKED + activeClmm true returns `REQUEST_EXIT_CLMM`; stand-down + in-range returns `STAND_DOWN`; canonical request and response are written through the port.
- `src/adapters/http/__tests__/routes.contract.test.ts` — update fixtures and assertions to position-scoped shape; add tests asserting `503` envelopes for `PLAN_MARKET_DATA_UNAVAILABLE` and `PLAN_POSITION_STATE_STALE`; add a test proving `/v1/plan` never returns `REQUEST_REBALANCE` or `REQUEST_ENTER_CLMM`.
- `src/adapters/http/__tests__/plan.e2e.test.ts` — ingest candles via `/v1/candles` first, then `POST /v1/plan` with position-scoped payload, assert plan ledger rows.
- `src/adapters/http/__tests__/executionResult.e2e.test.ts` — ingest candles first, generate a position-scoped plan, post `/v1/execution-result` with the linked `(planId, planHash)`, assert idempotent replay.
- `src/ledger/__tests__/ledger.test.ts` — update `makePlanRequestFixture` and helpers to position-scoped; the test asserting plan + linked execution rows must pre-ingest candles.
- `src/__tests__/smoke.test.ts` — no changes expected (smoke test never posts to `/v1/plan`); confirm no regression.
- `src/engine/plan/__tests__/planDeterminism.snapshot.test.ts` — delete (replaced by `positionPlan.snapshot.test.ts`).

**Delete:**

- `src/engine/plan/buildPlan.ts` — superseded by `positionPlan.ts`. The application no longer imports it.
- `src/engine/plan/__tests__/planDeterminism.snapshot.test.ts` — superseded by `positionPlan.snapshot.test.ts`.
- `src/engine/plan/__tests__/__snapshots__/planDeterminism.snapshot.test.ts.snap` — stale snapshot file, must be deleted alongside the test.

---

## Pre-flight

- [ ] **Step 0: Confirm clean working tree on a fresh branch from `main`**

Run:

```bash
git status
git log -1 --oneline
git checkout -b m47-position-scoped-plan
```

Expected: working tree clean, HEAD on `4743e74 m47: add position-scoped plan design`.

- [ ] **Step 1: Confirm baseline is green**

Run:

```bash
pnpm install
pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build && pnpm run boundaries
```

Expected: all pass. If anything fails on baseline, stop and investigate before changing code.

---

## Phase 1: Contract Types

### Task 1: Add new contract types

**Files:**

- Modify: `src/contract/v1/types.ts`

- [ ] **Step 1: Replace `PlanRequest` and `PlanResponse` types**

Open `src/contract/v1/types.ts`. Replace the `PlanRequest` interface (currently lines 64-90) with:

```ts
export type RangeState = "in-range" | "below-range" | "above-range";
export type PlanScopeKind = "position";
export type MvpPlanActionType = "HOLD" | "STAND_DOWN" | "REQUEST_EXIT_CLMM";

export interface PlanRequestPosition {
  positionId: string;
  walletId?: string;
  observedAtUnixMs: number;
  breachQualifiedAtUnixMs?: number;
  lowerBoundPrice: number;
  upperBoundPrice: number;
  currentPrice: number;
  rangeState: RangeState;
  breachQualified: boolean;
  distanceToLowerPct?: number;
  distanceToUpperPct?: number;
  liquidityUsd?: number;
  unclaimedFeesUsd?: number;
  inventorySkewSolPct?: number;
  inventorySkewUsdcPct?: number;
}

export interface PlanRequest {
  schemaVersion: SchemaVersion;
  asOfUnixMs: number;
  market: {
    symbol: string;
    source: string;
    network: string;
    poolAddress: string;
    timeframe: RegimeReadTimeframe;
  };
  position: PlanRequestPosition;
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
  regimeState?: RegimeState;
  config: PlanRequestConfig;
}
```

Replace the `PlanResponse` interface (currently lines 103-123) with:

```ts
export interface PlanScope {
  kind: PlanScopeKind;
  positionId: string;
  poolAddress: string;
  symbol: string;
}

export interface PlanMarketData {
  source: string;
  network: string;
  poolAddress: string;
  requestedTimeframe: RegimeReadTimeframe;
  sourceTimeframe: string;
  candleCount: number;
  sourceCandleCount: number;
  freshness: RegimeCurrentFreshness;
  derivedTimeframe?: string;
  aggregationVersion?: string;
}

export interface PlanResponse {
  schemaVersion: SchemaVersion;
  planId: string;
  planHash: string;
  asOfUnixMs: number;
  scope: PlanScope;
  regime: Regime;
  targets: {
    solBps: number;
    usdcBps: number;
    allowClmm: boolean;
  };
  actions: PlanAction[];
  constraints: {
    cooldownUntilUnixMs: number;
    standDownUntilUnixMs: number;
    notes: string[];
  };
  nextRegimeState: RegimeState;
  reasons: PlanReason[];
  telemetry: Record<string, number | string | boolean>;
  marketData: PlanMarketData;
}
```

Note: `RegimeCurrentFreshness` and `RegimeReadTimeframe` are declared later in the same file. TypeScript hoists types, so the references resolve. If you prefer linear declaration order, move `RegimeReadTimeframe` and `RegimeCurrentFreshness` above `PlanRequest`. `PlanActionType` stays as the wider union for `/v1/execution-result` compatibility.

- [ ] **Step 2: Run typecheck to surface every consumer that breaks**

Run: `pnpm run typecheck`

Expected: errors in `src/engine/plan/buildPlan.ts`, `src/application/use-cases/generatePlanUseCase.ts`, `src/contract/v1/__tests__/validation.test.ts`, `src/contract/v1/__tests__/canonicalHash.snapshot.test.ts`, `src/engine/plan/__tests__/planDeterminism.snapshot.test.ts`, `src/application/use-cases/__tests__/generatePlanUseCase.test.ts`, `src/adapters/http/__tests__/routes.contract.test.ts`, `src/adapters/http/__tests__/plan.e2e.test.ts`, `src/adapters/http/__tests__/executionResult.e2e.test.ts`, `src/ledger/__tests__/ledger.test.ts`, `scripts/harness.ts`. This is expected; subsequent tasks fix each.

- [ ] **Step 3: Commit**

```bash
git add src/contract/v1/types.ts
git commit -m "m47: add position-scoped PlanRequest and PlanResponse types"
```

---

## Phase 2: Contract Errors

### Task 2: Add new error codes and helpers

**Files:**

- Modify: `src/contract/v1/errors.ts`
- Test: `src/contract/v1/__tests__/validation.test.ts` (covered later)

- [ ] **Step 1: Extend `ERROR_CODES`**

In `src/contract/v1/errors.ts`, extend the `ERROR_CODES` const:

```ts
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  BATCH_TOO_LARGE: "BATCH_TOO_LARGE",
  MALFORMED_CANDLE: "MALFORMED_CANDLE",
  DUPLICATE_CANDLE_IN_BATCH: "DUPLICATE_CANDLE_IN_BATCH",
  CANDLES_NOT_FOUND: "CANDLES_NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  SERVER_MISCONFIGURATION: "SERVER_MISCONFIGURATION",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INSIGHT_NOT_FOUND: "INSIGHT_NOT_FOUND",
  INSIGHT_RUN_CONFLICT: "INSIGHT_RUN_CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  PLAN_MARKET_DATA_UNAVAILABLE: "PLAN_MARKET_DATA_UNAVAILABLE",
  PLAN_POSITION_STATE_STALE: "PLAN_POSITION_STATE_STALE",
  INVALID_POSITION_OBSERVED_AT: "INVALID_POSITION_OBSERVED_AT",
  BREACH_QUALIFIED_AT_REQUIRED: "BREACH_QUALIFIED_AT_REQUIRED",
  INVALID_BREACH_QUALIFIED_AT: "INVALID_BREACH_QUALIFIED_AT"
} as const;
```

- [ ] **Step 2: Add helper constructors**

After the existing helpers, add:

```ts
export const planMarketDataUnavailableError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(503, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.PLAN_MARKET_DATA_UNAVAILABLE, message, details }
  });
};

export const planPositionStateStaleError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(503, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.PLAN_POSITION_STATE_STALE, message, details }
  });
};

export const invalidPositionObservedAtError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.INVALID_POSITION_OBSERVED_AT, message, details }
  });
};

export const breachQualifiedAtRequiredError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.BREACH_QUALIFIED_AT_REQUIRED, message, details }
  });
};

export const invalidBreachQualifiedAtError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.INVALID_BREACH_QUALIFIED_AT, message, details }
  });
};
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`

Expected: no new failures from this file (other failures from Task 1 may remain).

- [ ] **Step 4: Commit**

```bash
git add src/contract/v1/errors.ts
git commit -m "m47: add position-scoped plan error codes and constructors"
```

---

## Phase 3: Contract Validation Schema

### Task 3: Replace `planRequestSchema` with position-scoped schema

**Files:**

- Modify: `src/contract/v1/validation.ts`
- Test: `src/contract/v1/__tests__/validation.test.ts`

- [ ] **Step 1: Write the failing tests first**

Open `src/contract/v1/__tests__/validation.test.ts`. Replace the existing `validPlanRequestFixture` with a position-scoped fixture and add new test cases. Replace lines 10-69 with:

```ts
const validPlanRequestFixture: PlanRequest = {
  schemaVersion: SCHEMA_VERSION,
  asOfUnixMs: 1_762_591_200_000,
  market: {
    symbol: "SOL/USDC",
    source: "geckoterminal",
    network: "solana",
    poolAddress: "PoolAbc123",
    timeframe: "1h"
  },
  position: {
    positionId: "pos-001",
    observedAtUnixMs: 1_762_591_200_000,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: 100,
    rangeState: "in-range",
    breachQualified: false
  },
  portfolio: { navUsd: 10_000, solUnits: 20, usdcUnits: 6_000 },
  autopilotState: {
    activeClmm: true,
    stopouts24h: 0,
    redeploys24h: 0,
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: 0,
    strikeCount: 0
  },
  config: {
    regime: {
      confirmBars: 2,
      minHoldBars: 3,
      enterUpTrend: 0.6,
      exitUpTrend: 0.4,
      enterDownTrend: -0.6,
      exitDownTrend: -0.4,
      chopVolRatioMax: 1.25
    },
    allocation: {
      upSolBps: 7_500,
      downSolBps: 2_000,
      chopSolBps: 5_000,
      maxDeltaExposureBpsPerDay: 1_500,
      maxTurnoverPerDayBps: 2_000
    },
    churn: {
      maxStopouts24h: 2,
      maxRedeploys24h: 2,
      cooldownMsAfterStopout: 86_400_000,
      standDownTriggerStrikes: 2
    },
    baselines: {
      dcaIntervalDays: 7,
      dcaAmountUsd: 250,
      usdcCarryApr: 0.06
    }
  }
};
```

Inside the existing `describe("v1 validation", ...)` block, the test "rejects candles later than asOfUnixMs" no longer applies — delete it. The test "returns deterministic sorted validation details for invalid /v1/plan payloads" must be rewritten to fit the new shape. Replace it with:

```ts
it("rejects /v1/plan when required position fields are missing", () => {
  const { position: _omitted, ...withoutPosition } = validPlanRequestFixture;
  void _omitted;
  const response = captureValidationError(() => parsePlanRequest(withoutPosition));

  expect(response.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  expect(response.error.details.some((d) => d.path === "$.position")).toBe(true);
});

it("rejects lowerBoundPrice >= upperBoundPrice", () => {
  const response = captureValidationError(() =>
    parsePlanRequest({
      ...validPlanRequestFixture,
      position: {
        ...validPlanRequestFixture.position,
        lowerBoundPrice: 120,
        upperBoundPrice: 110
      }
    })
  );

  expect(response.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  expect(
    response.error.details.some(
      (d) => d.path === "$.position.lowerBoundPrice" || d.path === "$.position.upperBoundPrice"
    )
  ).toBe(true);
});

it("rejects observedAtUnixMs greater than asOfUnixMs with INVALID_POSITION_OBSERVED_AT", () => {
  const response = captureValidationError(() =>
    parsePlanRequest({
      ...validPlanRequestFixture,
      position: {
        ...validPlanRequestFixture.position,
        observedAtUnixMs: validPlanRequestFixture.asOfUnixMs + 1
      }
    })
  );

  expect(response.error.code).toBe(ERROR_CODES.INVALID_POSITION_OBSERVED_AT);
  expect(response.error.details.some((d) => d.path === "$.position.observedAtUnixMs")).toBe(true);
});

it("rejects breachQualified=true without breachQualifiedAtUnixMs (BREACH_QUALIFIED_AT_REQUIRED)", () => {
  const response = captureValidationError(() =>
    parsePlanRequest({
      ...validPlanRequestFixture,
      position: {
        ...validPlanRequestFixture.position,
        rangeState: "below-range",
        breachQualified: true
      }
    })
  );

  expect(response.error.code).toBe(ERROR_CODES.BREACH_QUALIFIED_AT_REQUIRED);
});

it("rejects breachQualifiedAtUnixMs greater than asOfUnixMs (INVALID_BREACH_QUALIFIED_AT)", () => {
  const response = captureValidationError(() =>
    parsePlanRequest({
      ...validPlanRequestFixture,
      position: {
        ...validPlanRequestFixture.position,
        rangeState: "below-range",
        breachQualified: true,
        breachQualifiedAtUnixMs: validPlanRequestFixture.asOfUnixMs + 1
      }
    })
  );

  expect(response.error.code).toBe(ERROR_CODES.INVALID_BREACH_QUALIFIED_AT);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm vitest run src/contract/v1/__tests__/validation.test.ts`

Expected: existing fixture-based tests fail to typecheck or fail at runtime; new tests fail with current `planRequestSchema` because it still allows old shape.

- [ ] **Step 3: Replace `planRequestSchema` and helpers in `validation.ts`**

In `src/contract/v1/validation.ts`, replace the `planRequestSchema` (currently lines 37-127) with the position-scoped schema. Add the new imports at the top:

```ts
import {
  ContractValidationError,
  batchTooLargeError,
  breachQualifiedAtRequiredError,
  duplicateCandleInBatchError,
  invalidBreachQualifiedAtError,
  invalidPositionObservedAtError,
  malformedCandleError,
  unsupportedSchemaVersionError,
  validationErrorFromZod
} from "./errors.js";
```

Replace the schema with:

```ts
const RANGE_STATES = ["in-range", "below-range", "above-range"] as const;
const PLAN_TIMEFRAMES = ["15m", "1h"] as const;
const finitePositiveNumber = z
  .number()
  .refine((value) => Number.isFinite(value) && value > 0, "must be finite positive");

const planRequestPositionSchema = z
  .object({
    positionId: z.string().min(1),
    walletId: z.string().min(1).optional(),
    observedAtUnixMs: unixMsSchema,
    breachQualifiedAtUnixMs: unixMsSchema.optional(),
    lowerBoundPrice: finitePositiveNumber,
    upperBoundPrice: finitePositiveNumber,
    currentPrice: finitePositiveNumber,
    rangeState: z.enum(RANGE_STATES),
    breachQualified: z.boolean(),
    distanceToLowerPct: z.number().optional(),
    distanceToUpperPct: z.number().optional(),
    liquidityUsd: nonNegativeNumberSchema.optional(),
    unclaimedFeesUsd: nonNegativeNumberSchema.optional(),
    inventorySkewSolPct: z.number().optional(),
    inventorySkewUsdcPct: z.number().optional()
  })
  .strict()
  .superRefine((position, ctx) => {
    if (position.lowerBoundPrice >= position.upperBoundPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lowerBoundPrice"],
        message: "lowerBoundPrice must be less than upperBoundPrice"
      });
    }
  });

const planRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    asOfUnixMs: unixMsSchema,
    market: z
      .object({
        symbol: z.string().min(1),
        source: z.string().min(1),
        network: z.string().min(1),
        poolAddress: z.string().min(1),
        timeframe: z.enum(PLAN_TIMEFRAMES)
      })
      .strict(),
    position: planRequestPositionSchema,
    portfolio: z
      .object({
        navUsd: nonNegativeNumberSchema,
        solUnits: nonNegativeNumberSchema,
        usdcUnits: nonNegativeNumberSchema
      })
      .strict(),
    autopilotState: z
      .object({
        activeClmm: z.boolean(),
        stopouts24h: z.number().int().nonnegative(),
        redeploys24h: z.number().int().nonnegative(),
        cooldownUntilUnixMs: unixMsSchema,
        standDownUntilUnixMs: unixMsSchema,
        strikeCount: z.number().int().nonnegative()
      })
      .strict(),
    regimeState: z
      .object({
        current: regimeSchema,
        barsInRegime: z.number().int().nonnegative(),
        pending: regimeSchema.nullable(),
        pendingBars: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    config: z
      .object({
        regime: z
          .object({
            confirmBars: z.number().int().min(1),
            minHoldBars: z.number().int().nonnegative(),
            enterUpTrend: z.number(),
            exitUpTrend: z.number(),
            enterDownTrend: z.number(),
            exitDownTrend: z.number(),
            chopVolRatioMax: z.number().positive()
          })
          .strict(),
        allocation: z
          .object({
            upSolBps: bpsSchema,
            downSolBps: bpsSchema,
            chopSolBps: bpsSchema,
            maxDeltaExposureBpsPerDay: z.number().int().nonnegative(),
            maxTurnoverPerDayBps: z.number().int().nonnegative()
          })
          .strict(),
        churn: z
          .object({
            maxStopouts24h: z.number().int().nonnegative(),
            maxRedeploys24h: z.number().int().nonnegative(),
            cooldownMsAfterStopout: z.number().int().nonnegative(),
            standDownTriggerStrikes: z.number().int().min(1)
          })
          .strict(),
        baselines: z
          .object({
            dcaIntervalDays: z.number().int().min(1),
            dcaAmountUsd: nonNegativeNumberSchema,
            usdcCarryApr: nonNegativeNumberSchema
          })
          .strict()
      })
      .strict()
  })
  .strict();
```

Replace `parsePlanRequest`:

```ts
export const parsePlanRequest = (raw: unknown): PlanRequest => {
  const parsed = parseWithSchema(raw, planRequestSchema, "Invalid /v1/plan request body");

  if (parsed.position.observedAtUnixMs > parsed.asOfUnixMs) {
    throw invalidPositionObservedAtError(
      `position.observedAtUnixMs (${parsed.position.observedAtUnixMs}) must not exceed ` +
        `asOfUnixMs (${parsed.asOfUnixMs})`,
      [
        {
          path: "$.position.observedAtUnixMs",
          code: "INVALID_VALUE",
          message: "observedAtUnixMs is in the future relative to asOfUnixMs"
        }
      ]
    );
  }

  if (parsed.position.breachQualified && parsed.position.breachQualifiedAtUnixMs === undefined) {
    throw breachQualifiedAtRequiredError(
      "position.breachQualified=true requires position.breachQualifiedAtUnixMs",
      [
        {
          path: "$.position.breachQualifiedAtUnixMs",
          code: "REQUIRED",
          message: "breachQualifiedAtUnixMs is required when breachQualified is true"
        }
      ]
    );
  }

  if (
    parsed.position.breachQualifiedAtUnixMs !== undefined &&
    parsed.position.breachQualifiedAtUnixMs > parsed.asOfUnixMs
  ) {
    throw invalidBreachQualifiedAtError(
      `position.breachQualifiedAtUnixMs (${parsed.position.breachQualifiedAtUnixMs}) must not ` +
        `exceed asOfUnixMs (${parsed.asOfUnixMs})`,
      [
        {
          path: "$.position.breachQualifiedAtUnixMs",
          code: "INVALID_VALUE",
          message: "breachQualifiedAtUnixMs is in the future relative to asOfUnixMs"
        }
      ]
    );
  }

  return parsed;
};
```

Update the type imports at the top: `import { type PlanRequest, ... }` is already present; ensure `type RegimeReadTimeframe` is also imported (already is).

- [ ] **Step 4: Run validation tests**

Run: `pnpm vitest run src/contract/v1/__tests__/validation.test.ts`

Expected: all tests in this file pass.

- [ ] **Step 5: Commit**

```bash
git add src/contract/v1/validation.ts src/contract/v1/__tests__/validation.test.ts
git commit -m "m47: replace plan request schema with position-scoped validation"
```

---

## Phase 4: Application Errors

### Task 4: Add plan-specific application errors

**Files:**

- Create: `src/application/errors/planErrors.ts`

- [ ] **Step 1: Create the file**

```ts
import type { RegimeApplicationErrorDetail } from "./regimeErrors.js";

export class PlanMarketDataUnavailableError extends Error {
  public readonly details: RegimeApplicationErrorDetail[];

  public constructor(message: string, details: RegimeApplicationErrorDetail[]) {
    super(message);
    this.name = "PlanMarketDataUnavailableError";
    this.details = details;
  }
}

export class PlanPositionStateStaleError extends Error {
  public readonly details: RegimeApplicationErrorDetail[];

  public constructor(message: string, details: RegimeApplicationErrorDetail[]) {
    super(message);
    this.name = "PlanPositionStateStaleError";
    this.details = details;
  }
}
```

- [ ] **Step 2: Confirm typecheck**

Run: `pnpm run typecheck`

Expected: no errors introduced by this file. Other Task-1-introduced errors remain.

- [ ] **Step 3: Commit**

```bash
git add src/application/errors/planErrors.ts
git commit -m "m47: add PlanMarketDataUnavailableError and PlanPositionStateStaleError"
```

---

## Phase 5: Pure Engine Module

### Task 5: Build the position-plan engine and its tests

**Files:**

- Create: `src/engine/plan/positionPlan.ts`
- Create: `src/engine/plan/__tests__/positionPlan.policy.test.ts`
- Create: `src/engine/plan/__tests__/positionPlan.snapshot.test.ts`

- [ ] **Step 1: Write the policy tests first (failing)**

Create `src/engine/plan/__tests__/positionPlan.policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPositionPlan, type PositionPlanInput } from "../positionPlan.js";
import type {
  ClmmSuitabilityStatus,
  Regime,
  RegimeCurrentFreshness
} from "../../../contract/v1/types.js";
import type { IndicatorTelemetry } from "../../features/indicators.js";

const AS_OF = 1_762_591_200_000;

const baseFreshness = (): RegimeCurrentFreshness => ({
  generatedAtIso: "2026-05-08T12:00:00.000Z",
  lastCandleUnixMs: AS_OF - 60_000,
  lastCandleIso: "2026-05-08T11:59:00.000Z",
  ageSeconds: 60,
  softStale: false,
  hardStale: false,
  softStaleSeconds: 1500,
  hardStaleSeconds: 2100
});

const baseTelemetry = (): IndicatorTelemetry => ({
  realizedVolShort: 0.01,
  realizedVolLong: 0.01,
  volRatio: 1.0,
  trendStrength: 0.0,
  compression: 0.5
});

const makeInput = (overrides: {
  regime?: Regime;
  suitabilityStatus?: ClmmSuitabilityStatus;
  rangeState?: "in-range" | "below-range" | "above-range";
  breachQualified?: boolean;
  activeClmm?: boolean;
  standDown?: boolean;
}): PositionPlanInput => ({
  asOfUnixMs: AS_OF,
  position: {
    positionId: "pos-1",
    observedAtUnixMs: AS_OF,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: overrides.rangeState === "below-range" ? 90 : 100,
    rangeState: overrides.rangeState ?? "in-range",
    breachQualified: overrides.breachQualified ?? false,
    breachQualifiedAtUnixMs: overrides.breachQualified ? AS_OF - 30_000 : undefined
  },
  portfolio: { navUsd: 10_000, solUnits: 20, usdcUnits: 6_000 },
  autopilotState: {
    activeClmm: overrides.activeClmm ?? false,
    stopouts24h: 0,
    redeploys24h: 0,
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: overrides.standDown ? AS_OF + 60 * 60 * 1000 : 0,
    strikeCount: 0
  },
  config: {
    regime: {
      confirmBars: 1,
      minHoldBars: 0,
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },
    allocation: {
      upSolBps: 7000,
      downSolBps: 1000,
      chopSolBps: 4000,
      maxDeltaExposureBpsPerDay: 2000,
      maxTurnoverPerDayBps: 5000
    },
    churn: {
      maxStopouts24h: 3,
      maxRedeploys24h: 3,
      cooldownMsAfterStopout: 0,
      standDownTriggerStrikes: 3
    },
    baselines: { dcaIntervalDays: 7, dcaAmountUsd: 100, usdcCarryApr: 0.04 }
  },
  market: {
    feed: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: "PoolA",
      requestedTimeframe: "1h"
    },
    regime: overrides.regime ?? "CHOP",
    telemetry: baseTelemetry(),
    freshness: baseFreshness(),
    clmmSuitability: { status: overrides.suitabilityStatus ?? "ALLOWED", reasons: [] },
    candleCount: 50,
    sourceCandleCount: 200,
    sourceTimeframe: "15m",
    derivedTimeframe: "1h",
    aggregationVersion: "ohlcv-agg-v1"
  }
});

describe("buildPositionPlan action precedence", () => {
  it("returns REQUEST_EXIT_CLMM for qualified below-range", () => {
    const plan = buildPositionPlan(
      makeInput({ rangeState: "below-range", breachQualified: true, activeClmm: true })
    );
    expect(plan.actions).toEqual([{ type: "REQUEST_EXIT_CLMM", reasonCode: expect.any(String) }]);
  });

  it("returns REQUEST_EXIT_CLMM for qualified above-range", () => {
    const plan = buildPositionPlan(
      makeInput({ rangeState: "above-range", breachQualified: true, activeClmm: true })
    );
    expect(plan.actions).toEqual([{ type: "REQUEST_EXIT_CLMM", reasonCode: expect.any(String) }]);
  });

  it("returns HOLD for below-range without breachQualified", () => {
    const plan = buildPositionPlan(
      makeInput({ rangeState: "below-range", breachQualified: false, activeClmm: true })
    );
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("returns REQUEST_EXIT_CLMM when suitability is BLOCKED and activeClmm is true", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "BLOCKED", activeClmm: true }));
    expect(plan.actions[0].type).toBe("REQUEST_EXIT_CLMM");
  });

  it("returns HOLD when suitability is BLOCKED but activeClmm is false", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "BLOCKED", activeClmm: false }));
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("returns STAND_DOWN when stand-down active and no exit conditions", () => {
    const plan = buildPositionPlan(makeInput({ standDown: true }));
    expect(plan.actions[0].type).toBe("STAND_DOWN");
  });

  it("breach precedence: qualified breach exits even when stand-down is active", () => {
    const plan = buildPositionPlan(
      makeInput({
        rangeState: "below-range",
        breachQualified: true,
        activeClmm: true,
        standDown: true
      })
    );
    expect(plan.actions[0].type).toBe("REQUEST_EXIT_CLMM");
  });

  it("returns HOLD for in-range CAUTION", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "CAUTION" }));
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("returns HOLD for in-range UNKNOWN", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "UNKNOWN" }));
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("returns HOLD for in-range ALLOWED", () => {
    const plan = buildPositionPlan(makeInput({ suitabilityStatus: "ALLOWED" }));
    expect(plan.actions[0].type).toBe("HOLD");
  });

  it("public path never emits REQUEST_REBALANCE or REQUEST_ENTER_CLMM", () => {
    const cases: Array<Partial<Parameters<typeof makeInput>[0]>> = [
      {},
      { suitabilityStatus: "ALLOWED" },
      { suitabilityStatus: "BLOCKED", activeClmm: false },
      { rangeState: "below-range", breachQualified: false },
      { standDown: true }
    ];
    for (const c of cases) {
      const plan = buildPositionPlan(makeInput(c));
      for (const action of plan.actions) {
        expect(["HOLD", "STAND_DOWN", "REQUEST_EXIT_CLMM"]).toContain(action.type);
      }
    }
  });

  it("populates scope from feed and position", () => {
    const plan = buildPositionPlan(makeInput({}));
    expect(plan.scope).toEqual({
      kind: "position",
      positionId: "pos-1",
      poolAddress: "PoolA",
      symbol: "SOL/USDC"
    });
  });

  it("populates marketData from market context", () => {
    const plan = buildPositionPlan(makeInput({}));
    expect(plan.marketData.requestedTimeframe).toBe("1h");
    expect(plan.marketData.derivedTimeframe).toBe("1h");
    expect(plan.marketData.aggregationVersion).toBe("ohlcv-agg-v1");
    expect(plan.marketData.candleCount).toBe(50);
    expect(plan.marketData.sourceCandleCount).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm vitest run src/engine/plan/__tests__/positionPlan.policy.test.ts`

Expected: import fails — `positionPlan` does not exist yet.

- [ ] **Step 3: Implement `src/engine/plan/positionPlan.ts`**

```ts
import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { planHashFromPlan, sha256Hex } from "../../contract/v1/hash.js";
import type {
  ClmmSuitabilityReason,
  ClmmSuitabilityStatus,
  MarketReason,
  PlanAction,
  PlanReason,
  PlanRequest,
  PlanRequestPosition,
  PlanResponse,
  Regime,
  RegimeCurrentFreshness,
  RegimeReadTimeframe,
  RegimeState
} from "../../contract/v1/types.js";
import { applyChurnGovernor } from "../churn/governor.js";
import type { IndicatorTelemetry } from "../features/indicators.js";

export interface PositionPlanMarketContext {
  feed: {
    symbol: string;
    source: string;
    network: string;
    poolAddress: string;
    requestedTimeframe: RegimeReadTimeframe;
  };
  regime: Regime;
  telemetry: IndicatorTelemetry;
  freshness: RegimeCurrentFreshness;
  clmmSuitability: { status: ClmmSuitabilityStatus; reasons: ClmmSuitabilityReason[] };
  marketReasons?: MarketReason[];
  candleCount: number;
  sourceCandleCount: number;
  sourceTimeframe: string;
  derivedTimeframe?: string;
  aggregationVersion?: string;
}

export interface PositionPlanInput {
  asOfUnixMs: number;
  position: PlanRequestPosition;
  portfolio: PlanRequest["portfolio"];
  autopilotState: PlanRequest["autopilotState"];
  regimeState?: RegimeState;
  config: PlanRequest["config"];
  market: PositionPlanMarketContext;
  schemaVersion?: PlanRequest["schemaVersion"];
}

const REASON = {
  EXIT_RANGE_BREACH: "POSITION_RANGE_BREACH_QUALIFIED",
  EXIT_BLOCKED_ACTIVE: "CLMM_BLOCKED_ACTIVE_POSITION",
  STAND_DOWN: "CHURN_STAND_DOWN",
  HOLD_DEFAULT: "POSITION_HOLD",
  HOLD_OUT_OF_RANGE_NOT_QUALIFIED: "POSITION_OUT_OF_RANGE_NOT_QUALIFIED",
  HOLD_DATA_QUALITY: "POSITION_HOLD_DATA_QUALITY"
} as const;

const buildActions = (input: {
  position: PlanRequestPosition;
  suitabilityStatus: ClmmSuitabilityStatus;
  activeClmm: boolean;
  shouldStandDown: boolean;
}): PlanAction[] => {
  const { position, suitabilityStatus, activeClmm, shouldStandDown } = input;

  if (
    (position.rangeState === "below-range" || position.rangeState === "above-range") &&
    position.breachQualified
  ) {
    return [{ type: "REQUEST_EXIT_CLMM", reasonCode: REASON.EXIT_RANGE_BREACH }];
  }

  if (suitabilityStatus === "BLOCKED" && activeClmm) {
    return [{ type: "REQUEST_EXIT_CLMM", reasonCode: REASON.EXIT_BLOCKED_ACTIVE }];
  }

  if (shouldStandDown) {
    return [{ type: "STAND_DOWN", reasonCode: REASON.STAND_DOWN }];
  }

  if (
    (position.rangeState === "below-range" || position.rangeState === "above-range") &&
    !position.breachQualified
  ) {
    return [{ type: "HOLD", reasonCode: REASON.HOLD_OUT_OF_RANGE_NOT_QUALIFIED }];
  }

  if (suitabilityStatus === "UNKNOWN") {
    return [{ type: "HOLD", reasonCode: REASON.HOLD_DATA_QUALITY }];
  }

  return [{ type: "HOLD", reasonCode: REASON.HOLD_DEFAULT }];
};

const buildReasons = (input: {
  market: PositionPlanMarketContext;
  position: PlanRequestPosition;
  churnReasons: PlanReason[];
}): PlanReason[] => {
  const reasons: PlanReason[] = [];
  for (const r of input.market.marketReasons ?? []) {
    reasons.push({ code: r.code, severity: r.severity, message: r.message });
  }
  for (const r of input.market.clmmSuitability.reasons) {
    reasons.push({ code: r.code, severity: r.severity, message: r.message });
  }
  reasons.push(...input.churnReasons);

  if (
    (input.position.rangeState === "below-range" || input.position.rangeState === "above-range") &&
    !input.position.breachQualified
  ) {
    reasons.push({
      code: "POSITION_OUT_OF_RANGE_NOT_QUALIFIED",
      severity: "WARN",
      message: `Position is ${input.position.rangeState} but breach is not yet qualified.`
    });
  }
  return reasons;
};

const computeNextRegimeState = (input: {
  current: Regime;
  prior: RegimeState | undefined;
}): RegimeState => {
  if (!input.prior) {
    return { current: input.current, barsInRegime: 1, pending: null, pendingBars: 0 };
  }
  if (input.prior.current === input.current) {
    return {
      current: input.current,
      barsInRegime: input.prior.barsInRegime + 1,
      pending: null,
      pendingBars: 0
    };
  }
  return {
    current: input.current,
    barsInRegime: 1,
    pending: null,
    pendingBars: 0
  };
};

const computeTelemetry = (input: {
  indicators: IndicatorTelemetry;
  position: PlanRequestPosition;
}): Record<string, number | string | boolean> => {
  const telemetry: Record<string, number | string | boolean> = {
    realizedVolShort: input.indicators.realizedVolShort,
    realizedVolLong: input.indicators.realizedVolLong,
    volRatio: input.indicators.volRatio,
    trendStrength: input.indicators.trendStrength,
    compression: input.indicators.compression,
    rangeState: input.position.rangeState,
    breachQualified: input.position.breachQualified,
    currentPrice: input.position.currentPrice,
    lowerBoundPrice: input.position.lowerBoundPrice,
    upperBoundPrice: input.position.upperBoundPrice
  };
  if (input.position.distanceToLowerPct !== undefined) {
    telemetry.distanceToLowerPct = input.position.distanceToLowerPct;
  }
  if (input.position.distanceToUpperPct !== undefined) {
    telemetry.distanceToUpperPct = input.position.distanceToUpperPct;
  }
  if (input.position.liquidityUsd !== undefined) {
    telemetry.liquidityUsd = input.position.liquidityUsd;
  }
  if (input.position.unclaimedFeesUsd !== undefined) {
    telemetry.unclaimedFeesUsd = input.position.unclaimedFeesUsd;
  }
  if (input.position.inventorySkewSolPct !== undefined) {
    telemetry.inventorySkewSolPct = input.position.inventorySkewSolPct;
  }
  if (input.position.inventorySkewUsdcPct !== undefined) {
    telemetry.inventorySkewUsdcPct = input.position.inventorySkewUsdcPct;
  }
  return telemetry;
};

export const buildPositionPlan = (input: PositionPlanInput): PlanResponse => {
  const churn = applyChurnGovernor({
    asOfUnixMs: input.asOfUnixMs,
    state: input.autopilotState,
    config: input.config.churn
  });

  const actions = buildActions({
    position: input.position,
    suitabilityStatus: input.market.clmmSuitability.status,
    activeClmm: input.autopilotState.activeClmm,
    shouldStandDown: churn.shouldStandDown
  });

  const allowClmm = input.market.clmmSuitability.status === "ALLOWED" && !churn.shouldStandDown;
  const targets = {
    solBps: 5_000,
    usdcBps: 5_000,
    allowClmm
  };

  const nextRegimeState = computeNextRegimeState({
    current: input.market.regime,
    prior: input.regimeState
  });

  const reasons = buildReasons({
    market: input.market,
    position: input.position,
    churnReasons: churn.reasons
  });

  const telemetry = computeTelemetry({
    indicators: input.market.telemetry,
    position: input.position
  });

  const marketData = {
    source: input.market.feed.source,
    network: input.market.feed.network,
    poolAddress: input.market.feed.poolAddress,
    requestedTimeframe: input.market.feed.requestedTimeframe,
    sourceTimeframe: input.market.sourceTimeframe,
    candleCount: input.market.candleCount,
    sourceCandleCount: input.market.sourceCandleCount,
    freshness: input.market.freshness,
    ...(input.market.derivedTimeframe !== undefined
      ? { derivedTimeframe: input.market.derivedTimeframe }
      : {}),
    ...(input.market.aggregationVersion !== undefined
      ? { aggregationVersion: input.market.aggregationVersion }
      : {})
  };

  const requestSignature = {
    asOfUnixMs: input.asOfUnixMs,
    market: input.market.feed,
    position: input.position,
    portfolio: input.portfolio,
    autopilotState: input.autopilotState,
    regimeState: input.regimeState ?? null
  };
  const requestHash = sha256Hex(toCanonicalJson(requestSignature));
  const planId = `plan-${requestHash.slice(0, 16)}`;

  const basePlan: Omit<PlanResponse, "planHash"> = {
    schemaVersion: input.schemaVersion ?? "1.0",
    planId,
    asOfUnixMs: input.asOfUnixMs,
    scope: {
      kind: "position",
      positionId: input.position.positionId,
      poolAddress: input.market.feed.poolAddress,
      symbol: input.market.feed.symbol
    },
    regime: input.market.regime,
    targets,
    actions,
    constraints: {
      cooldownUntilUnixMs: churn.constraints.cooldownUntilUnixMs,
      standDownUntilUnixMs: churn.constraints.standDownUntilUnixMs,
      notes: churn.constraints.notes
    },
    nextRegimeState,
    reasons,
    telemetry,
    marketData
  };

  return {
    ...basePlan,
    planHash: planHashFromPlan(basePlan)
  };
};
```

- [ ] **Step 4: Run policy tests**

Run: `pnpm vitest run src/engine/plan/__tests__/positionPlan.policy.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Add the determinism snapshot test**

Create `src/engine/plan/__tests__/positionPlan.snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPositionPlan, type PositionPlanInput } from "../positionPlan.js";
import { toCanonicalJson } from "../../../contract/v1/canonical.js";

const AS_OF = 1_762_591_200_000;

const fixedInput: PositionPlanInput = {
  asOfUnixMs: AS_OF,
  position: {
    positionId: "pos-snapshot",
    observedAtUnixMs: AS_OF - 30_000,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: 102.5,
    rangeState: "in-range",
    breachQualified: false,
    liquidityUsd: 5_000,
    unclaimedFeesUsd: 12.5
  },
  portfolio: { navUsd: 12_000, solUnits: 25, usdcUnits: 7_000 },
  autopilotState: {
    activeClmm: true,
    stopouts24h: 0,
    redeploys24h: 0,
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: 0,
    strikeCount: 0
  },
  regimeState: { current: "CHOP", barsInRegime: 4, pending: null, pendingBars: 0 },
  config: {
    regime: {
      confirmBars: 1,
      minHoldBars: 0,
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },
    allocation: {
      upSolBps: 7000,
      downSolBps: 1000,
      chopSolBps: 4000,
      maxDeltaExposureBpsPerDay: 2000,
      maxTurnoverPerDayBps: 5000
    },
    churn: {
      maxStopouts24h: 3,
      maxRedeploys24h: 3,
      cooldownMsAfterStopout: 0,
      standDownTriggerStrikes: 3
    },
    baselines: { dcaIntervalDays: 7, dcaAmountUsd: 100, usdcCarryApr: 0.04 }
  },
  market: {
    feed: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: "PoolSnapshot1",
      requestedTimeframe: "1h"
    },
    regime: "CHOP",
    telemetry: {
      realizedVolShort: 0.011,
      realizedVolLong: 0.013,
      volRatio: 0.846,
      trendStrength: 0.12,
      compression: 0.4
    },
    freshness: {
      generatedAtIso: "2026-05-08T12:00:00.000Z",
      lastCandleUnixMs: AS_OF - 60_000,
      lastCandleIso: "2026-05-08T11:59:00.000Z",
      ageSeconds: 60,
      softStale: false,
      hardStale: false,
      softStaleSeconds: 1500,
      hardStaleSeconds: 2100
    },
    clmmSuitability: {
      status: "ALLOWED",
      reasons: [{ code: "CLMM_ALLOWED_CHOP_FRESH", severity: "INFO", message: "ok" }]
    },
    candleCount: 50,
    sourceCandleCount: 200,
    sourceTimeframe: "15m",
    derivedTimeframe: "1h",
    aggregationVersion: "ohlcv-agg-v1"
  }
};

describe("buildPositionPlan determinism", () => {
  it("returns byte-identical canonical JSON for identical inputs", () => {
    const first = buildPositionPlan(fixedInput);
    const second = buildPositionPlan(JSON.parse(JSON.stringify(fixedInput)));
    expect(first).toEqual(second);
    expect(first.planHash).toBe(second.planHash);
    expect(toCanonicalJson(first)).toBe(toCanonicalJson(second));
  });

  it("matches deterministic plan snapshots", () => {
    const plan = buildPositionPlan(fixedInput);
    expect(toCanonicalJson(plan)).toMatchSnapshot();
    expect(plan.planHash).toMatchSnapshot();
  });
});
```

- [ ] **Step 6: Run snapshot test (creates the snapshot first time)**

Run: `pnpm vitest run src/engine/plan/__tests__/positionPlan.snapshot.test.ts`

Expected: passes; snapshot file is created.

- [ ] **Step 7: Commit**

```bash
git add src/engine/plan/positionPlan.ts src/engine/plan/__tests__/positionPlan.policy.test.ts src/engine/plan/__tests__/positionPlan.snapshot.test.ts src/engine/plan/__tests__/__snapshots__/positionPlan.snapshot.test.ts.snap
git commit -m "m47: add pure position-plan engine with policy and determinism tests"
```

---

## Phase 6: Use Case Refactor

### Task 6: Rewrite GeneratePlanUseCase to be store-backed and position-aware

**Files:**

- Modify: `src/application/use-cases/generatePlanUseCase.ts`
- Modify: `src/application/use-cases/__tests__/generatePlanUseCase.test.ts`

- [ ] **Step 1: Write the failing tests first**

Replace the contents of `src/application/use-cases/__tests__/generatePlanUseCase.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createGeneratePlanUseCase } from "../generatePlanUseCase.js";
import { FakePlanLedgerWritePort } from "./fakes/fakePlanLedgerWritePort.js";
import { FakeCandleReadPort } from "./fakes/fakeCandleReadPort.js";
import { FakeClockPort } from "./fakes/fakeClockPort.js";
import {
  PlanMarketDataUnavailableError,
  PlanPositionStateStaleError
} from "../../errors/planErrors.js";
import { MARKET_REGIME_CONFIG } from "../../../engine/marketRegime/config.js";
import type { CandleRow, PlanRequest } from "../../../contract/v1/types.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIXED_NOW =
  Math.floor(Date.parse("2026-05-08T12:00:00.000Z") / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
const AS_OF = FIXED_NOW;

const buildSequential15mRows = (count: number, anchor: number, basePrice = 100): CandleRow[] =>
  Array.from({ length: count }, (_, i) => {
    const close = basePrice + Math.sin(i / 4) * 0.5;
    return {
      unixMs: anchor - (count - 1 - i) * FIFTEEN_MIN_MS,
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000 + i
    };
  });

const makeRequest = (overrides: Partial<PlanRequest> = {}): PlanRequest => ({
  schemaVersion: "1.0",
  asOfUnixMs: AS_OF,
  market: {
    symbol: "SOL/USDC",
    source: "geckoterminal",
    network: "solana",
    poolAddress: "PoolUC1",
    timeframe: "1h"
  },
  position: {
    positionId: "pos-uc-1",
    observedAtUnixMs: AS_OF,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: 100,
    rangeState: "in-range",
    breachQualified: false
  },
  portfolio: { navUsd: 10_000, solUnits: 20, usdcUnits: 6_000 },
  autopilotState: {
    activeClmm: true,
    stopouts24h: 0,
    redeploys24h: 0,
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: 0,
    strikeCount: 0
  },
  config: {
    regime: {
      confirmBars: 2,
      minHoldBars: 0,
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },
    allocation: {
      upSolBps: 7000,
      downSolBps: 1000,
      chopSolBps: 4000,
      maxDeltaExposureBpsPerDay: 2000,
      maxTurnoverPerDayBps: 5000
    },
    churn: {
      maxStopouts24h: 3,
      maxRedeploys24h: 3,
      cooldownMsAfterStopout: 0,
      standDownTriggerStrikes: 3
    },
    baselines: { dcaIntervalDays: 7, dcaAmountUsd: 100, usdcCarryApr: 0.04 }
  },
  ...overrides
});

const buildDeps = (rows: CandleRow[]) => {
  const candleReadPort = new FakeCandleReadPort({ "15m": rows });
  const clock = new FakeClockPort(FIXED_NOW);
  const planLedgerWritePort = new FakePlanLedgerWritePort();
  return { candleReadPort, clock, planLedgerWritePort };
};

const enoughDerived1hSourceRows = () =>
  buildSequential15mRows(
    (MARKET_REGIME_CONFIG["1h"].suitability.minCandles + 20) * 4,
    FIXED_NOW - ONE_HOUR_MS
  );

describe("GeneratePlanUseCase", () => {
  it("returns a position-scoped plan and writes once on the happy path", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps(enoughDerived1hSourceRows());
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    const body = makeRequest();
    const plan = await useCase(body);

    expect(plan.scope).toEqual({
      kind: "position",
      positionId: "pos-uc-1",
      poolAddress: "PoolUC1",
      symbol: "SOL/USDC"
    });
    expect(plan.marketData.requestedTimeframe).toBe("1h");
    expect(plan.marketData.sourceTimeframe).toBe("15m");
    expect(planLedgerWritePort.calls).toHaveLength(1);
    expect(planLedgerWritePort.calls[0].planRequest).toBe(body);
    expect(planLedgerWritePort.calls[0].planResponse).toBe(plan);
  });

  it("raises PlanPositionStateStaleError when observedAtUnixMs is older than 60s", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps(enoughDerived1hSourceRows());
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    const body = makeRequest({
      position: { ...makeRequest().position, observedAtUnixMs: AS_OF - 60_001 }
    });
    await expect(useCase(body)).rejects.toBeInstanceOf(PlanPositionStateStaleError);
  });

  it("raises PlanMarketDataUnavailableError when no closed candles are available", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps([]);
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    await expect(useCase(makeRequest())).rejects.toBeInstanceOf(PlanMarketDataUnavailableError);
  });

  it("raises PlanMarketDataUnavailableError when closed candles exist but are insufficient", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps(
      buildSequential15mRows(8, FIXED_NOW - ONE_HOUR_MS)
    );
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    await expect(useCase(makeRequest())).rejects.toBeInstanceOf(PlanMarketDataUnavailableError);
  });

  it("raises PlanMarketDataUnavailableError when derived 1h aggregation produces no complete bars", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps([
      {
        unixMs: FIXED_NOW - 200 * ONE_HOUR_MS,
        open: 100,
        high: 100.5,
        low: 99.5,
        close: 100,
        volume: 1
      }
    ]);
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    await expect(useCase(makeRequest())).rejects.toBeInstanceOf(PlanMarketDataUnavailableError);
  });

  it("emits REQUEST_EXIT_CLMM for a qualified below-range position", async () => {
    const { candleReadPort, clock, planLedgerWritePort } = buildDeps(enoughDerived1hSourceRows());
    const useCase = createGeneratePlanUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9",
      planLedgerWritePort
    });

    const body = makeRequest({
      position: {
        ...makeRequest().position,
        rangeState: "below-range",
        currentPrice: 90,
        breachQualified: true,
        breachQualifiedAtUnixMs: AS_OF - 30_000
      }
    });
    const plan = await useCase(body);
    expect(plan.actions[0].type).toBe("REQUEST_EXIT_CLMM");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm vitest run src/application/use-cases/__tests__/generatePlanUseCase.test.ts`

Expected: import errors or assertion failures because `createGeneratePlanUseCase` still has the old signature.

- [ ] **Step 3: Rewrite `generatePlanUseCase.ts`**

```ts
import type { CandleReadPort } from "../ports/candlePorts.js";
import type { ClockPort } from "../ports/clock.js";
import type { PlanLedgerWritePort } from "../ports/planLedgerPort.js";
import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";
import { MARKET_REGIME_CONFIG } from "../../engine/marketRegime/config.js";
import { aggregate15mTo1h } from "../../engine/candles/aggregateCandles.js";
import { buildRegimeCandleReadPlan } from "../../engine/marketRegime/regimeCandleReadPlan.js";
import { computeIndicators } from "../../engine/features/indicators.js";
import { classifyMarketRegime } from "../../engine/marketRegime/classifyMarketRegime.js";
import { computeFreshness } from "../../engine/marketRegime/freshness.js";
import { evaluateMarketClmmSuitability } from "../../engine/marketRegime/evaluateMarketClmmSuitability.js";
import { buildPositionPlan } from "../../engine/plan/positionPlan.js";
import {
  PlanMarketDataUnavailableError,
  PlanPositionStateStaleError
} from "../errors/planErrors.js";

export type GeneratePlanUseCase = (body: PlanRequest) => Promise<PlanResponse>;

const POSITION_OBSERVATION_MAX_AGE_MS = 60_000;

export interface GeneratePlanUseCaseDeps {
  candleReadPort: CandleReadPort;
  clock: ClockPort;
  engineVersion: string;
  planLedgerWritePort: PlanLedgerWritePort;
}

export const createGeneratePlanUseCase = (deps: GeneratePlanUseCaseDeps): GeneratePlanUseCase => {
  return async (body) => {
    if (body.asOfUnixMs - body.position.observedAtUnixMs > POSITION_OBSERVATION_MAX_AGE_MS) {
      throw new PlanPositionStateStaleError(
        `Position observation is stale: asOfUnixMs - observedAtUnixMs = ` +
          `${body.asOfUnixMs - body.position.observedAtUnixMs} ms (max ${POSITION_OBSERVATION_MAX_AGE_MS}).`,
        [
          {
            path: "$.position.observedAtUnixMs",
            code: "INVALID_VALUE",
            message: "Position state is stale"
          }
        ]
      );
    }

    const config = MARKET_REGIME_CONFIG[body.market.timeframe];
    const nowUnixMs = deps.clock.nowUnixMs();
    const readPlan = buildRegimeCandleReadPlan({
      requestedTimeframe: body.market.timeframe,
      nowUnixMs
    });

    const sourceCandles = await deps.candleReadPort.getLatestCandlesForFeed({
      symbol: body.market.symbol,
      source: body.market.source,
      network: body.market.network,
      poolAddress: body.market.poolAddress,
      timeframe: readPlan.sourceTimeframe,
      closedCandleCutoffUnixMs: readPlan.sourceCutoffUnixMs,
      limit: readPlan.sourceLimit
    });

    if (sourceCandles.length === 0) {
      throw new PlanMarketDataUnavailableError(
        "No closed candles available for the requested feed/timeframe.",
        [
          {
            path: "$.market",
            code: "NO_SOURCE_CANDLES",
            message: "No closed candles before the freshness cutoff"
          }
        ]
      );
    }

    let candlesToClassify = sourceCandles;
    if (readPlan.mode === "derived") {
      const { candles: aggregated, telemetry } = aggregate15mTo1h(sourceCandles);
      candlesToClassify = aggregated.filter((c) => c.unixMs <= readPlan.derivedCutoffUnixMs);
      if (candlesToClassify.length === 0) {
        throw new PlanMarketDataUnavailableError(
          "No complete derived 1h candles available for plan generation.",
          [
            {
              path: "$.market.timeframe",
              code: "NO_DERIVED_CANDLES_AFTER_AGGREGATION",
              message: `Aggregation produced ${telemetry.completeBuckets} complete 1h buckets but none before the cutoff.`
            }
          ]
        );
      }
    }

    if (candlesToClassify.length < config.suitability.minCandles) {
      throw new PlanMarketDataUnavailableError(
        `Insufficient closed candles for plan generation: have ${candlesToClassify.length}, need at least ${config.suitability.minCandles}.`,
        [
          {
            path: "$.market",
            code: "INSUFFICIENT_CLOSED_CANDLES",
            message: "Not enough closed candles for the requested timeframe"
          }
        ]
      );
    }

    const indicators = computeIndicators(candlesToClassify, config.indicators);
    const { regime, reasons: regimeReasons } = classifyMarketRegime(indicators, config.regime);

    const lastCandleUnixMs = candlesToClassify[candlesToClassify.length - 1].unixMs;
    const freshness = computeFreshness(nowUnixMs, lastCandleUnixMs, {
      softStaleMs: config.freshness.softStaleMs,
      hardStaleMs: config.freshness.hardStaleMs
    });

    if (freshness.hardStale) {
      throw new PlanMarketDataUnavailableError(
        "Market data is hard-stale; plan generation refuses to proceed on stale data.",
        [
          {
            path: "$.market",
            code: "DATA_HARD_STALE",
            message: "Latest candle is older than the hard-stale window"
          }
        ]
      );
    }

    const clmmSuitability = evaluateMarketClmmSuitability({
      regime,
      telemetry: indicators,
      freshness: { hardStale: freshness.hardStale, softStale: freshness.softStale },
      candleCount: candlesToClassify.length,
      config: config.suitability
    });

    const plan = buildPositionPlan({
      asOfUnixMs: body.asOfUnixMs,
      position: body.position,
      portfolio: body.portfolio,
      autopilotState: body.autopilotState,
      regimeState: body.regimeState,
      config: body.config,
      schemaVersion: body.schemaVersion,
      market: {
        feed: {
          symbol: body.market.symbol,
          source: body.market.source,
          network: body.market.network,
          poolAddress: body.market.poolAddress,
          requestedTimeframe: body.market.timeframe
        },
        regime,
        telemetry: indicators,
        freshness,
        clmmSuitability,
        marketReasons: regimeReasons,
        candleCount: candlesToClassify.length,
        sourceCandleCount: sourceCandles.length,
        sourceTimeframe: readPlan.sourceMetadata.sourceTimeframe,
        ...(readPlan.mode === "derived"
          ? {
              derivedTimeframe: readPlan.sourceMetadata.derivedTimeframe,
              aggregationVersion: readPlan.sourceMetadata.aggregationVersion
            }
          : {})
      }
    });

    await deps.planLedgerWritePort.writePlan({ planRequest: body, planResponse: plan });
    return plan;
  };
};
```

Note `engineVersion` is accepted by the deps but not yet used. Keeping it on the deps surface mirrors `getCurrentRegimeUseCase` and lets composition pass through `process.env.npm_package_version` at the boundary; `marketData` may include it later in a follow-up if needed. For this iteration the field exists on deps but the use case does not surface it in the response (the spec lists `marketData` fields that don't include engineVersion).

- [ ] **Step 4: Run use-case tests**

Run: `pnpm vitest run src/application/use-cases/__tests__/generatePlanUseCase.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/generatePlanUseCase.ts src/application/use-cases/__tests__/generatePlanUseCase.test.ts
git commit -m "m47: rewire GeneratePlanUseCase as store-backed and position-scoped"
```

---

## Phase 7: HTTP Handler

### Task 7: Map new errors in the plan handler

**Files:**

- Modify: `src/adapters/http/handlers/plan.ts`

- [ ] **Step 1: Replace `plan.ts`**

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { parsePlanRequest } from "../../../contract/v1/validation.js";
import type { GeneratePlanUseCase } from "../../../application/use-cases/generatePlanUseCase.js";
import {
  ContractValidationError,
  planMarketDataUnavailableError,
  planPositionStateStaleError
} from "../../../contract/v1/errors.js";
import type { ErrorDetail } from "../../../contract/errors.js";
import {
  PlanMarketDataUnavailableError,
  PlanPositionStateStaleError
} from "../../../application/errors/planErrors.js";

export const createPlanHandler = (generatePlan: GeneratePlanUseCase) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = parsePlanRequest(request.body);
      const plan = await generatePlan(body);
      return reply.code(200).send(plan);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof PlanMarketDataUnavailableError) {
        const httpError = planMarketDataUnavailableError(
          error.message,
          error.details as ErrorDetail[]
        );
        return reply.code(httpError.statusCode).send(httpError.response);
      }
      if (error instanceof PlanPositionStateStaleError) {
        const httpError = planPositionStateStaleError(
          error.message,
          error.details as ErrorDetail[]
        );
        return reply.code(httpError.statusCode).send(httpError.response);
      }

      throw error;
    }
  };
};
```

- [ ] **Step 2: Confirm typecheck**

Run: `pnpm run typecheck`

Expected: `routes.contract.test.ts`, `plan.e2e.test.ts`, `executionResult.e2e.test.ts`, `ledger.test.ts`, `harness.ts` still fail because their fixtures haven't been updated. That's fine — fixed in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/http/handlers/plan.ts
git commit -m "m47: map plan use-case errors to 503 envelopes in HTTP handler"
```

---

## Phase 8: Composition Wiring

### Task 8: Update composition root

**Files:**

- Modify: `src/composition/buildApplication.ts`

- [ ] **Step 1: Update use-case construction**

In `src/composition/buildApplication.ts`, replace the `createGeneratePlanUseCase` call:

```ts
const generatePlan = createGeneratePlanUseCase({
  candleReadPort,
  clock,
  engineVersion: process.env.npm_package_version ?? "0.0.0",
  planLedgerWritePort
});
```

Keep all other constructions identical. The existing `clock`, `candleReadPort`, and `planLedgerWritePort` instantiations are reused.

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`

Expected: this file is now happy. Test files still fail.

- [ ] **Step 3: Commit**

```bash
git add src/composition/buildApplication.ts
git commit -m "m47: pass candleReadPort/clock/engineVersion into GeneratePlanUseCase"
```

---

## Phase 9: OpenAPI

### Task 9: Update OpenAPI plan entry

**Files:**

- Modify: `src/adapters/http/openapi.ts`

- [ ] **Step 1: Update `/v1/plan` POST entry**

Find the `"/v1/plan"` block (lines 68-80) and replace it:

```ts
      "/v1/plan": {
        post: {
          summary:
            "Compute a position-scoped CLMM recommendation. Reads stored closed " +
            "candles for the (source, network, poolAddress, timeframe) feed; " +
            "no inline candles. Emits HOLD, STAND_DOWN, or REQUEST_EXIT_CLMM only.",
          responses: {
            "200": {
              description:
                "PlanResponse with scope.kind='position', scope.positionId, marketData " +
                "freshness/timeframe metadata, and HOLD | STAND_DOWN | REQUEST_EXIT_CLMM actions"
            },
            "400": {
              description:
                "VALIDATION_ERROR for malformed payloads, INVALID_POSITION_OBSERVED_AT, " +
                "BREACH_QUALIFIED_AT_REQUIRED, or INVALID_BREACH_QUALIFIED_AT for position-specific failures"
            },
            "503": {
              description:
                "PLAN_MARKET_DATA_UNAVAILABLE when stored candles are missing/insufficient/hard-stale, " +
                "or PLAN_POSITION_STATE_STALE when the latest position observation is older than 60 seconds"
            }
          }
        }
      },
```

- [ ] **Step 2: Run smoke test for OpenAPI surface**

Run: `pnpm vitest run src/__tests__/smoke.test.ts`

Expected: still passes (smoke test only checks paths exist, not their schemas).

- [ ] **Step 3: Commit**

```bash
git add src/adapters/http/openapi.ts
git commit -m "m47: document position-scoped /v1/plan in OpenAPI"
```

---

## Phase 10: HTTP Route Contract Tests

### Task 10: Update routes.contract.test.ts and plan e2e tests

**Files:**

- Modify: `src/adapters/http/__tests__/routes.contract.test.ts`
- Modify: `src/adapters/http/__tests__/plan.e2e.test.ts`
- Modify: `src/adapters/http/__tests__/executionResult.e2e.test.ts`
- Modify: `src/ledger/__tests__/ledger.test.ts`

- [ ] **Step 1: Build a shared fixture helper**

Inside `src/adapters/http/__tests__/routes.contract.test.ts`, replace the `planRequestFixture` (lines 5-64) with the position-scoped one. The contract tests need pre-ingested candles, so each plan-related test must `POST /v1/candles` first. Add this helper near the top:

```ts
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const PLAN_AS_OF =
  Math.floor(Date.parse("2026-05-08T12:00:00.000Z") / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;

const buildIngestPayload = (count: number) => ({
  schemaVersion: "1.0",
  source: "geckoterminal",
  network: "solana",
  poolAddress: "PoolPlanContract1",
  symbol: "SOL/USDC",
  timeframe: "15m",
  sourceRecordedAtIso: new Date(PLAN_AS_OF).toISOString(),
  candles: Array.from({ length: count }, (_, i) => {
    const close = 100 + Math.sin(i / 4) * 0.5;
    return {
      unixMs: PLAN_AS_OF - (count - 1 - i) * FIFTEEN_MIN_MS,
      open: close - 0.1,
      high: close + 0.5,
      low: close - 0.5,
      close,
      volume: 1_000 + i
    };
  })
});

const planRequestFixture = {
  schemaVersion: "1.0",
  asOfUnixMs: PLAN_AS_OF,
  market: {
    symbol: "SOL/USDC",
    source: "geckoterminal",
    network: "solana",
    poolAddress: "PoolPlanContract1",
    timeframe: "1h"
  },
  position: {
    positionId: "pos-contract-1",
    observedAtUnixMs: PLAN_AS_OF,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: 100,
    rangeState: "in-range",
    breachQualified: false
  },
  portfolio: { navUsd: 10_000, solUnits: 20, usdcUnits: 6_000 },
  autopilotState: {
    activeClmm: true,
    stopouts24h: 0,
    redeploys24h: 0,
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: 0,
    strikeCount: 0
  },
  config: {
    regime: {
      confirmBars: 2,
      minHoldBars: 3,
      enterUpTrend: 0.6,
      exitUpTrend: 0.4,
      enterDownTrend: -0.6,
      exitDownTrend: -0.4,
      chopVolRatioMax: 1.25
    },
    allocation: {
      upSolBps: 7_500,
      downSolBps: 2_000,
      chopSolBps: 5_000,
      maxDeltaExposureBpsPerDay: 1_500,
      maxTurnoverPerDayBps: 2_000
    },
    churn: {
      maxStopouts24h: 2,
      maxRedeploys24h: 2,
      cooldownMsAfterStopout: 86_400_000,
      standDownTriggerStrikes: 2
    },
    baselines: { dcaIntervalDays: 7, dcaAmountUsd: 250, usdcCarryApr: 0.06 }
  }
} as const;
```

In the `beforeAll`, set the candles ingest token (the existing token-required handler is wired through `CANDLES_INGEST_TOKEN` — the contract test currently bypasses it via env). Inspect `src/adapters/http/handlers/candlesIngest.ts` for the actual env name and reuse the same env setup the existing tests use. Set the env in `beforeAll`:

```ts
process.env.CANDLES_INGEST_TOKEN = "test-token";
```

Update the plan-positive test to first ingest candles and then post `/v1/plan`:

```ts
it("returns plan response for /v1/plan", async () => {
  const ingest = await app.inject({
    method: "POST",
    url: "/v1/candles",
    headers: { "X-Candles-Ingest-Token": "test-token" },
    payload: buildIngestPayload(140)
  });
  expect(ingest.statusCode).toBe(200);

  const response = await app.inject({
    method: "POST",
    url: "/v1/plan",
    payload: planRequestFixture
  });

  expect(response.statusCode).toBe(200);
  const body = response.json();
  expect(body).toEqual(
    expect.objectContaining({
      schemaVersion: "1.0",
      planId: expect.any(String),
      planHash: expect.any(String),
      scope: expect.objectContaining({
        kind: "position",
        positionId: "pos-contract-1",
        poolAddress: "PoolPlanContract1",
        symbol: "SOL/USDC"
      }),
      targets: expect.objectContaining({
        solBps: expect.any(Number),
        usdcBps: expect.any(Number),
        allowClmm: expect.any(Boolean)
      }),
      marketData: expect.objectContaining({
        source: "geckoterminal",
        network: "solana",
        poolAddress: "PoolPlanContract1",
        requestedTimeframe: "1h",
        sourceTimeframe: "15m",
        derivedTimeframe: "1h"
      })
    })
  );
  for (const action of body.actions as Array<{ type: string }>) {
    expect(["HOLD", "STAND_DOWN", "REQUEST_EXIT_CLMM"]).toContain(action.type);
  }
});
```

Remove the "rejects /v1/plan candles later than asOfUnixMs" test (no longer applies).

Add tests for the new error envelopes:

```ts
it("returns 503 PLAN_MARKET_DATA_UNAVAILABLE when no candles are stored", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/plan",
    payload: {
      ...planRequestFixture,
      market: { ...planRequestFixture.market, poolAddress: "PoolNoneStored" }
    }
  });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual(
    expect.objectContaining({
      schemaVersion: "1.0",
      error: expect.objectContaining({ code: "PLAN_MARKET_DATA_UNAVAILABLE" })
    })
  );
});

it("returns 503 PLAN_POSITION_STATE_STALE for stale position observations", async () => {
  const ingest = await app.inject({
    method: "POST",
    url: "/v1/candles",
    headers: { "X-Candles-Ingest-Token": "test-token" },
    payload: buildIngestPayload(140)
  });
  expect(ingest.statusCode).toBe(200);

  const response = await app.inject({
    method: "POST",
    url: "/v1/plan",
    payload: {
      ...planRequestFixture,
      position: { ...planRequestFixture.position, observedAtUnixMs: PLAN_AS_OF - 60_001 }
    }
  });
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual(
    expect.objectContaining({
      error: expect.objectContaining({ code: "PLAN_POSITION_STATE_STALE" })
    })
  );
});

it("never emits REQUEST_REBALANCE or REQUEST_ENTER_CLMM for the public position-scoped path", async () => {
  const ingest = await app.inject({
    method: "POST",
    url: "/v1/candles",
    headers: { "X-Candles-Ingest-Token": "test-token" },
    payload: buildIngestPayload(140)
  });
  expect(ingest.statusCode).toBe(200);

  const response = await app.inject({
    method: "POST",
    url: "/v1/plan",
    payload: planRequestFixture
  });
  const body = response.json() as { actions: Array<{ type: string }> };
  for (const a of body.actions) {
    expect(a.type).not.toBe("REQUEST_REBALANCE");
    expect(a.type).not.toBe("REQUEST_ENTER_CLMM");
  }
});
```

- [ ] **Step 2: Update `plan.e2e.test.ts`**

Replace its inline plan payload with the same shape used above (`PoolPlanE2E1` poolAddress to keep tests isolated). Add a candles `POST /v1/candles` call before `POST /v1/plan` and set `process.env.CANDLES_INGEST_TOKEN = "test-token"` before each test (and unset in `afterEach`).

- [ ] **Step 3: Update `executionResult.e2e.test.ts`**

Same approach: ingest candles for `PoolExecE2E1`, post position-scoped plan, then post execution result with the linked `(planId, planHash)`. Replace the inline plan request payload with the position-scoped equivalent.

- [ ] **Step 4: Update `ledger.test.ts`**

Update `makePlanRequestFixture` (and any inline payloads) to position-scoped shape. The wire-via-HTTP test needs to ingest candles first, just like the e2e tests above.

- [ ] **Step 5: Run the affected test files**

Run:

```bash
pnpm vitest run src/adapters/http/__tests__/routes.contract.test.ts \
  src/adapters/http/__tests__/plan.e2e.test.ts \
  src/adapters/http/__tests__/executionResult.e2e.test.ts \
  src/ledger/__tests__/ledger.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/http/__tests__/routes.contract.test.ts \
        src/adapters/http/__tests__/plan.e2e.test.ts \
        src/adapters/http/__tests__/executionResult.e2e.test.ts \
        src/ledger/__tests__/ledger.test.ts
git commit -m "m47: update HTTP and ledger integration tests for position-scoped plan"
```

---

## Phase 11: Snapshot Tests

### Task 11: Update canonicalHash snapshot test

**Files:**

- Modify: `src/contract/v1/__tests__/canonicalHash.snapshot.test.ts`
- Modify: `src/contract/v1/__tests__/__snapshots__/canonicalHash.snapshot.test.ts.snap`

- [ ] **Step 1: Inspect the existing test**

Run:

```bash
sed -n '1,80p' src/contract/v1/__tests__/canonicalHash.snapshot.test.ts
```

If it asserts a snapshot of `buildPlan(...)` output, replace its `PlanRequest` fixture with the position-scoped equivalent (re-using the snapshot fixture from the policy tests above). If it imports `buildPlan`, swap the import to use the use case via fakes — or import `buildPositionPlan` directly with a hand-built `PositionPlanInput` to keep the test pure.

- [ ] **Step 2: Update the test and regenerate the snapshot**

Run:

```bash
pnpm vitest run src/contract/v1/__tests__/canonicalHash.snapshot.test.ts -u
```

Expected: snapshot is updated and the test passes.

- [ ] **Step 3: Commit**

```bash
git add src/contract/v1/__tests__/canonicalHash.snapshot.test.ts \
        src/contract/v1/__tests__/__snapshots__/canonicalHash.snapshot.test.ts.snap
git commit -m "m47: regenerate canonical hash snapshot for position-scoped plan"
```

---

## Phase 12: Delete Legacy Plan Engine

### Task 12: Remove legacy `buildPlan` and its snapshot test

**Files:**

- Delete: `src/engine/plan/buildPlan.ts`
- Delete: `src/engine/plan/__tests__/planDeterminism.snapshot.test.ts`
- Delete: `src/engine/plan/__tests__/__snapshots__/planDeterminism.snapshot.test.ts.snap`

- [ ] **Step 1: Confirm nothing imports `buildPlan`**

Run:

```bash
grep -rn 'engine/plan/buildPlan\|from.*buildPlan\.js' src/
```

Expected: no results except the file itself and its snapshot test (which we are deleting).

- [ ] **Step 2: Delete the files**

```bash
rm src/engine/plan/buildPlan.ts \
   src/engine/plan/__tests__/planDeterminism.snapshot.test.ts \
   src/engine/plan/__tests__/__snapshots__/planDeterminism.snapshot.test.ts.snap
```

- [ ] **Step 3: Run typecheck and tests**

Run: `pnpm run typecheck && pnpm run test`

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add -A src/engine/plan
git commit -m "m47: remove legacy buildPlan superseded by buildPositionPlan"
```

---

## Phase 13: Demo Fixtures and Harness

### Task 13: Convert demo fixtures and update harness

**Files:**

- Modify: `fixtures/demo/01-uptrend.json`, `02-chop.json`, `03-downtrend.json`, `04-whipsaw.json`
- Modify: `scripts/harness.ts`

- [ ] **Step 1: Inspect harness flow**

Run:

```bash
sed -n '60,180p' scripts/harness.ts
```

Identify where the harness calls `POST /v1/plan` (around line 111 per earlier grep) and confirm whether the harness already calls `POST /v1/candles` for an ingestion step (it does not).

- [ ] **Step 2: Update the harness fixture shape**

Define a new fixture step shape:

```ts
interface HarnessStepFixture {
  candles?: {
    sourceRecordedAtIso: string;
    rows: Array<{
      unixMs: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
  };
  request: Record<string, unknown>;
  execution?: HarnessExecutionFixture;
}
```

Before calling `/v1/plan`, when `step.candles` is present, post:

```ts
if (step.candles) {
  await app.inject({
    method: "POST",
    url: "/v1/candles",
    headers: { "X-Candles-Ingest-Token": process.env.CANDLES_INGEST_TOKEN ?? "harness-token" },
    payload: {
      schemaVersion: "1.0",
      source: step.request.market?.source,
      network: step.request.market?.network,
      poolAddress: step.request.market?.poolAddress,
      symbol: step.request.market?.symbol,
      timeframe: "15m",
      sourceRecordedAtIso: step.candles.sourceRecordedAtIso,
      candles: step.candles.rows
    }
  });
}
```

Set `process.env.CANDLES_INGEST_TOKEN = "harness-token"` near the start of the harness if it isn't already set (mirror existing tests).

- [ ] **Step 3: Convert each demo fixture**

For each of `01-uptrend.json`, `02-chop.json`, `03-downtrend.json`, `04-whipsaw.json`:

- Move the existing `request.market.candles` to a top-level `candles.rows` field (reshaped at 15m unixMs alignment — if existing fixtures use 1h candles, treat them as the post-aggregation surface and instead synthesize the equivalent 15m sequence by quartering each 1h candle: emit four 15m candles with shared ohlc and `volume / 4`. This preserves the demo regime profile without changing what the fixture intends).
- Remove `market.candles`.
- Add the new `position` block with `positionId`, `observedAtUnixMs == request.asOfUnixMs`, sane `lowerBoundPrice`/`upperBoundPrice`/`currentPrice`/`rangeState`/`breachQualified` matching the fixture intent (e.g. `04-whipsaw` should set a qualified breach for an out-of-range position; the others should remain `in-range`).
- Add `market.{source: "geckoterminal", network: "solana", poolAddress: "<unique per fixture>", timeframe: "1h"}`.
- Add `candles.sourceRecordedAtIso` matching `request.asOfUnixMs`.

- [ ] **Step 4: Run the harness end-to-end**

Run:

```bash
pnpm run harness --fixture fixtures/demo
```

Expected: harness completes without errors and emits report artifacts for all four fixtures.

- [ ] **Step 5: Commit**

```bash
git add fixtures/demo scripts/harness.ts
git commit -m "m47: rewire demo fixtures and harness for position-scoped plan"
```

---

## Phase 14: Documentation

### Task 14: Update README, architecture, and documentation

**Files:**

- Modify: `README.md`
- Modify: `architecture.md`
- Modify: `documentation.md`

- [ ] **Step 1: Update `README.md`**

Find the `POST /v1/plan` bullet (line 23) and rewrite the surrounding endpoint list entry:

```md
- `POST /v1/plan` — position-scoped CLMM recommendation. Reads stored closed
  candles for `(market.source, market.network, market.poolAddress, market.timeframe)`
  and returns one of `HOLD`, `STAND_DOWN`, or `REQUEST_EXIT_CLMM` against the
  caller-supplied LP position state, portfolio, and autopilot state. No inline
  candles. Plans are persisted to the existing plan ledger with `planId` /
  `planHash` and link cleanly to `POST /v1/execution-result`.
```

If the README has a "Plan request shape" section, update its example to a position-scoped one.

- [ ] **Step 2: Update `architecture.md`**

Replace the "Plan generation (`POST /v1/plan`)" section (around line 170) with the new flow:

```md
### Plan generation (`POST /v1/plan`)

1. **Validate request** (contract v1, position-scoped).
2. **Validate position freshness** (`asOfUnixMs - position.observedAtUnixMs <= 60s`,
   else `503 PLAN_POSITION_STATE_STALE`).
3. **Build candle read plan** for the requested timeframe (`15m` or `1h`).
4. **Read closed candles** from `CandleReadPort` for
   `(market.source, market.network, market.poolAddress, "15m")`.
5. **Aggregate to 1h on the fly** when `timeframe = "1h"`; filter to the closed
   derived cutoff. Insufficient closed/derived candles → `503 PLAN_MARKET_DATA_UNAVAILABLE`.
6. **Compute indicators, classify regime, evaluate freshness and CLMM
   suitability** using the same helpers as `GET /v1/regime/current`.
7. **Apply position recommendation policy:**
   1. Qualified out-of-range → `REQUEST_EXIT_CLMM`.
   2. `BLOCKED` suitability with `activeClmm` → `REQUEST_EXIT_CLMM`.
   3. Stand-down active → `STAND_DOWN`.
   4. Otherwise → `HOLD`.
8. **Build the plan response** with `scope.kind = "position"`, `scope.positionId`,
   advisory `targets`, market metadata, telemetry, and reasons.
9. **Canonicalize + hash** (deterministic `planHash`).
10. **Persist** request + plan rows through `PlanLedgerWritePort`.
11. **Return PlanResponse** (HTTP adapter).
```

- [ ] **Step 3: Update `documentation.md`**

Append a new milestone section at the end:

```md
## Milestone 47 — Position-scoped /v1/plan

- `POST /v1/plan` is now a position-scoped, store-backed recommendation
  endpoint. Inline `market.candles` is removed; the request supplies
  `market.{symbol, source, network, poolAddress, timeframe}` and a full
  `position` block.
- The MVP action set is restricted to `HOLD`, `STAND_DOWN`, and `REQUEST_EXIT_CLMM`.
- New error codes: `PLAN_MARKET_DATA_UNAVAILABLE`, `PLAN_POSITION_STATE_STALE`
  (both 503), `INVALID_POSITION_OBSERVED_AT`, `BREACH_QUALIFIED_AT_REQUIRED`,
  `INVALID_BREACH_QUALIFIED_AT` (400).
- The legacy `src/engine/plan/buildPlan.ts` was removed; the new pure module
  is `src/engine/plan/positionPlan.ts`.
- `GeneratePlanUseCase` now depends on `CandleReadPort`, `ClockPort`,
  `engineVersion`, and `PlanLedgerWritePort`.
- Plans persist with the same `(planId, planHash)` shape, so
  `/v1/execution-result` linkage is unchanged.
```

- [ ] **Step 4: Commit**

```bash
git add README.md architecture.md documentation.md
git commit -m "m47: document position-scoped /v1/plan contract"
```

---

## Phase 15: Final Validation

### Task 15: Run full quality gate

- [ ] **Step 1: Run the full validation suite**

Run:

```bash
pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build && pnpm run boundaries
```

Expected: all pass.

- [ ] **Step 2: Optional: run Postgres tests if local Postgres is available**

Run:

```bash
pnpm run test:pg
```

If `pnpm run test:pg` fails for environmental reasons, note the absence of a local Postgres in the PR and let CI handle it.

- [ ] **Step 3: Confirm dependency-cruiser passes**

Run: `pnpm run boundaries`

Expected: passes. The new `src/application/errors/planErrors.ts` only imports from `regimeErrors.ts`. `src/engine/plan/positionPlan.ts` imports only from `src/contract/**` and `src/engine/**`. `src/application/use-cases/generatePlanUseCase.ts` imports from `src/application/**`, `src/engine/**`, and `src/contract/**` — all inward dependencies.

- [ ] **Step 4: Open the PR**

When opening the PR, copy the full validation command output into the description. Highlight:

- `/v1/plan` is now position-scoped with breaking request/response shape (intentional, no live consumer).
- Action set restricted to `HOLD | STAND_DOWN | REQUEST_EXIT_CLMM`.
- New 400/503 error codes documented.
- Legacy `buildPlan` removed.
