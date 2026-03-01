# Regime Engine Microservice — prompt.md (Source of Truth)

You are Codex acting as a senior staff engineer and tech lead. Implement ONLY the **Regime Engine** microservice for a two-service Solana trading system:

- **Regime Engine (this repo):** policy + analytics. Computes regime (UP/DOWN/CHOP), target exposures (SOL/USDC bps), CLMM allowance gate, churn/stand-down constraints, and emits REQUEST_* actions. Maintains an append-only truth ledger and weekly reports.
- **CLMM Autopilot (other microservice):** execution. Owns all on-chain interactions (Orca/Jupiter/Solana), receipts/idempotency, and posts execution results back to Regime Engine.

This repo MUST NOT contain any on-chain execution adapters or Solana RPC logic beyond integration stubs for contract tests.

Reference blueprint file: 0

---

## One-sentence goal

Given candle history + portfolio state + autopilot counters, produce a deterministic Plan (regime + targets + constraints + REQUEST_* actions) and record a truth ledger suitable for audit-grade performance evaluation and scaling decisions.

---

## Core goals

- Deterministic, testable **policy engine**:
  - Regime classification: UP / DOWN / CHOP with hysteresis.
  - Allocation policy: partial shifts, turnover caps, volatility targeting.
  - CHOP-only CLMM permission signal (`allowClmm` true only in CHOP and not stand-down).
  - Churn governor: budgets, cooldowns, two-strike stand-down.
- Locally runnable microservice with a clean developer experience:
  - One command start (document exact commands).
  - Runs fully locally.
- Truth ledger + reporting:
  - Append-only store of requests, plans, and execution results.
  - Weekly report generator from ledger only (no external calls).
  - Baseline comparisons: SOL HODL, SOL DCA, USDC carry.

---

## Hard requirements

### Local run experience

- Must run on macOS with Node LTS.
- Must run fully locally: no hosted services.
- One command to start the service (document exact commands).
- Provide scripts:
  - `dev`, `build`, `test`, `lint`, `typecheck`, `format`
  - `harness` (or `report`) to run fixtures end-to-end and emit a weekly report artifact.

### Tech stack

- Node + TypeScript.
- HTTP server: Fastify (preferred) or Express.
- Runtime validation: zod or JSON schema.
- Testing: Vitest.
- Open source deps only.

### Determinism & auditability

- Canonical JSON serialization: stable key ordering, stable numeric formatting rules.
- `planHash = sha256(canonicalPlanJson)` and must be stable across runs.
- Snapshot tests must prove determinism for:
  - canonical JSON
  - plan hash
  - plan generation fixtures
  - weekly report output (fixtures -> byte-identical report)

### Microservice boundary

- Regime Engine outputs REQUEST_* actions only (never claims execution happened).
- Autopilot is authoritative for:
  - what executed
  - costs (tx fees/priority/slippage)
  - portfolioAfter
- Regime Engine must accept and persist execution results via API.

---

## Product spec (build this)

### A) Policy compute API (v1)

Implement these endpoints:

- `GET /health` → `{ ok: true }`
- `GET /version` → `{ name, version, commit? }`
- `GET /v1/openapi.json` → OpenAPI spec
- `POST /v1/plan` → validate request, compute deterministic plan, write ledger, return plan
- `POST /v1/execution-result` → validate + link to planId/planHash, write ledger, return ack
- `GET /v1/report/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD` → markdown + JSON summary (ledger-only)

### B) Contract (must be explicit and versioned)

- Every request/response includes `schemaVersion: "1.0"`.
- `/v1/plan` request must include:
  - `asOfUnixMs`
  - `market`: symbol, timeframe, candles[]
  - `portfolio`: navUsd, solUnits, usdcUnits
  - `autopilotState`: activeClmm flag, cooldowns, churn counters (stopouts/redeploys)
  - `config`: regime thresholds + allocation targets/caps + churn rules + baseline settings
- `/v1/plan` response must include:
  - `planId`, `planHash`, `asOfUnixMs`
  - `regime: UP|DOWN|CHOP`
  - `targets: { solBps, usdcBps, allowClmm }`
  - `actions[]`: REQUEST_* and/or HOLD/STAND_DOWN (no imperative “EXECUTE” semantics)
  - `constraints`: cooldowns/budgets + notes
  - `reasons[]`: canonical codes with severity
  - `telemetry`: computed indicator values for inspection
- `/v1/execution-result` must include:
  - `(planId, planHash)`
  - per-action statuses: SUCCESS|FAILED|SKIPPED
  - costs: tx fees, priority fees, slippage (as provided by Autopilot)
  - `portfolioAfter`: navUsd, solUnits, usdcUnits

### C) Strategy kernel (pure)

- Indicators from candles: realized vol short/long + ratio, trend strength proxy, compression proxy.
- Regime classifier with hysteresis:
  - confirm bars
  - separate enter/exit thresholds
  - minimum hold bars after switching
- Churn governor:
  - max stopouts/redeploys per window
  - cooldown after stopout
  - two-strike stand-down
- Allocation policy:
  - partial shifts by regime
  - volatility targeting
  - turnover and delta exposure caps
- CHOP gate:
  - `allowClmm` true only in CHOP and not stand-down.

### D) Truth ledger (append-only)

Persist:

- `plan_requests`
- `plans`
- `execution_results`

Preferred store: SQLite (local file) with transactional writes.

### E) Weekly reporting (ledger-only)

Generate:

- regime distribution over window
- churn / stand-down metrics
- execution success rate + cost summaries (from results)
- baseline comparisons:
  - SOL HODL
  - SOL DCA (schedule defined in config)
  - USDC carry APR (config)

---

## Process requirements (follow strictly)

1) Planning first

- Ensure `plan.md` exists and matches actual milestones.
- Do not implement beyond the current milestone.

2) Implement milestone-by-milestone
   For each milestone:

- implement only the scoped deliverables
- add/extend tests (unit + snapshot where required)
- run verification commands (lint/typecheck/test/build)
- fix failures immediately
- update documentation and mark milestone complete

3) Quality gates

- Determinism is a blocker: any non-determinism must be fixed before proceeding.
- Contract drift is a blocker: OpenAPI and contract fixtures must remain correct.

---

## Definition of Done (exit conditions)

- `npm run dev` starts service locally and /health works.
- All milestones in plan.md are implemented and checked off.
- All scripts exist and pass:
  - lint, typecheck, tests, build
- End-to-end harness can:
  - generate plans from fixtures
  - post simulated execution results
  - produce a weekly report from ledger-only
- OpenAPI available at `/v1/openapi.json`.
- Documentation explains:
  - data flow and boundary with Autopilot
  - determinism strategy
  - how to run the demo in <3 minutes
