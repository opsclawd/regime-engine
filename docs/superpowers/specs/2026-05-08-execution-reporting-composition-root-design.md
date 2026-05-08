# Execution Reporting And Composition Root Design

**Issue:** #40
**Date:** 2026-05-08
**Status:** Approved

## Problem

Regime Engine has already extracted the candle ingestion, regime-current, and
plan-generation seams, but `src/http/routes.ts` still owns too many
responsibilities:

- Reads runtime environment variables.
- Selects SQLite-only versus SQLite plus Postgres infrastructure.
- Constructs and closes stores.
- Builds clocks, ports, adapters, and use cases.
- Registers routes.
- Implements health response behavior inline.

The execution-result, CLMM execution-result, and weekly-report handlers also
still call ledger/report infrastructure directly. #40 finishes this refactor
stage by extracting execution/reporting use cases and moving runtime wiring into
`src/composition/**`, while preserving current behavior exactly.

## Goals

- Add execution/reporting application use cases.
- Add the ports needed by those use cases.
- Add adapter implementations only where needed to preserve current runtime
  behavior.
- Move runtime dependency wiring and infrastructure selection into
  `src/composition/**`.
- Reduce `src/http/routes.ts` to route registration and HTTP-only concerns.
- Preserve response shapes, HTTP statuses, idempotency behavior, ledger writes,
  health behavior, startup behavior, shutdown behavior, and env var semantics.

## Non-Goals

- Do not move `src/http/**` files in #40.
- Do not change execution-result schemas.
- Do not change CLMM execution-event schemas.
- Do not change weekly report contents.
- Do not rewrite the engine.
- Do not decouple engine code from `contract/v1` types.
- Do not change deployment env var semantics.
- Do not refactor S/R or insights handlers beyond passing their existing store
  dependencies through route registration.

## Architecture-Closure Follow-Up

#40 intentionally keeps `src/http/**` stable. #41 is the architecture-closure
story that will make the final HTTP adapter layout decision and align code,
docs, and boundary rules. The preferred direction is moving `src/http/**` to
`src/adapters/http/**`, but #40 does not perform that path migration.

This keeps #40 focused on use cases and composition-root extraction without
leaving the remaining HTTP adapter layout normalization unresolved.

## Design Decisions

| Decision                      | Choice                                          | Rationale                                                                                 |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| HTTP file movement            | None in #40                                     | Avoids mixing behavior-preserving extraction with path churn.                             |
| Runtime wiring owner          | `src/composition/**`                            | Route registration should not select stores, read env, or own lifecycle cleanup.          |
| Execution orchestration       | Application use cases                           | Execution receipt behavior becomes testable without Fastify.                              |
| Report dependency shape       | `WeeklyReportReadPort`                          | The application needs a read capability, not SQLite-specific report mechanics.            |
| CLMM auth owner               | HTTP handler/auth helper                        | Shared-secret auth is an HTTP concern and must preserve current per-request env behavior. |
| Store lifecycle               | Single runtime context `close(): Promise<void>` | Store/context construction and cleanup must be paired in one place.                       |
| Postgres startup verification | Preserve current semantics                      | Failure timing, redacted logging, and process-exit behavior are deployment-sensitive.     |

## Target Structure

```text
src/application/errors/
  ledgerErrors.ts
  reportErrors.ts

src/application/ports/
  executionLedgerPort.ts
  weeklyReportReadPort.ts

src/application/use-cases/
  recordExecutionResultUseCase.ts
  recordClmmExecutionResultUseCase.ts
  getWeeklyReportUseCase.ts

src/adapters/sqlite/
  sqliteExecutionLedgerAdapter.ts
  sqliteWeeklyReportReadAdapter.ts

src/composition/
  buildApp.ts
  buildApplication.ts
  buildStoreContext.ts
```

Exact filenames may vary to match local conventions, but ownership boundaries
should remain stable.

## Use Cases

### `RecordExecutionResultUseCase`

Input: parsed `ExecutionResultRequest`.

Responsibilities:

1. Call the execution-result ledger port.
2. Interpret meaningful application outcomes such as inserted, idempotent,
   plan-not-found, plan-hash-mismatch, and execution-result-conflict.
3. Return the exact current `ExecutionResultResponse` shape:
   `{ schemaVersion, ok: true, linkedPlanId, linkedPlanHash }`, with
   `idempotent: true` only for idempotent replay.
4. Throw typed application errors for meaningful failure outcomes.

It must not import Fastify, HTTP errors, SQLite, ledger writer code, storage
adapters, `process`, or `process.env`.

### `RecordClmmExecutionResultUseCase`

Input: parsed `ClmmExecutionEventRequest`.

Responsibilities:

