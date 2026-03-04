# Regime Engine — plan.md (Long-Horizon Implementation Plan)

This document is the complete execution plan, risk register, demo script, and architecture summary for the **Regime Engine microservice**. Implement milestone-by-milestone, validating each step with lint, typecheck, tests, and deterministic snapshots. Patterned after the blueprint structure. 0

Guiding principles:

- Determinism over flash: stable ordering, canonical serialization, stable hashes.
- Hard microservice boundary: policy here, execution in Autopilot service.
- Demo-ready throughout: always keep runnable fixtures and a working harness.

---

## Verification checklist (kept current)

Core commands (run after every milestone):

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run build`

Final validation sweep (exit criteria):

- [x] `npm run dev` (service starts; /health ok)
- [x] `npm run build`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test`
- [x] `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
- [x] `curl -s http://localhost:<PORT>/v1/openapi.json | jq . >/dev/null`

---

## Milestones (executed in order)

Each milestone includes scope, key files/modules, acceptance criteria, and verification commands.

### Milestone 01 — Repo scaffold + tooling foundation

Status: completed (2026-03-03)

Goal:

- Establish a runnable local Fastify + TypeScript service foundation with strict tooling.

Scope:

- Initialize Node + TypeScript service (Fastify recommended).
- Add Vitest, ESLint, Prettier, strict TS settings.
- Establish folder structure and path aliases.

Key files/modules:

- `package.json`
- `tsconfig.json`
- `src/server.ts`, `src/app.ts`
- `src/__tests__/smoke.test.ts`

Acceptance criteria:

- `npm install` succeeds on Node LTS.
- `npm run dev` starts service.
- `GET /health` returns 200 JSON.

Verification commands:

- `npm run dev`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run dev` (validated `/health` response: `{"ok":true}`)
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 02 — v1 Contract types + schema validation + error taxonomy

Status: completed (2026-03-03)

Goal:

- Define explicit v1 request contracts with runtime validation and deterministic error taxonomy.

Scope:

- Define the v1 contract as TypeScript types + runtime validation:
  - POST `/v1/plan`
  - POST `/v1/execution-result`
- Define canonical error codes and stable error response shape.

Key files/modules:

- `src/contract/v1/types.ts`
- `src/contract/v1/validation.ts`
- `src/http/errors.ts`
- `src/contract/v1/__tests__/validation.test.ts`

Acceptance criteria:

- Invalid bodies return deterministic validation errors with canonical codes.
- Contract fixtures validate in tests.

Verification commands:

- `npm run test -- validation`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- validation`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 03 — Canonical JSON + planHash

Status: completed (2026-03-03)

Goal:

- Produce deterministic canonical JSON serialization and stable SHA-256 plan hashes.

Scope:

- Implement canonical serialization (stable key order, stable numeric formatting).
- Implement `planHash = sha256(canonicalPlanJson)`.

Key files/modules:

- `src/contract/v1/canonical.ts`
- `src/contract/v1/hash.ts`
- `src/contract/v1/__tests__/canonicalHash.snapshot.test.ts`

Acceptance criteria:

- Same plan => byte-identical canonical JSON.
- Same canonical JSON => same hash.
- Snapshot test proves determinism.

Verification commands:

- `npm run test -- canonicalHash`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- canonicalHash`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 04 — HTTP API skeleton + OpenAPI

Status: completed (2026-03-03)

Goal:

- Expose the initial v1 HTTP contract surface and OpenAPI document with deterministic stub responses.

Scope:

- Implement endpoints:
  - `GET /health`
  - `GET /version`
  - `GET /v1/openapi.json`
  - `POST /v1/plan` (stub plan)
  - `POST /v1/execution-result` (stub accept)
- Serve OpenAPI JSON (static or generated).

Key files/modules:

- `src/http/routes.ts`
- `src/http/openapi.ts`
- `src/http/handlers/plan.stub.ts`
- `src/http/handlers/executionResult.stub.ts`
- `src/http/__tests__/routes.contract.test.ts`

Acceptance criteria:

- Endpoints exist and return correct shapes.
- OpenAPI is reachable and valid JSON.

Verification commands:

- `npm run test -- routes.contract`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- routes.contract`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 05 — Ledger v1 (append-only truth store)

Status: completed (2026-03-03)

Goal:

- Add an append-only SQLite ledger with transactional writes and wire API stubs to persist truth records.

Scope:

- Implement append-only ledger (SQLite preferred).
- Persist:
  - `plan_requests`
  - `plans`
  - `execution_results`
- Add schema migrations (v1) and safe transaction wrapper.

