# Regime Engine — documentation.md

This document is updated continuously as milestones land so it reflects reality. 0

## What Regime Engine is

- A local-first **policy + analytics** microservice that produces deterministic trading plans.
- It classifies market regime (**UP / DOWN / CHOP**) with hysteresis, applies churn governance, and outputs target exposures (**SOL/USDC bps**) plus **REQUEST_\*** actions for an external execution service.
- It maintains an append-only **truth ledger** of plan requests, plans, and execution results, and can generate weekly reports from the ledger only.

## What Regime Engine is not

- It does **not** execute trades.
- It does **not** talk to Solana RPC, Orca, Jupiter, wallets, or receipts.
- It does **not** manage CLMM positions. It only emits `allowClmm` and `REQUEST_ENTER_CLMM` / `REQUEST_EXIT_CLMM` actions.

## Status

- Milestone 01: completed (2026-03-03)
- Milestone 02: completed (2026-03-03)
- Milestone 03: completed (2026-03-03)
- Milestone 04: completed (2026-03-03)
- Milestone 05: completed (2026-03-03)
- Milestone 06: completed (2026-03-03)
- Milestone 07: completed (2026-03-03)
- Milestone 08: completed (2026-03-03)
- Milestone 09: completed (2026-03-03)
- Milestone 10: completed (2026-03-03)
- Milestone 11: completed (2026-03-03)
- Milestone 12: completed (2026-03-03)
- Milestone 13: completed (2026-03-03)
- Milestone 14: completed (2026-03-03)
- Milestone 15: completed (2026-03-03)
- Milestone 16: completed (2026-03-03)

(Keep this list current as you check milestones off in `plan.md`.)

## Milestone Log

### Milestone 01 (completed)

Goal:

- Establish a runnable Node + TypeScript + Fastify service foundation with strict lint/typecheck/test/build tooling.

What changed:

- Added project scaffold and tooling: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `.eslintrc.cjs`, `.prettierrc.json`, `vitest.config.ts`, `.gitignore`.
- Added service entrypoints: `src/app.ts`, `src/server.ts`.
- Added smoke test for `GET /health`: `src/__tests__/smoke.test.ts`.
- Added placeholder harness command entrypoint: `scripts/harness.ts`.
- Added TypeScript path alias: `@/* -> src/*`.

Why:

- Milestone 1 requires a local runnable service with deterministic CI-style quality gates before contract and engine implementation.

Decisions:

- Fastify selected for HTTP server.
- `tsx watch` selected for local dev (`npm run dev`).
- `tsc -p tsconfig.build.json` selected for production build output.
- ESLint configured with TypeScript recommended rules and zero-warning gate.

Acceptance criteria:

- `npm install` succeeds on Node 22.13.0+.
- `npm run dev` starts service.
- `GET /health` returns 200 JSON.

Exact validation commands run:

- `npm run dev` (verified `curl -sSf http://127.0.0.1:8787/health` => `{"ok":true}`)
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 01 is complete and green.
- Milestone 02 is next.

How to run/demo now:

1. `npm install`
2. `npm run dev`
3. `curl -s http://127.0.0.1:8787/health`

Remaining risks:

- Contract, canonical hashing, and OpenAPI endpoints are not implemented yet (planned in Milestones 02-04).
- Canonical hashing and OpenAPI endpoints are not implemented yet (planned in Milestones 03-04).
- Harness is a placeholder until Milestone 16.

### Milestone 02 (completed)

Goal:

- Define explicit v1 request contracts with runtime validation and canonical error taxonomy.

What changed:

- Added explicit v1 contract types in `src/contract/v1/types.ts`.
- Added runtime validation for `POST /v1/plan` and `POST /v1/execution-result` in `src/contract/v1/validation.ts`.
- Added deterministic error taxonomy and conversion layer in `src/http/errors.ts`.
- Added contract fixture and error determinism tests in `src/contract/v1/__tests__/validation.test.ts`.

Why:

- Milestone 2 requires deterministic request validation and stable error payloads before wiring HTTP handlers.

