# Regime Engine — architecture.md

This architecture is based on the uploaded blueprint’s core principles: determinism over flash, pure cores with thin I/O adapters, and local-first ergonomics. 0

---

## Guiding principles

- **Determinism over flash**
  - Stable ordering, canonical JSON, deterministic hashes, fixture + snapshot tests.
- **Pure cores, thin adapters**
  - Strategy logic is framework-agnostic and unit-testable with no HTTP/DB.
  - HTTP, validation, ledger, and reporting are adapters around the core.
- **Local-first ergonomics**
  - One command runs the service.
  - No external dependencies beyond local filesystem + SQLite.

---

## System boundary and responsibilities

### Regime Engine (this service)

- Computes policy intent:
  - Regime: `UP | DOWN | CHOP` (with hysteresis)
  - Targets: `{ solBps, usdcBps, allowClmm }`
  - Actions: `REQUEST_*` (never executes)
  - Constraints: cooldowns, budgets, stand-down
  - Reasons + telemetry
- Persists:
  - plan requests, plans, execution results
- Generates:
  - weekly report (ledger-only)
  - baseline comparisons (SOL HODL, SOL DCA, USDC carry)

### CLMM Autopilot (other service)

- Executes on-chain actions and is authoritative for:
  - what executed
  - costs (fees/priority/slippage)
  - portfolioAfter
- Posts results back to Regime Engine.

**Authority rule:** Regime Engine is authoritative for “what was planned”; Autopilot is authoritative for “what happened.”

---

## Runtime overview

- HTTP server exposes:
  - `GET /health`, `GET /version`
  - `GET /v1/openapi.json`
  - `POST /v1/plan`
  - `POST /v1/execution-result`
  - `GET /v1/report/weekly`
- Ledger is local SQLite (single file).
- Report generation reads ledger only (no network calls).

---

## Module layout

Target layout (names can vary, responsibilities cannot):

- `src/contract/v1/`
  - `types.ts` — request/response types
  - `validation.ts` — runtime validation
  - `canonical.ts` — canonical JSON serialization
  - `hash.ts` — `planHash = sha256(canonicalPlanJson)`
- `src/engine/` (pure core)
  - `features/` — candle parsing + indicator computation
  - `regime/` — classifier + hysteresis
  - `churn/` — budgets, cooldowns, stand-down
  - `allocation/` — targets, caps, vol targeting
  - `plan/` — plan builder orchestration
- `src/http/` (I/O adapter)
  - routes, handlers, error taxonomy, OpenAPI
- `src/ledger/` (I/O adapter)
  - schema, store, writer, queries
- `src/report/` (pure + adapter boundary)
  - baselines (pure), weekly report builder (pure), renderer (md/json)
- `scripts/`
  - harness to run fixtures → plan calls → simulated results → report
- `fixtures/`
  - uptrend/downtrend/chop/whipsaw sequences and autopilot state progressions

---

## Data flow

### Plan generation (`POST /v1/plan`)

1. **Validate request** (contract v1).
2. **Compute features** from candles (pure).
3. **Classify regime** with hysteresis (pure).
4. **Apply churn governor** (pure; uses autopilotState counters + cooldowns).
5. **Compute allocation targets**
   - partial shifts by regime
   - turnover + delta caps
   - vol targeting (pure)
6. **Apply CHOP gate**
   - `allowClmm = true` only if `regime == CHOP` AND not stand-down (pure)
7. **Build plan**
   - actions: `REQUEST_*` / `HOLD` / `STAND_DOWN`
   - reasons + telemetry
8. **Canonicalize + hash**
   - canonical JSON + `planHash` (pure)
9. **Persist**
   - write request + plan rows (ledger adapter)
10. **Return PlanResponse** (HTTP adapter)

### Execution result ingestion (`POST /v1/execution-result`)

1. Validate body (contract v1).
2. Verify `(planId, planHash)` exists and matches.
3. Persist execution result row + costs + `portfolioAfter`.
4. Return ack.

### Weekly reporting (`GET /v1/report/weekly`)

1. Query ledger for window.
2. Compute:
   - regime distribution (from plans)
   - churn/stand-down metrics (from plan requests/plans)
   - execution quality + costs (from results)
   - baselines (from candle closes + baseline config)
3. Emit deterministic Markdown + JSON summary (byte-stable for same ledger inputs).

---

## Determinism strategy

### Canonical JSON

- Objects: keys sorted lexicographically.
- Numbers: stable formatting rules (no locale).
- Arrays:
  - preserve when order is semantically meaningful
  - otherwise explicitly sort (and document which arrays are sorted)

### Hashing

- `planHash = sha256(canonicalPlanJson)`
- `planHash` must change only when semantically meaningful plan fields change.

### Tests that enforce determinism

- Snapshot tests for:
  - canonical JSON
  - plan determinism from fixtures (same request → identical response bytes)
  - weekly report determinism (same ledger → identical report bytes)
- Property tests (optional) for bounded outputs:
  - exposure caps never violated
  - churn governor always halts after limits

---

## Error taxonomy (stable contract)

- Validation errors return:
  - canonical error `code`
  - stable `message`
  - `details` (field paths), ordered deterministically
- Execution-result errors:
  - `PLAN_NOT_FOUND`
  - `PLAN_HASH_MISMATCH`
  - `SCHEMA_VERSION_UNSUPPORTED`

Regime Engine must prefer refusing to emit an ambiguous plan over emitting a plan that could cause churn or unsafe behavior.

---

## Contract versioning and compatibility

- Every request/response contains `schemaVersion`.
- Breaking changes require:
  - bumping schemaVersion
  - adding parallel validation/handlers OR coordinated upgrade
- OpenAPI (`/v1/openapi.json`) reflects the current schemaVersion set.

---

## Security and safety posture (local-first)

- Service is designed to run locally and accept requests from trusted callers (Autopilot on same host).
- No secrets required in Regime Engine.
- Ledger is append-only for auditability (deletions/updates avoided; corrections via new rows if needed).

---

## Extension points (later, without breaking core)

- Add additional symbols/pairs by extending contract + feature module.
- Add more robust baselines (e.g., different DCA schedules) as pure functions.
- Add “shadow mode” reporting: compute plans without recording execution results.
- Add message-bus integration later without changing the core engine.

---
