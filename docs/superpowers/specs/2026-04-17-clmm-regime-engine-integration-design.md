# Design: CLMM + Regime Engine Integration Sprint

**Date:** 2026-04-17
**Status:** Approved
**Origin:** `docs/2026-04-17-clmm-regime-engine-integration-sprint.md`
**Prior draft reviewed:** `docs/plans/2026-04-17-001-feat-clmm-regime-engine-integration-plan.md` (GPT)
**Budget:** ~15h, two weekends. Weekend-1 cutoff still applies.
**Target repos:** `regime-engine`, `clmm-superpowers-v2`

---

## 1. Problem

Three gaps between "MVP works" and "running live with $100":

1. OpenClaw briefs have no durable store. Each daily brief is ephemeral. Position-placement decisions can't reference current active levels.
2. CLMM has no feedback path to Regime Engine. Execution outcomes stay inside CLMM. The truth ledger can't accumulate the data weekly reports need.
3. Neither service is deployed together. Regime Engine runs locally; CLMM runs on Railway.

This sprint closes those three gaps and gets the combined system running live with $100 on one SOL/USDC position.

## 2. Goals

- S/R levels from OpenClaw persist in regime-engine's SQLite ledger, queryable by `(symbol, source)`.
- CLMM posts execution results to regime-engine after every **reconciled terminal state** (confirmed / partial / failed).
- Both services deployed in the same Railway project with internal + public networking.
- End-to-end manual validation exercises the full path: brief ingest → current-read → breach → reconcile → execution-result POST → ledger persistence → idempotent replay.
- Live $100 deployment on one SOL/USDC position.

## 3. Non-Goals

- No `/v1/plan` calls from CLMM. Plans remain analytics-only.
- No runtime regime filter gating CLMM exits. Breach direction determines exit direction.
- No dashboards, report tuning, or weekly-report CLMM-section integration. Report work is post-shelf.
- No multi-analyst support beyond `source: 'mco'`.
- No whipsaw filtering, confidence weighting, or level-expiry policies.
- No monitoring, alerting, kill-switch infrastructure.
- No shared libraries between repos. HTTP is the only coupling.
- No auth beyond shared-secret headers.
- No migration to Postgres/Drizzle for regime-engine. SQLite stays.

## 4. Repo reality check (what the sprint draft got wrong)

The original sprint doc made assumptions that do not match code reality. This design corrects them:

### regime-engine

- Uses `node:sqlite` (native) + raw SQL with canonical-JSON payloads in `src/ledger/`. **Not** Postgres/Drizzle. A migration to Postgres/Drizzle is out of scope.
- `POST /v1/execution-result` is **plan-linked**: `src/ledger/writer.ts:80-94` fails with `PLAN_NOT_FOUND` if no prior plan exists for the `planId`. CLMM cannot reuse this endpoint without calling `/v1/plan` first, which the sprint forbids. A **new** endpoint is required.
- Ledger is append-only by architectural commitment (`architecture.md:187`). "Current S/R set" is derived via `ORDER BY captured_at DESC LIMIT 1`, not by mutating a `superseded_at` column.
- Server binds `0.0.0.0:8787` today. Dockerfile already mounts `/app/tmp` and runs as non-root `app` user.
- Canonical-JSON equality for idempotency/conflict detection is a reusable pattern in `src/ledger/writer.ts:113-124`. New CLMM ingest reuses it.

### clmm-superpowers-v2 (the real CLMM)

- pnpm + turbo monorepo. `@clmm/domain`, `@clmm/application`, `@clmm/adapters`, `@clmm/ui`, `@clmm/testing`, `@clmm/config`. Not `clmm-v2` (which is scaffolding).
- Real stack: NestJS + Fastify API, pg-boss workers (`BreachScanJobHandler`, `ReconciliationJobHandler`, `TriggerQualificationJobHandler`, `NotificationDispatchJobHandler`), Drizzle + Postgres.
- Expo Router PWA at `apps/app/app/` with existing routes: `execution/`, `position/`, `preview/`, `connect`, `signing`, `(tabs)`. Adding `levels.tsx` is one file.
- **Terminal-state seam** is `packages/application/src/use-cases/execution/ReconcileExecutionAttempt.ts` — it transitions attempts `pending → confirmed | partial | failed`. This is where regime-engine notification belongs. `SubmitExecutionAttempt` only reaches "submitted" (pre-chain-confirmation) and is the wrong hook.