Decisions:

- `schemaVersion` mismatch is surfaced as `UNSUPPORTED_SCHEMA_VERSION`.
- Validation details are sorted by path/code/message for deterministic ordering.
- Error detail messages are canonicalized (not raw Zod message text) for stability.

Acceptance criteria:

- Invalid bodies return deterministic validation errors with canonical codes.
- Contract fixtures validate in tests.

Exact validation commands run:

- `npm run test -- validation`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 02 is complete and green.
- Milestone 03 is next.

How to run/demo now:

1. `npm run test -- validation`
2. `npm run dev`
3. `curl -s http://127.0.0.1:8787/health`

Remaining risks:

- Resolved in Milestone 03: canonical JSON serialization and plan hashing.
- HTTP endpoints are still scaffold-only and not wired to validation yet (Milestone 04+).

### Milestone 03 (completed)

Goal:

- Implement deterministic canonical JSON serialization and stable SHA-256 `planHash`.

What changed:

- Added canonical JSON serializer in `src/contract/v1/canonical.ts`.
- Added hash helpers in `src/contract/v1/hash.ts`.
- Added determinism snapshot tests in `src/contract/v1/__tests__/canonicalHash.snapshot.test.ts`.
- Added generated snapshot artifact in `src/contract/v1/__tests__/__snapshots__/canonicalHash.snapshot.test.ts.snap`.

Why:

- Determinism is a blocker requirement and must be proven before plan building and persistence.

Decisions:

- Object keys are sorted lexicographically at every level.
- Array ordering is preserved as provided.
- Numeric normalization converts `-0` to `0` and rejects non-finite values.
- `planHash` uses `sha256(canonicalPlanJson)` exactly.

Acceptance criteria:

- Same plan => byte-identical canonical JSON.
- Same canonical JSON => same hash.
- Snapshot tests prove determinism.

Exact validation commands run:

- `npm run test -- canonicalHash`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 03 is complete and green.
- Milestone 04 is next.

How to run/demo now:

1. `npm run test -- canonicalHash`
2. `npm run test`

Remaining risks:

- Resolved in Milestone 04: OpenAPI and HTTP contract surface wiring.
- Ledger integration is not implemented yet (Milestone 05+).

### Milestone 04 (completed)

Goal:

- Expose the HTTP skeleton (`/health`, `/version`, `/v1/openapi.json`, stub `POST /v1/plan`, stub `POST /v1/execution-result`) with route contract tests.

What changed:

- Added route registration in `src/http/routes.ts` and wired it from `src/app.ts`.
- Added OpenAPI document builder in `src/http/openapi.ts`.
- Added stub handlers:
  - `src/http/handlers/plan.stub.ts`
  - `src/http/handlers/executionResult.stub.ts`
- Added route contract tests in `src/http/__tests__/routes.contract.test.ts`.

Why:

- Milestone 4 requires the externally visible API shape before introducing persistence and full planning logic.

Decisions:

- Stub handlers already run v1 validation to enforce contract behavior early.
- `/v1/plan` returns deterministic placeholder planning data and computed `planHash`.
- `/version` exposes `{name, version, commit?}` with commit gated on `COMMIT_SHA`.

Acceptance criteria:

- Endpoints exist and return correct shapes.
- OpenAPI endpoint is reachable and valid JSON.

Exact validation commands run:

- `npm run test -- routes.contract`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 04 is complete and green.
- Milestone 05 is next.

How to run/demo now:

1. `npm run dev`
2. `curl -s http://127.0.0.1:8787/health`
3. `curl -s http://127.0.0.1:8787/v1/openapi.json`

Remaining risks:

- Resolved in Milestone 05: ledger persistence wiring.
- Plan/execution endpoints are still stub outputs and not connected to engine state.

### Milestone 05 (completed)

Goal:

- Implement append-only SQLite truth ledger and persist rows from `/v1/plan` and `/v1/execution-result`.

What changed:

- Added ledger schema in `src/ledger/schema.sql`.
- Added store and transaction/query helpers in `src/ledger/store.ts`.
- Added ledger writer with link checks in `src/ledger/writer.ts`.
- Wired route handlers to ledger writes:
  - `src/http/handlers/plan.stub.ts`
  - `src/http/handlers/executionResult.stub.ts`
  - `src/http/routes.ts`
- Added ledger tests in `src/ledger/__tests__/ledger.test.ts`.

Why:

- Milestone 5 requires append-only persistence for requests, plans, and execution truth to support auditability.

Decisions:

- SQLite uses deterministic canonical JSON payload storage for request/plan/result bodies.
- Link checks (`planId`, `planHash`) are enforced in writer logic.
- Test default uses in-memory DB; local dev defaults to `tmp/ledger.sqlite`.

Acceptance criteria:

- Every `/v1/plan` writes request + plan rows.
- Every `/v1/execution-result` writes a linked result row.

Exact validation commands run:

- `npm run test -- ledger`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 05 is complete and green.
- Milestone 06 is next.

How to run/demo now:

1. `npm run dev`
2. `curl -s http://127.0.0.1:8787/health`
3. `POST /v1/plan` then `POST /v1/execution-result` to populate `tmp/ledger.sqlite`

Remaining risks:

- Engine regime/allocation/plan logic is still stubbed (Milestones 07-12).
- Weekly reporting and harness are not implemented yet.

### Milestone 06 (completed)

Goal:

- Build deterministic, pure feature extraction from candles.

What changed:

- Added candle utilities in `src/engine/features/candles.ts`.
- Added indicator computation in `src/engine/features/indicators.ts`:
  - realized vol short/long
  - vol ratio
  - trend strength proxy
  - compression proxy
- Added fixture tests and snapshots in `src/engine/features/__tests__/indicators.test.ts`.
- Added generated snapshot artifact in `src/engine/features/__tests__/__snapshots__/indicators.test.ts.snap`.

Why:

- Regime and allocation logic depend on deterministic features derived solely from request candles.

Decisions:

- Candle order is normalized by `unixMs`.
- Indicator outputs are rounded to fixed precision for deterministic downstream behavior.
- No external feeds are used; candles are the only source.

Acceptance criteria:

- Indicator outputs are deterministic and fixture-tested.

Exact validation commands run:

- `npm run test -- indicators`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 06 is complete and green.
- Milestone 07 is next.

How to run/demo now:

1. `npm run test -- indicators`
2. `npm run test`

Remaining risks:

- Regime hysteresis classifier is implemented; churn governor and allocation are pending (Milestones 08-10).
- Plan builder still returns stub regime decisions until Milestone 12 wiring.

### Milestone 07 (completed)

Goal:

- Implement UP/DOWN/CHOP classifier with hysteresis (`confirmBars`, enter/exit thresholds, `minHoldBars`) and reason codes.

What changed:

- Added regime types in `src/engine/regime/types.ts`.
- Added classifier logic in `src/engine/regime/classifier.ts`.
- Added fixture tests in `src/engine/regime/__tests__/regime.fixtures.test.ts`.

Why:

- Regime determination must be stable and explainable before churn and allocation policies are layered in.

Decisions:

- Classifier state is explicit (`current`, `barsInRegime`, `pending`, `pendingBars`) and fully passed in/out.
- Enter/exit thresholds and vol-ratio chop gating are separated to enforce hysteresis.
- Reason codes are emitted for stable, min-hold, pending-confirm, and switch-confirmed paths.

Acceptance criteria:

- Whipsaw fixtures do not flip regimes repeatedly.
- Reasons explain why regime was selected.

Exact validation commands run:

- `npm run test -- regime.fixtures`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 07 is complete and green.
- Milestone 08 is next.

How to run/demo now:

1. `npm run test -- regime.fixtures`
2. `npm run test`

Remaining risks:

- Resolved in Milestone 08: churn constraints and stand-down signaling.
- Allocation/vol-target/chop gate and full plan composition remain pending.

