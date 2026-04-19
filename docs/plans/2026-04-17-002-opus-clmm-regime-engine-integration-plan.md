---
title: "feat: CLMM + Regime Engine integration sprint (Opus plan)"
type: feat
status: active
date: 2026-04-17
origin: docs/2026-04-17-clmm-regime-engine-integration-sprint.md
canonical_spec: docs/superpowers/specs/2026-04-17-clmm-regime-engine-integration-merged.md
companion: docs/plans/2026-04-17-001-feat-clmm-regime-engine-integration-plan.md
---

# feat: CLMM + Regime Engine integration sprint (Opus plan)

## 1. What's in this document

An implementation plan that closes the three gaps in the sprint doc (durable S/R storage, CLMM→regime-engine execution feedback, co-deployed Railway topology) against the code as it exists today. Built by reading the repo, not the original sprint doc's assumptions. The merged spec
(`docs/superpowers/specs/2026-04-17-clmm-regime-engine-integration-merged.md`) is the canonical source of record; this plan is the executable decomposition of that spec.

**Target repos:** `regime-engine` (this repo) and `clmm-superpowers-v2`.
**Budget:** 15.5h across 2 weekends. Hard stops and gates defined in §8.

## 2. Repo reality check (baseline on `main`)

Facts the plan is anchored to, verified by reading current `main`:

- `regime-engine` is Fastify + Zod + `node:sqlite` (native). **Not** Postgres/Drizzle. The sprint doc's `CREATE SCHEMA regime_engine` DDL is non-applicable.
- `src/ledger/writer.ts:72-94` makes `POST /v1/execution-result` **plan-linked**: it fails `PLAN_NOT_FOUND` if the `planId` has no prior plan row. CLMM cannot reuse this route without calling `/v1/plan` first, which the sprint forbids. A new CLMM-specific ingest route is required.
- Canonical-JSON equality + SHA-256 hashing is the existing idempotency/conflict pattern (`src/ledger/writer.ts:113-124`, `src/contract/v1/canonical.ts`). Reuse, don't reinvent.
- The ledger is append-only by architectural commitment. "Current S/R set" is a read derived from the newest `(symbol, source)` brief, not a mutated `superseded_at` column.
- Server binds `0.0.0.0:8787` today. Dockerfile already mounts `/app/tmp` and runs non-root. Railway deployment reuses the existing Dockerfile with a volume attached at `/app/tmp`.
- `clmm-superpowers-v2` terminal state is reached at **two seams**: `ExecutionController.submitExecution` (inline reconciliation on fast confirmations) and `ReconciliationJobHandler` (later, for stuck submitted attempts). Single-seam notification misses the inline path.
- Expo/web clients use only `EXPO_PUBLIC_BFF_BASE_URL`. Any regime-engine URL configuration is backend-only.

## 3. Requirements trace

| ID | Requirement | Covered by |
|---|---|---|
| R1 | Persist OpenClaw S/R levels by (symbol, source) | Unit 1 |
| R2 | Preserve history; derive current set via query | Unit 1, 2 |
| R3 | Read path for current SOL/USDC + mco levels | Unit 2, 5 |
| R4 | CLMM surfaces current levels read-only with freshness + empty state | Unit 5 |
| R5 | CLMM posts execution event after terminal state | Unit 4 |
| R6 | Notification is best-effort, non-blocking | Unit 4 |
| R7 | Event carries enough context for analytics | Unit 3 (contract), Unit 4 (payload) |
| R8 | Replay of same correlationId is idempotent | Unit 3 |
| R9 | Both services deployed in one Railway project | Unit 6 |
| R10 | Minimum public surface; internal routes guarded | Unit 2, 3, 6 |
| R11 | Shared-secret protection for write routes | Unit 2, 3 |
| R12 | One manual end-to-end validation | Unit 6 |
| R13 | Live $100 SOL/USDC position after validation | Unit 6 (post-sprint gate) |

## 4. Architecture at a glance

```
OpenClaw   ──POST /v1/sr-levels + X-Ingest-Token──►  regime-engine ──writes──► SQLite
                                                          ▲
CLMM BFF   ──GET  /v1/sr-levels/current────────────────► regime-engine  (public)
CLMM BFF   ──POST /v1/clmm-execution-result
           + X-CLMM-Internal-Token─────────────────────► regime-engine  (backend-only call)
CLMM job   ──POST /v1/clmm-execution-result
           + X-CLMM-Internal-Token─────────────────────► regime-engine  (backend-only call)
```

