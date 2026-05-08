# Regime Current And Plan Use Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `GetCurrentRegimeUseCase` and `GeneratePlanUseCase` under `src/application/use-cases/` so the deterministic orchestration of `GET /v1/regime/current` and `POST /v1/plan` lives behind ports, with HTTP handlers reduced to request parsing, known-error mapping, and reply mechanics — preserving the on-the-wire contract, plan hashes, canonical JSON, ledger writes, cutoff behavior, and error envelopes byte-for-byte.

**Architecture:** Two new use-case factories take parsed contract inputs and return contract outputs. `GetCurrentRegimeUseCase` depends on `CandleReadPort`, `ClockPort`, and a static `engineVersion` string injected from routes — it owns read planning, source/derived selection, aggregation, derived-cutoff filtering, empty-candle signaling via a new `RegimeCandlesNotFoundError`, and `buildRegimeCurrent` invocation. `GeneratePlanUseCase` depends on a new `PlanLedgerWritePort` — it calls `buildPlan(body, body.regimeState)` and writes `{ planRequest, planResponse }` through the port. A `createSqlitePlanLedgerWriteAdapter` wraps the existing synchronous `writePlanLedgerEntry`. Routes compose the use cases and pass them into existing handler factories.

**Tech Stack:** Node 22, pnpm 10, TypeScript (NodeNext, strict), Fastify 5, `node:sqlite`, Drizzle ORM + `postgres` driver, Vitest. Boundary rules in `.dependency-cruiser.cjs` already prohibit `src/application/**` from importing `src/http/**`, `src/ledger/**`, `src/adapters/**`, framework npm packages, `node:process`, or `process` — the new code must respect those rules.

---

## File Map

**Create — application errors (no I/O):**

- `src/application/errors/regimeErrors.ts` — `RegimeApplicationErrorDetail` interface and `RegimeCandlesNotFoundError` class with a `details` field. No `src/http/**` imports.

**Create — application ports:**

- `src/application/ports/planLedgerPort.ts` — `PlanLedgerWritePort` interface with `writePlan({ planRequest, planResponse })`. Imports only contract types.

**Create — application use cases (orchestration, no I/O):**

- `src/application/use-cases/getCurrentRegimeUseCase.ts` — `createGetCurrentRegimeUseCase(deps)` factory returning `(query: RegimeCurrentQuery) => Promise<RegimeCurrentResponse>`. Depends on `CandleReadPort`, `ClockPort`, and `engineVersion: string`.
- `src/application/use-cases/generatePlanUseCase.ts` — `createGeneratePlanUseCase(deps)` factory returning `(body: PlanRequest) => Promise<PlanResponse>`. Depends on `PlanLedgerWritePort`.

**Create — application use case tests:**

- `src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts` — direct 15m, derived 1h, source-empty error, derived-empty error, metadata, engine-version-injection paths using fakes.
- `src/application/use-cases/__tests__/generatePlanUseCase.test.ts` — calls `buildPlan(body, body.regimeState)`, writes exactly `{ planRequest: body, planResponse: plan }` through the port, returns the same response.
- `src/application/use-cases/__tests__/fakes/fakeCandleReadPort.ts` — in-memory `CandleReadPort` returning a configured candle list, recording the params it was called with.
- `src/application/use-cases/__tests__/fakes/fakeClockPort.ts` — `ClockPort` returning a fixed `nowUnixMs`.
- `src/application/use-cases/__tests__/fakes/fakePlanLedgerWritePort.ts` — captures `writePlan` inputs into a public `calls` array.

**Create — adapters:**

- `src/adapters/sqlite/sqlitePlanLedgerWriteAdapter.ts` — `createSqlitePlanLedgerWriteAdapter(store)` returns a `PlanLedgerWritePort` whose `writePlan` calls the existing synchronous `writePlanLedgerEntry`. No new transaction or hashing logic.

**Modify — handlers (slim down):**

- `src/http/handlers/regimeCurrent.ts` — change factory signature to accept the use case; keep parse, run, map `ContractValidationError`, map `RegimeCandlesNotFoundError` to `candlesNotFoundError(error.message, error.details)`, log + 500 on unexpected.
- `src/http/handlers/plan.ts` — change factory signature to accept the use case; keep parse, run, map `ContractValidationError`, rethrow on unexpected.

**Modify — composition:**

- `src/http/routes.ts` — construct `getCurrentRegime` and `generatePlan` use cases; pass them into the handler factories. Remove the now-unused `ledger` argument from `createPlanHandler`'s call site (`createPlanHandler(ledger)` → `createPlanHandler(generatePlan)`); remove the now-unused `candleReadPort` argument from `createRegimeCurrentHandler`'s call site (`createRegimeCurrentHandler(candleReadPort)` → `createRegimeCurrentHandler(getCurrentRegime)`). The existing `clock`, `candleReadPort`, and `ledger` constructions stay — they now feed the use cases.

**No changes:**