## 5. Architecture

### Deployment topology (Railway)

```
Railway project: clmm-v2
├── clmm-v2-api         (existing) — NestJS Fastify API + Expo web
├── clmm-v2-worker      (existing) — pg-boss workers
├── clmm-v2-postgres    (existing)
└── regime-engine       (NEW)      — Fastify + SQLite on attached volume
```

Regime-engine does **not** share the CLMM Postgres. Its SQLite file lives on a Railway volume mounted at `/app/tmp`. No cross-service database coupling.

### Endpoint surface

Public (regime-engine):
- `GET /health`, `GET /version`, `GET /v1/openapi.json` (existing)
- `POST /v1/plan` (existing — not called by CLMM this sprint)
- `POST /v1/execution-result` (existing — plan-linked, unchanged)
- `GET /v1/report/weekly` (existing — unchanged)
- `POST /v1/sr-levels` (NEW, shared-secret via `X-Ingest-Token`)
- `GET /v1/sr-levels/current?symbol&source` (NEW, public read)

Internal + shared-secret (regime-engine):
- `POST /v1/clmm-execution-result` (NEW, shared-secret via `X-CLMM-Internal-Token`)

### Data flows

**S/R ingestion:**
```
OpenClaw daily cron
  → POST /v1/sr-levels + X-Ingest-Token
    → regime-engine validates (Zod), persists brief + levels in one transaction
      → append-only ledger rows
Expo PWA levels screen
  → GET /v1/sr-levels/current?symbol=SOL/USDC&source=mco (public)
    → regime-engine returns latest brief rows
```

**Execution-result flow (terminal state only):**
```
pg-boss ReconciliationJobHandler tick
  → application ReconcileExecutionAttempt
    → executionRepo.saveAttempt({ lifecycleState: finalState })
    → historyRepo.appendEvent({ eventType: confirmed|partial|failed })
    → regimeEngineNotificationPort.notifyExecutionTerminalState(...)  [NEW, best-effort]
      → RegimeEngineHttpAdapter POST /v1/clmm-execution-result (retry 3x, swallow on final failure)
        → regime-engine appends to clmm_execution_events (canonical-JSON idempotency)
```

The outbound notification fires **only** on truly-terminal states: `confirmed | failed`. `partial` is transient (it can later resolve to `confirmed` or `failed`); firing on `partial` would cause 409 conflicts on the inevitable follow-up reconciliation with the same `correlationId`. Wait for resolution. `pending` never notifies. Notification failure never rolls back the execution record — the chain is authoritative.

## 6. Implementation units

```
U1 ──┐
     ├─> U4 (needs U1's read endpoint)
     │
U2 ──┼─> U3 (needs U2's CLMM ingest endpoint)
     │
U1+U2+U3+U4 ──> U5
```

### Unit 1 — regime-engine: S/R ledger + ingest + read API (~4h)

**Files:**
- Modify `src/ledger/schema.sql`
- Create `src/ledger/srLevelsWriter.ts`
- Modify `src/contract/v1/types.ts`
- Modify `src/contract/v1/validation.ts`
- Create `src/http/auth.ts`
- Create `src/http/handlers/srLevelsIngest.ts`
- Create `src/http/handlers/srLevelsCurrent.ts`
- Modify `src/http/routes.ts`
- Modify `src/http/openapi.ts`
- Create `src/http/__tests__/srLevels.e2e.test.ts`

**Schema additions:**

```sql
CREATE TABLE IF NOT EXISTS sr_level_briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  brief_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  source_recorded_at_iso TEXT,
  summary TEXT,
  brief_json TEXT NOT NULL,
  captured_at_unix_ms INTEGER NOT NULL,
  UNIQUE (source, brief_id)
);

CREATE TABLE IF NOT EXISTS sr_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id INTEGER NOT NULL REFERENCES sr_level_briefs(id),
  level_type TEXT NOT NULL CHECK (level_type IN ('support','resistance')),
  price REAL NOT NULL,
  timeframe TEXT,
  rank TEXT,
  invalidation REAL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_sr_level_briefs_current
  ON sr_level_briefs(symbol, source, captured_at_unix_ms DESC);
```

**Behavior:**

