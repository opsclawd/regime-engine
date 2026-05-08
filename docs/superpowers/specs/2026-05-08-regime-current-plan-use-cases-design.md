# Regime Current And Plan Use Cases Design

**Issue:** #39
**Date:** 2026-05-08
**Status:** Approved

## Problem

The two core deterministic decision paths still have application orchestration
inside HTTP handlers:

- `GET /v1/regime/current` parses HTTP, plans candle reads, reads candles,
  derives 1h candles, handles empty-candle cases, invokes the regime engine, and
  sends the HTTP response.
- `POST /v1/plan` parses HTTP, invokes `buildPlan`, writes plan ledger rows, and
  sends the HTTP response.

#39 extracts narrow application use cases for those paths while preserving
existing engine behavior, public response shapes, plan hashes, canonical JSON,
ledger writes, cutoff behavior, and error envelopes.

## Goals

- Add `GetCurrentRegimeUseCase` under `src/application/use-cases`.
- Add `GeneratePlanUseCase` under `src/application/use-cases`.
- Add `PlanLedgerWritePort` under `src/application/ports`.
- Reuse existing `CandleReadPort` and `ClockPort`.
- Keep HTTP handlers responsible for request parsing, known-error mapping, and
  final reply status/send.
- Keep use cases responsible for deterministic orchestration, port calls, engine
  invocation, and application-level errors.
- Keep route changes limited to minimal wiring in `src/http/routes.ts`.
- Preserve behavior for current-regime reads, plan generation, and plan ledger
  writes exactly.

## Non-Goals

- Do not move composition out of `routes.ts`; #40 owns composition-root cleanup.
- Do not change regime thresholds, market-regime config, indicator math,
  allocation, churn, chop, or plan logic.
- Do not decouple engine code from `contract/v1` types.
- Do not change public request or response schemas.
- Do not introduce new HTTP error envelopes.
- Do not make application code import `src/http/**`, `src/ledger/**`,
  `src/adapters/**`, `process`, or `process.env`.

## Design Decisions

| Decision                    | Choice                                   | Rationale                                                                                            |
| --------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Regime orchestration owner  | `GetCurrentRegimeUseCase`                | The handler should no longer own candle retrieval orchestration.                                     |
| Plan orchestration owner    | `GeneratePlanUseCase`                    | Plan generation and plan ledger persistence become testable without Fastify.                         |
| Plan persistence dependency | Explicit `PlanLedgerWritePort`           | Matches the established ports-and-adapters boundary; avoids raw callbacks.                           |
| Empty-candle signaling      | Application error mapped by HTTP handler | Application code must not construct HTTP-shaped errors, but the public envelope must stay unchanged. |
| Engine version              | Inject string from routes                | Application code must not read `process.env`.                                                        |
| Composition                 | Minimal wiring in `routes.ts`            | Avoids pulling #40 into this refactor.                                                               |

## Target Structure

```text
src/application/errors/
  regimeErrors.ts

src/application/ports/
  planLedgerPort.ts

src/application/use-cases/
  getCurrentRegimeUseCase.ts
  generatePlanUseCase.ts
  __tests__/

src/adapters/sqlite/
  sqlitePlanLedgerWriteAdapter.ts
```

Exact test fixture filenames may vary, but the production boundaries should
remain stable.

## Layer Responsibilities

### HTTP Handlers

Handlers remain the only layer that owns HTTP request and response mechanics.

`regimeCurrent` handler owns:

1. Parsing `request.query` through `parseRegimeCurrentQuery`.
2. Calling `GetCurrentRegimeUseCase` with the parsed `RegimeCurrentQuery`.
3. Mapping `ContractValidationError` from parsing exactly as today.
4. Mapping `RegimeCandlesNotFoundError` to the existing
   `candlesNotFoundError(error.message, error.details)` envelope.
5. Logging and returning the current `500 INTERNAL_ERROR` response for
   unexpected errors.
6. Sending the successful response with status `200`.

`plan` handler owns:

1. Parsing `request.body` through `parsePlanRequest`.
2. Calling `GeneratePlanUseCase` with the parsed `PlanRequest`.
3. Mapping `ContractValidationError` exactly as today.
4. Preserving the current behavior for unexpected errors.
5. Sending the successful plan response with status `200`.

Handlers do not own deterministic orchestration after this refactor.

### Use Cases

Use cases receive parsed contract inputs only. They do not import Fastify, HTTP
errors, ledger code, storage adapters, or environment variables.

`GetCurrentRegimeUseCase` owns:

1. Reading `nowUnixMs` from `ClockPort`.
2. Looking up `MARKET_REGIME_CONFIG[query.timeframe]`.
3. Building the read plan with `buildRegimeCandleReadPlan`.
4. Reading source candles through `CandleReadPort`.
5. Throwing `RegimeCandlesNotFoundError` when no source candles exist.
6. Aggregating 15m candles to 1h with `aggregate15mTo1h` for derived reads.
7. Filtering derived candles by `derivedCutoffUnixMs`.
8. Throwing `RegimeCandlesNotFoundError` when no derived candles survive the
   cutoff.
9. Calling `buildRegimeCurrent`.
10. Constructing metadata with the same values as today, including
    `sourceCandleCount`, read-plan metadata, config version, and injected engine
    version.