Key files/modules:

- `src/ledger/schema.sql`
- `src/ledger/store.ts`
- `src/ledger/writer.ts`
- `src/ledger/__tests__/ledger.test.ts`

Acceptance criteria:

- Every `/v1/plan` writes request + plan rows.
- Every `/v1/execution-result` writes a linked result row.

Verification commands:

- `npm run test -- ledger`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- ledger`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 06 — Feature extraction from candles (pure)

Status: completed (2026-03-03)

Goal:

- Implement deterministic candle-derived indicators (vol short/long/ratio, trend proxy, compression proxy).

Scope:

- Implement deterministic indicators:
  - realized vol short/long + ratio
  - trend proxy (e.g., MA slope or regression slope)
  - compression proxy (BB width normalized)
- No external price feeds; only candles from request.

Key files/modules:

- `src/engine/features/candles.ts`
- `src/engine/features/indicators.ts`
- `src/engine/features/__tests__/indicators.test.ts`

Acceptance criteria:

- Indicator outputs are deterministic and fixture-tested.

Verification commands:

- `npm run test -- indicators`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- indicators`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 07 — Regime classifier (UP/DOWN/CHOP) + hysteresis

Status: completed (2026-03-03)

Goal:

- Build a hysteresis-aware regime classifier with confirmation and hold constraints to suppress whipsaw flips.

Scope:

- Implement regime logic with hysteresis:
  - `confirmBars`
  - separate enter/exit thresholds
  - `minHoldBars` after switching
- Emit reason codes and telemetry.

Key files/modules:

- `src/engine/regime/types.ts`
- `src/engine/regime/classifier.ts`
- `src/engine/regime/__tests__/regime.fixtures.test.ts`

Acceptance criteria:

- Whipsaw fixtures do not flip regimes repeatedly.
- Reasons explain why regime selected.

Verification commands:

- `npm run test -- regime.fixtures`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- regime.fixtures`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 08 — Churn governor (budgets + cooldowns + stand-down)

Status: completed (2026-03-03)

Goal:

- Enforce churn budgets/cooldowns/two-strike stand-down with deterministic constraints output and stand-down signaling.

Scope:

- Use `autopilotState` from request:
  - stopouts24h, redeploys24h, cooldown timers
- Enforce:
  - max stopouts / redeploys per window
  - cooldown after stopout
  - two-strike stand-down
- Output: constraints + `STAND_DOWN` action when exceeded.

Key files/modules:

- `src/engine/churn/governor.ts`
- `src/engine/churn/__tests__/churn.test.ts`

Acceptance criteria:

- Fakeout sequences halt rather than churn.

Verification commands:

- `npm run test -- churn`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- churn`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 09 — Allocation policy (partial shifts + caps)

Status: completed (2026-03-03)

Goal:

- Produce regime-based deterministic allocation targets with bounded exposure-change caps.

Scope:

- Deterministic target exposure outputs:
  - UP: SOL heavy (not 100% by default)
  - DOWN: USDC heavy (optionally some SOL)
  - CHOP: neutral-ish
- Enforce caps:
  - maxDeltaExposureBpsPerDay
  - maxTurnoverPerDayBps

Key files/modules:

- `src/engine/allocation/policy.ts`
- `src/engine/allocation/caps.ts`
- `src/engine/allocation/__tests__/allocation.test.ts`

Acceptance criteria:

- Exposure changes are bounded and smooth.

Verification commands:

- `npm run test -- allocation`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- allocation`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 10 — Volatility targeting (overlay scaling)

Status: completed (2026-03-03)

Goal:

- Add a deterministic volatility overlay that de-risks on high vol and increases UP tilt on low vol, while preserving cap constraints.

Scope:

- Scale aggressiveness using realized vol:
  - vol high => de-risk (lower SOL target)
  - vol low => allow more SOL tilt in UP
- Ensure explicit caps remain in effect.

Key files/modules:

- `src/engine/allocation/volTarget.ts`
- `src/engine/allocation/__tests__/volTarget.test.ts`

Acceptance criteria:

- Vol spikes reduce exposure deterministically.

Verification commands:

- `npm run test -- volTarget`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- volTarget`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 11 — CHOP gate output (allowClmm only in CHOP)

Status: completed (2026-03-03)

Goal:

- Emit deterministic CHOP gate output where `allowClmm` is only true in CHOP and never during stand-down.

Scope:

- Regime Engine must output:
  - `targets.allowClmm = true` only if regime == CHOP AND not stand-down.
- In UP/DOWN: allowClmm must be false.