- Ingest: validate → in one `runInTransaction`, insert brief row + all level rows. On duplicate `(source, brief_id)`, compare canonical JSON; byte-equal → return `{ status: 'already_ingested' }` (200); differing → return 409.
- Current read: single query joining `sr_level_briefs` (latest by `captured_at_unix_ms` for `(symbol, source)`) + its `sr_levels` rows. 404 if no brief exists.
- Auth: `src/http/auth.ts` exports `requireSharedSecret(request, headerName, envVar): void | throws 401`. Used by both new write routes (this one and CLMM-ingest in Unit 2).

**Test scenarios:**
- Happy: POST valid → 201 with `{ brief_id, inserted_count }`; GET current returns latest levels grouped by `level_type`, sorted by `price`.
- Idempotency: re-POST byte-identical brief → 200 `already_ingested`; does not duplicate rows.
- Conflict: re-POST same `(source, brief_id)` with different levels → 409.
- Auth: missing/wrong `X-Ingest-Token` → 401 without writing.
- Validation: empty `levels` array → 400; malformed payload → 400 via `validationErrorFromZod`.
- History preservation: after two briefs for same `(symbol, source)`, only the latest appears in GET current; the older brief's rows still exist in DB.

### Unit 2 — regime-engine: CLMM execution ingest (~3h)

**Files:**
- Modify `src/ledger/schema.sql`
- Modify `src/ledger/writer.ts` (add `writeClmmExecutionEvent`)
- Modify `src/contract/v1/types.ts` (add `ClmmExecutionEventRequest`, `ClmmExecutionEventResponse`)
- Modify `src/contract/v1/validation.ts`
- Create `src/http/handlers/clmmExecutionResult.ts`
- Modify `src/http/routes.ts`
- Modify `src/http/openapi.ts`
- Create `src/http/__tests__/clmmExecutionResult.e2e.test.ts`
- Modify `src/ledger/__tests__/ledger.test.ts` (add CLMM-event cases)

**Schema:**

```sql
CREATE TABLE IF NOT EXISTS clmm_execution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  correlation_id TEXT NOT NULL UNIQUE,
  event_json TEXT NOT NULL,
  received_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clmm_execution_events_correlation
  ON clmm_execution_events(correlation_id);
```

**`ClmmExecutionEventRequest` shape** (matches sprint doc §4 field list):

```typescript
{
  schemaVersion: "1.0",
  correlationId: string,          // CLMM attempt id
  walletId: string,
  positionMint: string,
  poolAddress: string,
  breachDirection: "LowerBoundBreach" | "UpperBoundBreach",
  tickLower: number,
  tickUpper: number,
  tickAtDetection: number,
  detectedAtIso: string,
  reconciledAtIso: string,
  txSignature: string,
  tokenOut: "SOL" | "USDC",
  amountOutRaw: string,           // raw token amount, precision-safe string
  status: "confirmed" | "partial" | "failed"
}
```

Derive `tokenOut` from `breachDirection` per sprint policy (lower → USDC, upper → SOL).

**`writeClmmExecutionEvent`** mirrors `writeExecutionResultLedgerEntry`:
- Canonical-JSON of `input.event`.
- If existing row with same `correlation_id`: byte-equal → `{ inserted: false, idempotent: true }`; differing → throw `LedgerWriteError(EXECUTION_RESULT_CONFLICT, ...)` (reuse existing code).
- Else: insert. Return `{ inserted: true, idempotent: false }`.

**Handler `POST /v1/clmm-execution-result`:**
- Shared-secret via `requireSharedSecret(request, 'X-CLMM-Internal-Token', 'CLMM_INTERNAL_TOKEN')`.
- Zod validation → 400.
- `writeClmmExecutionEvent` → 200 with `{ ok: true, correlationId, idempotent?: boolean }` on success; 409 on conflict.

**Test scenarios:**
- Happy: valid POST → 200, row persisted.
- Idempotent replay: byte-equal → 200 `idempotent: true`, no new row.
- Conflict: same `correlationId`, different payload → 409.
- Auth: missing/wrong token → 401.
- Validation: malformed payload → 400.
- **Non-regression:** existing `/v1/execution-result` e2e tests pass unchanged.

### Unit 3 — CLMM: outbound notification port + reconciliation wiring (~4h)

**Target repo:** `clmm-superpowers-v2`