### Milestone 08 (completed)

Goal:

- Add churn governor logic for budget/cooldown/stand-down constraints and output deterministic stand-down actions.

What changed:

- Added churn governor in `src/engine/churn/governor.ts`.
- Added churn fixture tests in `src/engine/churn/__tests__/churn.test.ts`.

Why:

- Fakeout periods must halt churning behavior instead of repeatedly redeploying into adverse conditions.

Decisions:

- Any active cooldown, active stand-down window, budget exceedance, or strike trigger forces `STAND_DOWN`.
- Constraints include remaining budgets and stand-down timing for transparent policy output.
- Reasons/notes are deterministic and code-based.

Acceptance criteria:

- Fakeout sequences halt rather than churn.

Exact validation commands run:

- `npm run test -- churn`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 08 is complete and green.
- Milestone 09 is next.

How to run/demo now:

1. `npm run test -- churn`
2. `npm run test`

Remaining risks:

- Allocation policy is implemented; volatility overlay is pending (Milestone 10).
- CHOP gate and plan composition/wiring remain pending.

### Milestone 09 (completed)

Goal:

- Add deterministic regime-based allocation targets with turnover/delta caps.

What changed:

- Added cap math in `src/engine/allocation/caps.ts`.
- Added allocation policy in `src/engine/allocation/policy.ts`.
- Added fixture tests in `src/engine/allocation/__tests__/allocation.test.ts`.

Why:

- Regime signals need bounded exposure shifts to avoid abrupt full flips and reduce churn.

Decisions:

- Desired SOL target is selected by regime (`UP`/`DOWN`/`CHOP`).
- Applied step is capped by `min(maxDeltaExposureBpsPerDay, maxTurnoverPerDayBps)`.
- Targets always sum to 10,000 bps.

Acceptance criteria:

- Exposure changes are bounded and smooth.

Exact validation commands run:

- `npm run test -- allocation`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 09 is complete and green.
- Milestone 10 is next.

How to run/demo now:

1. `npm run test -- allocation`
2. `npm run test`

Remaining risks:

- Resolved in Milestone 10: volatility targeting overlay.
- CHOP gate and plan builder wiring remain pending.

### Milestone 10 (completed)

Goal:

- Add volatility targeting overlay to scale allocation aggressiveness deterministically.

What changed:

- Added vol-target overlay logic in `src/engine/allocation/volTarget.ts`.
- Added tests in `src/engine/allocation/__tests__/volTarget.test.ts`.

Why:

- Regime targets need risk-adaptive scaling so high-vol environments de-risk and low-vol UP regimes can take more tilt.

Decisions:

- Overlay scales tilt around neutral 5,000 bps.
- High `volRatio` de-risks (`scale < 1`), low `volRatio` in UP increases tilt (`scale > 1`).
- Cap constraints are reapplied after scaling.

Acceptance criteria:

- Vol spikes reduce exposure deterministically.

Exact validation commands run:

- `npm run test -- volTarget`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 10 is complete and green.
- Milestone 11 is next.

How to run/demo now:

1. `npm run test -- volTarget`
2. `npm run test`

Remaining risks:

- Resolved in Milestone 11: CHOP-only CLMM gate.
- Plan builder and full endpoint wiring remain pending.

### Milestone 11 (completed)

Goal:

- Implement CHOP gate so `allowClmm` is true only in CHOP and false during stand-down.

What changed:

- Added CHOP gate module `src/engine/chopGate.ts`.
- Added tests `src/engine/__tests__/chopGate.test.ts`.

Why:

- CLMM permission must be explicit and independent from other policy logic.

Decisions:

- Stand-down always overrides regime and forces `allowClmm=false`.
- Non-CHOP regimes always force `allowClmm=false`.
- Gate emits deterministic reason codes.

Acceptance criteria:

- Fixtures prove `allowClmm` toggles only in CHOP.

Exact validation commands run:

- `npm run test -- chopGate`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 11 is complete and green.
- Milestone 12 is next.