Public endpoints: `GET /health`, `GET /version`, `GET /v1/openapi.json`, `GET /v1/sr-levels/current`, `GET /v1/report/weekly`, `POST /v1/sr-levels` (token-guarded), `POST /v1/clmm-execution-result` (token-guarded). Plan/execution-result endpoints remain on the public host but gated via shared secret or kept undocumented externally; see Unit 3 and 6.

## 5. Contracts (canonical, lifted from merged spec)

### 5.1 S/R ingest — `POST /v1/sr-levels`

```ts
interface SrLevelBriefRequest {
  schemaVersion: "1.0";
  source: string;                 // "mco" in this sprint
  symbol: string;                 // "SOL/USDC"
  brief: {
    briefId: string;
    sourceRecordedAtIso?: string;
    summary?: string;
  };
  levels: Array<{
    levelType: "support" | "resistance";
    price: number;
    timeframe?: string;
    rank?: string;
    invalidation?: number;
    notes?: string;
  }>;
}
```

`capturedAtUnixMs` is not client-supplied. Regime-engine stamps it on receipt and persists it for latest-brief selection and `capturedAtIso` in the read response.

- `201` on first insert with `{ briefId, insertedCount }`.
- `200` `{ status: "already_ingested" }` when a byte-identical payload arrives again for the same `(source, briefId)`.
- `409` `CONFLICT` when `(source, briefId)` already exists but canonical JSON differs.
- `400` on validation failure; `401` on missing/bad `X-Ingest-Token`.

### 5.2 Current read — `GET /v1/sr-levels/current?symbol&source`

```ts
interface SrLevelsCurrentResponse {
  schemaVersion: "1.0";
  source: string;
  symbol: string;
  briefId: string;
  sourceRecordedAtIso: string | null;
  summary: string | null;
  capturedAtIso: string;          // ISO derived from capturedAtUnixMs
  supports: SrLevel[];
  resistances: SrLevel[];
}
interface SrLevel {
  price: number;
  rank?: string;
  timeframe?: string;
  invalidation?: number;
  notes?: string;
}
```

`supports` and `resistances` sorted by `price ASC`. `404` when no brief exists.

### 5.3 CLMM execution event — `POST /v1/clmm-execution-result`

```ts
interface ClmmExecutionEventRequest {
  schemaVersion: "1.0";
  correlationId: string;                    // CLMM attemptId; primary idempotency key
  positionId: string;
  breachDirection: "LowerBoundBreach" | "UpperBoundBreach";
  reconciledAtIso: string;
  txSignature: string;
  tokenOut: "SOL" | "USDC";
  status: "confirmed" | "failed";           // terminal only
  episodeId?: string;
  previewId?: string;
  detectedAtIso?: string;
  amountOutRaw?: string;                    // string preserves precision
  txFeesUsd?: number;
  priorityFeesUsd?: number;
  slippageUsd?: number;
}
```

- `status` is `confirmed | failed` **only**. `partial` and `pending` do not travel. This is load-bearing — it prevents 409 churn when CLMM reconciles later.
- `200` with `{ schemaVersion, ok: true, correlationId, idempotent?: true }`.
- `409` `CONFLICT` on same `correlationId` with different canonical payload.
- `401` on missing/bad `X-CLMM-Internal-Token`.

### 5.4 DDL (additions to `src/ledger/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS sr_level_briefs (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  source                  TEXT NOT NULL,
  brief_id                TEXT NOT NULL,
  symbol                  TEXT NOT NULL,
  source_recorded_at_iso  TEXT,
  summary                 TEXT,
  brief_json              TEXT NOT NULL,   -- canonical JSON of full request
  captured_at_unix_ms     INTEGER NOT NULL,
  UNIQUE (source, brief_id)
);

CREATE TABLE IF NOT EXISTS sr_levels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id      INTEGER NOT NULL REFERENCES sr_level_briefs(id),
  level_type    TEXT NOT NULL CHECK (level_type IN ('support','resistance')),
  price         REAL NOT NULL,
  timeframe     TEXT,
  rank          TEXT,
  invalidation  REAL,
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_sr_level_briefs_current
  ON sr_level_briefs(symbol, source, captured_at_unix_ms DESC);