**Files:**
- Modify `packages/application/src/ports/index.ts` (add `RegimeEngineNotificationPort`)
- Modify `packages/application/src/use-cases/execution/ReconcileExecutionAttempt.ts`
- Modify `packages/application/src/use-cases/execution/ReconcileExecutionAttempt.test.ts`
- Create `packages/adapters/src/outbound/regime-engine/RegimeEngineHttpAdapter.ts`
- Create `packages/adapters/src/outbound/regime-engine/RegimeEngineNoOpAdapter.ts`
- Create `packages/adapters/src/outbound/regime-engine/RegimeEngineHttpAdapter.test.ts`
- Modify `packages/adapters/src/inbound/jobs/ReconciliationJobHandler.ts` (inject new port)
- Modify `packages/adapters/src/composition/AdaptersModule.ts` (wire port, select no-op vs http by env)

**Port:**

```typescript
export interface RegimeEngineNotificationPort {
  notifyExecutionTerminalState(event: {
    correlationId: string;
    walletId: string;
    positionMint: string;
    poolAddress: string;
    breachDirection: 'LowerBoundBreach' | 'UpperBoundBreach';
    tickLower: number;
    tickUpper: number;
    tickAtDetection: number;
    detectedAtIso: string;
    reconciledAtIso: string;
    txSignature: string;
    tokenOut: 'SOL' | 'USDC';
    amountOutRaw: string;
    status: 'confirmed' | 'partial' | 'failed';
  }): Promise<void>;
}
```

**Wiring in `ReconcileExecutionAttempt`:**

After the existing `historyRepo.appendEvent(...)` and only when `finalState.kind` is `'confirmed'` or `'failed'` (not `'partial'` or `'pending'`), call `regimeEngineNotificationPort.notifyExecutionTerminalState(...)`. Read enrichment context (walletId, positionMint, poolAddress, ticks, detectedAtIso) from the attempt record + trigger repository — **no domain DTO changes**. The adapter swallows errors, so this call cannot fail the use case; still wrap in `try/catch` in the use case as belt-and-suspenders.

**`RegimeEngineHttpAdapter` behavior:**
- POST to `${REGIME_ENGINE_INTERNAL_URL}/v1/clmm-execution-result` with header `X-CLMM-Internal-Token: ${CLMM_INTERNAL_TOKEN}`.
- 5s timeout (AbortController).
- 3 retry attempts, exponential backoff starting 500ms (500/1000/2000).
- On final failure: log ERROR with full payload (use existing `ObservabilityPort` if present, else NestJS `Logger`). Swallow exception.
- No circuit breaker.

**`RegimeEngineNoOpAdapter`:** logs a single debug line per call. Selected in `AdaptersModule` when `REGIME_ENGINE_INTERNAL_URL` or `CLMM_INTERNAL_TOKEN` is unset. Preserves local dev ergonomics.

**Test scenarios:**
- Unit (adapter): happy 200; 5xx triggers retry then success; 3× 5xx → logs + resolves (no throw); timeout → retry.
- Unit (adapter): no-op selected when env missing.
- Use case: notification called after `saveAttempt` and `appendEvent` when `finalState.kind` is `confirmed` or `failed` (call-order assertion).
- Use case: notification NOT called when `finalState.kind` is `pending` or `partial`.
- Use case: adapter throwing does not affect returned `ReconcileResult`.

### Unit 4 — CLMM: levels display screen (~1.5h)

**Target repo:** `clmm-superpowers-v2`

**Files:**
- Create `apps/app/app/levels.tsx`
- Modify `apps/app/app/_layout.tsx` (register route in nav if needed)

**Approach:**

Single Expo Router screen. Direct `fetch(${EXPO_PUBLIC_REGIME_ENGINE_URL}/v1/sr-levels/current?symbol=SOL/USDC&source=mco)` in a `useEffect`. No port, no use-case, no adapter. The read is a public unauthenticated HTTPS GET; hexagonal ceremony here would be over-engineering for a read-only display.

**States rendered:**
- Loading: spinner
- Success: support levels grouped, resistance levels grouped, each sorted by `price` ascending; each shows `rank` badge and `price`; `capturedAt` timestamp shown once at top
- 404 or empty: "No levels available — check OpenClaw ingestion"
- Other HTTP error: "Could not load levels" with a retry button
- `EXPO_PUBLIC_REGIME_ENGINE_URL` missing: "Regime engine not configured"