How to run/demo now:

1. `npm run test -- chopGate`
2. `npm run test`

Remaining risks:

- Resolved in Milestone 12: deterministic plan builder composition + snapshots.
- HTTP `/v1/plan` still returns stub regime/allocation outputs.

### Milestone 12 (completed)

Goal:

- Build pure deterministic plan orchestration pipeline.

What changed:

- Added plan builder in `src/engine/plan/buildPlan.ts`.
- Added deterministic plan snapshot tests in `src/engine/plan/__tests__/planDeterminism.snapshot.test.ts`.
- Added generated snapshot artifact in `src/engine/plan/__tests__/__snapshots__/planDeterminism.snapshot.test.ts.snap`.

Why:

- The service needs a single deterministic policy kernel that produces final plan outputs from request inputs.

Decisions:

- Pipeline order: features -> regime -> churn -> allocation -> vol-target -> chop gate -> actions/constraints/reasons/telemetry.
- `planId` is deterministic from request canonical hash (`plan-<prefix>`).
- `planHash` is computed from canonical JSON of the full plan payload (excluding `planHash`).

Acceptance criteria:

- Same request => byte-identical plan JSON + same planHash.
- Snapshot tests confirm determinism.

Exact validation commands run:

- `npm run test -- planDeterminism`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 12 is complete and green.
- Milestone 13 is next.

How to run/demo now:

1. `npm run test -- planDeterminism`
2. `npm run test`

Remaining risks:

- Resolved in Milestone 13: `/v1/plan` now uses real builder + ledger path.
- `/v1/execution-result` canonical mismatch/missing behavior hardening remains for Milestone 14.

### Milestone 13 (completed)

Goal:

- Wire `/v1/plan` endpoint to real plan composition and ledger writes.

What changed:

- Added real plan handler `src/http/handlers/plan.ts`.
- Updated route wiring in `src/http/routes.ts` to use the real handler.
- Added end-to-end test `src/http/__tests__/plan.e2e.test.ts`.
- Updated route contract expectations in `src/http/__tests__/routes.contract.test.ts`.

Why:

- Milestone 13 requires the API path to reflect actual policy computation, not placeholder output.

Decisions:

- Handler flow is: validate -> buildPlan -> write ledger request/plan rows -> return plan.
- Plan hash is revalidated in e2e test by recomputing from response payload.

Acceptance criteria:

- `POST /v1/plan` writes ledger rows and returns plan response.

Exact validation commands run:

- `npm run test -- plan.e2e`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 13 is complete and green.
- Milestone 14 is next.

How to run/demo now:

1. `npm run dev`
2. `POST /v1/plan` with a valid fixture body
3. Inspect `tmp/ledger.sqlite` contents via tests or SQLite tooling

Remaining risks:

- Resolved in Milestone 14: `/v1/execution-result` mismatch/missing canonical behavior + idempotency.
- Weekly reporting/harness are still pending.

### Milestone 14 (completed)

Goal:

- Wire `/v1/execution-result` with plan linkage checks, canonical errors, and idempotency safeguards.

What changed:

- Added real execution-result handler `src/http/handlers/executionResult.ts`.
- Updated route wiring in `src/http/routes.ts`.
- Extended ledger writer idempotency/conflict behavior in `src/ledger/writer.ts`.
- Added e2e coverage in `src/http/__tests__/executionResult.e2e.test.ts`.

Why:

- Execution truth must link to known plans and remain append-only without duplicate/replay corruption.

Decisions:

- Missing `planId` -> `PLAN_NOT_FOUND` (404).
- `planId` with mismatched hash -> `PLAN_HASH_MISMATCH` (409).
- Exact replay of same execution payload -> 200 with `idempotent: true`.
- Replay with different payload for same `(planId, planHash)` -> `EXECUTION_RESULT_CONFLICT` (409).

Acceptance criteria:

- Reject mismatched hashes.
- Accept valid results and store them.

Exact validation commands run:

- `npm run test -- executionResult.e2e`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 14 is complete and green.
- Milestone 15 is next.

