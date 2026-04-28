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
  - `GET /health` — probes both SQLite and Postgres; returns `{ ok, postgres, sqlite }`
  - `GET /version`
  - `GET /v1/openapi.json`
  - `POST /v1/plan`
  - `POST /v1/execution-result`
  - `POST /v1/clmm-execution-result` — token-guarded (`X-CLMM-Internal-Token`)
  - `GET /v1/report/weekly`
  - `POST /v1/sr-levels` — token-guarded (`X-Ingest-Token`)
  - `GET /v1/sr-levels/current?symbol&source`
- Data stores:
  - **SQLite ledger** (single file; Railway mounts `/data`) — append-only receipts, plans, execution results.
  - **Postgres** (shared Railway instance, `regime_engine` schema) — feature tables needing JSONB, arrays, concurrent reads. Migrated via Drizzle Kit (`npm run db:migrate`).
- `DATABASE_URL` is mandatory in production; startup hard-fails if Postgres is unreachable.
- Report generation reads ledger only (no network calls).
- CLMM execution events accumulate in `clmm_execution_events` for post-shelf analytics; the weekly report does NOT consume them in this sprint.

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
  - `schema.sql` — append-only tables: `plan_requests`, `plans`, `execution_results`, `sr_level_briefs`, `sr_levels`, `clmm_execution_events`
  - `store.ts` — `node:sqlite` connection + canonical-JSON idempotency helpers
  - `writer.ts` — plan + execution result writes; plan-linked (`PLAN_NOT_FOUND` on missing planId)
  - `srLevels.ts` — `writeSrLevelBrief`, `getCurrentSrLevels`; `BEGIN IMMEDIATE` for check-then-insert
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

### S/R brief ingestion (`POST /v1/sr-levels`)

1. `requireSharedSecret(request, "X-Ingest-Token", "OPENCLAW_INGEST_TOKEN")` — 401 on bad/missing token, 500 on unset env.
2. Validate body (`parseSrLevelBriefRequest`).
3. `writeSrLevelBrief` under `BEGIN IMMEDIATE`:
   - `(source, brief_id)` byte-equal → idempotent `200 { status: "already_ingested" }`.
   - `(source, brief_id)` differs → `409 CONFLICT` (`BRIEF_CONFLICT`).
   - Absent → insert brief + N level rows, stamp `captured_at_unix_ms` on receipt, `201 { briefId, insertedCount }`.

### Current S/R read (`GET /v1/sr-levels/current?symbol&source`)

1. Validate query (`parseSrLevelsCurrentQuery`).
2. `getCurrentSrLevels` selects the newest `sr_level_briefs` row for `(symbol, source)` by `captured_at_unix_ms DESC, id DESC` and joins its levels.
3. `404` when no brief exists; `200` with grouped `supports` / `resistances` sorted by `price ASC` otherwise.

### CLMM execution event ingestion (`POST /v1/clmm-execution-result`)

1. `requireSharedSecret(request, "X-CLMM-Internal-Token", "CLMM_INTERNAL_TOKEN")`.
2. Validate body (`parseClmmExecutionEventRequest`). `status` is `confirmed | failed` only — transient states are rejected at 400.
3. `writeClmmExecutionEvent` under `BEGIN IMMEDIATE`:
   - Byte-equal replay of the same `correlationId` → `200 { idempotent: true }`.
   - `correlationId` collision with a different canonical payload → `409 CONFLICT` (`CLMM_EXECUTION_EVENT_CONFLICT`, distinct from the plan-linked `EXECUTION_RESULT_CONFLICT`).
   - Absent → insert, `200 { ok: true, correlationId }`.

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

## Security and safety posture

- Originally designed for local use. For the Railway deploy, two write routes are protected by shared-secret headers:
  - `POST /v1/sr-levels` — `X-Ingest-Token` compared against `OPENCLAW_INGEST_TOKEN` via `timingSafeEqual`.
  - `POST /v1/clmm-execution-result` — `X-CLMM-Internal-Token` compared against `CLMM_INTERNAL_TOKEN` via `timingSafeEqual`.
- A missing/empty token env var is an **ops misconfig** and responds `500`, not `401` — a caller cannot brute-force a service that has no configured token.
- Token comparison fails closed when caller and configured token differ in length (required by `timingSafeEqual`).
- Read routes (`GET /v1/sr-levels/current`, `GET /v1/report/weekly`) are unauthenticated. Treat them as public.
- **Append-only ledger.** No `UPDATE`s, no `DELETE`s on any truth row. "Current S/R set" is a read derived from the newest `(symbol, source)` brief — never a mutated `superseded_at` column. Corrections happen via a new brief with a later `captured_at_unix_ms`.

---

## Extension points (later, without breaking core)

- Add additional symbols/pairs by extending contract + feature module.
- Add more robust baselines (e.g., different DCA schedules) as pure functions.
- Add “shadow mode” reporting: compute plans without recording execution results.
- Add message-bus integration later without changing the core engine.

---