**Environment variable:** `EXPO_PUBLIC_REGIME_ENGINE_URL` — Railway reference variable pointing to the regime-engine public domain.

### Unit 5 — Deploy + manual validation runbook (~3h)

**Files — regime-engine:**
- Modify `.env.example` (add `OPENCLAW_INGEST_TOKEN`, `CLMM_INTERNAL_TOKEN`, document `LEDGER_DB_PATH`, `HOST`)
- Modify `src/server.ts` (default `HOST=::`)
- Create `docs/deploy-railway.md` (ordered runbook)
- Create `docs/e2e-runbook.md` (manual validation with copy-pasteable curls)
- Modify `README.md` (link to both runbooks; list new endpoints)

**Files — clmm-superpowers-v2:**
- Modify `apps/app/app.json` or `.env.example` to document `EXPO_PUBLIC_REGIME_ENGINE_URL`
- Modify `packages/adapters/.env.example` (add `REGIME_ENGINE_INTERNAL_URL`, `CLMM_INTERNAL_TOKEN`)

**Deploy runbook `docs/deploy-railway.md` — ordered steps:**

1. **Provision Railway volume at `/app/tmp` FIRST.** Without this, SQLite writes go to ephemeral FS and vanish on redeploy. This is step 0, not a footnote.
2. Set env vars:
   - `HOST=::`
   - `PORT` (Railway-injected)
   - `LEDGER_DB_PATH=/app/tmp/ledger.sqlite`
   - `OPENCLAW_INGEST_TOKEN=<32-byte random>`
   - `CLMM_INTERNAL_TOKEN=<32-byte random, different from OPENCLAW>`
3. Enable public domain.
4. Deploy. Verify:
   - `curl https://<public>/health` → `{"ok":true}`
   - `curl https://<public>/v1/sr-levels/current?symbol=SOL/USDC&source=mco` → 404 (empty ledger)
5. In CLMM Railway project, add reference variables:
   - `REGIME_ENGINE_INTERNAL_URL=http://regime-engine.railway.internal:${{regime-engine.PORT}}`
   - `CLMM_INTERNAL_TOKEN` (same value as regime-engine)
   - `EXPO_PUBLIC_REGIME_ENGINE_URL=https://<regime-engine-public-domain>`
6. Redeploy CLMM. Verify from CLMM container:
   - `curl $REGIME_ENGINE_INTERNAL_URL/health` → 200

**E2E runbook `docs/e2e-runbook.md` — concrete commands:**

```bash
# 1. Seed an S/R brief
curl -X POST https://$REGIME/v1/sr-levels \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: $OPENCLAW_INGEST_TOKEN" \
  -d '{"source":"mco","symbol":"SOL/USDC","brief":{"briefId":"mco-2026-04-17","sourceRecordedAtIso":"2026-04-17T10:00:00Z","summary":"Test brief"},"levels":[{"levelType":"support","price":142.5,"timeframe":"daily","rank":"key"},{"levelType":"resistance","price":158.0,"timeframe":"daily","rank":"key"}]}'
# Expect: 201 with {"briefId":"mco-2026-04-17","insertedCount":2}

# 2. Verify current read
curl "https://$REGIME/v1/sr-levels/current?symbol=SOL/USDC&source=mco"
# Expect: 200 with latest brief + 2 levels sorted by price

# 3. Idempotent replay
# Re-run command 1. Expect: 200 with {"status":"already_ingested"}

# 4. Seed a CLMM execution event directly (simulates adapter)
curl -X POST https://$REGIME/v1/clmm-execution-result \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: $CLMM_INTERNAL_TOKEN" \
  -d '{"schemaVersion":"1.0","correlationId":"test-corr-001","walletId":"test-wallet","positionMint":"...","poolAddress":"...","breachDirection":"LowerBoundBreach","tickLower":-1000,"tickUpper":1000,"tickAtDetection":-1100,"detectedAtIso":"2026-04-17T12:00:00Z","reconciledAtIso":"2026-04-17T12:01:00Z","txSignature":"...","tokenOut":"USDC","amountOutRaw":"123456789","status":"confirmed"}'
# Expect: 200 with {"ok":true,"correlationId":"test-corr-001"}

# 5. Verify ledger state (from Railway CLI or psql-like access)
# sqlite3 /app/tmp/ledger.sqlite 'SELECT correlation_id, status FROM clmm_execution_events'

# 6. Trigger real reconciliation (after CLMM is integrated and a position is monitored)
# See CLMM's ReconciliationJobHandler fixtures

# 7. Idempotent replay of CLMM event — re-run command 4 — expect 200 idempotent
# 8. Conflict check — change one field (e.g. status to 'failed') with same correlationId — expect 409
```