`GeneratePlanUseCase` owns:

1. Calling `buildPlan(body, body.regimeState)` exactly.
2. Writing `{ planRequest: body, planResponse: plan }` through
   `PlanLedgerWritePort`.
3. Returning the exact `PlanResponse` returned by `buildPlan`.

## Application Errors

Add `src/application/errors/regimeErrors.ts`.

```ts
export interface RegimeApplicationErrorDetail {
  code: string;
  path: string;
  message: string;
}

export class RegimeCandlesNotFoundError extends Error {
  public readonly details: RegimeApplicationErrorDetail[];
}
```

The application-local detail shape intentionally matches the data currently
passed into `candlesNotFoundError`, but it must not import HTTP error types.

The empty-candle message and detail construction must move from the current
handler into `GetCurrentRegimeUseCase` byte-for-byte:

- The source-candle empty path keeps the same message, detail code
  `NO_SOURCE_CANDLES`, path `$.sourceTimeframe`, and detail message.
- The derived-candle empty path keeps the same message, detail code
  `NO_DERIVED_CANDLES_AFTER_AGGREGATION`, path `$.derivedTimeframe`, and detail
  message containing aggregation telemetry counts.

The handler maps `RegimeCandlesNotFoundError` through:

```ts
candlesNotFoundError(error.message, error.details);
```

This preserves status `404`, schema version, top-level `CANDLES_NOT_FOUND`,
message, details, and response shape.

## Application Ports

Add `src/application/ports/planLedgerPort.ts`.

```ts
import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";

export interface PlanLedgerWritePort {
  writePlan(input: { planRequest: PlanRequest; planResponse: PlanResponse }): Promise<void>;
}
```

`GeneratePlanUseCase` depends on this port. It must not import
`src/ledger/writer.ts`.

## Adapters

Add `src/adapters/sqlite/sqlitePlanLedgerWriteAdapter.ts`.

The adapter wraps the existing synchronous writer in an async method:

```ts
export const createSqlitePlanLedgerWriteAdapter = (store: LedgerStore): PlanLedgerWritePort => ({
  async writePlan(input) {
    writePlanLedgerEntry(store, input);
  }
});
```

This keeps the current SQLite ledger write behavior, canonical request hashing,
canonical plan JSON, transaction behavior, and `Date.now()` default timestamp
behavior unchanged.

There is no Postgres plan-ledger adapter in #39 because current plan ledger
writes use the existing SQLite ledger path. If plan persistence changes later,
that backend can implement the same port without changing the use case.

## Route Wiring

`src/http/routes.ts` remains the wiring location for now.

It should:

1. Continue constructing `clock: ClockPort = { nowUnixMs: () => Date.now() }`.
2. Continue choosing the existing candle read adapter based on `DATABASE_URL`.
3. Construct `GetCurrentRegimeUseCase` with `candleReadPort`, `clock`, and
   `engineVersion: process.env.npm_package_version ?? "0.0.0"`.
4. Construct `PlanLedgerWritePort` with `createSqlitePlanLedgerWriteAdapter(ledger)`.
5. Construct `GeneratePlanUseCase` with that port.
6. Pass use cases into the existing route handlers.

No composition-root folder is introduced in #39.

## Behavior Parity

This refactor must preserve:

- Regime current response shape.
- Regime classification output.
- CLMM suitability output.
- Freshness behavior.
- Closed-candle cutoff behavior.
- Minimum candle/read-limit behavior.
- Empty source-candle error behavior.
- Empty derived-candle error behavior.
- Plan response shape.
- Plan hash behavior.
- Canonical JSON behavior.
- Ledger write behavior for plan generation.
- Existing validation error codes and HTTP statuses.
- Existing unexpected-error behavior.

Any snapshot/hash/report-sensitive test changes would need an explicit
explanation, but the expected outcome is no deterministic output change.

## Testing

Add use-case unit tests with fakes instead of Fastify or real databases.

`GetCurrentRegimeUseCase` tests should use a fake `ClockPort` so direct 15m,
derived 1h, freshness cutoff, and derived cutoff behavior are deterministic.
They should cover:

- Direct 15m happy path.
- Derived 1h happy path.
- Source-candle empty path throws `RegimeCandlesNotFoundError` with the exact
  current message and detail payload.
- Derived-candle empty path throws `RegimeCandlesNotFoundError` with the exact
  current message and detail payload.
- Metadata preserves source timeframe, source candle count, derived timeframe,
  and aggregation version behavior.

`GeneratePlanUseCase` tests should cover:

- It calls `buildPlan(body, body.regimeState)` behavior by asserting the returned
  plan matches the normal engine output for the same request.
- It writes exactly `{ planRequest: body, planResponse: plan }` through
  `PlanLedgerWritePort`.
- It returns the same `PlanResponse` written through the port.

Handler/e2e coverage should prove `RegimeCandlesNotFoundError` maps to the exact
existing public 404 envelope:

- status `404`
- `schemaVersion: "1.0"`
- top-level error code `CANDLES_NOT_FOUND`
- exact error message
- exact detail array, including detail codes, paths, and messages

Existing e2e, snapshot, hash, and ledger tests remain parity protection.

## Required Validation

The eventual implementation PR must run:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:pg
npm run build
npm run boundaries
```

If any command is not run, the PR must explicitly say why.