How to run/demo now:

1. `npm run dev`
2. `POST /v1/plan` once
3. `POST /v1/execution-result` with returned `(planId, planHash)`

Remaining risks:

- Resolved in Milestone 15: weekly report endpoint + baselines.
- Harness + final docs hardening are pending (Milestone 16).

### Milestone 15 (completed)

Goal:

- Implement ledger-only weekly reporting with baselines and expose it at `GET /v1/report/weekly`.

What changed:

- Added baseline calculations in `src/report/baselines.ts`.
- Added weekly report generator in `src/report/weekly.ts`.
- Added report handler in `src/http/handlers/report.ts`.
- Wired weekly route in `src/http/routes.ts`.
- Added deterministic report tests in `src/report/__tests__/weeklyReport.snapshot.test.ts`.
- Added generated snapshot artifact in `src/report/__tests__/__snapshots__/weeklyReport.snapshot.test.ts.snap`.

Why:

- Reporting must be reproducible from persisted truth only, independent of external services.

Decisions:

- Report reads `plan_requests`, `plans`, and `execution_results` only.
- Regime/churn/execution metrics are computed from stored canonical JSON rows.
- Baselines use candle closes only: SOL HODL, SOL DCA, USDC carry.

Acceptance criteria:

- Same ledger fixtures => byte-identical report output.
- Endpoint returns report payload.

Exact validation commands run:

- `npm run test -- weeklyReport`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Current status:

- Milestone 15 is complete and green.
- Milestone 16 is next.

How to run/demo now:

1. `npm run dev`
2. Populate ledger via `/v1/plan` + `/v1/execution-result`
3. `GET /v1/report/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD`

Remaining risks:

- Resolved in Milestone 16: harness CLI + fixture/demo/docs hardening.
- Final end-to-end sweep completed.

### Milestone 16 (completed)

Goal:

- Deliver runnable local harness/fixtures and finalize operator-facing docs/demo.

What changed:

- Replaced harness placeholder with real runner in `scripts/harness.ts`.
- Added deterministic demo fixtures:
  - `fixtures/demo/01-uptrend.json`
  - `fixtures/demo/02-chop.json`
  - `fixtures/demo/03-downtrend.json`
  - `fixtures/demo/04-whipsaw.json`
- Updated README quickstart/demo instructions.
- Completed final validation sweep and updated milestone/checklist state in `plan.md`.

Why:

- Milestone 16 requires a one-command local end-to-end path from fixtures to weekly report artifacts.

Decisions:

- Harness runs in-process (`app.inject`) for deterministic local behavior and no external dependencies.
- Harness writes outputs to:
  - `tmp/reports/weekly-<from>-<to>.md`
  - `tmp/reports/weekly-<from>-<to>.json`
- Harness resets `tmp/harness-ledger.sqlite` on each run for reproducible output.

Acceptance criteria:

- One command produces weekly report artifacts from fixtures.
- Final validation sweep passes.

Exact validation commands run:

- `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
- Final sweep:
  - `npm run dev` + `/health`
  - `npm run build`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
  - `/v1/openapi.json` JSON validation

Current status:

- Milestones 01-16 are complete.
- Core completion criteria are satisfied.

How to run/demo now:

1. `npm install`
2. `npm run dev`
3. In a second terminal: `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
4. Inspect `tmp/reports/weekly-2026-01-01-2026-01-31.md` and `.json`

Remaining risks:

- `jq` is not installed in this environment; JSON validation used Node parser fallback in final sweep.

## Local setup

- Node 22.13.0+ on macOS.
- Install deps: `npm install`
- Start service: `npm run dev`
- Health check: `http://localhost:8787/health` (or configured port)
- OpenAPI: `http://localhost:8787/v1/openapi.json`

## Verification commands

- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Tests: `npm run test`
- Build: `npm run build`

## One-command demo