CREATE INDEX IF NOT EXISTS idx_sr_levels_brief_id
  ON sr_levels(brief_id);

CREATE TABLE IF NOT EXISTS clmm_execution_events (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  correlation_id       TEXT NOT NULL UNIQUE,
  event_json           TEXT NOT NULL,        -- canonical JSON
  received_at_unix_ms  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clmm_execution_events_correlation
  ON clmm_execution_events(correlation_id);
```

Append-only. No triggers. No `superseded_at` column — latest-brief query handles "current."

## 6. Implementation units

Ordering matches the merged spec. Each unit has: files touched, approach, test scenarios, acceptance criteria, and budget.

### Unit 1 — S/R ledger persistence (regime-engine, 2h)

Files:
- Modify `src/ledger/schema.sql` — append §5.4 DDL only. Do not duplicate existing DDL statements.
- Create `src/ledger/srLevels.ts` — exports `writeSrLevelBrief`, `getCurrentSrLevels`, `SrLevelsWriteError`, `SR_LEVELS_ERROR_CODES = { BRIEF_CONFLICT: "BRIEF_CONFLICT" }`.
- Test `src/ledger/__tests__/srLevels.test.ts`.

Approach:
- `writeSrLevelBrief` does `BEGIN IMMEDIATE` for write-lock + check-then-insert. Inside the transaction: `SELECT brief_json FROM sr_level_briefs WHERE source = ? AND brief_id = ?`. If found and canonical-equal → idempotent. If found and differs → throw `BRIEF_CONFLICT`. Else insert brief row, grab `lastInsertRowid`, insert each level. Commit.
- `getCurrentSrLevels` joins latest brief by `ORDER BY captured_at_unix_ms DESC, id DESC LIMIT 1` to levels via `LEFT JOIN`, returns `null` if no brief.
- Canonical JSON via existing `toCanonicalJson`.

Tests:
- Insert brief with N levels → one brief row, N level rows, `insertedCount === N`.
- Second insert with identical payload → `{ idempotent: true, insertedCount: 0 }`.
- Second insert with same `(source, briefId)` but different levels → `BRIEF_CONFLICT`.
- Two briefs for same `(symbol, source)` → `getCurrentSrLevels` returns the newer brief's levels; older brief's rows still in DB.
- Unknown `(symbol, source)` → `getCurrentSrLevels` returns `null`.
- Level insertion failure mid-loop → no partial brief row (transaction rollback).

Acceptance: tests pass; existing plan/execution ledger tests unaffected.

### Unit 2 — S/R HTTP surface (regime-engine, 2.5h)

Files:
- Modify `src/contract/v1/types.ts` — add `SrLevelBriefRequest`, `SrLevelBriefResponse`, `SrLevelsCurrentResponse`.
- Modify `src/contract/v1/validation.ts` — add Zod schemas and `parseSrLevelBriefRequest`, `parseSrLevelsCurrentQuery`.
- Create `src/http/auth.ts` — `requireSharedSecret(request, headerName, envVar)`. Uses `timingSafeEqual` for constant-time compare. Throws `401` on bad/missing token and **500** when `envVar` is unset (misconfig ≠ bad request).
- Create `src/http/handlers/srLevelsIngest.ts`.
- Create `src/http/handlers/srLevelsCurrent.ts`.
- Modify `src/http/routes.ts` — register routes.
- Modify `src/http/openapi.ts` — document both routes.
- Modify `.env.example` — add `OPENCLAW_INGEST_TOKEN=`.
- Test `src/http/__tests__/srLevels.e2e.test.ts`.
- Modify `src/http/__tests__/routes.contract.test.ts` — include new routes.

Approach:
- Ingest handler: `requireSharedSecret(request, "X-Ingest-Token", "OPENCLAW_INGEST_TOKEN")` → `parseSrLevelBriefRequest` → `writeSrLevelBrief` → `201 { briefId, insertedCount }` or `200 { status: "already_ingested" }`.
- Current handler: no auth; `parseSrLevelsCurrentQuery` → `getCurrentSrLevels`; `404` if null; `200` with grouped `supports/resistances` sorted by price.
- `timingSafeEqual` requires equal-length buffers; normalize by returning 401 if lengths differ.

Tests (e2e with in-memory DB via `LEDGER_DB_PATH=:memory:`):
- POST with valid token + body → `201`, rows present.
- POST with missing token → `401`; DB untouched.
- POST with wrong token → `401`; DB untouched.
- POST with `OPENCLAW_INGEST_TOKEN` env unset → `500` (ops misconfig).
- POST with malformed body → `400` with canonical Zod error shape.
- POST with empty `levels: []` → `400`.
- Duplicate POST byte-equal → `200 { status: "already_ingested" }`.
- Duplicate POST with different levels → `409 CONFLICT`.
- GET `?symbol=SOL/USDC&source=mco` on empty DB → `404`.
- GET after POST → `200`, `supports`/`resistances` grouped and price-sorted.
- GET after two POSTs for same `(symbol, source)` → returns newer brief's levels only.

Acceptance: tests pass; OpenAPI snapshot updated; existing tests green.

### Unit 3 — CLMM execution event ingest (regime-engine, 2h)

**Scope excludes weekly-report integration.** The merged spec drops it (non-goal §3.3). Events accumulate in the ledger; report consumers are post-shelf.

Files:
- Modify `src/ledger/schema.sql` — append `clmm_execution_events` DDL.
- Modify `src/ledger/writer.ts` — add `writeClmmExecutionEvent`; extend `LEDGER_ERROR_CODES` with `CLMM_EXECUTION_EVENT_CONFLICT`.
- Modify `src/contract/v1/types.ts` — add `ClmmExecutionEventRequest`, `ClmmExecutionEventResponse`.
- Modify `src/contract/v1/validation.ts` — add Zod schema + `parseClmmExecutionEventRequest`.
- Create `src/http/handlers/clmmExecutionResult.ts`.
- Modify `src/http/routes.ts` — register `POST /v1/clmm-execution-result`.
- Modify `src/http/openapi.ts` — document.
- Modify `.env.example` — add `CLMM_INTERNAL_TOKEN=`.
- Test `src/http/__tests__/clmmExecutionResult.e2e.test.ts`.

Approach:
- `writeClmmExecutionEvent` uses `BEGIN IMMEDIATE` for the check-then-insert. Inside: `SELECT event_json FROM clmm_execution_events WHERE correlation_id = ? ORDER BY id DESC LIMIT 1`. Idempotent if canonical-equal, conflict otherwise, insert on absent.
- Handler: `requireSharedSecret(request, "X-CLMM-Internal-Token", "CLMM_INTERNAL_TOKEN")` → validate → write → `200 { ok: true, correlationId, idempotent? }`.
- Return `409` on `CLMM_EXECUTION_EVENT_CONFLICT`, `500` on other `LedgerWriteError` codes. Dedicated error code avoids conflating this with plan-linked `EXECUTION_RESULT_CONFLICT`.

Tests:
- POST with valid token + confirmed payload → `200`, row present.
- POST with `status: "pending"` or `"partial"` → `400` (Zod rejects the enum).
- POST with missing token → `401`.
- POST duplicate with byte-equal payload → `200 { idempotent: true }`.
- POST duplicate with differing payload (e.g. different `txSignature`) → `409 CONFLICT`.
- POST malformed body → `400`.
- Existing `POST /v1/execution-result` tests remain green.

Acceptance: tests pass; weekly-report code **unchanged**.

### Unit 4 — CLMM outbound adapter + dual-seam wiring (clmm-superpowers-v2, 3h)

Target repo files:
- Create `packages/adapters/src/outbound/regime-engine/RegimeEngineExecutionEventAdapter.ts`.
- Test `packages/adapters/src/outbound/regime-engine/RegimeEngineExecutionEventAdapter.test.ts`.
- Modify `packages/adapters/src/composition/AdaptersModule.ts` — register adapter.
- Modify `packages/adapters/src/inbound/http/{AppModule,tokens}.ts` — DI token + binding.
- Modify `packages/adapters/src/inbound/jobs/tokens.ts` — same token exposed to job composition.
- Modify `packages/adapters/src/inbound/http/ExecutionController.ts` — after persisted terminal state only.
- Modify `packages/adapters/src/inbound/http/ExecutionController.test.ts`.
- Modify `packages/adapters/src/inbound/jobs/ReconciliationJobHandler.ts` — after persisted terminal state only.
- Modify `packages/adapters/src/inbound/jobs/ReconciliationJobHandler.test.ts`.
- Modify `packages/adapters/.env.sample` — add `REGIME_ENGINE_BASE_URL=`, `REGIME_ENGINE_INTERNAL_TOKEN=`.

Approach:
- Adapter signature: `notifyExecutionEvent(event: ClmmExecutionEventRequest): Promise<void>`. Posts JSON to `${REGIME_ENGINE_BASE_URL}/v1/clmm-execution-result` with `X-CLMM-Internal-Token` header; 5s timeout; up to 3 retries with exponential backoff starting 500ms; swallow+log final failure at `ERROR`. Never throws.
- If `REGIME_ENGINE_BASE_URL` or `REGIME_ENGINE_INTERNAL_TOKEN` is missing, adapter resolves to a no-op that logs at `DEBUG` once per process. Keeps local dev and ephemeral review envs quiet.
- Wiring rule: adapter is called **after** CLMM has persisted the terminal attempt state and appended the local lifecycle event. This is the key invariant — CLMM owns execution truth; notification is a side-effect.
- **Terminal gate:** only post when `reconciled.finalState in {"confirmed","failed"}`. Map `finalState` → wire `status`. `partial` / `pending` do not post.
- Payload mapping: `correlationId = attemptId`, `positionId`, `breachDirection` from trigger context, `txSignature`, `tokenOut`, `detectedAtIso`, `reconciledAtIso`, optional cost fields if available. Shape exactly matches §5.3.

Tests:
- Unit: adapter posts correct body + header; retries on 5xx; swallows after final retry; no-op when config missing.
- Controller: on inline terminal confirmation, adapter called exactly once **after** attempt persistence + lifecycle-event append (assert call order).
- Controller: on inline `submitted` (non-terminal) result, adapter **not** called.
- Controller: adapter failure does not change the HTTP response or persisted state.
- Job handler: same three scenarios via the worker path.
- Idempotency: same `attemptId` flowing through both controller and worker yields two POSTs; server idempotency is the safety net (asserted indirectly — adapter test fakes `200 { idempotent: true }`).

Acceptance: tests pass; application layer unchanged; no new application port introduced.

### Unit 5 — BFF enrichment of position detail with S/R levels (clmm-superpowers-v2, 3h)

Files:
- Modify `packages/application/src/dto/index.ts` — extend `PositionDetailDto` with optional `srLevels?: SrLevelsBlock`.
- Create `packages/adapters/src/outbound/regime-engine/CurrentSrLevelsAdapter.ts`.
- Test `packages/adapters/src/outbound/regime-engine/CurrentSrLevelsAdapter.test.ts`.
- Modify `packages/adapters/src/inbound/http/{AppModule,tokens}.ts` — DI wiring.
- Modify `packages/adapters/src/inbound/http/PositionController.ts` — call adapter; degrade on failure.
- Modify `packages/adapters/src/inbound/http/PositionController.test.ts`.
- Modify `apps/app/src/api/positions.ts` — accept additive `srLevels` field in parser.
- Modify `apps/app/src/api/positions.test.ts`.
- Modify `packages/ui/src/view-models/PositionDetailViewModel.ts` — expose S/R block + freshness badge state.
- Modify `packages/ui/src/screens/PositionDetailScreen.tsx` — render grouped levels, freshness label, "no levels available" empty state.
- Modify `packages/ui/src/screens/PositionDetailScreen.test.tsx`.

Approach:
- `CurrentSrLevelsAdapter`: `fetchCurrent(symbol: string, source: "mco"): Promise<SrLevelsBlock | null>`. 2s timeout. On 404 or transport error → return `null` (not throw). No retry — this is a read path for UI; stale-or-empty is better than slow.
- `PositionController`: for SOL/USDC positions, call adapter in parallel with existing position-detail lookups. Merge `srLevels` into response only when non-null.
- UI: freshness = `Date.now() - capturedAtUnixMs`; show `"captured <relative>"`; warn if `> 48h`; render "No current MCO levels available" when block absent.
- Fixed `(symbol, source) = ("SOL/USDC", "mco")` mapping in this sprint. Do not generalize.

Tests:
- Controller returns enriched DTO when adapter yields data.
- Controller returns base DTO (no `srLevels` key) when adapter yields `null`.
- Adapter returns `null` on 404 and on timeout; never throws.
- App API parser accepts both shapes without breaking existing consumers.
- UI renders grouped supports/resistances sorted by price, with freshness label.
- UI renders empty state when block absent.
- Integration: `EXPO_PUBLIC_BFF_BASE_URL` remains the only app-public URL. No `EXPO_PUBLIC_REGIME_ENGINE_*`.

Acceptance: tests pass; existing position-detail tests unaffected.

### Unit 6 — Deploy + E2E runbook (both repos, 2.5h)

Files:
- `regime-engine`:
  - Modify `src/server.ts` — confirm bind `::` (dual-stack) for Railway compatibility; default to `0.0.0.0` when `HOST` unset so local dev stays unchanged.
  - Modify `README.md` — document `OPENCLAW_INGEST_TOKEN`, `CLMM_INTERNAL_TOKEN`, `LEDGER_DB_PATH`, Railway volume requirement.
  - Modify `architecture.md` — note append-only invariant + the two new tables.
  - Modify `Dockerfile` — ensure `LEDGER_DB_PATH` defaults make the volume path the durable path in production (fall back to `tmp/ledger.sqlite` for local).
  - Modify `docs/2026-04-17-clmm-regime-engine-integration-sprint.md` — annotate resolved assumptions (SQLite not Postgres; new CLMM ingest endpoint).
  - Test `src/__tests__/smoke.test.ts` — boot + `GET /health` + `GET /version` + `GET /v1/openapi.json`.
- `clmm-superpowers-v2`:
  - Modify `README.md` — document `REGIME_ENGINE_BASE_URL`, `REGIME_ENGINE_INTERNAL_TOKEN`, that `EXPO_PUBLIC_BFF_BASE_URL` stays the sole app-public URL.
  - Modify `packages/adapters/.env.sample` — both backend-only vars.
  - Modify `apps/app/.env.example` — confirm only `EXPO_PUBLIC_BFF_BASE_URL` remains.

Railway runbook (execute in order):

1. **Create volume first.** In Railway, create a volume on the new `regime-engine` service, mount at `/app/tmp`. **Do not deploy the service before the volume exists** — without the volume, SQLite writes to ephemeral disk and data vanishes on restart.
2. Add service `regime-engine` in the existing `clmm-superpowers-v2` Railway project. Source = this repo.
3. Env vars on `regime-engine`:
   - `HOST=::`
   - `PORT` — Railway injects. Server binds `[${HOST}]:${PORT}`.
   - `LEDGER_DB_PATH=/app/tmp/ledger.sqlite`
   - `OPENCLAW_INGEST_TOKEN` — generate strong random; share with OpenClaw out-of-band.
   - `CLMM_INTERNAL_TOKEN` — generate strong random; reference from CLMM service (step 5).
   - `NODE_ENV=production`.
4. Enable public domain for `regime-engine`.
5. On CLMM backend service, add `REGIME_ENGINE_BASE_URL` and `REGIME_ENGINE_INTERNAL_TOKEN` using Railway reference variables (`${{regime-engine.RAILWAY_PRIVATE_DOMAIN}}` + `${{regime-engine.CLMM_INTERNAL_TOKEN}}`). Confirm CLMM backend resolves the internal hostname via private networking.
6. Deploy verification (copy-paste):

```bash
# Public health
curl -fsS https://<public>.up.railway.app/health
# Version
curl -fsS https://<public>.up.railway.app/version
# Empty current-read
curl -fsS "https://<public>.up.railway.app/v1/sr-levels/current?symbol=SOL/USDC&source=mco"
# → expect 404

# Ingest a brief
curl -fsS -X POST https://<public>.up.railway.app/v1/sr-levels \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: $OPENCLAW_INGEST_TOKEN" \
  -d @fixtures/sr-levels-brief.json
# → 201

# Read current
curl -fsS "https://<public>.up.railway.app/v1/sr-levels/current?symbol=SOL/USDC&source=mco"
# → 200 with supports/resistances

# CLMM event (simulate)
curl -fsS -X POST https://<public>.up.railway.app/v1/clmm-execution-result \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: $CLMM_INTERNAL_TOKEN" \
  -d @fixtures/clmm-execution-event.json
# → 200

# Replay same
curl -fsS -X POST https://<public>.up.railway.app/v1/clmm-execution-result \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: $CLMM_INTERNAL_TOKEN" \
  -d @fixtures/clmm-execution-event.json
# → 200 { idempotent: true }
```

7. From inside the CLMM backend container (Railway shell), verify private-network reach:

```bash
curl -fsS http://regime-engine.railway.internal:${PORT}/health
```

If private networking is unresolved at deploy time, temporarily set `REGIME_ENGINE_BASE_URL` to the public URL and keep the shared secret — same architectural outcome, slightly higher latency. Shelf the private-networking migration.

E2E (one manual run, no CI automation):

1. Seed brief via curl (step 6 above).
2. Verify BFF-enriched position detail in the PWA for the live SOL/USDC position — levels appear, freshness shown.
3. Trigger a breach in CLMM staging (or fixture breach). Observe one `POST /v1/clmm-execution-result` in regime-engine logs.
4. Query `clmm_execution_events` via Railway Postgres console on the CLMM side or the SQLite file on regime-engine — row present for the `attemptId`.
5. Replay (if possible via cron manual trigger) — assert `idempotent: true`.
6. If all six pass — proceed to fund wallet with $100 and open live position (Gate 5).

## 7. Forbidden list (hard rules)

1. Do not call `POST /v1/plan` from CLMM. Plans stay analytics-only.
2. Do not extend `POST /v1/execution-result`; do not reuse its plan-linked error code for CLMM events.
3. Do not introduce `RegimeEngineNotificationPort` in `packages/application`. Adapter-layer only.
4. Do not introduce `EXPO_PUBLIC_REGIME_ENGINE_*`. Expo fetches only through the BFF.
5. Do not add CLMM-event integration to `src/report/weekly.ts`. Post-shelf work.
6. Do not introduce a `superseded_at` column. Latest-brief query is the model.
7. Do not expand `status` on the wire contract beyond `confirmed | failed` this sprint.
8. Do not generalize pool-to-symbol mapping. Hardcode SOL/USDC + mco.
9. Do not swap to Postgres/Drizzle for regime-engine.
10. Do not deploy to anything other than Railway.
11. Do not bump above $100 until 30 days of live data exist.

## 8. Gates, budget, hard stop

| Gate | When | Criteria |
|---|---|---|
| G1 | End Sat W1 | Units 1-3 pass locally; existing tests green |
| G2 | End Sun W1 | Unit 4 tests pass locally; no application-layer surface added |
| G3 | Sat morning W2 | Unit 6 deploy section passes from §6's curl list |
| G4 | Sat evening W2 | Unit 5 merged; E2E runbook steps 1-5 pass manually |
| G5 | Sun W2 | $100 funded; one live SOL/USDC position opened; monitor running |

**Hard stop:** if G1 or G2 misses by end of Sun W1, shelf the project. Do not extend into weekday time. Pronghorn starts Monday regardless. If G3 or G4 slip, ship code-done without live deployment — G5 can wait 2-4 weeks.

Budget by unit: U1 2h · U2 2.5h · U3 2h · U4 3h · U5 3h · U6 2.5h + 0.5h buffer = 15.5h.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Railway private networking resolves slowly or misconfigures on first deploy. | Runbook step 7 tests reachability before CLMM wiring. Fallback to public URL + shared secret preserves the architecture. |
| SQLite file goes to ephemeral disk if volume isn't mounted before first deploy. | Runbook step 1: create volume first. `LEDGER_DB_PATH` default points inside the mount path. Smoke test on fresh deploy detects ephemeral behavior by checking that a seeded brief survives a restart. |
| CLMM reconciliation double-posts (controller + worker both fire for same attempt). | `correlation_id UNIQUE` on the server + canonical-JSON idempotency returns `200 { idempotent: true }`. Adapter test covers this. |
| Timing-attack on shared secret via `===`. | Use `timingSafeEqual` on equal-length buffers; fail closed on length mismatch. |
| Partial/pending states leak into the wire contract and cause 409 churn. | Wire type enforces `"confirmed" \| "failed"` only. Zod rejects other values. Dual-seam wiring checks `finalState` before calling adapter. |
| Weekly-report consumers get a surprise CLMM section. | Deferred entirely. `src/report/weekly.ts` untouched this sprint. |
| OpenClaw ships a brief shape that doesn't fit `SrLevelBriefRequest`. | Regime-engine contract is canonical. Translation goes on the OpenClaw side. Budget 1h buffer in U2 for this if needed. |
| Scope creep via "while I'm in here". | Forbidden list §7. Re-read before every work session. |

## 10. What I would do differently from GPT's plan

**Keeping from GPT (these are good):**

- Requirements trace R1–R13. Makes completeness verifiable.
- Append-only history via latest-brief query (not `superseded_at`). Fits existing ledger invariant.
- Separate CLMM ingest endpoint rather than overloading `/v1/execution-result`. The plan-linkage check at `writer.ts:82-87` makes reuse impossible anyway.
- BFF-mediated reads. Expo client stays on `EXPO_PUBLIC_BFF_BASE_URL` only.
- Dual seam notification: `ExecutionController` + `ReconciliationJobHandler`. Single-seam misses inline confirmations.
- Adapter-layer wiring, no application port. Analytics transport is infrastructure.
- Unit dependency graph.

**Changing (these are gaps or mistakes):**

1. **Drop weekly-report integration from Unit 3.** Sprint non-goals §3.3 explicitly exclude it. GPT's Unit 3 modifies `src/report/weekly.ts` and `weeklyReport.snapshot.test.ts` — that's scope creep. Events accumulate in `clmm_execution_events`; report consumers are post-shelf.
2. **Publish concrete DDL.** GPT talks about tables but shows no SQL. See §5.4. Implementers guess column names/types otherwise.
3. **Publish concrete TypeScript contracts.** GPT lists "semantic fields" only. See §5.1–5.3. Field names, optionality, and precision rules matter at the CLMM↔regime-engine seam.
4. **Constrain wire `status` to `confirmed | failed`.** GPT's Unit 4 hints at notifying on `partial`, which is transient. Partial reconciliations fire 409s when the final state arrives later. The wire type enforces this, not a comment.
5. **Gate adapter call on `finalState` before invoking, not after.** GPT says "after CLMM has saved the updated attempt." True but incomplete — the gate is `finalState in {"confirmed","failed"}`. Otherwise `submitted` non-terminal states would post.
6. **Concrete deploy runbook with curl verifications.** GPT's Unit 6 is prose. See §6 Unit 6 — step-by-step including "create volume first" to prevent silent ephemeral data loss, dual-stack bind `HOST=::`, and reference-variable setup for cross-service URLs/tokens.
7. **Concrete E2E runbook.** GPT says "one manual integrated validation" without specifying steps. See §6 Unit 6 end. Copy-pasteable.
8. **Forbidden list.** GPT's scope boundaries are good but don't include a dedicated "do not" enumeration. See §7. Prevents creep during long sessions.
9. **Budget + gates + hard stop.** GPT has phased delivery but no time estimates, no weekend cutoffs, no shelf rule. See §8.
10. **`timingSafeEqual` for shared-secret comparison.** GPT just says "shared-secret header." Using `===` is timing-attack vulnerable; worth naming the primitive. Also distinguish "missing env var" (500, ops issue) from "wrong token" (401, caller issue).
11. **`BEGIN IMMEDIATE` for CLMM event ingest.** Check-then-insert against `clmm_execution_events` is inherently racy under concurrent retries. `BEGIN IMMEDIATE` acquires the write lock up front. GPT's plan is silent on transaction semantics.
12. **Dedicated `CLMM_EXECUTION_EVENT_CONFLICT` error code.** Reusing `EXECUTION_RESULT_CONFLICT` (which exists for plan-linked flows) conflates two distinct conflict conditions. Separate codes keep the error taxonomy clean for operators grepping logs.
13. **Unit 5 file count sanity check.** GPT's equivalent unit touches ~13 files — that's a large diff to review in one reviewable unit. I keep the count similar but call out the split points explicitly (adapter+tests, controller+tests, app parser+tests, UI+tests) so a reviewer can read it in four passes.
14. **Freshness UX constraint in Unit 5.** GPT says "show freshness" without criteria. Specify: `> 48h` → warn badge; absent → "No current MCO levels available". Prevents silent degradation.
15. **Explicit fallback for private networking failures.** GPT assumes internal networking works. I include a plain-English fallback: public URL + shared secret preserves the architecture at slightly higher latency. Ship shared-secret, harden later.

The net effect: GPT's plan is structurally sound but under-specified at the contract and deploy layers. This plan adds concrete DDL, concrete payload types, `BEGIN IMMEDIATE`, `timingSafeEqual`, a step-by-step deploy runbook, a forbidden list, and a budget/gate schedule — the details that prevent implementers from guessing and that keep scope honest when the work gets tired late Sunday night.