1. Call the CLMM execution-event ledger port.
2. Interpret meaningful application outcomes such as inserted, idempotent, and
   correlation-id conflict.
3. Return the exact current `ClmmExecutionEventResponse` shape:
   `{ schemaVersion, ok: true, correlationId }`, with `idempotent: true` only
   for idempotent replay.
4. Throw typed application errors for meaningful failure outcomes.

CLMM shared-secret auth remains in the HTTP handler/auth helper. The use case
receives only already-authenticated and parsed contract input.

### `GetWeeklyReportUseCase`

Input: `from` and `to` strings after the handler has checked that both query
params are present.

Responsibilities:

1. Call `WeeklyReportReadPort`.
2. Return the existing report output: markdown plus summary.
3. Preserve the current invalid-range behavior. Today, report date validation
   lives inside `generateWeeklyReport`, so the adapter should translate
   `ReportRangeError` into a typed application report-range error and the use
   case should let that error propagate.

Request parsing and basic report-range request validation remain in
HTTP/contract parsing unless current behavior already validates inside report
generation.

## Ports

Ports express application needs, not SQLite mechanics.

### Execution Ledger Ports

#40 should define two small write-port interfaces:

- `ExecutionResultLedgerWritePort` for plan-linked execution receipts.
- `ClmmExecutionEventLedgerWritePort` for CLMM execution events.

The ports should return storage-neutral outcomes, for example:

- inserted
- idempotent
- plan not found
- plan hash mismatch
- execution result conflict
- CLMM correlation conflict

Application use cases decide which outcomes are meaningful conflicts/not-found
conditions versus unexpected failures.

Adapters may translate raw SQLite/storage failures into typed
application-visible failures, but they should not own business-level ledger
semantics.

### Weekly Report Read Port

`WeeklyReportReadPort` should expose one read operation for report
generation over the existing ledger-backed data:

```ts
getWeeklyReport(input: { from: string; to: string }): Promise<WeeklyReportOutput>
```

The application is reading/reporting rather than writing ledger data, so the
port should not use write- or SQLite-specific naming.

## Adapters

Adapter implementations should be added only where required to preserve current
runtime behavior. Execution receipts, CLMM execution events, and weekly reports
currently use the SQLite ledger path even when Postgres is configured, so #40
should add SQLite-backed adapters for those ports.

#40 should not invent Postgres execution/report adapters unless current behavior
already requires them.

The SQLite execution adapter may wrap existing functions from
`src/ledger/writer.ts`, but the application layer must not import those
functions directly. The adapter should preserve:

- Plan existence checks.
- Plan-hash mismatch behavior.
- Canonical JSON comparisons.
- Idempotent replay detection.
- Conflict detection.
- Transaction behavior.
- Existing `Date.now()` default timestamp behavior where currently used.

The weekly report adapter may wrap `generateWeeklyReport` while preserving the
existing ledger-only query behavior and deterministic output.

## HTTP Handlers

Handlers remain responsible for HTTP mechanics:

- Request parsing.
- Query parameter presence checks.
- Shared-secret auth.
- Mapping typed application outcomes/errors to HTTP status codes and response
  envelopes.
- Sending Fastify replies.

Use cases do not map to HTTP status codes or HTTP envelopes. Handler and e2e
tests must prove that use-case outcomes/errors map to the existing public
responses.

Expected public mappings remain:

- `/v1/execution-result`
  - success: 200 with the existing success body
  - idempotent replay: 200 with `idempotent: true`
  - `PLAN_NOT_FOUND`: 404 with the existing error body
  - `PLAN_HASH_MISMATCH`: 409 with the existing error body
  - `EXECUTION_RESULT_CONFLICT`: 409 with the existing error body
- `/v1/clmm-execution-result`
  - success: 200 with the existing success body
  - idempotent replay: 200 with `idempotent: true`
  - `CLMM_EXECUTION_EVENT_CONFLICT`: 409 with the existing error body
  - unexpected ledger write failures: preserve existing 500 behavior
- `/v1/report/weekly`
  - missing `from` or `to`: 400 with the existing
    `INVALID_REPORT_RANGE` body
  - invalid report range: 400 with the existing `INVALID_REPORT_RANGE` body
  - malformed persisted report rows: preserve existing 500 behavior

## Composition Root

`src/composition/**` owns runtime wiring.

### `buildStoreContext.ts`

This module owns store construction and cleanup:

1. Read `LEDGER_DB_PATH` with the current defaulting behavior:
   - `:memory:` in tests when unset
   - `tmp/ledger.sqlite` otherwise
2. Read `DATABASE_URL`.
3. Construct the SQLite-only fallback when `DATABASE_URL` is absent.
4. Construct the current `StoreContext` when `DATABASE_URL` is present.
5. Return a runtime context containing the selected stores plus one
   `close(): Promise<void>` method.

