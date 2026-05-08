# Execution Reporting And Composition Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract three application use cases (`RecordExecutionResultUseCase`, `RecordClmmExecutionResultUseCase`, `GetWeeklyReportUseCase`) and move runtime store/use-case wiring out of `src/http/routes.ts` into a new `src/composition/**` layer, while preserving HTTP responses, idempotency, ledger writes, weekly report output, health behavior, and env var semantics byte-for-byte.

**Architecture:** Each use case takes parsed contract input, returns the existing response shape, and throws typed application errors that handlers map to HTTP status/envelope. New ports `ExecutionResultLedgerWritePort`, `ClmmExecutionEventLedgerWritePort`, and `WeeklyReportReadPort` express application needs with storage-neutral outcomes. SQLite adapters wrap existing `writeExecutionResultLedgerEntry`, `writeClmmExecutionEvent`, and `generateWeeklyReport`, translating `LedgerWriteError` and `ReportRangeError` into typed application errors. `src/composition/buildStoreContext.ts` owns env-driven store selection plus a single `close()` method; `src/composition/buildApplication.ts` builds the clock, ports, adapters, and use cases; `src/composition/buildApp.ts` creates Fastify, wires everything, and installs `onClose` cleanup. `src/app.ts` becomes a thin re-export. `src/http/routes.ts` accepts a dependency object and registers routes only.

**Tech Stack:** Node 22, pnpm 10, TypeScript (NodeNext, strict), Fastify 5, `node:sqlite`, Drizzle ORM + `postgres` driver, Vitest. Boundary rules in `.dependency-cruiser.cjs` already prohibit `src/application/**` from importing `src/http/**`, `src/ledger/**`, `src/adapters/**`, framework npm packages, `node:process`, or `process`. `src/adapters/**` is forbidden from importing `src/composition/**` or runtime entry points. The new `src/composition/**` directory is unrestricted (it is the composition root).

---

## File Map

**Create — application errors (no I/O):**

- `src/application/errors/ledgerErrors.ts` — typed application errors for execution-result and CLMM execution-event outcomes that handlers must distinguish: `ExecutionResultPlanNotFoundError`, `ExecutionResultPlanHashMismatchError`, `ExecutionResultConflictError`, `ClmmExecutionEventConflictError`. Each carries a `message`. No `src/http/**` imports.
- `src/application/errors/reportErrors.ts` — `ReportRangeApplicationError` carrying `message`. No `src/http/**` imports.

**Create — application ports:**

- `src/application/ports/executionLedgerPort.ts` — `ExecutionResultLedgerWritePort` and `ClmmExecutionEventLedgerWritePort` interfaces, plus a discriminated `ExecutionLedgerOutcome` / `ClmmExecutionLedgerOutcome` union expressing storage-neutral outcomes (`{ kind: "inserted" }`, `{ kind: "idempotent" }`, `{ kind: "plan-not-found", message }`, `{ kind: "plan-hash-mismatch", message }`, `{ kind: "execution-result-conflict", message }`, `{ kind: "clmm-correlation-conflict", message }`).
- `src/application/ports/weeklyReportReadPort.ts` — `WeeklyReportReadPort` interface with `getWeeklyReport(input: { from: string; to: string }): Promise<WeeklyReportOutput>` re-exported from `src/report/weekly.ts`.

**Create — application use cases (orchestration, no I/O):**

- `src/application/use-cases/recordExecutionResultUseCase.ts` — `createRecordExecutionResultUseCase(deps)` factory returning `(body: ExecutionResultRequest) => Promise<ExecutionResultResponse>`. Depends on `ExecutionResultLedgerWritePort`. Throws typed errors for plan-not-found, plan-hash-mismatch, conflict.
- `src/application/use-cases/recordClmmExecutionResultUseCase.ts` — `createRecordClmmExecutionResultUseCase(deps)` factory returning `(body: ClmmExecutionEventRequest) => Promise<ClmmExecutionEventResponse>`. Depends on `ClmmExecutionEventLedgerWritePort`. Throws typed error for correlation conflict.
- `src/application/use-cases/getWeeklyReportUseCase.ts` — `createGetWeeklyReportUseCase(deps)` factory returning `(input: { from: string; to: string }) => Promise<WeeklyReportOutput>`. Depends on `WeeklyReportReadPort`. Lets `ReportRangeApplicationError` propagate.

**Create — application use case test fakes:**

- `src/application/use-cases/__tests__/fakes/fakeExecutionResultLedgerWritePort.ts` — captures calls; lets tests configure the next outcome.
- `src/application/use-cases/__tests__/fakes/fakeClmmExecutionEventLedgerWritePort.ts` — captures calls; lets tests configure the next outcome.
- `src/application/use-cases/__tests__/fakes/fakeWeeklyReportReadPort.ts` — captures calls; lets tests configure either a return value or a thrown `ReportRangeApplicationError`.

**Create — application use case tests:**

- `src/application/use-cases/__tests__/recordExecutionResultUseCase.test.ts` — happy path response, idempotent replay, plan-not-found error, plan-hash-mismatch error, execution-result-conflict error, ensures `body.planId` and `body.planHash` echo into response, ensures port called once with `{ executionResult: body }`.
- `src/application/use-cases/__tests__/recordClmmExecutionResultUseCase.test.ts` — happy path, idempotent replay, correlation-conflict error, ensures `body.correlationId` echoes into response, ensures port called once with `{ event: body }`.
- `src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts` — calls port once with `{ from, to }`, returns `{ markdown, summary }` unchanged, lets `ReportRangeApplicationError` propagate from the port unchanged.

**Create — adapters (SQLite):**

- `src/adapters/sqlite/sqliteExecutionLedgerAdapter.ts` — `createSqliteExecutionResultLedgerWriteAdapter(store)` and `createSqliteClmmExecutionEventLedgerWriteAdapter(store)`. Wrap `writeExecutionResultLedgerEntry` and `writeClmmExecutionEvent`. Translate `LedgerWriteError` codes (`PLAN_NOT_FOUND`, `PLAN_HASH_MISMATCH`, `EXECUTION_RESULT_CONFLICT`, `CLMM_EXECUTION_EVENT_CONFLICT`) to outcome unions. Re-throw any non-matching error.
- `src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts` — `createSqliteWeeklyReportReadAdapter(store)` returning a `WeeklyReportReadPort` whose `getWeeklyReport` calls `generateWeeklyReport` and rethrows `ReportRangeError` as `ReportRangeApplicationError` preserving `message`.

**Create — composition:**