Key files/modules:

- `src/engine/chopGate.ts`
- `src/engine/__tests__/chopGate.test.ts`

Acceptance criteria:

- Fixtures prove allowClmm toggles only in CHOP.

Verification commands:

- `npm run test -- chopGate`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- chopGate`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 12 — Plan builder (pure, deterministic)

Status: completed (2026-03-03)

Goal:

- Compose pure deterministic plan pipeline from validation inputs through features/regime/churn/allocation/chop gate into final plan object.

Scope:

- Compose pipeline:
  - validate -> features -> regime -> churn -> allocation -> chop gate -> plan object
- Produce:
  - `planId` (UUIDv7 recommended)
  - `planHash` (canonical)
  - `reasons[]`, `telemetry{}` and `actions[]` (REQUEST_* only + HOLD/STAND_DOWN)

Key files/modules:

- `src/engine/plan/buildPlan.ts`
- `src/engine/plan/__tests__/planDeterminism.snapshot.test.ts`

Acceptance criteria:

- Same request => byte-identical plan JSON + same planHash.
- Snapshot tests confirm determinism on fixtures.

Verification commands:

- `npm run test -- planDeterminism`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- planDeterminism`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 13 — Wire /v1/plan to builder + ledger

Status: completed (2026-03-03)

Goal:

- Connect `/v1/plan` to the real deterministic plan builder and ledger persistence path.

Scope:

- Implement `/v1/plan` handler:
  - validate
  - buildPlan
  - persist request + plan
  - return response
- Add contract tests and one end-to-end test.

Key files/modules:

- `src/http/handlers/plan.ts`
- `src/http/__tests__/plan.e2e.test.ts`

Acceptance criteria:

- POST /v1/plan writes ledger rows and returns plan.

Verification commands:

- `npm run test -- plan.e2e`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- plan.e2e`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 14 — Wire /v1/execution-result + idempotency checks

Status: completed (2026-03-03)

Goal:

- Wire `/v1/execution-result` to linked ledger writes with canonical mismatch/missing handling and idempotent replay behavior.

Scope:

- Validate `(planId, planHash)` exists and matches.
- Persist execution results + costs + portfolioAfter.
- Return canonical errors for mismatch/missing.

Key files/modules:

- `src/http/handlers/executionResult.ts`
- `src/http/__tests__/executionResult.e2e.test.ts`

Acceptance criteria:

- Reject mismatched hashes.
- Accept valid results and store them.

Verification commands:

- `npm run test -- executionResult.e2e`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- executionResult.e2e`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 15 — Baselines + weekly report (ledger-only)

Status: completed (2026-03-03)

Goal:

- Generate deterministic ledger-only weekly reports with baseline comparisons and expose them via HTTP.

Scope:

- Implement baseline comparators (using candle closes only):
  - SOL HODL
  - SOL DCA (schedule defined in config)
  - USDC carry (APR defined in config)
- Weekly report generator:
  - regime distribution
  - churn outcomes
  - execution success + costs
  - baseline comparisons
- Add endpoint: `GET /v1/report/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD`

Key files/modules:

- `src/report/baselines.ts`
- `src/report/weekly.ts`
- `src/http/handlers/report.ts`
- `src/report/__tests__/weeklyReport.snapshot.test.ts`

Acceptance criteria:

- Same ledger fixtures => byte-identical report output (snapshot).
- Endpoint returns report.

Verification commands:

- `npm run test -- weeklyReport`
- `npm run lint && npm run typecheck && npm run test && npm run build`

Validation run (2026-03-03):

- `npm run test -- weeklyReport`
- `npm run lint && npm run typecheck && npm run test && npm run build`

---

### Milestone 16 — Local harness + fixtures + docs hardening

Status: completed (2026-03-03)

Goal:

- Provide a runnable fixture harness and harden operator documentation/demo flow for end-to-end local execution.

Scope:

- CLI harness:
  - loads fixtures
  - calls /v1/plan repeatedly
  - posts simulated /v1/execution-result
  - generates weekly report
- Provide fixtures:
  - uptrend, downtrend, chop, whipsaw
  - example autopilotState sequences (stopouts/redeploys/cooldowns)
- Update docs:
  - README quickstart
  - contract notes
  - demo script

Key files/modules:

- `scripts/harness.ts`
- `fixtures/*`
- `README.md`
- `documentation.md`, `architecture.md`

Acceptance criteria:

- One command produces a weekly report from fixtures.
- Final validation sweep passes.

Verification commands:

- `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
- Final validation sweep

Validation run (2026-03-03):

- `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
- Final validation sweep:
  - `npm run dev` with `/health` check
  - `npm run build`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
  - `/v1/openapi.json` JSON validity check (used Node parser because `jq` is unavailable in environment)

---

## Implementation Notes

- 2026-03-03 (M01): interpreted “path aliases” as compile-time TypeScript aliasing only (`@/* -> src/*`) to keep runtime startup simple and deterministic.
- 2026-03-03 (M02): canonical validation detail messages are generated in `src/http/errors.ts` rather than using raw Zod messages to guarantee stable error payloads across runs.
- 2026-03-03 (M03): canonical serializer sorts object keys recursively, preserves array order, normalizes `-0` to `0`, and rejects non-finite numbers.
- 2026-03-03 (M04): `/v1/plan` and `/v1/execution-result` are wired as validation-aware stubs first to preserve incremental delivery before ledger + engine integration milestones.
- 2026-03-03 (M05): execution-result linkage integrity is enforced in `writer.ts` (planId/planHash checks) instead of a DB foreign key, keeping schema simple while preserving deterministic error behavior.
- 2026-03-03 (M06): indicator outputs are rounded to fixed precision to avoid floating-point noise in snapshots and downstream regime decisions.
- 2026-03-03 (M07): classifier state tracks pending target regime + confirmation bars separately from `barsInRegime`, allowing deterministic hysteresis without hidden mutable globals.
- 2026-03-03 (M08): cooldown, budget exhaustion, and two-strike triggers all funnel into explicit `STAND_DOWN` action output to halt fakeout churn deterministically.
- 2026-03-03 (M09): exposure shift per cycle is capped by `min(maxDeltaExposureBpsPerDay, maxTurnoverPerDayBps)` for deterministic bounded transitions.
- 2026-03-03 (M10): volatility overlay scales SOL tilt around neutral `5000` bps, then reapplies exposure caps to guarantee policy limits remain authoritative.
- 2026-03-03 (M11): CHOP gate is isolated in `src/engine/chopGate.ts` so `allowClmm` logic remains explicit, testable, and independent from allocation math.
- 2026-03-03 (M12): `planId` is derived from request canonical hash (`plan-<16 hex>`) to keep plan outputs byte-identical for identical inputs.
- 2026-03-03 (M13): `/v1/plan` now uses `buildPlan` end-to-end; prior stub handler is retained only as legacy scaffolding and is no longer routed.
- 2026-03-03 (M14): `/v1/execution-result` treats exact replays as idempotent success and conflicting replays as `EXECUTION_RESULT_CONFLICT` to preserve append-only truth.
- 2026-03-03 (M15): weekly report reads only persisted ledger rows (`plan_requests`, `plans`, `execution_results`) and does not depend on live engine recomputation.
- 2026-03-03 (M16): harness executes in-process HTTP calls (`app.inject`) against fixture steps to keep local demos reproducible without external infrastructure.

---

## Risk register (top technical risks + mitigations)

1) Regime flip-flop (whipsaw) causing churn

- Mitigation: hysteresis + confirmBars + minHoldBars + churn governor stand-down.

2) Hidden non-determinism (key order, float formatting)

- Mitigation: canonical serializer + snapshot tests + explicit sorts for arrays/maps.

3) Contract drift between microservices

- Mitigation: schemaVersion + OpenAPI + fixture-based contract tests.

4) Ledger integrity under concurrent requests

- Mitigation: SQLite transactions, deterministic writes, indexed uniqueness where appropriate.

5) Misleading reporting due to external execution authority

- Mitigation: Autopilot is authoritative for portfolioAfter and costs; report separates PLAN vs EXECUTION outcomes.

---

## Demo script (2–3 minutes)

1) Start: `npm run dev`
2) Health check: `GET /health`
3) POST `/v1/plan` with CHOP fixture:
   - expect `regime=CHOP`, `allowClmm=true`, targets near neutral
4) POST `/v1/plan` with DOWN fixture:
   - expect `regime=DOWN`, `allowClmm=false`, targets shift USDC-heavy
5) POST simulated `/v1/execution-result` for both
6) GET `/v1/report/weekly?from=...&to=...`
   - show regime distribution, churn/stand-down, costs, baseline comparisons

---

## Architecture overview (summary)

- Pure engine: indicators -> regime -> churn -> allocation -> chop gate -> plan.
- Deterministic contract: canonical JSON + planHash.
- Append-only ledger: requests, plans, results; reporting reads ledger only.
- Microservice boundary: Regime Engine emits REQUEST_*; Autopilot executes and posts results.