1) `npm run dev`
2) In another terminal:
   - `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
3) Inspect:
   - `tmp/reports/weekly-*.md`
   - `tmp/reports/weekly-*.json`

## HTTP API overview

### `GET /health`

Returns a small JSON payload confirming the server is running.

### `GET /version`

Returns build metadata (service name/version; optional commit hash if injected at build time).

### `GET /v1/openapi.json`

Returns the OpenAPI document for all v1 endpoints.

### `POST /v1/plan`

Input: candles + portfolio state + autopilot counters + config.

Output: deterministic PlanResponse:

- `planId`, `planHash`
- `regime`: `UP | DOWN | CHOP`
- `targets`: `{ solBps, usdcBps, allowClmm }`
- `actions[]`: `REQUEST_*` plus optionally `HOLD`/`STAND_DOWN`
- `constraints`: cooldowns/budgets/notes
- `reasons[]`: canonical reason codes with severity
- `telemetry`: computed indicators for inspection

### `POST /v1/execution-result`

Input: `(planId, planHash)` + per-action statuses + costs + `portfolioAfter`.

Behavior:

- Reject if `planId` not found or `planHash` mismatch.
- Persist a linked execution result row.
- Execution results are the authoritative source of realized costs and portfolio-after values.

### `GET /v1/report/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD`

Returns weekly report output built from ledger only:

- markdown report + JSON summary
- regime distribution
- churn / stand-down stats
- execution success + costs (as reported by Autopilot)
- baselines: SOL HODL, SOL DCA, USDC carry

## How Regime Engine interacts with the CLMM Autopilot microservice

### Contract boundary

- Regime Engine produces **policy intent**:
  - “what should be attempted next” (REQUEST_* actions)
  - “what is allowed” (allowClmm)
  - “how aggressively” (targets + caps + constraints)
- Autopilot produces **execution truth**:
  - what actually executed
  - costs and slippage
  - portfolioAfter

### Typical loop

1) Autopilot gathers candles + its own internal counters/cooldowns and calls `POST /v1/plan`.
2) Regime Engine returns a Plan (deterministic, hashed).
3) Autopilot decides whether to execute and then posts `POST /v1/execution-result`.
4) Regime Engine logs results and reports on outcomes.

## Repo structure overview (target)

- `src/contract/v1/*`
  - request/response types, validation, canonical JSON, hashing
- `src/engine/*`
  - `features/*` candle parsing + indicators (pure)
  - `regime/*` regime classifier + hysteresis (pure)
  - `churn/*` churn governor (pure)
  - `allocation/*` partial shifts + caps + vol targeting (pure)
  - `plan/*` plan builder (pure)
- `src/http/*`
  - routes, handlers, OpenAPI, error taxonomy
- `src/ledger/*`
  - sqlite schema, store, writer
- `src/report/*`
  - baselines, weekly report generator (ledger-only)
- `scripts/*`
  - harness to drive fixtures → plan → simulated results → report
- `fixtures/*`
  - deterministic candle sequences + autopilotState progressions

## Determinism rules

- Canonical JSON serialization is required for:
  - planHash
  - snapshot tests
  - stable ledger-derived reporting artifacts
- Stable ordering requirements:
  - object keys are sorted
  - arrays are either preserved as-is from input or explicitly sorted (document which)
- Any detected non-determinism is a blocker.

## Baselines (for weekly reports)

- SOL HODL: hold SOL units constant across the window.
- SOL DCA: buy SOL on a fixed schedule (defined in config).
- USDC carry: apply a configurable APR on USDC balance (defined in config).
  Baselines must be computed from candle close prices only.

## Troubleshooting

- Port already in use: kill the prior process or change `PORT`.
- Hash mismatch on `/v1/execution-result`: Autopilot posted a mutated plan or stale planHash; it must post the exact `(planId, planHash)` returned by `/v1/plan`.
- Report is empty: no ledger rows in the requested window, or execution results were never posted.
- Regime flaps in fixtures: hysteresis thresholds too tight or `confirmBars/minHoldBars` misconfigured; fix policy defaults and lock with fixtures + snapshot tests.