- `src/composition/buildStoreContext.ts` — `buildStoreContext()` reads env (`LEDGER_DB_PATH`, `DATABASE_URL`, `NODE_ENV`), constructs SQLite-only or SQLite+Postgres `StoreContext`, returns `{ ledger, pg, insightsStore, srThesesV2Store, close: () => Promise<void> }`. The `close()` method pairs with construction: closes Postgres + SQLite once, in the right order.
- `src/composition/buildApplication.ts` — `buildApplication(ctx)` returns the clock, all ports/adapters, and all use cases (existing #38/#39 plus new #40), plus the SQLite ledger reference passed through to S/R, insights, and openapi/version mechanics that still need it.
- `src/composition/buildApp.ts` — `buildApp()` creates Fastify (logger gate unchanged), calls `buildStoreContext()`, calls `buildApplication(ctx)`, registers routes via `registerRoutes(app, deps)`, and installs `app.addHook("onClose", () => ctx.close())`.

**Create — composition tests:**

- `src/composition/__tests__/buildApp.e2e.test.ts` — verifies `/health`, `/version`, `/v1/openapi.json` still serve; verifies SQLite-only fallback works with `LEDGER_DB_PATH=:memory:`; verifies that calling `app.close()` closes the runtime context (asserted by an injected fake or by ensuring no unclosed handles error).

**Modify — handlers (slim down):**

- `src/http/handlers/executionResult.ts` — change factory signature from `(store: LedgerStore)` to `(useCase: RecordExecutionResultUseCase)`. Map typed application errors (`ExecutionResultPlanNotFoundError` → 404, `ExecutionResultPlanHashMismatchError` → 409, `ExecutionResultConflictError` → 409). Keep `ContractValidationError` mapping. Preserve response body shape exactly.
- `src/http/handlers/clmmExecutionResult.ts` — change factory signature from `(store: LedgerStore)` to `(useCase: RecordClmmExecutionResultUseCase)`. Auth (`requireSharedSecret`) stays in handler. Map `ClmmExecutionEventConflictError` → 409 with envelope `{ code: "CLMM_EXECUTION_EVENT_CONFLICT", ... }`. Any other thrown error must keep returning 500 with current LedgerWriteError-style envelope when relevant. Preserve response body shape exactly.
- `src/http/handlers/report.ts` — change factory signature from `(store: LedgerStore)` to `(useCase: GetWeeklyReportUseCase)`. Continue to validate that `from` and `to` are present and return existing 400 envelope if not. Map `ReportRangeApplicationError` → 400 with `INVALID_REPORT_RANGE` envelope. Let other errors throw (Fastify yields 500, preserving the malformed-row behavior).

**Modify — composition wiring:**

- `src/http/routes.ts` — convert exported `registerRoutes(app)` to `registerRoutes(app, deps)` where `deps` is the dependency bag built by `buildApplication`. Remove env reads, store construction, store context selection, clock construction, port construction, use case construction, and the `onClose` hook. Keep `/health`, `/version`, `/v1/openapi.json` registration but drive `version` from `deps.version` (an object passed from composition that snapshots `process.env.npm_package_version` and `process.env.COMMIT_SHA`). Health handler reads `deps.healthCheck` (a function returning `{ ok, postgres, sqlite }`).
- `src/app.ts` — re-export `buildApp` from `src/composition/buildApp.ts`. Existing test imports keep working.

**Modify — health probe test (signature change):**

- `src/http/__tests__/health.probe.test.ts` — `registerRoutes` now requires `deps`. Update the test to use `buildApp()` directly (it already covers `/health` happy path) or build dependencies inline.

**No changes:**

- `src/server.ts` — startup, Postgres verification, SIGTERM/SIGINT handling, shutdown timeout, redacted logging, and process-exit semantics are deployment-sensitive (per spec "Postgres verification may remain in `server.ts`"). Keep them in `server.ts`.
- `src/contract/v1/types.ts`, `src/contract/v1/validation.ts` — contract preserved.
- `src/ledger/writer.ts`, `src/ledger/store.ts`, `src/ledger/storeContext.ts` — keep underlying functions; new SQLite adapters wrap them. `closeStoreContext` is reused inside `buildStoreContext`.
- `src/report/weekly.ts` — `generateWeeklyReport` unchanged; the new SQLite report adapter wraps it.
- `src/http/openapi.ts`, `src/http/auth.ts`, `src/http/errors.ts` — unchanged.
- `.dependency-cruiser.cjs` — `src/composition/**` is intentionally unconstrained as the composition root; no rule changes needed.

---

## Pre-flight

- [ ] **Step 0: Confirm clean working tree on a fresh branch from `main`**

Run:

```bash
git status
git log -1 --oneline
git checkout -b m40-execution-reporting-composition-root
```

Expected: working tree clean (or only this plan file unstaged), HEAD on `5bf18c2 m40: design execution reporting composition root`. The design commit on `main` is what this plan implements.

- [ ] **Step 1: Confirm baseline is green**

Run:

```bash
npm run typecheck && npm run lint && npm run test && npm run build && npm run boundaries
```

Expected: all five succeed. If any fail, stop and surface the failure — every refactor task below assumes a green baseline so a new red is unambiguously caused by #40.

- [ ] **Step 2: Confirm baseline `test:pg` status**

Run:

```bash
npm run test:pg || echo "PG suite is unavailable in this environment"
```

Expected: either the PG suite runs and is green, or it fails because `DATABASE_URL` is unreachable. **Record which** in the PR description. If `test:pg` cannot run locally, the implementer must note that the Postgres path remains unvalidated locally and rely on CI for proof.

---

## Task Sequencing

The new application errors and ports are independent leaves and can land in any order before adapters and use cases. Adapters and use cases depend on errors and ports. Composition depends on adapters, ports, and use cases. Handlers depend on the use cases. Routes depends on composition + handlers. Land tasks in the order below; do not jump ahead.

1. Add `ledgerErrors.ts` (application errors).
2. Add `reportErrors.ts` (application errors).
3. Add `executionLedgerPort.ts` (ports + outcome types).
4. Add `weeklyReportReadPort.ts` (port).
5. Add use-case test fakes.
6. Add `RecordExecutionResultUseCase` (TDD).
7. Add `RecordClmmExecutionResultUseCase` (TDD).
8. Add `GetWeeklyReportUseCase` (TDD).
9. Add `sqliteExecutionLedgerAdapter.ts` (adapter).
10. Add `sqliteWeeklyReportReadAdapter.ts` (adapter).
11. Slim the execution-result handler.
12. Slim the CLMM execution-result handler.
13. Slim the weekly-report handler.
14. Add `buildStoreContext.ts`.
15. Add `buildApplication.ts`.
16. Add `buildApp.ts` and update `src/app.ts`.
17. Convert `src/http/routes.ts` to dependency-injected route registration.
18. Update `health.probe.test.ts` for the new `registerRoutes` signature.
19. Add composition e2e test.
20. Run the quality gate.

---

### Task 1: Add `ledgerErrors.ts`

**Files:**

- Create: `src/application/errors/ledgerErrors.ts`

- [ ] **Step 1: Write the file**

Create `src/application/errors/ledgerErrors.ts` with the following exact contents:

```ts
export class ExecutionResultPlanNotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionResultPlanNotFoundError";
  }
}

export class ExecutionResultPlanHashMismatchError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionResultPlanHashMismatchError";
  }
}

export class ExecutionResultConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionResultConflictError";
  }
}

export class ClmmExecutionEventConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ClmmExecutionEventConflictError";
  }
}
```

Notes:

- These errors carry only `message` — handlers map them to HTTP status codes and envelope codes. No `details` array is needed; the existing handler responses use `details: []`.
- Do not import from `src/http/**` or `src/ledger/**`.

- [ ] **Step 2: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed. If `boundaries` fails, the new file violated `application-no-outer-layers` — fix imports.

- [ ] **Step 3: Commit**

```bash
git add src/application/errors/ledgerErrors.ts
git commit -m "m40: add execution-ledger application errors"
```

---

### Task 2: Add `reportErrors.ts`

**Files:**

- Create: `src/application/errors/reportErrors.ts`

- [ ] **Step 1: Write the file**

Create `src/application/errors/reportErrors.ts` with the following exact contents:

```ts
export class ReportRangeApplicationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReportRangeApplicationError";
  }
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
git add src/application/errors/reportErrors.ts
git commit -m "m40: add report-range application error"
```

---

### Task 3: Add `executionLedgerPort.ts`

**Files:**

- Create: `src/application/ports/executionLedgerPort.ts`

- [ ] **Step 1: Write the file**

Create `src/application/ports/executionLedgerPort.ts` with the following exact contents:

```ts
import type { ClmmExecutionEventRequest, ExecutionResultRequest } from "../../contract/v1/types.js";

export type ExecutionResultLedgerOutcome =
  | { kind: "inserted" }
  | { kind: "idempotent" }
  | { kind: "plan-not-found"; message: string }
  | { kind: "plan-hash-mismatch"; message: string }
  | { kind: "execution-result-conflict"; message: string };

export interface ExecutionResultLedgerWritePort {
  recordExecutionResult(input: {
    executionResult: ExecutionResultRequest;
  }): Promise<ExecutionResultLedgerOutcome>;
}

export type ClmmExecutionEventLedgerOutcome =
  | { kind: "inserted" }
  | { kind: "idempotent" }
  | { kind: "clmm-correlation-conflict"; message: string };

export interface ClmmExecutionEventLedgerWritePort {
  recordClmmExecutionEvent(input: {
    event: ClmmExecutionEventRequest;
  }): Promise<ClmmExecutionEventLedgerOutcome>;
}
```

Notes:

- The discriminated union expresses storage-neutral outcomes per the spec. Application use cases decide which outcomes are meaningful conflicts/not-found versus unexpected failures.
- Adapters translate `LedgerWriteError` codes into these `kind`s; unknown errors propagate.
- Imports only contract types — no `src/http/**`, `src/ledger/**`, or `src/adapters/**`.

- [ ] **Step 2: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/application/ports/executionLedgerPort.ts
git commit -m "m40: add execution ledger ports"
```

---

### Task 4: Add `weeklyReportReadPort.ts`

**Files:**

- Create: `src/application/ports/weeklyReportReadPort.ts`

- [ ] **Step 1: Write the file**

Create `src/application/ports/weeklyReportReadPort.ts` with the following exact contents:

```ts
import type { WeeklyReportOutput } from "../../report/weekly.js";

export type { WeeklyReportOutput };

export interface WeeklyReportReadPort {
  getWeeklyReport(input: { from: string; to: string }): Promise<WeeklyReportOutput>;
}
```

Notes:

- `src/application/**` is allowed to import `src/report/weekly.ts` only for types (`WeeklyReportOutput` is a pure type alias plus its summary interface). Confirm `boundaries` accepts this; if it fails, define a structurally compatible local `WeeklyReportOutput` interface here and have the adapter map between them.

- [ ] **Step 2: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed. If `boundaries` reports a violation on the `src/report/weekly.js` import, replace the import with a locally-defined `WeeklyReportOutput`/`WeeklyReportSummary` interface mirroring the shape in `src/report/weekly.ts:42-45` and `src/report/weekly.ts:1-40`.

- [ ] **Step 3: Commit**

```bash
git add src/application/ports/weeklyReportReadPort.ts
git commit -m "m40: add weekly report read port"
```

---

### Task 5: Add use-case test fakes

**Files:**

- Create: `src/application/use-cases/__tests__/fakes/fakeExecutionResultLedgerWritePort.ts`
- Create: `src/application/use-cases/__tests__/fakes/fakeClmmExecutionEventLedgerWritePort.ts`
- Create: `src/application/use-cases/__tests__/fakes/fakeWeeklyReportReadPort.ts`

- [ ] **Step 1: Write the execution-result fake**

Create `src/application/use-cases/__tests__/fakes/fakeExecutionResultLedgerWritePort.ts`:

```ts
import type {
  ExecutionResultLedgerOutcome,
  ExecutionResultLedgerWritePort
} from "../../../ports/executionLedgerPort.js";
import type { ExecutionResultRequest } from "../../../../contract/v1/types.js";

export class FakeExecutionResultLedgerWritePort implements ExecutionResultLedgerWritePort {
  public calls: Array<{ executionResult: ExecutionResultRequest }> = [];
  private nextOutcome: ExecutionResultLedgerOutcome = { kind: "inserted" };

  public setNextOutcome(outcome: ExecutionResultLedgerOutcome): void {
    this.nextOutcome = outcome;
  }

  async recordExecutionResult(input: {
    executionResult: ExecutionResultRequest;
  }): Promise<ExecutionResultLedgerOutcome> {
    this.calls.push({ executionResult: input.executionResult });
    return this.nextOutcome;
  }
}
```

- [ ] **Step 2: Write the CLMM fake**

Create `src/application/use-cases/__tests__/fakes/fakeClmmExecutionEventLedgerWritePort.ts`:

```ts
import type {
  ClmmExecutionEventLedgerOutcome,
  ClmmExecutionEventLedgerWritePort
} from "../../../ports/executionLedgerPort.js";
import type { ClmmExecutionEventRequest } from "../../../../contract/v1/types.js";

export class FakeClmmExecutionEventLedgerWritePort implements ClmmExecutionEventLedgerWritePort {
  public calls: Array<{ event: ClmmExecutionEventRequest }> = [];
  private nextOutcome: ClmmExecutionEventLedgerOutcome = { kind: "inserted" };

  public setNextOutcome(outcome: ClmmExecutionEventLedgerOutcome): void {
    this.nextOutcome = outcome;
  }

  async recordClmmExecutionEvent(input: {
    event: ClmmExecutionEventRequest;
  }): Promise<ClmmExecutionEventLedgerOutcome> {
    this.calls.push({ event: input.event });
    return this.nextOutcome;
  }
}
```

- [ ] **Step 3: Write the weekly-report fake**

Create `src/application/use-cases/__tests__/fakes/fakeWeeklyReportReadPort.ts`:

```ts
import type {
  WeeklyReportOutput,
  WeeklyReportReadPort
} from "../../../ports/weeklyReportReadPort.js";

export class FakeWeeklyReportReadPort implements WeeklyReportReadPort {
  public calls: Array<{ from: string; to: string }> = [];
  private nextResult: WeeklyReportOutput | null = null;
  private nextError: Error | null = null;

  public setNextResult(output: WeeklyReportOutput): void {
    this.nextResult = output;
    this.nextError = null;
  }

  public setNextError(error: Error): void {
    this.nextError = error;
    this.nextResult = null;
  }

  async getWeeklyReport(input: { from: string; to: string }): Promise<WeeklyReportOutput> {
    this.calls.push({ from: input.from, to: input.to });
    if (this.nextError) {
      throw this.nextError;
    }
    if (this.nextResult) {
      return this.nextResult;
    }
    throw new Error("FakeWeeklyReportReadPort: no result configured");
  }
}
```

- [ ] **Step 4: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/__tests__/fakes/
git commit -m "m40: add use-case test fakes for execution and report ports"
```

---

### Task 6: Add `RecordExecutionResultUseCase` (TDD)

**Files:**

- Test: `src/application/use-cases/__tests__/recordExecutionResultUseCase.test.ts`
- Create: `src/application/use-cases/recordExecutionResultUseCase.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/application/use-cases/__tests__/recordExecutionResultUseCase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRecordExecutionResultUseCase } from "../recordExecutionResultUseCase.js";
import { FakeExecutionResultLedgerWritePort } from "./fakes/fakeExecutionResultLedgerWritePort.js";
import {
  ExecutionResultConflictError,
  ExecutionResultPlanHashMismatchError,
  ExecutionResultPlanNotFoundError
} from "../../errors/ledgerErrors.js";
import type { ExecutionResultRequest } from "../../../contract/v1/types.js";

const baseBody = (): ExecutionResultRequest => ({
  schemaVersion: "1.0",
  planId: "plan-1",
  planHash: "hash-1",
  asOfUnixMs: 1_762_591_300_000,
  actionResults: [{ actionType: "REQUEST_REBALANCE", status: "SUCCESS" }],
  costs: { txFeesUsd: 0.05, priorityFeesUsd: 0.02, slippageUsd: 0.15 },
  portfolioAfter: { navUsd: 10_120, solUnits: 20.5, usdcUnits: 5_920 }
});

describe("RecordExecutionResultUseCase", () => {
  it("returns success body on inserted outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({ kind: "inserted" });
    const useCase = createRecordExecutionResultUseCase({ port });

    const body = baseBody();
    const response = await useCase(body);

    expect(response).toEqual({
      schemaVersion: "1.0",
      ok: true,
      linkedPlanId: "plan-1",
      linkedPlanHash: "hash-1"
    });
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0].executionResult).toBe(body);
  });

  it("returns idempotent: true on idempotent replay outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({ kind: "idempotent" });
    const useCase = createRecordExecutionResultUseCase({ port });

    const response = await useCase(baseBody());

    expect(response).toEqual({
      schemaVersion: "1.0",
      ok: true,
      linkedPlanId: "plan-1",
      linkedPlanHash: "hash-1",
      idempotent: true
    });
  });

  it("throws ExecutionResultPlanNotFoundError on plan-not-found outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({ kind: "plan-not-found", message: 'No plan found for planId "plan-1".' });
    const useCase = createRecordExecutionResultUseCase({ port });

    await expect(useCase(baseBody())).rejects.toThrow(ExecutionResultPlanNotFoundError);
    await expect(useCase(baseBody())).rejects.toThrow('No plan found for planId "plan-1".');
  });

  it("throws ExecutionResultPlanHashMismatchError on plan-hash-mismatch outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({
      kind: "plan-hash-mismatch",
      message: 'planHash mismatch for planId "plan-1".'
    });
    const useCase = createRecordExecutionResultUseCase({ port });

    await expect(useCase(baseBody())).rejects.toThrow(ExecutionResultPlanHashMismatchError);
    await expect(useCase(baseBody())).rejects.toThrow('planHash mismatch for planId "plan-1".');
  });

  it("throws ExecutionResultConflictError on execution-result-conflict outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({
      kind: "execution-result-conflict",
      message: 'Execution result conflict for planId "plan-1".'
    });
    const useCase = createRecordExecutionResultUseCase({ port });

    await expect(useCase(baseBody())).rejects.toThrow(ExecutionResultConflictError);
    await expect(useCase(baseBody())).rejects.toThrow(
      'Execution result conflict for planId "plan-1".'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/application/use-cases/__tests__/recordExecutionResultUseCase.test.ts`

Expected: FAIL because `recordExecutionResultUseCase.ts` does not exist yet.

- [ ] **Step 3: Write the use case**

Create `src/application/use-cases/recordExecutionResultUseCase.ts`:

```ts
import type { ExecutionResultRequest, ExecutionResultResponse } from "../../contract/v1/types.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import type { ExecutionResultLedgerWritePort } from "../ports/executionLedgerPort.js";
import {
  ExecutionResultConflictError,
  ExecutionResultPlanHashMismatchError,
  ExecutionResultPlanNotFoundError
} from "../errors/ledgerErrors.js";

export type RecordExecutionResultUseCase = (
  body: ExecutionResultRequest
) => Promise<ExecutionResultResponse>;

export interface RecordExecutionResultUseCaseDeps {
  port: ExecutionResultLedgerWritePort;
}

export const createRecordExecutionResultUseCase = (
  deps: RecordExecutionResultUseCaseDeps
): RecordExecutionResultUseCase => {
  return async (body) => {
    const outcome = await deps.port.recordExecutionResult({ executionResult: body });

    switch (outcome.kind) {
      case "inserted":
        return {
          schemaVersion: SCHEMA_VERSION,
          ok: true,
          linkedPlanId: body.planId,
          linkedPlanHash: body.planHash
        };
      case "idempotent":
        return {
          schemaVersion: SCHEMA_VERSION,
          ok: true,
          linkedPlanId: body.planId,
          linkedPlanHash: body.planHash,
          idempotent: true
        };
      case "plan-not-found":
        throw new ExecutionResultPlanNotFoundError(outcome.message);
      case "plan-hash-mismatch":
        throw new ExecutionResultPlanHashMismatchError(outcome.message);
      case "execution-result-conflict":
        throw new ExecutionResultConflictError(outcome.message);
    }
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/application/use-cases/__tests__/recordExecutionResultUseCase.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/recordExecutionResultUseCase.ts \
        src/application/use-cases/__tests__/recordExecutionResultUseCase.test.ts
git commit -m "m40: add RecordExecutionResultUseCase"
```

---

### Task 7: Add `RecordClmmExecutionResultUseCase` (TDD)

**Files:**

- Test: `src/application/use-cases/__tests__/recordClmmExecutionResultUseCase.test.ts`
- Create: `src/application/use-cases/recordClmmExecutionResultUseCase.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/application/use-cases/__tests__/recordClmmExecutionResultUseCase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRecordClmmExecutionResultUseCase } from "../recordClmmExecutionResultUseCase.js";
import { FakeClmmExecutionEventLedgerWritePort } from "./fakes/fakeClmmExecutionEventLedgerWritePort.js";
import { ClmmExecutionEventConflictError } from "../../errors/ledgerErrors.js";
import type { ClmmExecutionEventRequest } from "../../../contract/v1/types.js";

const baseBody = (): ClmmExecutionEventRequest => ({
  schemaVersion: "1.0",
  correlationId: "corr-001",
  positionId: "pos-001",
  breachDirection: "LowerBoundBreach",
  reconciledAtIso: "2025-04-17T12:00:00Z",
  txSignature: "sig-abc123",
  tokenOut: "USDC",
  status: "confirmed"
});

describe("RecordClmmExecutionResultUseCase", () => {
  it("returns success body on inserted outcome", async () => {
    const port = new FakeClmmExecutionEventLedgerWritePort();
    port.setNextOutcome({ kind: "inserted" });
    const useCase = createRecordClmmExecutionResultUseCase({ port });

    const body = baseBody();
    const response = await useCase(body);

    expect(response).toEqual({
      schemaVersion: "1.0",
      ok: true,
      correlationId: "corr-001"
    });
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0].event).toBe(body);
  });

  it("returns idempotent: true on idempotent outcome", async () => {
    const port = new FakeClmmExecutionEventLedgerWritePort();
    port.setNextOutcome({ kind: "idempotent" });
    const useCase = createRecordClmmExecutionResultUseCase({ port });

    const response = await useCase(baseBody());

    expect(response).toEqual({
      schemaVersion: "1.0",
      ok: true,
      correlationId: "corr-001",
      idempotent: true
    });
  });

  it("throws ClmmExecutionEventConflictError on correlation conflict", async () => {
    const port = new FakeClmmExecutionEventLedgerWritePort();
    port.setNextOutcome({
      kind: "clmm-correlation-conflict",
      message: 'CLMM execution event conflict for correlationId "corr-001".'
    });
    const useCase = createRecordClmmExecutionResultUseCase({ port });

    await expect(useCase(baseBody())).rejects.toThrow(ClmmExecutionEventConflictError);
    await expect(useCase(baseBody())).rejects.toThrow(
      'CLMM execution event conflict for correlationId "corr-001".'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/application/use-cases/__tests__/recordClmmExecutionResultUseCase.test.ts`

Expected: FAIL because `recordClmmExecutionResultUseCase.ts` does not exist.

- [ ] **Step 3: Write the use case**

Create `src/application/use-cases/recordClmmExecutionResultUseCase.ts`:

```ts
import type {
  ClmmExecutionEventRequest,
  ClmmExecutionEventResponse
} from "../../contract/v1/types.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import type { ClmmExecutionEventLedgerWritePort } from "../ports/executionLedgerPort.js";
import { ClmmExecutionEventConflictError } from "../errors/ledgerErrors.js";

export type RecordClmmExecutionResultUseCase = (
  body: ClmmExecutionEventRequest
) => Promise<ClmmExecutionEventResponse>;

export interface RecordClmmExecutionResultUseCaseDeps {
  port: ClmmExecutionEventLedgerWritePort;
}

export const createRecordClmmExecutionResultUseCase = (
  deps: RecordClmmExecutionResultUseCaseDeps
): RecordClmmExecutionResultUseCase => {
  return async (body) => {
    const outcome = await deps.port.recordClmmExecutionEvent({ event: body });

    switch (outcome.kind) {
      case "inserted":
        return {
          schemaVersion: SCHEMA_VERSION,
          ok: true,
          correlationId: body.correlationId
        };
      case "idempotent":
        return {
          schemaVersion: SCHEMA_VERSION,
          ok: true,
          correlationId: body.correlationId,
          idempotent: true
        };
      case "clmm-correlation-conflict":
        throw new ClmmExecutionEventConflictError(outcome.message);
    }
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/application/use-cases/__tests__/recordClmmExecutionResultUseCase.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/recordClmmExecutionResultUseCase.ts \
        src/application/use-cases/__tests__/recordClmmExecutionResultUseCase.test.ts
git commit -m "m40: add RecordClmmExecutionResultUseCase"
```

---

### Task 8: Add `GetWeeklyReportUseCase` (TDD)

**Files:**

- Test: `src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts`
- Create: `src/application/use-cases/getWeeklyReportUseCase.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createGetWeeklyReportUseCase } from "../getWeeklyReportUseCase.js";
import { FakeWeeklyReportReadPort } from "./fakes/fakeWeeklyReportReadPort.js";
import { ReportRangeApplicationError } from "../../errors/reportErrors.js";
import type { WeeklyReportOutput } from "../../ports/weeklyReportReadPort.js";

const sampleSummary: WeeklyReportOutput["summary"] = {
  window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs: 0, toUnixMs: 0 },
  totals: { plans: 0, executionResults: 0 },
  regimeDistribution: {
    UP: { count: 0, pct: 0 },
    DOWN: { count: 0, pct: 0 },
    CHOP: { count: 0, pct: 0 }
  },
  churn: { standDownPlans: 0, holdPlans: 0, standDownPct: 0 },
  execution: {
    totalActions: 0,
    successActions: 0,
    failedActions: 0,
    skippedActions: 0,
    successRate: 0,
    totalTxFeesUsd: 0,
    totalPriorityFeesUsd: 0,
    totalSlippageUsd: 0
  },
  baselines: {
    solHodlFinalNavUsd: 0,
    solDcaFinalNavUsd: 0,
    usdcCarryFinalNavUsd: 0
  }
};

describe("GetWeeklyReportUseCase", () => {
  it("calls port once with from/to and returns its output unchanged", async () => {
    const port = new FakeWeeklyReportReadPort();
    const expected: WeeklyReportOutput = {
      markdown: "# Weekly Report\n",
      summary: sampleSummary
    };
    port.setNextResult(expected);
    const useCase = createGetWeeklyReportUseCase({ port });

    const result = await useCase({ from: "2026-01-01", to: "2026-01-07" });

    expect(result).toBe(expected);
    expect(port.calls).toEqual([{ from: "2026-01-01", to: "2026-01-07" }]);
  });

  it("propagates ReportRangeApplicationError thrown by the port", async () => {
    const port = new FakeWeeklyReportReadPort();
    port.setNextError(new ReportRangeApplicationError("Invalid weekly report date range."));
    const useCase = createGetWeeklyReportUseCase({ port });

    await expect(useCase({ from: "2026-02-30", to: "2026-03-01" })).rejects.toThrow(
      ReportRangeApplicationError
    );
    await expect(useCase({ from: "2026-02-30", to: "2026-03-01" })).rejects.toThrow(
      "Invalid weekly report date range."
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts`

Expected: FAIL because `getWeeklyReportUseCase.ts` does not exist.

- [ ] **Step 3: Write the use case**

Create `src/application/use-cases/getWeeklyReportUseCase.ts`:

```ts
import type { WeeklyReportOutput, WeeklyReportReadPort } from "../ports/weeklyReportReadPort.js";

export type GetWeeklyReportUseCase = (input: {
  from: string;
  to: string;
}) => Promise<WeeklyReportOutput>;

export interface GetWeeklyReportUseCaseDeps {
  port: WeeklyReportReadPort;
}

export const createGetWeeklyReportUseCase = (
  deps: GetWeeklyReportUseCaseDeps
): GetWeeklyReportUseCase => {
  return async (input) => {
    return deps.port.getWeeklyReport(input);
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/use-cases/getWeeklyReportUseCase.ts \
        src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts
git commit -m "m40: add GetWeeklyReportUseCase"
```

---

### Task 9: Add `sqliteExecutionLedgerAdapter.ts`

**Files:**

- Create: `src/adapters/sqlite/sqliteExecutionLedgerAdapter.ts`

- [ ] **Step 1: Write the adapter**

Create `src/adapters/sqlite/sqliteExecutionLedgerAdapter.ts`:

```ts
import type { LedgerStore } from "../../ledger/store.js";
import {
  LEDGER_ERROR_CODES,
  LedgerWriteError,
  writeClmmExecutionEvent,
  writeExecutionResultLedgerEntry
} from "../../ledger/writer.js";
import type {
  ClmmExecutionEventLedgerOutcome,
  ClmmExecutionEventLedgerWritePort,
  ExecutionResultLedgerOutcome,
  ExecutionResultLedgerWritePort
} from "../../application/ports/executionLedgerPort.js";

export const createSqliteExecutionResultLedgerWriteAdapter = (
  store: LedgerStore
): ExecutionResultLedgerWritePort => ({
  async recordExecutionResult(input): Promise<ExecutionResultLedgerOutcome> {
    try {
      const result = writeExecutionResultLedgerEntry(store, {
        executionResult: input.executionResult
      });
      return result.idempotent ? { kind: "idempotent" } : { kind: "inserted" };
    } catch (error) {
      if (error instanceof LedgerWriteError) {
        if (error.code === LEDGER_ERROR_CODES.PLAN_NOT_FOUND) {
          return { kind: "plan-not-found", message: error.message };
        }
        if (error.code === LEDGER_ERROR_CODES.PLAN_HASH_MISMATCH) {
          return { kind: "plan-hash-mismatch", message: error.message };
        }
        if (error.code === LEDGER_ERROR_CODES.EXECUTION_RESULT_CONFLICT) {
          return { kind: "execution-result-conflict", message: error.message };
        }
      }
      throw error;
    }
  }
});

export const createSqliteClmmExecutionEventLedgerWriteAdapter = (
  store: LedgerStore
): ClmmExecutionEventLedgerWritePort => ({
  async recordClmmExecutionEvent(input): Promise<ClmmExecutionEventLedgerOutcome> {
    try {
      const result = writeClmmExecutionEvent(store, { event: input.event });
      return result.idempotent ? { kind: "idempotent" } : { kind: "inserted" };
    } catch (error) {
      if (
        error instanceof LedgerWriteError &&
        error.code === LEDGER_ERROR_CODES.CLMM_EXECUTION_EVENT_CONFLICT
      ) {
        return { kind: "clmm-correlation-conflict", message: error.message };
      }
      throw error;
    }
  }
});
```

Notes:

- Adapter must not pass `receivedAtUnixMs`; we keep the `Date.now()` default in `writeExecutionResultLedgerEntry` (`src/ledger/writer.ts:86`) and `writeClmmExecutionEvent` (`src/ledger/writer.ts:165`). Behavior parity requires this exactly.
- Unknown errors propagate so unexpected ledger write failures still produce 500s in the CLMM handler path.

- [ ] **Step 2: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/sqlite/sqliteExecutionLedgerAdapter.ts
git commit -m "m40: add SQLite execution-ledger adapters"
```

---

### Task 10: Add `sqliteWeeklyReportReadAdapter.ts`

**Files:**

- Create: `src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts`

- [ ] **Step 1: Write the adapter**

Create `src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts`:

```ts
import type { LedgerStore } from "../../ledger/store.js";
import { generateWeeklyReport, ReportRangeError } from "../../report/weekly.js";
import type { WeeklyReportReadPort } from "../../application/ports/weeklyReportReadPort.js";
import { ReportRangeApplicationError } from "../../application/errors/reportErrors.js";

export const createSqliteWeeklyReportReadAdapter = (store: LedgerStore): WeeklyReportReadPort => ({
  async getWeeklyReport(input) {
    try {
      return generateWeeklyReport({ store, from: input.from, to: input.to });
    } catch (error) {
      if (error instanceof ReportRangeError) {
        throw new ReportRangeApplicationError(error.message);
      }
      throw error;
    }
  }
});
```

Notes:

- Synchronous `generateWeeklyReport` is wrapped with `async` so the port returns a `Promise`.
- Other thrown errors (e.g., malformed-row JSON parse) propagate so the existing 500 behavior is preserved at the handler boundary.

- [ ] **Step 2: Confirm typecheck and boundaries are green**

Run:

```bash
npm run typecheck && npm run boundaries
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts
git commit -m "m40: add SQLite weekly-report read adapter"
```

---

### Task 11: Slim the execution-result handler

**Files:**

- Modify: `src/http/handlers/executionResult.ts`

- [ ] **Step 1: Replace handler contents**

Overwrite `src/http/handlers/executionResult.ts` with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { parseExecutionResultRequest } from "../../contract/v1/validation.js";
import type { RecordExecutionResultUseCase } from "../../application/use-cases/recordExecutionResultUseCase.js";
import {
  ExecutionResultConflictError,
  ExecutionResultPlanHashMismatchError,
  ExecutionResultPlanNotFoundError
} from "../../application/errors/ledgerErrors.js";
import { ContractValidationError } from "../errors.js";

export const createExecutionResultHandler = (useCase: RecordExecutionResultUseCase) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = parseExecutionResultRequest(request.body);
      const response = await useCase(body);
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof ExecutionResultPlanNotFoundError) {
        return reply.code(404).send({
          schemaVersion: SCHEMA_VERSION,
          error: { code: "PLAN_NOT_FOUND", message: error.message, details: [] }
        });
      }

      if (error instanceof ExecutionResultPlanHashMismatchError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: { code: "PLAN_HASH_MISMATCH", message: error.message, details: [] }
        });
      }

      if (error instanceof ExecutionResultConflictError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: { code: "EXECUTION_RESULT_CONFLICT", message: error.message, details: [] }
        });
      }

      throw error;
    }
  };
};
```

Notes:

- Status code mapping: `PLAN_NOT_FOUND` → 404, `PLAN_HASH_MISMATCH` → 409, `EXECUTION_RESULT_CONFLICT` → 409 (matches `src/http/handlers/executionResult.ts:35-44` pre-refactor behavior).
- Error envelope: identical to the existing one — `details: []`.

- [ ] **Step 2: Confirm typecheck is green**

Run:

```bash
npm run typecheck
```

Expected: TYPE ERROR — `src/http/routes.ts` still calls `createExecutionResultHandler(ledger)`. Leave this for Task 17 to fix; do not push the change yet.

- [ ] **Step 3: Hold the commit**

Do NOT commit yet. The handler change is intentionally inconsistent with the routes call site. Tasks 12 and 13 do the same. Task 17 fixes the call sites and tests pass again. To keep commits atomic, the handler+routes change is bundled at Task 17. Stash this change locally if you want to keep the working tree clean:

```bash
git stash push -m "m40: handler slim down (executionResult)" src/http/handlers/executionResult.ts
```

Or leave it dirty and proceed; the next handler tasks layer on top.

> **Note for executing-plans:** If you prefer atomic commits per file, switch to: keep `routes.ts` building both the new use case AND passing `ledger` (overload the handler to accept either) — then drop the overload in Task 17. The single-overload approach is cleaner; this plan keeps it simple by accepting one broken intermediate state across Tasks 11–13 that Task 17 resolves.

---

### Task 12: Slim the CLMM execution-result handler

**Files:**

- Modify: `src/http/handlers/clmmExecutionResult.ts`

- [ ] **Step 1: Replace handler contents**

Overwrite `src/http/handlers/clmmExecutionResult.ts` with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { parseClmmExecutionEventRequest } from "../../contract/v1/validation.js";
import type { RecordClmmExecutionResultUseCase } from "../../application/use-cases/recordClmmExecutionResultUseCase.js";
import { ClmmExecutionEventConflictError } from "../../application/errors/ledgerErrors.js";
import { AuthError, requireSharedSecret } from "../auth.js";
import { ContractValidationError } from "../errors.js";

export const createClmmExecutionResultHandler = (useCase: RecordClmmExecutionResultUseCase) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-CLMM-Internal-Token", "CLMM_INTERNAL_TOKEN");

      const body = parseClmmExecutionEventRequest(request.body);
      const response = await useCase(body);
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof ClmmExecutionEventConflictError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: { code: "CLMM_EXECUTION_EVENT_CONFLICT", message: error.message, details: [] }
        });
      }

      throw error;
    }
  };
};
```

Notes:

- Auth (`requireSharedSecret`) stays in the handler.
- Pre-refactor, unexpected ledger write failures were caught as `LedgerWriteError` and returned 500. After refactor, those become unknown errors that propagate to Fastify, which produces 500 with no body — that matches the e2e test in `src/http/__tests__/clmmExecutionResult.e2e.test.ts:180-194` which only asserts `statusCode === 500`. Verify this assertion stays true; if any test asserts a specific 500 body, replace `throw error` with the explicit envelope mapping.

- [ ] **Step 2: Confirm typecheck shows the same expected error**

Run:

```bash
npm run typecheck
```

Expected: TYPE ERROR — `src/http/routes.ts` still calls `createClmmExecutionResultHandler(ledger)`. To be fixed at Task 17.

---

### Task 13: Slim the weekly-report handler

**Files:**

- Modify: `src/http/handlers/report.ts`

- [ ] **Step 1: Replace handler contents**

Overwrite `src/http/handlers/report.ts` with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import type { GetWeeklyReportUseCase } from "../../application/use-cases/getWeeklyReportUseCase.js";
import { ReportRangeApplicationError } from "../../application/errors/reportErrors.js";

const invalidReportRangeResponse = (message: string) => ({
  schemaVersion: SCHEMA_VERSION,
  error: {
    code: "INVALID_REPORT_RANGE",
    message,
    details: []
  }
});

export const createWeeklyReportHandler = (useCase: GetWeeklyReportUseCase) => {
  return async (
    request: FastifyRequest<{
      Querystring: {
        from?: string;
        to?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const from = request.query.from;
    const to = request.query.to;

    if (!from || !to) {
      return reply
        .code(400)
        .send(
          invalidReportRangeResponse("Query params from and to are required in YYYY-MM-DD format.")
        );
    }

    try {
      const report = await useCase({ from, to });
      return reply.code(200).send({
        schemaVersion: SCHEMA_VERSION,
        markdown: report.markdown,
        summary: report.summary
      });
    } catch (error) {
      if (error instanceof ReportRangeApplicationError) {
        return reply.code(400).send(invalidReportRangeResponse(error.message));
      }

      throw error;
    }
  };
};
```

Notes:

- Missing `from`/`to` returns the same 400 envelope as before.
- `ReportRangeApplicationError` thrown from the adapter (translated from `ReportRangeError`) → 400 with same envelope.
- Malformed persisted rows still throw raw JSON parse errors that propagate → Fastify returns 500. Test in `src/report/__tests__/weeklyReport.snapshot.test.ts:284-318` only asserts 500 status, no body shape.

- [ ] **Step 2: Confirm typecheck shows the same expected error**

Run:

```bash
npm run typecheck
```

Expected: TYPE ERROR — `src/http/routes.ts` still calls `createWeeklyReportHandler(ledger)`. To be fixed at Task 17.

---

### Task 14: Add `buildStoreContext.ts`

**Files:**

- Create: `src/composition/buildStoreContext.ts`

- [ ] **Step 1: Write the module**

Create `src/composition/buildStoreContext.ts`:

```ts
import type { Db } from "../ledger/pg/db.js";
import type { LedgerStore } from "../ledger/store.js";
import type { CandleStore } from "../ledger/candleStore.js";
import type { InsightsStore } from "../ledger/insightsStore.js";
import type { SrThesesV2Store } from "../ledger/srThesesV2Store.js";
import { createLedgerStore } from "../ledger/store.js";
import { closeStoreContext, createStoreContext } from "../ledger/storeContext.js";

export interface RuntimeStoreContext {
  ledger: LedgerStore;
  pg: Db | null;
  candleStore: CandleStore | null;
  insightsStore: InsightsStore | null;
  srThesesV2Store: SrThesesV2Store | null;
  close(): Promise<void>;
}

export const buildStoreContext = (): RuntimeStoreContext => {
  const databasePath =
    process.env.LEDGER_DB_PATH ??
    (process.env.NODE_ENV === "test" ? ":memory:" : "tmp/ledger.sqlite");

  const pgConnectionString = process.env.DATABASE_URL ?? "";

  if (pgConnectionString) {
    const ctx = createStoreContext(databasePath, pgConnectionString);
    return {
      ledger: ctx.ledger,
      pg: ctx.pg,
      candleStore: ctx.candleStore,
      insightsStore: ctx.insightsStore,
      srThesesV2Store: ctx.srThesesV2Store,
      close: () => closeStoreContext(ctx)
    };
  }

  const ledger = createLedgerStore(databasePath);
  return {
    ledger,
    pg: null,
    candleStore: null,
    insightsStore: null,
    srThesesV2Store: null,
    close: async () => {
      ledger.close();
    }
  };
};
```

Notes:

- Defaulting matches `src/http/routes.ts:36-37` exactly: `:memory:` in tests when unset, `tmp/ledger.sqlite` otherwise.
- Postgres branch reuses `createStoreContext` and `closeStoreContext` from `src/ledger/storeContext.ts:9-41` — no duplicated lifecycle logic.
- SQLite-only branch returns `null` for stores that depend on Postgres so `buildApplication` can detect them.

- [ ] **Step 2: Confirm typecheck is green**

Run:

```bash
npm run typecheck
```

Expected: PASS (no other module imports `buildStoreContext` yet).

- [ ] **Step 3: Commit**

```bash
git add src/composition/buildStoreContext.ts
git commit -m "m40: add buildStoreContext composition module"
```

---

### Task 15: Add `buildApplication.ts`

**Files:**

- Create: `src/composition/buildApplication.ts`

- [ ] **Step 1: Write the module**

Create `src/composition/buildApplication.ts`:

```ts
import type { ClockPort } from "../application/ports/clock.js";
import type { CandleReadPort, CandleWritePort } from "../application/ports/candlePorts.js";
import type { PlanLedgerWritePort } from "../application/ports/planLedgerPort.js";
import type {
  ClmmExecutionEventLedgerWritePort,
  ExecutionResultLedgerWritePort
} from "../application/ports/executionLedgerPort.js";
import type { WeeklyReportReadPort } from "../application/ports/weeklyReportReadPort.js";
import type { GetCurrentRegimeUseCase } from "../application/use-cases/getCurrentRegimeUseCase.js";
import type { GeneratePlanUseCase } from "../application/use-cases/generatePlanUseCase.js";
import type { IngestCandlesUseCase } from "../application/use-cases/ingestCandlesUseCase.js";
import type { RecordExecutionResultUseCase } from "../application/use-cases/recordExecutionResultUseCase.js";
import type { RecordClmmExecutionResultUseCase } from "../application/use-cases/recordClmmExecutionResultUseCase.js";
import type { GetWeeklyReportUseCase } from "../application/use-cases/getWeeklyReportUseCase.js";
import { createIngestCandlesUseCase } from "../application/use-cases/ingestCandlesUseCase.js";
import { createGetCurrentRegimeUseCase } from "../application/use-cases/getCurrentRegimeUseCase.js";
import { createGeneratePlanUseCase } from "../application/use-cases/generatePlanUseCase.js";
import { createRecordExecutionResultUseCase } from "../application/use-cases/recordExecutionResultUseCase.js";
import { createRecordClmmExecutionResultUseCase } from "../application/use-cases/recordClmmExecutionResultUseCase.js";
import { createGetWeeklyReportUseCase } from "../application/use-cases/getWeeklyReportUseCase.js";
import { createSqliteCandleReadAdapter } from "../adapters/sqlite/sqliteCandleReadAdapter.js";
import { createSqliteCandleRevisionUnitOfWork } from "../adapters/sqlite/sqliteCandleRevisionUnitOfWork.js";
import { createPostgresCandleReadAdapter } from "../adapters/postgres/postgresCandleReadAdapter.js";
import { createPostgresCandleRevisionUnitOfWork } from "../adapters/postgres/postgresCandleRevisionUnitOfWork.js";
import { createSqlitePlanLedgerWriteAdapter } from "../adapters/sqlite/sqlitePlanLedgerWriteAdapter.js";
import {
  createSqliteClmmExecutionEventLedgerWriteAdapter,
  createSqliteExecutionResultLedgerWriteAdapter
} from "../adapters/sqlite/sqliteExecutionLedgerAdapter.js";
import { createSqliteWeeklyReportReadAdapter } from "../adapters/sqlite/sqliteWeeklyReportReadAdapter.js";
import { checkPgHealth, checkSqliteHealth } from "../ledger/health.js";
import type { RuntimeStoreContext } from "./buildStoreContext.js";
import type { LedgerStore } from "../ledger/store.js";
import type { InsightsStore } from "../ledger/insightsStore.js";
import type { SrThesesV2Store } from "../ledger/srThesesV2Store.js";

export interface VersionInfo {
  name: string;
  version: string;
  commit?: string;
}

export interface HealthResult {
  ok: boolean;
  postgres: "ok" | "unavailable" | "not_configured";
  sqlite: "ok" | "unavailable";
}

export interface ApplicationDependencies {
  clock: ClockPort;
  candleReadPort: CandleReadPort;
  candleWritePort: CandleWritePort;
  planLedgerWritePort: PlanLedgerWritePort;
  executionResultLedgerWritePort: ExecutionResultLedgerWritePort;
  clmmExecutionEventLedgerWritePort: ClmmExecutionEventLedgerWritePort;
  weeklyReportReadPort: WeeklyReportReadPort;
  ingestCandles: IngestCandlesUseCase;
  getCurrentRegime: GetCurrentRegimeUseCase;
  generatePlan: GeneratePlanUseCase;
  recordExecutionResult: RecordExecutionResultUseCase;
  recordClmmExecutionResult: RecordClmmExecutionResultUseCase;
  getWeeklyReport: GetWeeklyReportUseCase;
  ledgerStore: LedgerStore;
  insightsStore: InsightsStore | null;
  srThesesV2Store: SrThesesV2Store | null;
  versionInfo: VersionInfo;
  checkHealth(): Promise<HealthResult>;
}

export const buildApplication = (ctx: RuntimeStoreContext): ApplicationDependencies => {
  const clock: ClockPort = { nowUnixMs: () => Date.now() };

  const candleReadPort: CandleReadPort = ctx.pg
    ? createPostgresCandleReadAdapter(ctx.pg)
    : createSqliteCandleReadAdapter(ctx.ledger);

  const candleWritePort: CandleWritePort = ctx.pg
    ? createPostgresCandleRevisionUnitOfWork(ctx.pg)
    : createSqliteCandleRevisionUnitOfWork(ctx.ledger);

  const planLedgerWritePort = createSqlitePlanLedgerWriteAdapter(ctx.ledger);
  const executionResultLedgerWritePort = createSqliteExecutionResultLedgerWriteAdapter(ctx.ledger);
  const clmmExecutionEventLedgerWritePort = createSqliteClmmExecutionEventLedgerWriteAdapter(
    ctx.ledger
  );
  const weeklyReportReadPort = createSqliteWeeklyReportReadAdapter(ctx.ledger);

  const ingestCandles = createIngestCandlesUseCase({ candleWritePort });
  const getCurrentRegime = createGetCurrentRegimeUseCase({
    candleReadPort,
    clock,
    engineVersion: process.env.npm_package_version ?? "0.0.0"
  });
  const generatePlan = createGeneratePlanUseCase({ planLedgerWritePort });
  const recordExecutionResult = createRecordExecutionResultUseCase({
    port: executionResultLedgerWritePort
  });
  const recordClmmExecutionResult = createRecordClmmExecutionResultUseCase({
    port: clmmExecutionEventLedgerWritePort
  });
  const getWeeklyReport = createGetWeeklyReportUseCase({ port: weeklyReportReadPort });

  const versionInfo: VersionInfo = {
    name: "regime-engine",
    version: process.env.npm_package_version ?? "0.1.0",
    ...(process.env.COMMIT_SHA ? { commit: process.env.COMMIT_SHA } : {})
  };

  return {
    clock,
    candleReadPort,
    candleWritePort,
    planLedgerWritePort,
    executionResultLedgerWritePort,
    clmmExecutionEventLedgerWritePort,
    weeklyReportReadPort,
    ingestCandles,
    getCurrentRegime,
    generatePlan,
    recordExecutionResult,
    recordClmmExecutionResult,
    getWeeklyReport,
    ledgerStore: ctx.ledger,
    insightsStore: ctx.insightsStore,
    srThesesV2Store: ctx.srThesesV2Store,
    versionInfo,
    checkHealth: async () => {
      const sqlite = checkSqliteHealth(ctx.ledger);
      const postgres = await checkPgHealth(ctx.pg);
      return {
        ok: sqlite.ok && postgres.ok,
        postgres: postgres.status,
        sqlite: sqlite.status
      };
    }
  };
};
```

Notes:

- `CandleWritePort` is the type exported by `src/application/ports/candlePorts.ts:37-43`. Both `createPostgresCandleRevisionUnitOfWork` and `createSqliteCandleRevisionUnitOfWork` return values that satisfy this interface.
- `engineVersion` resolution preserves the current pre-refactor read at `src/http/routes.ts:69`.
- `versionInfo.commit` is omitted when `process.env.COMMIT_SHA` is unset, mirroring the runtime behavior at `src/http/routes.ts:91-99`.
- `ledgerStore` is exposed for the existing S/R and insights routes that #40 does not refactor; they will receive it via `deps`.

- [ ] **Step 2: Confirm typecheck is green**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/composition/buildApplication.ts
git commit -m "m40: add buildApplication composition module"
```

---

### Task 16: Add `buildApp.ts` and update `src/app.ts`

**Files:**

- Create: `src/composition/buildApp.ts`
- Modify: `src/app.ts`

- [ ] **Step 1: Write `buildApp.ts`**

Create `src/composition/buildApp.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "../http/routes.js";
import { buildStoreContext } from "./buildStoreContext.js";
import { buildApplication } from "./buildApplication.js";

export const buildApp = (): FastifyInstance => {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true
  });

  const ctx = buildStoreContext();
  const deps = buildApplication(ctx);

  registerRoutes(app, deps);

  app.addHook("onClose", async () => {
    await ctx.close();
  });

  return app;
};
```

- [ ] **Step 2: Update `src/app.ts` to re-export**

Overwrite `src/app.ts`:

```ts
export { buildApp } from "./composition/buildApp.js";
```

Notes:

- Keeping `src/app.ts` intact preserves all `import { buildApp } from "../../app.js"` paths in tests.

- [ ] **Step 3: Confirm typecheck error is now confined to `routes.ts`**

Run:

```bash
npm run typecheck
```

Expected: TYPE ERROR — `registerRoutes` still has the old `(app)` signature; Tasks 11–13 also broke the handler factory call sites in `routes.ts`. Task 17 unifies all of these.

- [ ] **Step 4: Stage but do not commit**

```bash
git add src/composition/buildApp.ts src/app.ts
```

Hold the commit until Task 17 makes the tree green again.

---

### Task 17: Convert `src/http/routes.ts` to dependency-injected route registration

**Files:**

- Modify: `src/http/routes.ts`

- [ ] **Step 1: Replace `routes.ts` contents**

Overwrite `src/http/routes.ts`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import { buildOpenApiDocument } from "./openapi.js";
import { createClmmExecutionResultHandler } from "./handlers/clmmExecutionResult.js";
import { createExecutionResultHandler } from "./handlers/executionResult.js";
import { createPlanHandler } from "./handlers/plan.js";
import { createWeeklyReportHandler } from "./handlers/report.js";
import { createCandlesIngestHandler } from "./handlers/candlesIngest.js";
import { createRegimeCurrentHandler } from "./handlers/regimeCurrent.js";
import { createSrLevelsIngestHandler } from "./handlers/srLevelsIngest.js";
import { createSrLevelsCurrentHandler } from "./handlers/srLevelsCurrent.js";
import { createInsightsIngestHandler } from "./handlers/insightsIngest.js";
import { createInsightsCurrentHandler } from "./handlers/insightsCurrent.js";
import { createInsightsHistoryHandler } from "./handlers/insightsHistory.js";
import { createSrLevelsV2IngestHandler } from "./handlers/srLevelsV2Ingest.js";
import { createSrLevelsV2CurrentHandler } from "./handlers/srLevelsV2Current.js";
import type { ApplicationDependencies } from "../composition/buildApplication.js";

export const registerRoutes = (app: FastifyInstance, deps: ApplicationDependencies): void => {
  app.get("/health", async (_req, reply: FastifyReply) => {
    const health = await deps.checkHealth();
    if (!health.ok) {
      reply.code(503);
    }
    return health;
  });

  app.get("/version", async () => {
    return deps.versionInfo;
  });

  app.get("/v1/openapi.json", async () => {
    return buildOpenApiDocument();
  });

  app.post("/v1/plan", createPlanHandler(deps.generatePlan));
  app.post("/v1/execution-result", createExecutionResultHandler(deps.recordExecutionResult));
  app.post(
    "/v1/clmm-execution-result",
    createClmmExecutionResultHandler(deps.recordClmmExecutionResult)
  );
  app.get("/v1/report/weekly", createWeeklyReportHandler(deps.getWeeklyReport));
  app.post("/v1/sr-levels", createSrLevelsIngestHandler(deps.ledgerStore));
  app.get("/v1/sr-levels/current", createSrLevelsCurrentHandler(deps.ledgerStore));
  app.post(
    "/v1/candles",
    createCandlesIngestHandler({ ingestCandles: deps.ingestCandles, clock: deps.clock })
  );
  app.get("/v1/regime/current", createRegimeCurrentHandler(deps.getCurrentRegime));
  app.post("/v1/insights/sol-usdc", createInsightsIngestHandler(deps.insightsStore));
  app.get("/v1/insights/sol-usdc/current", createInsightsCurrentHandler(deps.insightsStore));
  app.get("/v1/insights/sol-usdc/history", createInsightsHistoryHandler(deps.insightsStore));
  app.post("/v2/sr-levels", createSrLevelsV2IngestHandler(deps.srThesesV2Store));
  app.get("/v2/sr-levels/current", createSrLevelsV2CurrentHandler(deps.srThesesV2Store));
};
```

Notes:

- No env reads, no store construction, no clock construction, no infrastructure selection, no `onClose` hook here.
- `/health` reads `deps.checkHealth()`. The `503` branch is preserved.
- `/version` reads `deps.versionInfo`. The `commit` field is omitted when unset (already handled in `buildApplication`).
- The `S/R` and insights handlers still take stores directly — these are explicitly out of scope per the spec.
- `version`'s envelope no longer reads `process.env` directly. `buildApplication` snapshots `process.env.npm_package_version` and `process.env.COMMIT_SHA` at startup. This matches existing test behavior because tests rebuild the app after mutating env.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS. If `ApplicationDependencies` types don't line up (e.g., `insightsStore`/`srThesesV2Store` mismatched nullability), adjust `buildApplication.ts` types to match what the handlers accept. The pre-refactor route at `src/http/routes.ts:131` passes `srThesesV2Store` which is `null` in the SQLite-only path; preserve that exactly.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run boundaries**

Run:

```bash
npm run boundaries
```

Expected: PASS. `src/http/routes.ts` is allowed to import `src/composition/buildApplication.js` (only `src/engine`, `src/domain`, `src/application`, `src/adapters` are restricted). If a rule fires, inspect `.dependency-cruiser.cjs:104-114` — `src/adapters/**` cannot import `src/composition/**`, but `src/http/**` can.

- [ ] **Step 5: Run unit + e2e tests**

Run:

```bash
npm run test
```

Expected: PASS — all existing handler/e2e tests in `src/http/__tests__/`, `src/report/__tests__/`, and `src/__tests__/smoke.test.ts` continue passing because response bodies, idempotency, and ledger writes are byte-equal to pre-refactor.

- [ ] **Step 6: Commit the bundled handler+composition migration**

```bash
git add src/http/routes.ts \
        src/http/handlers/executionResult.ts \
        src/http/handlers/clmmExecutionResult.ts \
        src/http/handlers/report.ts \
        src/composition/buildApp.ts \
        src/app.ts
git commit -m "m40: route registration receives composition deps; slim execution/CLMM/report handlers"
```

---

### Task 18: Update `health.probe.test.ts` for the new `registerRoutes` signature

**Files:**

- Modify: `src/http/__tests__/health.probe.test.ts`

- [ ] **Step 1: Replace contents**

The pre-refactor test calls `registerRoutes(app)` directly. The new signature requires `deps`. Switch the happy-path test to use `buildApp()` and keep the `checkSqliteHealth` unit test as-is.

Overwrite `src/http/__tests__/health.probe.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../../app.js";
import { checkSqliteHealth } from "../../ledger/health.js";

describe("GET /health - happy path", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.LEDGER_DB_PATH;
  });

  it("returns 200 with postgres=not_configured, sqlite=ok when no DATABASE_URL", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;

    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      postgres: "not_configured",
      sqlite: "ok"
    });

    await app.close();
  });
});

describe("checkSqliteHealth — 503 branch coverage", () => {
  it("returns unavailable for a closed database", () => {
    const db = new DatabaseSync(":memory:");
    const store = {
      db,
      path: ":memory:",
      close: () => {
        db.close();
      }
    };

    const healthy = checkSqliteHealth(store as never);
    expect(healthy).toEqual({ ok: true, status: "ok" });

    db.close();
    const degraded = checkSqliteHealth(store as never);
    expect(degraded).toEqual({ ok: false, status: "unavailable" });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/http/__tests__/health.probe.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/http/__tests__/health.probe.test.ts
git commit -m "m40: update health.probe.test for dependency-injected registerRoutes"
```

---

### Task 19: Add composition e2e test

**Files:**

- Create: `src/composition/__tests__/buildApp.e2e.test.ts`

- [ ] **Step 1: Write the test**

Create `src/composition/__tests__/buildApp.e2e.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../buildApp.js";

describe("buildApp composition", () => {
  afterEach(() => {
    delete process.env.LEDGER_DB_PATH;
    delete process.env.DATABASE_URL;
    delete process.env.COMMIT_SHA;
  });

  it("serves /health when DATABASE_URL is unset (SQLite-only fallback)", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;

    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      postgres: "not_configured",
      sqlite: "ok"
    });

    await app.close();
  });

  it("serves /version with name and version", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";

    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/version" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { name: string; version: string; commit?: string };
    expect(body.name).toBe("regime-engine");
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);

    await app.close();
  });

  it("includes commit on /version when COMMIT_SHA is set", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.COMMIT_SHA = "abcdef0";

    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/version" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ commit: "abcdef0" });

    await app.close();
  });

  it("serves /v1/openapi.json", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";

    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const doc = response.json() as { openapi: string };
    expect(doc.openapi).toMatch(/^3\./);

    await app.close();
  });

  it("closes the runtime store context once via onClose", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";

    const app = buildApp();
    await app.close();

    // A second close on the same Fastify instance is a no-op for hooks; we
    // verify only that the first close resolves without error and that a
    // subsequent /health request rejects because the SQLite db is closed.
    await expect(app.inject({ method: "GET", url: "/health" })).rejects.toBeTruthy();
  });
});
```

Notes:

- This file lives under `src/composition/__tests__/`. There is no boundary rule restricting test files; verify with `npm run boundaries`.
- The "closes once" test exists to satisfy the spec composition-test bullet "Fastify `onClose` closes the paired runtime context through the single `close()` method." If asserting via injection after close turns out to be flaky on this Fastify version, replace with a fake `RuntimeStoreContext` injected via a test-only `buildApp` overload — but only do that if needed; prefer the simplest end-to-end check.

- [ ] **Step 2: Run the new test**

Run: `npx vitest run src/composition/__tests__/buildApp.e2e.test.ts`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/composition/__tests__/buildApp.e2e.test.ts
git commit -m "m40: add buildApp composition e2e test"
```

---

### Task 20: Quality gate

**Files:** none

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run unit + e2e tests**

Run:

```bash
npm run test
```

Expected: PASS. Verify the following test files in particular still pass byte-equal:

- `src/http/__tests__/executionResult.e2e.test.ts` — exact `200 / 404 / 409` bodies preserved.
- `src/http/__tests__/clmmExecutionResult.e2e.test.ts` — `401 / 500 / 200` mapping preserved; idempotency preserved.
- `src/report/__tests__/weeklyReport.snapshot.test.ts` — markdown + summary snapshots unchanged; `INVALID_REPORT_RANGE` envelope preserved; malformed-row 500 preserved.
- `src/http/__tests__/routes.contract.test.ts` — `/health`, `/version`, `/v1/openapi.json` contracts preserved.
- `src/__tests__/smoke.test.ts` — `/health`, `/version`, `/v1/openapi.json` smoke + fixture tests preserved.
- `src/http/__tests__/storeContext.e2e.test.ts` — `/health` `not_configured` body preserved.

If any of these fail, the failure indicates a real regression in HTTP shape or env semantics — fix before proceeding.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run boundaries**

Run:

```bash
npm run boundaries
```

Expected: PASS. The new files in `src/application/**`, `src/adapters/**`, and `src/composition/**` must satisfy:

- `application-no-outer-layers`: no application file imports `http`, `ledger`, `workers`, `adapters`, `composition`, `app.ts`, or `server.ts`.
- `adapters-no-composition-or-entry`: no adapter file imports `composition` or runtime entry points.
- `process.env` may only appear under `src/composition/**`, `src/http/**`, `src/server.ts`, `src/app.ts`, `src/workers/**`, `src/ledger/**` — confirm `scripts/check-boundary-env.sh` reports no inner-layer hits.

- [ ] **Step 6: Run `test:pg`**

Run:

```bash
npm run test:pg
```

Expected: PASS if a Postgres instance is reachable. If not, document this in the PR body explicitly:

```
test:pg was not run locally because DATABASE_URL is not reachable in this environment.
The Postgres-backed candle adapters used by /v1/regime/current and /v1/candles in the
DATABASE_URL=set path are unvalidated locally. CI must verify.
```

- [ ] **Step 7: Final commit (if any cleanup)**

If the gate run produced no diff, no commit is needed. Otherwise run:

```bash
git status
git add -p
git commit -m "m40: address quality-gate findings"
```

---

## Validation Checklist

Before opening the PR, confirm every spec requirement is covered:

- [ ] `RecordExecutionResultUseCase` exists with happy-path, idempotent, plan-not-found, plan-hash-mismatch, conflict tests using fakes (Tasks 5, 6).
- [ ] `RecordClmmExecutionResultUseCase` exists with happy-path, idempotent, conflict tests using fakes (Tasks 5, 7).
- [ ] `GetWeeklyReportUseCase` exists with port-call, output-passthrough, range-error-propagation tests using fakes (Tasks 5, 8).
- [ ] `ExecutionResultLedgerWritePort` and `ClmmExecutionEventLedgerWritePort` defined with storage-neutral outcome unions (Task 3).
- [ ] `WeeklyReportReadPort` defined as a read port (not a writer, not SQLite-named) (Task 4).
- [ ] SQLite execution-ledger adapter wraps `writeExecutionResultLedgerEntry` and `writeClmmExecutionEvent`, preserves plan checks, hash mismatch, idempotency, conflict, transactions, and `Date.now()` defaults (Task 9).
- [ ] SQLite weekly-report adapter wraps `generateWeeklyReport`, translates `ReportRangeError` to `ReportRangeApplicationError` (Task 10).
- [ ] CLMM auth (`requireSharedSecret`) stays in the handler (Task 12).
- [ ] HTTP handlers map use-case errors to existing public envelopes for the documented status codes (Tasks 11, 12, 13).
- [ ] `buildStoreContext.ts` reads env with the same defaulting, returns SQLite-only fallback or `StoreContext`, and pairs construction with one `close()` (Task 14).
- [ ] `buildApplication.ts` builds clock, ports, adapters, and use cases — only S/R + insights routes still use direct stores (Task 15).
- [ ] `buildApp.ts` creates Fastify with the same logger gate, builds dependencies, registers routes, installs `onClose` (Task 16).
- [ ] `src/app.ts` is a thin re-export so existing imports keep working (Task 16).
- [ ] `src/http/routes.ts` no longer reads env, no longer constructs stores, no longer chooses SQLite/Postgres, no longer creates clocks, no longer wires use cases, no longer owns `onClose` (Task 17).
- [ ] `/health` returns the existing body and status code mapping (Tasks 17, 19).
- [ ] `/version` includes `commit` only when `COMMIT_SHA` is set (Tasks 17, 19).
- [ ] `server.ts` startup, Postgres verification, redacted logging, SIGTERM/SIGINT, shutdown timeout, `app.close()` trigger remain unchanged.
- [ ] `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run boundaries` all pass (Task 20).
- [ ] `npm run test:pg` outcome documented in the PR body (Task 20).

---

## Execution Handoff

After the plan is approved, execute task-by-task using **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans**. Each task is self-contained with the file paths, code, commands, and expected output an engineer needs to land it without prior context.