**Manual validation gate (Weekend 2 Saturday evening):** run steps 1-8 once against deployed environment. Any failure → fix → re-run. Do not CI-automate this.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Deploying regime-engine without mounting the Railway volume first → ledger silently ephemeral. | Unit 5 step 0 is "provision volume before first deploy" with explicit checkbox. |
| Posting to regime-engine before chain confirmation. | Hook is `ReconcileExecutionAttempt` with `finalState.kind !== 'pending'` guard, not `SubmitExecutionAttempt`. |
| Outbound adapter failure blocking CLMM execution. | Adapter swallows on final failure; use case wraps call in try/catch. On-chain state is authoritative. |
| OpenClaw brief format diverges from proposed `POST /v1/sr-levels` shape. | Translation lives on OpenClaw side; regime-engine canonical schema is fixed. Until OpenClaw emits, use the curl runbook to seed manually. |
| Railway reference variables for private hostname get mis-wired. | Step 6 of deploy runbook verifies `curl $REGIME_ENGINE_INTERNAL_URL/health` from CLMM container before declaring deploy healthy. |
| Expo `EXPO_PUBLIC_*` vars require rebuild to pick up changes. | Document in Unit 5 that changing the URL requires a redeploy of CLMM web. |
| Scope creep ("while I'm in here..."). | Every such thought goes in the respective repo's `docs/post-shelf-ideas.md`. Do not enter sprint. |

## 8. Explicit forbidden list

1. No `POST /v1/plan` calls from CLMM.
2. No runtime regime filter on exits.
3. No weekly-report changes.
4. No multi-analyst support beyond `mco`.
5. No shared libraries between repos.
6. No auth beyond shared-secret headers.
7. No platform migration away from Railway.
8. No capital ramp above $100.
9. No Postgres/Drizzle migration for regime-engine.
10. No domain DTO enrichment in CLMM to serve the outbound integration.

## 9. Budget and gates

| Phase | Units | Gate |
|---|---|---|
| Weekend 1 Saturday | U1, U2 (regime-engine) | Both unit test suites green against `:memory:` SQLite |
| Weekend 1 Sunday | U3 (CLMM adapter + reconciliation wiring) | Adapter unit tests + `ReconcileExecutionAttempt.test.ts` green |
| Weekend 2 Saturday AM | U5 deploy | Both services healthy on Railway; internal curl works |
| Weekend 2 Saturday PM | U4 + U5 E2E | Levels screen renders; manual runbook steps 1-8 pass |
| Weekend 2 Sunday | Live $100 | Funded, position opened, monitor running |

**Hard stop:** if Weekend 1 ends without U1+U2+U3 green, shelf the sprint. Pronghorn starts Monday regardless.

## 10. After the sprint

The sprint ends Sunday. Monday is Pronghorn. Shelf state:
- Live $100 position running on Railway
- Truth ledger accumulating CLMM execution events
- S/R levels refreshing daily from OpenClaw (or manually-seeded until OpenClaw emits)
- No active development

Revisit at end of month 1. Decisions about graduating capital, adding whipsaw filtering, or tuning regime logic wait until 30+ days of real data exist.

## 11. Sources

- Origin sprint draft: `docs/2026-04-17-clmm-regime-engine-integration-sprint.md`
- Prior GPT plan reviewed: `docs/plans/2026-04-17-001-feat-clmm-regime-engine-integration-plan.md`
- Code: `regime-engine/src/ledger/writer.ts`, `regime-engine/src/http/routes.ts`, `regime-engine/src/contract/v1/types.ts`
- Code: `clmm-superpowers-v2/packages/application/src/use-cases/execution/ReconcileExecutionAttempt.ts`
- Code: `clmm-superpowers-v2/packages/adapters/src/inbound/jobs/ReconciliationJobHandler.ts`
- Code: `clmm-superpowers-v2/packages/adapters/src/outbound/` (existing adapter patterns)
- External: Railway Volumes docs, Railway Private Networking docs, Railway Reference Variables docs