- `src/contract/v1/types.ts`, `src/contract/v1/validation.ts`, `src/contract/v1/canonical.ts`, `src/contract/v1/hash.ts` — contract is preserved.
- `src/http/errors.ts`, `src/http/openapi.ts` — error taxonomy and OpenAPI shape are preserved.
- `src/engine/marketRegime/**`, `src/engine/plan/buildPlan.ts`, `src/engine/candles/aggregateCandles.ts` — engine behavior is preserved.
- `src/ledger/writer.ts`, `src/ledger/store.ts` — `writePlanLedgerEntry` keeps the same signature and behavior; the new SQLite adapter wraps it.
- `src/adapters/sqlite/sqliteCandleReadAdapter.ts`, `src/adapters/postgres/postgresCandleReadAdapter.ts` — already used by routes.ts; unchanged.
- `.dependency-cruiser.cjs` — existing rules already cover the new files; no changes needed.

---

## Pre-flight

- [ ] **Step 0: Confirm clean working tree on a fresh branch from `main`**

Run:

```bash
git status
git log -1 --oneline
git checkout -b m39-regime-current-plan-use-cases
```

Expected: working tree clean (or only this plan file unstaged), HEAD on `a6e678f m39: add regime and plan use case design`. The design commit on `main` is what this plan implements.

- [ ] **Step 1: Confirm baseline is green**

Run:

```bash
npm run typecheck && npm run lint && npm run test && npm run build && npm run boundaries
```

Expected: all five succeed. If any fail, stop and surface the failure — every refactor task below assumes a green baseline so a new red is unambiguously caused by #39.

- [ ] **Step 2: Confirm baseline `test:pg` status**

Run:

```bash
npm run test:pg || echo "PG suite is unavailable in this environment"
```

Expected: either the PG suite runs and is green, or it fails because `DATABASE_URL` is unreachable. **Record which** in the PR description. If `test:pg` cannot run locally, the implementer must note that the Postgres regime read path is locally unvalidated and rely on CI for proof.

---

## Task Sequencing

The new application errors, ports, and adapters are independent leaves and can land in any order before the use cases. Use cases depend on the errors and ports. Handlers depend on the use cases. Routes depends on everything. Land tasks in the order below; do not jump ahead.

1. Add `RegimeCandlesNotFoundError`.
2. Add `PlanLedgerWritePort`.
3. Add `createSqlitePlanLedgerWriteAdapter`.
4. Add use-case test fakes.
5. Add `GetCurrentRegimeUseCase` (TDD).
6. Add `GeneratePlanUseCase` (TDD).
7. Slim the regime-current handler.
8. Slim the plan handler.
9. Rewire routes.
10. Run the quality gate.

---

### Task 1: Add `RegimeCandlesNotFoundError`

**Files:**

- Create: `src/application/errors/regimeErrors.ts`

- [ ] **Step 1: Write the file**

Create `src/application/errors/regimeErrors.ts` with the following exact contents:

```ts
export interface RegimeApplicationErrorDetail {
  code: string;
  path: string;
  message: string;
}

export class RegimeCandlesNotFoundError extends Error {
  public readonly details: RegimeApplicationErrorDetail[];

  public constructor(message: string, details: RegimeApplicationErrorDetail[]) {
    super(message);
    this.name = "RegimeCandlesNotFoundError";
    this.details = details;
  }
}
```

Notes:

- `RegimeApplicationErrorDetail` keys (`code`, `path`, `message`) intentionally match the data shape currently passed into `candlesNotFoundError` in `src/http/handlers/regimeCurrent.ts:40` and `src/http/handlers/regimeCurrent.ts:62`.
- Do not import from `src/http/**`. Do not import `ErrorDetail` from `src/http/errors.ts`. The handler maps the application detail shape to the HTTP `ErrorDetail` by structural compatibility (same keys, same values).

- [ ] **Step 2: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed. If `boundaries` fails, the new file violated `application-no-outer-layers` — fix imports. If typecheck fails, fix syntax.

- [ ] **Step 3: Commit**

```bash
git add src/application/errors/regimeErrors.ts
git commit -m "m39: add RegimeCandlesNotFoundError application error"
```

---

### Task 2: Add `PlanLedgerWritePort`

**Files:**

- Create: `src/application/ports/planLedgerPort.ts`

- [ ] **Step 1: Write the file**

Create `src/application/ports/planLedgerPort.ts` with the following exact contents:

```ts
import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";

export interface PlanLedgerWritePort {
  writePlan(input: { planRequest: PlanRequest; planResponse: PlanResponse }): Promise<void>;
}
```

- [ ] **Step 2: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/application/ports/planLedgerPort.ts
git commit -m "m39: add PlanLedgerWritePort"
```

---

### Task 3: Add `createSqlitePlanLedgerWriteAdapter`

**Files:**

- Create: `src/adapters/sqlite/sqlitePlanLedgerWriteAdapter.ts`

- [ ] **Step 1: Write the adapter**

Create `src/adapters/sqlite/sqlitePlanLedgerWriteAdapter.ts` with the following exact contents:

```ts
import type { LedgerStore } from "../../ledger/store.js";
import type { PlanLedgerWritePort } from "../../application/ports/planLedgerPort.js";
import { writePlanLedgerEntry } from "../../ledger/writer.js";