Store/context construction and cleanup must be paired. `buildApp.ts` may
install a Fastify `onClose` hook to call the runtime context's `close()` method,
but it should not duplicate close logic.

### `buildApplication.ts`

This module builds application dependencies from the runtime context:

- Clock.
- Candle read/write ports.
- Plan ledger write port.
- Execution ledger port.
- `WeeklyReportReadPort`.
- Existing use cases from #38 and #39.
- New execution/reporting use cases from #40.
- Store dependencies that must still be passed to out-of-scope S/R and insights
  routes.
- Health-check dependency or ready health-check function.

Only S/R and insights routes may keep existing direct store dependencies because
they are outside #40 scope.

### `buildApp.ts`

This module creates Fastify, builds the runtime/application dependencies,
registers routes, and installs lifecycle cleanup:

1. Create Fastify with the existing logger behavior.
2. Build the runtime store context.
3. Build application/use-case dependencies.
4. Register routes.
5. Add `onClose` to call the runtime context's single `close()` method.

`src/app.ts` can become a compatibility wrapper that exports `buildApp()` from
composition, preserving current test and server imports.

### `src/http/routes.ts`

`routes.ts` receives a dependency object and registers routes only. It should no
longer:

- Read env vars.
- Construct stores.
- Choose SQLite/Postgres infrastructure.
- Create clocks.
- Wire use cases.
- Own store lifecycle cleanup.

`routes.ts` may still register `/health`, `/version`, and `/v1/openapi.json`.
Version dependencies can be passed in from composition so env reads stay out of
the route module.

## Startup And Shutdown Semantics

Existing graceful shutdown behavior in `server.ts` stays unchanged:

- Listen behavior stays unchanged.
- SIGTERM and SIGINT handling stays unchanged.
- Shutdown timeout stays unchanged.
- `app.close()` remains the shutdown trigger.

Postgres verification may remain in `server.ts` for #40 if moving it would
change failure timing, redacted logging, or process-exit behavior. If moved into
composition, those semantics must be preserved exactly.

Health endpoint behavior must stay unchanged:

- SQLite healthy and no Postgres configured returns
  `{ ok: true, postgres: "not_configured", sqlite: "ok" }`.
- Any unhealthy configured store returns status 503.
- Response keys and status strings stay unchanged.

## Behavior Parity

This refactor must preserve:

- Execution result response shapes.
- CLMM execution result response shapes.
- Idempotency behavior.
- Ledger write behavior.
- Weekly report output.
- Health endpoint behavior.
- SQLite/Postgres store initialization behavior.
- Railway startup behavior.
- Graceful shutdown behavior.
- Existing error codes and HTTP statuses.
- Existing env var semantics.

Snapshot, hash, and weekly-report outputs should not change.

## Testing

### Use-Case Unit Tests

`RecordExecutionResultUseCase` tests should use fake ports and cover:

- happy path response
- idempotent replay response
- plan-not-found application error
- plan-hash-mismatch application error
- execution-result-conflict application error

`RecordClmmExecutionResultUseCase` tests should cover:

- happy path response
- idempotent replay response
- correlation-conflict application error

`GetWeeklyReportUseCase` tests should cover:

- port call with `from` and `to`
- unchanged markdown plus summary output
- invalid-range application error translated from `ReportRangeError`

### Handler And E2E Tests

Handler/e2e tests must prove exact response-body parity for:

- execution success
- execution idempotent replay
- execution plan not found
- execution hash mismatch
- execution conflict
- CLMM success
- CLMM idempotent replay
- CLMM correlation conflict

Validation remains handler-owned. Existing validation tests should continue to
cover malformed request behavior.

CLMM auth remains handler-owned. Existing HTTP tests should continue to cover:

- missing token
- wrong token
- unset `CLMM_INTERNAL_TOKEN`

Weekly report tests should preserve:

- endpoint success shape
- invalid-range error body
- malformed persisted row behavior as 500
- snapshot output

### Composition Tests

Composition tests should verify behavior rather than implementation details:

- `buildApp()` still serves `/health`.
- `buildApp()` still serves `/version`.
- `buildApp()` still serves `/v1/openapi.json`.
- SQLite fallback works with `LEDGER_DB_PATH=:memory:`.
- Existing e2e route tests continue passing.
- Fastify `onClose` closes the paired runtime context through the single
  `close()` method.
- `src/http/routes.ts` no longer owns env reads or infrastructure construction.

## Required Validation

The implementation PR must run:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:pg
npm run build
npm run boundaries
```

If `npm run test:pg` cannot run locally, the PR must explicitly say why and
identify what Postgres behavior remains unvalidated.
