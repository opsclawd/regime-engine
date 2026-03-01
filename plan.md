# Regime Engine — plan.md (Long-Horizon Implementation Plan)

This document is the complete execution plan, risk register, demo script, and architecture summary for the **Regime Engine microservice**. Implement milestone-by-milestone, validating each step with lint, typecheck, tests, and deterministic snapshots. Patterned after the blueprint structure. 0

Guiding principles:

- Determinism over flash: stable ordering, canonical serialization, stable hashes.
- Hard microservice boundary: policy here, execution in Autopilot service.
- Demo-ready throughout: always keep runnable fixtures and a working harness.

---

## Verification checklist (kept current)

Core commands (run after every milestone):

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`

Final validation sweep (exit criteria):

- [ ] `npm run dev` (service starts; /health ok)
- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
- [ ] `curl -s http://localhost:<PORT>/v1/openapi.json | jq . >/dev/null`

---

## Milestones (executed in order)

Each milestone includes scope, key files/modules, acceptance criteria, and verification commands.

### Milestone 01 — Repo scaffold + tooling foundation

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

---

### Milestone 02 — v1 Contract types + schema validation + error taxonomy

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

---

### Milestone 03 — Canonical JSON + planHash

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

---

### Milestone 04 — HTTP API skeleton + OpenAPI

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

---

### Milestone 05 — Ledger v1 (append-only truth store)

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

---

### Milestone 06 — Feature extraction from candles (pure)

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

---

### Milestone 07 — Regime classifier (UP/DOWN/CHOP) + hysteresis

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

---

### Milestone 08 — Churn governor (budgets + cooldowns + stand-down)

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

---

### Milestone 09 — Allocation policy (partial shifts + caps)

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

---

### Milestone 10 — Volatility targeting (overlay scaling)

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

---

### Milestone 11 — CHOP gate output (allowClmm only in CHOP)

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

---

### Milestone 12 — Plan builder (pure, deterministic)

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

---

### Milestone 13 — Wire /v1/plan to builder + ledger

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

---

### Milestone 14 — Wire /v1/execution-result + idempotency checks

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

---

### Milestone 15 — Baselines + weekly report (ledger-only)

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

---

### Milestone 16 — Local harness + fixtures + docs hardening

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