export const createSqlitePlanLedgerWriteAdapter = (store: LedgerStore): PlanLedgerWritePort => ({
  async writePlan(input) {
    writePlanLedgerEntry(store, input);
  }
});
```

Notes:

- This adapter must not pass `receivedAtUnixMs`; we keep the existing `Date.now()` default in `writePlanLedgerEntry` (`src/ledger/writer.ts:38`). Behavior parity requires this exactly.
- The adapter intentionally awaits nothing inside `writePlan` because the underlying write is synchronous; the `async` keyword satisfies the `Promise<void>` return.

- [ ] **Step 2: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/sqlite/sqlitePlanLedgerWriteAdapter.ts
git commit -m "m39: add SQLite plan ledger write adapter"
```

---

### Task 4: Add use-case test fakes

**Files:**

- Create: `src/application/use-cases/__tests__/fakes/fakeCandleReadPort.ts`
- Create: `src/application/use-cases/__tests__/fakes/fakeClockPort.ts`
- Create: `src/application/use-cases/__tests__/fakes/fakePlanLedgerWritePort.ts`

- [ ] **Step 1: Write `fakeCandleReadPort.ts`**

Create `src/application/use-cases/__tests__/fakes/fakeCandleReadPort.ts` with:

```ts
import type { CandleReadPort } from "../../../ports/candlePorts.js";
import type { CandleRow, GetLatestCandlesParams } from "../../../../contract/v1/types.js";

export class FakeCandleReadPort implements CandleReadPort {
  public calls: GetLatestCandlesParams[] = [];
  private readonly rowsByTimeframe: Map<string, CandleRow[]>;

  public constructor(rowsByTimeframe: Record<string, CandleRow[]> = {}) {
    this.rowsByTimeframe = new Map(Object.entries(rowsByTimeframe));
  }

  async getLatestCandlesForFeed(params: GetLatestCandlesParams): Promise<CandleRow[]> {
    this.calls.push({ ...params });
    const rows = this.rowsByTimeframe.get(params.timeframe) ?? [];
    return rows.filter((row) => row.unixMs <= params.closedCandleCutoffUnixMs).slice(-params.limit);
  }
}
```

Notes:

- The fake honors `closedCandleCutoffUnixMs` and `limit` so direct/derived tests reflect real cutoff behavior. The use-case tests will configure rows aligned with the cutoffs the use case computes.

- [ ] **Step 2: Write `fakeClockPort.ts`**

Create `src/application/use-cases/__tests__/fakes/fakeClockPort.ts` with:

```ts
import type { ClockPort } from "../../../ports/clock.js";

export class FakeClockPort implements ClockPort {
  public constructor(private readonly fixedNowUnixMs: number) {}

  nowUnixMs(): number {
    return this.fixedNowUnixMs;
  }
}
```

- [ ] **Step 3: Write `fakePlanLedgerWritePort.ts`**

Create `src/application/use-cases/__tests__/fakes/fakePlanLedgerWritePort.ts` with:

```ts
import type { PlanLedgerWritePort } from "../../../ports/planLedgerPort.js";
import type { PlanRequest, PlanResponse } from "../../../../contract/v1/types.js";

export class FakePlanLedgerWritePort implements PlanLedgerWritePort {
  public calls: Array<{ planRequest: PlanRequest; planResponse: PlanResponse }> = [];

  async writePlan(input: { planRequest: PlanRequest; planResponse: PlanResponse }): Promise<void> {
    this.calls.push({ planRequest: input.planRequest, planResponse: input.planResponse });
  }
}
```

- [ ] **Step 4: Confirm typecheck is green**

Run:

```bash
npm run typecheck
```

Expected: success. Test files are excluded from `boundaries`, so do not run that here.

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/__tests__/fakes/fakeCandleReadPort.ts \
        src/application/use-cases/__tests__/fakes/fakeClockPort.ts \
        src/application/use-cases/__tests__/fakes/fakePlanLedgerWritePort.ts
git commit -m "m39: add use-case test fakes (candle read, clock, plan ledger)"
```

---

### Task 5: Add `GetCurrentRegimeUseCase` (TDD)

**Files:**

- Create: `src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts`
- Create: `src/application/use-cases/getCurrentRegimeUseCase.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts` with the following contents:

```ts
import { describe, expect, it } from "vitest";
import { createGetCurrentRegimeUseCase } from "../getCurrentRegimeUseCase.js";
import { FakeCandleReadPort } from "./fakes/fakeCandleReadPort.js";
import { FakeClockPort } from "./fakes/fakeClockPort.js";
import { RegimeCandlesNotFoundError } from "../../errors/regimeErrors.js";
import { MARKET_REGIME_CONFIG } from "../../../engine/marketRegime/config.js";
import type { CandleRow, RegimeCurrentQuery } from "../../../contract/v1/types.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIXED_NOW =
  Math.floor(Date.parse("2026-05-08T12:00:00.000Z") / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;

const baseQuery: RegimeCurrentQuery = {
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  timeframe: "15m"
};

const flatRow = (unixMs: number): CandleRow => ({
  unixMs,
  open: 100,
  high: 100.5,
  low: 99.5,
  close: 100,
  volume: 1
});

const buildSequential15mRows = (count: number, anchor: number): CandleRow[] =>
  Array.from({ length: count }, (_, i) => flatRow(anchor - (count - 1 - i) * FIFTEEN_MIN_MS));

describe("GetCurrentRegimeUseCase", () => {
  it("direct 15m happy path returns response shape and metadata", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const minCandles = MARKET_REGIME_CONFIG["15m"].suitability.minCandles;
    const sourceCandles = buildSequential15mRows(minCandles + 50, FIXED_NOW - 2 * FIFTEEN_MIN_MS);
    const candleReadPort = new FakeCandleReadPort({ "15m": sourceCandles });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    const response = await useCase(baseQuery);

    expect(response.timeframe).toBe("15m");
    expect(response.metadata.engineVersion).toBe("9.9.9");
    expect(response.metadata.sourceTimeframe).toBe("15m");
    expect(response.metadata.sourceCandleCount).toBe(sourceCandles.length);
    expect(response.metadata.derivedTimeframe).toBeUndefined();
    expect(response.metadata.aggregationVersion).toBeUndefined();
    expect(candleReadPort.calls).toHaveLength(1);
    expect(candleReadPort.calls[0].timeframe).toBe("15m");
  });

  it("derived 1h happy path reads 15m, aggregates, and emits derived metadata", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const minDerived = MARKET_REGIME_CONFIG["1h"].suitability.minCandles;
    // 4 source 15m candles per 1h bucket; produce well over the minimum derived bars.
    const sourceCandles = buildSequential15mRows((minDerived + 20) * 4, FIXED_NOW - ONE_HOUR_MS);
    const candleReadPort = new FakeCandleReadPort({ "15m": sourceCandles });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    const response = await useCase({ ...baseQuery, timeframe: "1h" });

    expect(response.timeframe).toBe("1h");
    expect(response.metadata.sourceTimeframe).toBe("15m");
    expect(response.metadata.derivedTimeframe).toBe("1h");
    expect(response.metadata.aggregationVersion).toBe("ohlcv-agg-v1");
    expect(response.metadata.sourceCandleCount).toBe(sourceCandles.length);
    expect(candleReadPort.calls[0].timeframe).toBe("15m");
  });

  it("throws RegimeCandlesNotFoundError when no source candles exist", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const candleReadPort = new FakeCandleReadPort({ "15m": [] });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    await expect(useCase(baseQuery)).rejects.toMatchObject({
      name: "RegimeCandlesNotFoundError",
      details: [
        {
          code: "NO_SOURCE_CANDLES",
          path: "$.sourceTimeframe",
          message: "No source candles found before the freshness cutoff"
        }
      ]
    });
    await expect(useCase(baseQuery)).rejects.toBeInstanceOf(RegimeCandlesNotFoundError);
  });

  it("throws RegimeCandlesNotFoundError when no derived candles survive the 1h cutoff", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    // Only one 15m candle, far in the past — never enough to form a complete 1h bucket
    // before the derived cutoff.
    const sourceCandles = [flatRow(FIXED_NOW - 200 * ONE_HOUR_MS)];
    const candleReadPort = new FakeCandleReadPort({ "15m": sourceCandles });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    await expect(useCase({ ...baseQuery, timeframe: "1h" })).rejects.toMatchObject({
      name: "RegimeCandlesNotFoundError",
      details: [
        expect.objectContaining({
          code: "NO_DERIVED_CANDLES_AFTER_AGGREGATION",
          path: "$.derivedTimeframe"
        })
      ]
    });
    const error = await useCase({ ...baseQuery, timeframe: "1h" }).catch((e) => e);
    expect(error.message).toContain("No complete derived 1h candles available");
    expect(error.details[0].message).toMatch(/Aggregation produced \d+ complete 1h buckets/);
    expect(error.details[0].message).toMatch(
      /Skipped: \d+ incomplete, \d+ gaps, \d+ misaligned, \d+ non-integer/
    );
  });

  it("calls the candle read port with the read plan parameters and the parsed query feed", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const candleReadPort = new FakeCandleReadPort({ "15m": [] });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    await expect(useCase(baseQuery)).rejects.toBeInstanceOf(RegimeCandlesNotFoundError);

    expect(candleReadPort.calls).toHaveLength(1);
    expect(candleReadPort.calls[0]).toMatchObject({
      symbol: "SOL/USDC",
      source: "birdeye",
      network: "solana-mainnet",
      poolAddress: "Pool111",
      timeframe: "15m"
    });
    expect(candleReadPort.calls[0].limit).toBeGreaterThan(0);
    expect(candleReadPort.calls[0].closedCandleCutoffUnixMs).toBeLessThan(FIXED_NOW);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts
```

Expected: FAIL with `Cannot find module '../getCurrentRegimeUseCase.js'` (or similar). The use case module does not exist yet.

- [ ] **Step 3: Implement the use case**

Create `src/application/use-cases/getCurrentRegimeUseCase.ts` with:

```ts
import type { CandleReadPort } from "../ports/candlePorts.js";
import type { ClockPort } from "../ports/clock.js";
import type { RegimeCurrentQuery, RegimeCurrentResponse } from "../../contract/v1/types.js";
import {
  MARKET_REGIME_CONFIG,
  MARKET_REGIME_CONFIG_VERSION
} from "../../engine/marketRegime/config.js";
import { buildRegimeCurrent } from "../../engine/marketRegime/buildRegimeCurrent.js";
import { buildRegimeCandleReadPlan } from "../../engine/marketRegime/regimeCandleReadPlan.js";
import { aggregate15mTo1h } from "../../engine/candles/aggregateCandles.js";
import { RegimeCandlesNotFoundError } from "../errors/regimeErrors.js";

export type GetCurrentRegimeUseCase = (query: RegimeCurrentQuery) => Promise<RegimeCurrentResponse>;

export interface GetCurrentRegimeUseCaseDeps {
  candleReadPort: CandleReadPort;
  clock: ClockPort;
  engineVersion: string;
}

export const createGetCurrentRegimeUseCase = (
  deps: GetCurrentRegimeUseCaseDeps
): GetCurrentRegimeUseCase => {
  return async (query) => {
    const config = MARKET_REGIME_CONFIG[query.timeframe];
    const nowUnixMs = deps.clock.nowUnixMs();
    const plan = buildRegimeCandleReadPlan({
      requestedTimeframe: query.timeframe,
      nowUnixMs
    });

    const sourceCandles = await deps.candleReadPort.getLatestCandlesForFeed({
      symbol: query.symbol,
      source: query.source,
      network: query.network,
      poolAddress: query.poolAddress,
      timeframe: plan.sourceTimeframe,
      closedCandleCutoffUnixMs: plan.sourceCutoffUnixMs,
      limit: plan.sourceLimit
    });

    if (sourceCandles.length === 0) {
      throw new RegimeCandlesNotFoundError(
        `No closed candles found for symbol="${query.symbol}", source="${query.source}", ` +
          `network="${query.network}", poolAddress="${query.poolAddress}", ` +
          `sourceTimeframe="${plan.sourceTimeframe}", requestedTimeframe="${query.timeframe}".`,
        [
          {
            code: "NO_SOURCE_CANDLES",
            path: "$.sourceTimeframe",
            message: "No source candles found before the freshness cutoff"
          }
        ]
      );
    }

    let candlesToClassify = sourceCandles;

    if (plan.mode === "derived") {
      const { candles: aggregated, telemetry } = aggregate15mTo1h(sourceCandles);
      candlesToClassify = aggregated.filter((candle) => candle.unixMs <= plan.derivedCutoffUnixMs);
      if (candlesToClassify.length === 0) {
        throw new RegimeCandlesNotFoundError(
          `No complete derived 1h candles available before the 1h freshness cutoff for ` +
            `symbol="${query.symbol}", source="${query.source}", network="${query.network}", ` +
            `poolAddress="${query.poolAddress}".`,
          [
            {
              code: "NO_DERIVED_CANDLES_AFTER_AGGREGATION",
              path: "$.derivedTimeframe",
              message:
                `Aggregation produced ${telemetry.completeBuckets} complete 1h buckets but none before the cutoff. ` +
                `Skipped: ${telemetry.skippedIncomplete} incomplete, ${telemetry.skippedGapInBucket} gaps, ` +
                `${telemetry.skippedMisaligned} misaligned, ${telemetry.skippedNonInteger} non-integer`
            }
          ]
        );
      }
    }

    return buildRegimeCurrent({
      feed: {
        symbol: query.symbol,
        source: query.source,
        network: query.network,
        poolAddress: query.poolAddress,
        timeframe: query.timeframe
      },
      candles: candlesToClassify,
      nowUnixMs,
      config,
      configVersion: MARKET_REGIME_CONFIG_VERSION,
      engineVersion: deps.engineVersion,
      metadata: {
        ...plan.sourceMetadata,
        sourceCandleCount: sourceCandles.length
      }
    });
  };
};
```

Notes:

- Strings, detail codes, paths, and messages are copied byte-for-byte from `src/http/handlers/regimeCurrent.ts:36-72`. Behavior parity for the HTTP envelope depends on this.
- The use case must not import `process`, `node:process`, `src/http/**`, `src/ledger/**`, or `src/adapters/**`. Routes injects `engineVersion`.
- The order of operations (config lookup → clock read → read plan → port read → empty source → optional aggregation → empty derived → `buildRegimeCurrent`) mirrors the current handler exactly.

- [ ] **Step 4: Run the tests until green**

Run:

```bash
npx vitest run src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts
```

Expected: PASS. If a test fails:

- Empty/cutoff tests: confirm the fake's filter and the use case's `closedCandleCutoffUnixMs` cutoff agree.
- Derived metadata tests: confirm `plan.sourceMetadata` is spread before `sourceCandleCount` is set.
- Engine-version test: confirm `deps.engineVersion` is passed straight through to `buildRegimeCurrent`.

- [ ] **Step 5: Confirm boundaries are still green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed. If `boundaries` fails, the use case violated `application-no-outer-layers`, `application-no-framework-npm`, or `application-no-node-builtins` — fix imports.

- [ ] **Step 6: Commit**

```bash
git add src/application/use-cases/getCurrentRegimeUseCase.ts \
        src/application/use-cases/__tests__/getCurrentRegimeUseCase.test.ts
git commit -m "m39: add GetCurrentRegimeUseCase"
```

---

### Task 6: Add `GeneratePlanUseCase` (TDD)

**Files:**

- Create: `src/application/use-cases/__tests__/generatePlanUseCase.test.ts`
- Create: `src/application/use-cases/generatePlanUseCase.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/application/use-cases/__tests__/generatePlanUseCase.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createGeneratePlanUseCase } from "../generatePlanUseCase.js";
import { FakePlanLedgerWritePort } from "./fakes/fakePlanLedgerWritePort.js";
import { buildPlan } from "../../../engine/plan/buildPlan.js";
import type { PlanRequest } from "../../../contract/v1/types.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const AS_OF = 1_762_591_200_000;

const makePlanRequest = (): PlanRequest => ({
  schemaVersion: "1.0",
  asOfUnixMs: AS_OF,
  market: {
    symbol: "SOLUSDC",
    timeframe: "1h",
    candles: Array.from({ length: 36 }, (_, index) => {
      const base = 100 + index * 0.65 + Math.sin(index / 5) * 0.6;
      const close = base + Math.sin(index / 4) * 0.5;
      return {
        unixMs: AS_OF - (35 - index) * ONE_HOUR_MS,
        open: base,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1_000 + index * 7
      };
    })
  },
  portfolio: { navUsd: 12_000, solUnits: 25, usdcUnits: 7_000 },
  autopilotState: {
    activeClmm: false,
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
  }
});

describe("GeneratePlanUseCase", () => {
  it("returns the same response that buildPlan(body, body.regimeState) returns", async () => {
    const port = new FakePlanLedgerWritePort();
    const useCase = createGeneratePlanUseCase({ planLedgerWritePort: port });
    const body = makePlanRequest();

    const response = await useCase(body);
    const direct = buildPlan(body, body.regimeState);

    expect(response).toEqual(direct);
  });

  it("writes exactly { planRequest: body, planResponse: plan } through the port once", async () => {
    const port = new FakePlanLedgerWritePort();
    const useCase = createGeneratePlanUseCase({ planLedgerWritePort: port });
    const body = makePlanRequest();

    const response = await useCase(body);

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0].planRequest).toBe(body);
    expect(port.calls[0].planResponse).toBe(response);
  });

  it("returns the same instance that was written through the port", async () => {
    const port = new FakePlanLedgerWritePort();
    const useCase = createGeneratePlanUseCase({ planLedgerWritePort: port });
    const body = makePlanRequest();

    const response = await useCase(body);

    expect(response).toBe(port.calls[0].planResponse);
  });
});
```

Notes:

- The first test asserts that the use case's plan equals `buildPlan(body, body.regimeState)` directly. That proves the use case applies `buildPlan` with that exact second argument (the spec is explicit about `buildPlan(body, body.regimeState)`).
- `body.regimeState` is `undefined` in the fixture, mirroring the e2e test in `src/http/__tests__/plan.e2e.test.ts`. The second `buildPlan` argument passes through unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run src/application/use-cases/__tests__/generatePlanUseCase.test.ts
```

Expected: FAIL with `Cannot find module '../generatePlanUseCase.js'`.

- [ ] **Step 3: Implement the use case**

Create `src/application/use-cases/generatePlanUseCase.ts` with:

```ts
import type { PlanLedgerWritePort } from "../ports/planLedgerPort.js";
import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";
import { buildPlan } from "../../engine/plan/buildPlan.js";

export type GeneratePlanUseCase = (body: PlanRequest) => Promise<PlanResponse>;

export interface GeneratePlanUseCaseDeps {
  planLedgerWritePort: PlanLedgerWritePort;
}

export const createGeneratePlanUseCase = (deps: GeneratePlanUseCaseDeps): GeneratePlanUseCase => {
  return async (body) => {
    const plan = buildPlan(body, body.regimeState);
    await deps.planLedgerWritePort.writePlan({
      planRequest: body,
      planResponse: plan
    });
    return plan;
  };
};
```

- [ ] **Step 4: Run the tests until green**

Run:

```bash
npx vitest run src/application/use-cases/__tests__/generatePlanUseCase.test.ts
```

Expected: PASS.

- [ ] **Step 5: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/application/use-cases/generatePlanUseCase.ts \
        src/application/use-cases/__tests__/generatePlanUseCase.test.ts
git commit -m "m39: add GeneratePlanUseCase"
```

---

### Task 7: Slim the regime-current handler

**Files:**

- Modify: `src/http/handlers/regimeCurrent.ts`

- [ ] **Step 1: Replace the handler factory**

Open `src/http/handlers/regimeCurrent.ts` and replace its **entire contents** with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { parseRegimeCurrentQuery } from "../../contract/v1/validation.js";
import { candlesNotFoundError, ContractValidationError, type ErrorDetail } from "../errors.js";
import type { GetCurrentRegimeUseCase } from "../../application/use-cases/getCurrentRegimeUseCase.js";
import { RegimeCandlesNotFoundError } from "../../application/errors/regimeErrors.js";

export const createRegimeCurrentHandler = (getCurrentRegime: GetCurrentRegimeUseCase) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = parseRegimeCurrentQuery(request.query);
      const response = await getCurrentRegime(query);
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof RegimeCandlesNotFoundError) {
        const httpError = candlesNotFoundError(error.message, error.details as ErrorDetail[]);
        return reply.code(httpError.statusCode).send(httpError.response);
      }
      request.log.error(error, "Unhandled error in GET /v1/regime/current");
      return reply.code(500).send({
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] }
      });
    }
  };
};
```

Notes:

- `candlesNotFoundError` expects `ErrorDetail[]` whose `code` is the union `ErrorDetailCode` (`src/http/errors.ts:21-31`). The application detail's `code` is a wider `string`. The `as ErrorDetail[]` cast at the boundary is the necessary minimum — runtime values (`"NO_SOURCE_CANDLES"`, `"NO_DERIVED_CANDLES_AFTER_AGGREGATION"`) are already members of `ErrorDetailCode`, so the cast preserves correctness.
- `ErrorDetail` is imported as a type-only import; the application module never imports it.
- The unexpected-error 500 envelope is unchanged from the previous implementation (`src/http/handlers/regimeCurrent.ts:101-104` before this edit).

- [ ] **Step 2: Confirm typecheck is green**

Run:

```bash
npm run typecheck
```

Expected: success. The old handler imported `CandleReadPort`, `MARKET_REGIME_CONFIG`, `buildRegimeCurrent`, `buildRegimeCandleReadPlan`, `aggregate15mTo1h` — those imports are removed.

- [ ] **Step 3: Confirm the existing regime-current e2e tests still pass**

The handler's call site in routes is updated in Task 9. Tests will still fail at the wiring level, so do **not** run `vitest` for `regimeCurrent.e2e.test.ts` until Task 9 lands. Run only:

```bash
npx vitest run src/contract/v1/__tests__/regimeCurrent.validation.test.ts
```

Expected: PASS — these tests are decoupled from the handler factory.

- [ ] **Step 4: Commit**

```bash
git add src/http/handlers/regimeCurrent.ts
git commit -m "m39: slim regime-current handler to use case"
```

---

### Task 8: Slim the plan handler

**Files:**

- Modify: `src/http/handlers/plan.ts`

- [ ] **Step 1: Replace the handler factory**

Open `src/http/handlers/plan.ts` and replace its **entire contents** with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { parsePlanRequest } from "../../contract/v1/validation.js";
import type { GeneratePlanUseCase } from "../../application/use-cases/generatePlanUseCase.js";
import { ContractValidationError } from "../errors.js";

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

      throw error;
    }
  };
};
```

Notes:

- The unexpected-error path still rethrows so Fastify's default error handler returns 500. Spec's `Behavior Parity` requires preserving "Existing unexpected-error behavior" exactly.
- `LedgerStore` and `writePlanLedgerEntry` imports are removed; the use case owns the write.

- [ ] **Step 2: Confirm typecheck is green**

Run:

```bash
npm run typecheck
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/http/handlers/plan.ts
git commit -m "m39: slim plan handler to use case"
```

---

### Task 9: Rewire routes

**Files:**

- Modify: `src/http/routes.ts`

- [ ] **Step 1: Add the new imports**

In `src/http/routes.ts`, add these imports near the existing application/adapters imports (after the line `import type { ClockPort } from "../application/ports/clock.js";`):

```ts
import { createGetCurrentRegimeUseCase } from "../application/use-cases/getCurrentRegimeUseCase.js";
import { createGeneratePlanUseCase } from "../application/use-cases/generatePlanUseCase.js";
import { createSqlitePlanLedgerWriteAdapter } from "../adapters/sqlite/sqlitePlanLedgerWriteAdapter.js";
```

- [ ] **Step 2: Construct the new use cases**

In `src/http/routes.ts`, after the existing `const ingestCandles = createIngestCandlesUseCase({ candleWritePort });` line, add:

```ts
const getCurrentRegime = createGetCurrentRegimeUseCase({
  candleReadPort,
  clock,
  engineVersion: process.env.npm_package_version ?? "0.0.0"
});

const planLedgerWritePort = createSqlitePlanLedgerWriteAdapter(ledger);
const generatePlan = createGeneratePlanUseCase({ planLedgerWritePort });
```

Notes:

- The default `"0.0.0"` matches the original handler's default at `src/http/handlers/regimeCurrent.ts:88` (pre-refactor) — not the `"0.1.0"` used by `/version`. This is intentional: it preserves the regime-current metadata default exactly.
- `planLedgerWritePort` always uses SQLite even when Postgres is present (per spec's `Adapters` section: "There is no Postgres plan-ledger adapter in #39").

- [ ] **Step 3: Update the two route registrations**

In `src/http/routes.ts`, change:

```ts
app.post("/v1/plan", createPlanHandler(ledger));
```

to:

```ts
app.post("/v1/plan", createPlanHandler(generatePlan));
```

And change:

```ts
app.get("/v1/regime/current", createRegimeCurrentHandler(candleReadPort));
```

to:

```ts
app.get("/v1/regime/current", createRegimeCurrentHandler(getCurrentRegime));
```

- [ ] **Step 4: Run the full test suite**

Run:

```bash
npm run test
```

Expected: PASS. Critical e2e tests that must stay green:

- `src/http/__tests__/regimeCurrent.e2e.test.ts` — proves direct 15m, derived 1h, and both empty-candle 404 envelopes are byte-identical.
- `src/http/__tests__/plan.e2e.test.ts` — proves plan response shape, `planHash`, and ledger row counts are unchanged.
- `src/http/__tests__/routes.contract.test.ts` — proves all routes are registered.

If a 404 test fails on detail shape, re-check Task 7 — the application detail's `code`/`path`/`message` field names must map identically into `ErrorDetail`.

- [ ] **Step 5: Commit**

```bash
git add src/http/routes.ts
git commit -m "m39: wire regime-current and plan use cases in routes"
```

---

### Task 10: Quality gate

- [ ] **Step 1: Run typecheck, lint, and boundaries**

Run:

```bash
npm run typecheck && npm run lint && npm run boundaries
```

Expected: all three succeed. Boundaries proves:

- `src/application/use-cases/getCurrentRegimeUseCase.ts` does not import `src/http/**`, `src/ledger/**`, `src/adapters/**`, framework npm, `node:process`, or `process`.
- `src/application/use-cases/generatePlanUseCase.ts` does not import `src/ledger/**` or `src/adapters/**`.
- `src/application/errors/regimeErrors.ts` does not import `src/http/**`.
- `src/application/ports/planLedgerPort.ts` imports only contract types.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
npm run test
```

Expected: PASS. Snapshot/hash tests (`canonicalHash.snapshot.test.ts`, `buildRegimeCurrent.snapshot.test.ts`, plan e2e hash assertions) confirm zero deterministic output change.

- [ ] **Step 3: Run the Postgres suite (best effort)**

Run:

```bash
npm run test:pg
```

Expected: PASS if `DATABASE_URL` is reachable; otherwise the suite fails to start. Record either outcome in the PR description. The Postgres regime-current path goes through the same `CandleReadPort`-backed use case — if `test:pg` is unavailable locally, CI must validate.

- [ ] **Step 4: Run the build**

Run:

```bash
npm run build
```

Expected: success. Build artifacts must include the new `src/application/**` and `src/adapters/sqlite/sqlitePlanLedgerWriteAdapter.ts` files.

- [ ] **Step 5: Final commit (only if anything changed)**

If the quality gate produced any incidental fixes (e.g., lint-fix of an import order), stage and commit them as a single fix-up:

```bash
git status
# If clean, skip this commit.
git add -p
git commit -m "m39: post-refactor lint and boundary fixups"
```

If the working tree is clean after the gate, skip the commit.

- [ ] **Step 6: Open the PR**

Open the PR with:

- Summary: "Extract `GetCurrentRegimeUseCase` and `GeneratePlanUseCase` behind `CandleReadPort` / `ClockPort` / `PlanLedgerWritePort`. HTTP handlers reduced to parse, dispatch, map known errors, send. Zero on-the-wire change."
- Validation block: copy/paste outputs of all six commands from the spec's `Required Validation` section, in this order: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:pg`, `npm run build`, `npm run boundaries`. If any command was not run, explicitly state why.
- Behavior parity note: "Snapshot, plan-hash, ledger-row, and 404-envelope tests pass unchanged."

---

## Behavior Parity Checklist

The refactor must preserve every item below. After Task 10, manually skim these test files and confirm none of their expectations changed:

- `src/http/__tests__/regimeCurrent.e2e.test.ts` — response shape, regime classification, freshness, derived 1h flow, both 404 envelopes.
- `src/http/__tests__/plan.e2e.test.ts` — plan response shape, `planHash`, ledger row counts, canonical request/plan JSON.
- `src/contract/v1/__tests__/canonicalHash.snapshot.test.ts` — canonical JSON / hash determinism.
- `src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts` — regime current snapshot.
- `src/contract/v1/__tests__/regimeCurrent.validation.test.ts` — query validation envelopes.
- `src/contract/v1/__tests__/validation.test.ts` — plan request validation envelopes.
- `src/ledger/__tests__/store.test.ts` and `src/ledger/__tests__/ledger.test.ts` — plan ledger row writes.

If any of these tests need updates beyond no-op import paths, **stop** — that signals a behavior change the spec forbids and the implementer must surface it before proceeding.
