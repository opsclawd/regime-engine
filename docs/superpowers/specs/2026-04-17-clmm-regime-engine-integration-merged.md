# Design: CLMM + Regime Engine Integration Sprint (Merged Spec)

**Date:** 2026-04-17
**Status:** Draft
**Origin:** Merger of GPT plan (`docs/plans/2026-04-17-001`) and Opus plan (`docs/superpowers/specs/2026-04-17-clmm-regime-engine-integration-design.md`)
**Budget:** ~15.5h, two weekends. Weekend-1 cutoff still applies.
**Target repos:** `regime-engine`, `clmm-superpowers-v2`

---

## Comparative Analysis

### GPT plan got right

1. **Explicit requirements trace** — every unit maps numbered requirements (R1–R13). Easy to verify completeness.
2. **Dependency graph** — clear unit dependencies with a mermaid flowchart showing which units block which.
3. **Phased delivery** — Phase 1 (regime-engine only), Phase 2 (CLMM only), Phase 3 (deploy). Clean separation for weekend scheduling.
4. **BFF-mediated reads** — correctly keeps the Expo/web client on the existing BFF path for position detail enrichment. No direct client→regime-engine calls for position data.
5. **Idempotency+conflict handling** — detailed rules for duplicate brief ingestion (byte-equal → idempotent, different → 409) and CLMM execution event replay.
6. **System-wide impact section** — lists state-lifecycle risks, error propagation, and integration-coverage gaps honestly.
7. **Detailed test scenarios per unit** — includes edge cases like empty levels array, missing source parameter, and call-order assertions in CLMM tests.

### GPT plan got wrong

1. **Weekly report integration in this sprint** — Unit 3 modifies `src/report/weekly.ts` and its snapshots. The sprint non-goals correctly exclude this ("Report work is post-shelf"). Adding a CLMM section to weekly reports inflates scope without validated user need.
2. **No concrete schema** — talks about schema additions but never shows the SQL DDL, making implementation ambiguous.
3. **No explicit payload shape** — lists semantic fields but doesn't define the exact `ClmmExecutionEventRequest` TypeScript type, leaving field names and types to guesswork.
4. **No budget/gate structure** — has phased delivery but no time estimates or hard stops.
5. **`pending` and `partial` notification** — implies notification could fire on `partial` state, which is transient and resolves later, creating 409 conflicts.

### Original Opus plan got right

1. **Concrete schema DDL** — shows exact SQL for both `sr_level_briefs`/`sr_levels` and `clmm_execution_events`. Implementable without interpretation.
2. **Concrete payload type** — defines the exact `ClmmExecutionEventRequest` TypeScript shape with field names, types, and rationale.
3. **Budget and gates** — explicit time estimates per unit, weekend cut points, and a hard stop rule.
4. **Deploy runbook** — step-by-step Railway deployment with numbered steps, explicit "volume FIRST" warning, and copy-pasteable verification curls.
5. **E2E runbook with concrete curl commands** — testable by any human without reading code.
6. **`partial` exclusion rationale** — explicitly explains why `partial` is never notified.
7. **Explicit forbidden list** — prevents scope creep.

### Original Opus plan got wrong

1. **Single notification seam** — hooked only into `ReconcileExecutionAttempt`. `ExecutionController.submitExecution` performs inline `reconcileExecution()` and persists terminal state before returning. A single seam would miss every fast-chain confirmation.
2. **Application-layer port** — `RegimeEngineNotificationPort` in `packages/application` adds architectural surface area for a sprint-scoped analytics transport. Both terminal seams live in `packages/adapters`; the notification wiring stays cleaner as adapter-layer.
3. **Direct Expo fetch** — `EXPO_PUBLIC_REGIME_ENGINE_URL` meant the Expo app called regime-engine directly, violating the single-BFF principle. No server-side degradation layer, CORS concerns, and rebuild-on-URL-change.
4. **`status: "partial"` in the CLMM contract** — if partial is never sent, it shouldn't be in the wire contract. It invites misuse.
5. **No BFF enrichment** — S/R levels in a standalone screen requires mental correlation with position data. The position detail screen is where S/R context matters.

### Refinements adopted from Opus's revised spec

After reviewing Opus's refined spec, three corrections were adopted:

1. **Dual seam for notifications** — verified against `ExecutionController.submitExecution` which performs inline `reconcileExecution()` and persists terminal `confirmed`/`failed` before the HTTP response returns. Both the controller and the worker must notify. Idempotency on `correlationId` makes duplicate posts safe.
2. **Adapter-layer wiring, no application port** — analytics transport to an external sink is adapter infrastructure. Both terminal-state seams already live in `packages/adapters`. No need to propagate into `packages/application`.
3. **`status: "confirmed" | "failed"` only** — the wire contract reflects what actually travels. `partial` is never sent and is excluded from the type.

---

## What I'm taking from each plan

| Aspect                                                    | Source            | Reason                                                                    |
| --------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| Dual seam: ExecutionController + ReconciliationJobHandler | Opus revised      | Single seam misses inline confirmations; both seams verified against code |
| Adapter-layer wiring (no application port)                | Opus revised      | Analytics transport is adapter infrastructure, not domain logic           |
| `status: "confirmed" \| "failed"` only in contract        | Opus revised      | Wire contract reflects reality; no `partial` to invite misuse             |
| Concrete schema DDL                                       | Opus              | Implementable without interpretation                                      |
| Concrete payload type                                     | Opus              | Exact TypeScript shape, precision-safe strings for amounts                |
| Budget, gates, hard-stop rule                             | Opus              | Time estimates per unit, weekend cutoffs, explicit shelf criteria         |
| Deploy runbook with "volume FIRST"                        | Opus              | Prevents silent ephemeral data loss                                       |
| E2E runbook with copy-pasteable curls                     | Opus              | Testable by any human                                                     |
| Explicit forbidden list                                   | Opus              | Prevents scope creep                                                      |
| BFF enrichment of position detail with S/R                | GPT               | S/R levels belong alongside position context, not on a separate screen    |
| Requirements trace (R1–R13) per unit                      | GPT               | Verifiable completeness                                                   |
| Detailed test scenarios per unit                          | GPT               | Edge cases like transaction rollback, empty arrays, call-order assertions |
| Shared-secret auth on write endpoints                     | Both (aligned)    | No disagreement                                                           |
| Separate CLMM ingest endpoint                             | Both (aligned)    | Both correctly reject plan-linked endpoint reuse                          |
| Weekly report integration                                 | Neither (dropped) | Post-shelf work                                                           |

## What I'm changing from my prior merged draft

1. **Dual notification seam** — my prior draft used a single seam in `ReconcileExecutionAttempt`. Opus's revised spec verified that `ExecutionController.submitExecution` performs inline `reconcileExecution()` and persists terminal state. Both the controller (Path A: inline reconciliation on fast chain confirmation) and the worker (Path B: later reconciliation for stuck attempts) must notify. The adapter is shared between both seams, and regime-engine's idempotency on `correlationId` makes duplicate posts safe.

2. **Adapter-layer wiring, no application port** — my prior draft created `RegimeEngineNotificationPort` in `packages/application`. Opus's revised spec correctly identifies that analytics transport is adapter infrastructure. Both seams live in `packages/adapters`; wiring stays there via Nest DI tokens. No propagation into the domain/application layer.

3. **`status: "confirmed" | "failed"` only** — my prior draft included `"partial"` in the TypeScript type with a comment saying "never sent." Opus's revised spec constrains the type to only what travels over the wire. If partial notification is ever needed, the contract can be widened then.

4. **Dropped standalone levels screen** — my prior draft kept a theoretical "standalone screen" path. The BFF enrichment makes it redundant for a 15h sprint. One path, less scope.

5. **Added `txFeesUsd`, `priorityFeesUsd`, `slippageUsd` as optional cost fields** — from Opus revised spec. Additive fields CLMM can provide if available, omitted without breaking the contract.

6. **Env var names aligned** — `REGIME_ENGINE_BASE_URL` (not `REGIME_ENGINE_INTERNAL_URL`), `REGIME_ENGINE_INTERNAL_TOKEN` (not `CLMM_INTERNAL_TOKEN` on the CLMM side). Backend-only; no `EXPO_PUBLIC_REGIME_ENGINE_URL`.

---

## 1. Problem

Three gaps between "MVP works" and "running live with $100":

1. OpenClaw briefs have no durable store. Each daily brief is ephemeral. Position-placement decisions can't reference current active levels.
2. CLMM has no feedback path to Regime Engine. Execution outcomes stay inside CLMM. The truth ledger can't accumulate the data weekly reports need.
3. Neither service is deployed together. Regime Engine runs locally; CLMM runs on Railway.

This sprint closes those three gaps and gets the combined system running live with $100 on one SOL/USDC position.

## 2. Goals

- S/R levels from OpenClaw persist in regime-engine's SQLite ledger, queryable by `(symbol, source)`.
- CLMM posts execution results to regime-engine after every **reconciled terminal state** (`confirmed` / `failed`). `partial` remains transient and notifies on later resolution.
- Both services deployed in the same Railway project with internal + public networking.
- End-to-end manual validation exercises the full path: brief ingest → BFF-enriched position-detail read → breach → reconcile → execution-result POST → ledger persistence → idempotent replay.
- Live $100 deployment on one SOL/USDC position.

## 3. Non-Goals

1. No `/v1/plan` calls from CLMM. Plans remain analytics-only.
2. No runtime regime filter gating CLMM exits. Breach direction determines exit direction.
3. No dashboards, report tuning, or weekly-report CLMM-section integration. Report work is post-shelf. The ledger accumulates events; report consumption is out of scope.
4. No multi-analyst support beyond `source: 'mco'`.
5. No whipsaw filtering, confidence weighting, or level-expiry policies.
6. No monitoring, alerting, or kill-switch infrastructure.
7. No shared libraries between repos. HTTP is the only coupling.
8. No auth beyond shared-secret headers.
9. No migration to Postgres/Drizzle for regime-engine. SQLite stays.
10. No new application-layer port in `clmm-superpowers-v2` for analytics notification. Adapter-layer wiring only.
11. No direct Expo/web fetch to regime-engine. The BFF remains the single client-facing surface.
12. No domain DTO enrichment in CLMM to serve the outbound regime-engine integration. (Inbound DTO enrichment for S/R display is allowed — it's additive presentation data, not domain orchestration.)

## 4. Repo reality check

The original sprint doc made assumptions that do not match code reality. This design corrects them:

### regime-engine

- Uses `node:sqlite` (native) + raw SQL with canonical-JSON payloads in `src/ledger/`. **Not** Postgres/Drizzle. A migration to Postgres/Drizzle is out of scope.
- `POST /v1/execution-result` is **plan-linked**: `src/ledger/writer.ts:80-94` fails with `PLAN_NOT_FOUND` if no prior plan exists for the `planId`. CLMM cannot reuse this endpoint without calling `/v1/plan` first, which the sprint forbids. A **new** endpoint is required.
- Ledger is append-only by architectural commitment (`architecture.md:187`). "Current S/R set" is derived via `ORDER BY captured_at_unix_ms DESC LIMIT 1`, not by mutating a `superseded_at` column.
- Server binds `0.0.0.0:8787` today. Dockerfile already mounts `/app/tmp` and runs as non-root `app` user.
- Canonical-JSON equality for idempotency/conflict detection is a reusable pattern in `src/ledger/writer.ts:113-124`. New CLMM ingest reuses it.

### clmm-superpowers-v2 (the real CLMM)

- pnpm + turbo monorepo. `@clmm/domain`, `@clmm/application`, `@clmm/adapters`, `@clmm/ui`, `@clmm/testing`, `@clmm/config`. Not `clmm-v2` (which is scaffolding).
- Real stack: NestJS + Fastify API, pg-boss workers (`BreachScanJobHandler`, `ReconciliationJobHandler`, `TriggerQualificationJobHandler`, `NotificationDispatchJobHandler`), Drizzle + Postgres.
- Expo Router PWA at `apps/app/app/` routes through `EXPO_PUBLIC_BFF_BASE_URL` via `apps/app/src/api/positions.ts`. The client does not — and should not — address any backend other than the BFF.
- **Terminal-state reconciliation happens at two seams**, not one:
  - `packages/adapters/src/inbound/http/ExecutionController.ts` — `submitExecution` performs `submissionPort.submitExecution(...)` immediately followed by `submissionPort.reconcileExecution(references)`. If `reconciliation.finalState` exists, the controller persists it and appends the lifecycle event inline before returning.
  - `packages/adapters/src/inbound/jobs/ReconciliationJobHandler.ts` → `packages/application/src/use-cases/execution/ReconcileExecutionAttempt.ts` — handles attempts that stayed `submitted` (the chain did not confirm inside the HTTP request window).
    A single seam in `ReconcileExecutionAttempt` would miss every terminal state reached inline in the controller. Notification must hook both.
- `packages/adapters/src/inbound/http/PositionController.ts` already serves the `/positions` BFF surface and is the natural seam for enriching position detail with current S/R levels.
- `packages/adapters/.env.sample` and `apps/app/.env.example` already split backend-only env from app-public env. Regime-engine configuration should remain backend-only.

## 5. Architecture

### Deployment topology (Railway)

```
Railway project: clmm
├── clmm-api            (existing) — NestJS Fastify BFF + Expo web
├── clmm-worker         (existing) — pg-boss workers
├── clmm-postgres       (existing)
└── regime-engine       (NEW)      — Fastify + SQLite on attached volume
```

Regime-engine does **not** share the CLMM Postgres. Its SQLite file lives on a Railway volume mounted at `/app/tmp`. No cross-service database coupling.

### Endpoint surface

Public (regime-engine):

- `GET /health`, `GET /version`, `GET /v1/openapi.json` (existing)
- `POST /v1/plan` (existing — not called by CLMM this sprint)
- `POST /v1/execution-result` (existing — plan-linked, unchanged)
- `GET /v1/report/weekly` (existing — unchanged; CLMM-event rollup deferred post-shelf)
- `POST /v1/sr-levels` (NEW, shared-secret via `X-Ingest-Token`)
- `GET /v1/sr-levels/current?symbol&source` (NEW, read — called server-to-server by CLMM BFF, also reachable publicly for operator inspection)

Internal + shared-secret (regime-engine):

- `POST /v1/clmm-execution-result` (NEW, shared-secret via `X-CLMM-Internal-Token`)

CLMM BFF additions:

- `GET /positions/:walletId/:positionId` — existing route; response DTO extended with optional `srLevels` block populated from regime-engine server-side.

### Data flows

**S/R ingestion:**

```
OpenClaw daily cron
  → POST /v1/sr-levels + X-Ingest-Token
    → regime-engine validates (Zod), persists brief + levels in one transaction
      → append-only ledger rows
```

**S/R read (client-facing):**

```
Expo/web client
  → GET $EXPO_PUBLIC_BFF_BASE_URL/positions/:walletId/:positionId
    → CLMM BFF PositionController
      → if position.poolId matches configured SOL/USDC target-pool allowlist:
         → server-side fetch: GET $REGIME_ENGINE_BASE_URL/v1/sr-levels/current?symbol=SOL/USDC&source=mco
         → on 200: enrich PositionDetailDto.srLevels
         → on 404 / transport failure: omit srLevels (non-fatal)
      → else: omit srLevels (no regime-engine call)
    → client parses additive DTO
```

Clients never call regime-engine directly. The BFF is the only public surface from the browser's perspective.

**Execution-result flow (terminal state — dual seam):**

```
Path A — inline reconciliation (happy path, chain confirms fast):
  ExecutionController.submitExecution
    → submissionPort.submitExecution(...)
    → executionRepo.saveAttempt({ lifecycleState: 'submitted' })
    → appendLifecycleEvent('submitted')
    → submissionPort.reconcileExecution(references)
    → if finalState present:
       → executionRepo.saveAttempt({ lifecycleState: finalState })
       → appendLifecycleEvent(confirmed|failed)
       → regimeEngineExecutionEventAdapter.notify(...)  [NEW, if status ∈ {confirmed, failed}]

Path B — worker reconciliation (attempt stayed submitted):
  ReconciliationJobHandler tick
    → ReconcileExecutionAttempt use case
      → executionRepo.saveAttempt({ lifecycleState: finalState })
      → historyRepo.appendEvent(confirmed|failed)
      → regimeEngineExecutionEventAdapter.notify(...)  [NEW, if status ∈ {confirmed, failed}]

Both paths converge at:
  RegimeEngineExecutionEventAdapter
    → POST $REGIME_ENGINE_BASE_URL/v1/clmm-execution-result + X-CLMM-Internal-Token
      (5s timeout, 3 retries w/ exponential backoff, swallow on final failure)
    → regime-engine appends to clmm_execution_events (canonical-JSON idempotency on correlationId)
```

The outbound notification fires **only** on truly-terminal states: `confirmed | failed`. `partial` is transient (it can later resolve to `confirmed` or `failed`); firing on `partial` would cause 409 conflicts on the inevitable follow-up reconciliation with the same `correlationId`. Wait for resolution. `pending` never notifies. Notification failure never rolls back CLMM state — the chain is authoritative.

The adapter lives in `packages/adapters/src/outbound/regime-engine/` and is injected into both the HTTP and worker composition roots. No application-layer port is introduced: analytics transport is adapter infrastructure, not domain orchestration.

## 6. Implementation units

```
U1 ──┐
     ├─> U4 (needs U1's read endpoint for BFF enrichment)
     │
U2 ──┼─> U3 (needs U2's CLMM ingest endpoint)
     │
U1+U2+U3+U4 ──> U5
```

### Unit 1 — regime-engine: S/R ledger + ingest + read API (~4h)

**Target repo:** `regime-engine`

**Requirements:** R1, R2, R3, R4, R10, R11

**Files:**

- Modify: `src/ledger/schema.sql`
- Create: `src/ledger/srLevelsWriter.ts`
- Modify: `src/contract/v1/types.ts`
- Modify: `src/contract/v1/validation.ts`
- Create: `src/http/auth.ts`
- Create: `src/http/handlers/srLevelsIngest.ts`
- Create: `src/http/handlers/srLevelsCurrent.ts`
- Modify: `src/http/routes.ts`
- Modify: `src/http/openapi.ts`
- Create: `src/http/__tests__/srLevels.e2e.test.ts`
- Create: `src/ledger/__tests__/srLevels.test.ts`
- Modify: `src/http/__tests__/routes.contract.test.ts`

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
- Auth: `src/http/auth.ts` exports `requireSharedSecret(request, headerName, envVar): void | throws 401`. Used by both new write routes. Missing env var fails closed.

**Test scenarios:**

- Happy: POST valid → 201 with `{ briefId, insertedCount }`; GET current returns latest levels grouped by `level_type`, sorted by `price`.
- Idempotency: re-POST byte-identical brief → 200 `already_ingested`; does not duplicate rows.
- Conflict: re-POST same `(source, brief_id)` with different levels → 409.
- Auth: missing/wrong `X-Ingest-Token` → 401 without writing.
- Validation: empty `levels` array → 400; malformed payload → 400 via `validationErrorFromZod`.
- History preservation: after two briefs for same `(symbol, source)`, only the latest appears in GET current; older brief's rows still exist in DB.
- Transaction rollback: simulated level-row failure after brief insertion leaves no partial brief.

### Unit 2 — regime-engine: CLMM execution ingest (~3h)

**Target repo:** `regime-engine`

**Requirements:** R5, R6, R7, R8, R10, R11

**Files:**

- Modify: `src/ledger/schema.sql`
- Modify: `src/ledger/writer.ts` (add `writeClmmExecutionEvent`)
- Modify: `src/contract/v1/types.ts` (add `ClmmExecutionEventRequest`, `ClmmExecutionEventResponse`)
- Modify: `src/contract/v1/validation.ts`
- Create: `src/http/handlers/clmmExecutionResult.ts`
- Modify: `src/http/routes.ts`
- Modify: `src/http/openapi.ts`
- Create: `src/http/__tests__/clmmExecutionResult.e2e.test.ts`
- Modify: `src/ledger/__tests__/ledger.test.ts` (add CLMM-event cases)
- Modify: `src/http/__tests__/routes.contract.test.ts`

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

**`ClmmExecutionEventRequest` shape** (minimum authoritative contract for this sprint):

```typescript
{
  schemaVersion: "1.0",
  correlationId: string,          // CLMM attemptId
  positionId: string,             // CLMM positionId; current repo uses Orca position mint here
  breachDirection: "LowerBoundBreach" | "UpperBoundBreach",
  reconciledAtIso: string,
  txSignature: string,
  tokenOut: "SOL" | "USDC",
  status: "confirmed" | "failed",  // partial is transient — CLMM does not post it
  // Optional enrichment fields: include only when already available at the notification seam.
  episodeId?: string,
  previewId?: string,
  detectedAtIso?: string,
  amountOutRaw?: string,
  txFeesUsd?: number,
  priorityFeesUsd?: number,
  slippageUsd?: number
}
```

Base event construction must rely only on fields already authoritative at the notification seam: attempt id, position id, breach direction, terminal status, reconciliation timestamp, and transaction reference. Richer context is additive only. Do not widen CLMM persistence or add live chain reads in this sprint solely to decorate this event.

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

### Unit 3 — CLMM: outbound execution-event adapter wired at both seams (~4.5h)

**Target repo:** `clmm-superpowers-v2`

**Requirements:** R5, R6, R7, R8, R9, R12

**Files:**

- Create: `packages/adapters/src/outbound/regime-engine/RegimeEngineExecutionEventAdapter.ts`
- Create: `packages/adapters/src/outbound/regime-engine/RegimeEngineExecutionEventAdapter.test.ts`
- Create: `packages/adapters/src/outbound/regime-engine/RegimeEngineExecutionEventNoOp.ts`
- Modify: `packages/adapters/src/composition/AdaptersModule.ts` (provider wiring + env-driven no-op selection)
- Modify: `packages/adapters/src/inbound/http/AppModule.ts`
- Modify: `packages/adapters/src/inbound/http/tokens.ts`
- Modify: `packages/adapters/src/inbound/jobs/tokens.ts`
- Modify: `packages/adapters/src/inbound/http/ExecutionController.ts` (inject + invoke after inline reconciliation)
- Modify: `packages/adapters/src/inbound/http/ExecutionController.test.ts`
- Modify: `packages/adapters/src/inbound/jobs/ReconciliationJobHandler.ts` (inject + invoke after worker reconciliation)
- Modify: `packages/adapters/src/inbound/jobs/ReconciliationJobHandler.test.ts`

**Why adapter-layer, not an application port:**

Analytics notification to an external sink is adapter infrastructure. Introducing a `RegimeEngineNotificationPort` in `packages/application` would surface a cross-cutting analytics dependency inside the application layer for a sprint-scoped integration. Both terminal-state seams (`ExecutionController` inline reconciliation and `ReconciliationJobHandler`) live in `packages/adapters`, so adapter-layer wiring keeps the blast radius inside the runtime composition roots and leaves domain/application untouched.

**Adapter interface (adapter-local, not exported as a port):**

```typescript
export interface RegimeEngineExecutionEventInput {
  correlationId: string; // CLMM attemptId
  positionId: string; // CLMM positionId; current repo uses Orca position mint here
  breachDirection: "LowerBoundBreach" | "UpperBoundBreach";
  reconciledAtIso: string;
  txSignature: string;
  tokenOut: "SOL" | "USDC";
  status: "confirmed" | "failed";
  episodeId?: string;
  previewId?: string;
  detectedAtIso?: string;
  amountOutRaw?: string;
  txFeesUsd?: number;
  priorityFeesUsd?: number;
  slippageUsd?: number;
}

export interface RegimeEngineExecutionEventAdapter {
  notify(input: RegimeEngineExecutionEventInput): Promise<void>;
}
```

Both the controller and the job handler depend on `RegimeEngineExecutionEventAdapter` via their respective Nest provider tokens.

**Wiring at seam A (`ExecutionController.submitExecution`):**

After inline reconciliation, at the existing point where the terminal `lifecycleState` has been saved via `executionRepo.saveAttempt(...)` and the lifecycle event appended, call:

```typescript
if (
  reconciliation.finalState?.kind === "confirmed" ||
  reconciliation.finalState?.kind === "failed"
) {
  try {
    await this.regimeEngineExecutionEventAdapter.notify(
      buildExecutionEventInput(attempt, reconciliation.finalState)
    );
  } catch {
    // Adapter already swallows; belt-and-suspenders against leaks.
  }
}
```

`partial` does not notify — the attempt will converge to `confirmed` or `failed` in a later reconciliation. `pending` does not notify.

**Wiring at seam B (`ReconciliationJobHandler` → `ReconcileExecutionAttempt`):**

After the existing `historyRepo.appendEvent(...)` completes, apply the same `confirmed | failed` guard and the same `notify(...)` call. Input construction helper lives next to the adapter so both seams share it.

Build the base event input from the stored attempt plus the terminal reconciliation state. Optional enrichment (`episodeId`, `previewId`, `detectedAtIso`, execution economics) may be appended only when already available from existing repositories/types at the seam. Do not add CLMM persistence, reverse wallet lookups, or live chain reads in this sprint solely to widen the analytics payload.

**`RegimeEngineExecutionEventAdapter` behavior (HTTP impl):**

- POST to `${REGIME_ENGINE_BASE_URL}/v1/clmm-execution-result` with header `X-CLMM-Internal-Token: ${REGIME_ENGINE_INTERNAL_TOKEN}`.
- 5s timeout (AbortController).
- 3 retry attempts, exponential backoff starting 500ms (500/1000/2000).
- On final failure: log ERROR with full payload via existing observability seam (or NestJS `Logger`). Swallow exception.
- No circuit breaker.

**`RegimeEngineExecutionEventNoOp`:** logs a single debug line per call. Selected in `AdaptersModule` when `REGIME_ENGINE_BASE_URL` or `REGIME_ENGINE_INTERNAL_TOKEN` is unset. Preserves local dev ergonomics.

**Test scenarios:**

- Adapter unit: happy 200; 5xx triggers retry then success; 3× 5xx → logs + resolves (no throw); timeout → retry then eventual swallow.
- Adapter unit: no-op selected when env missing.
- Controller: notification called after `saveAttempt` and `appendLifecycleEvent` when inline `finalState.kind` is `confirmed` or `failed` (call-order assertion).
- Controller: notification NOT called when inline `finalState` is absent, `kind: 'pending'`, or `kind: 'partial'`.
- Controller: adapter throwing does not affect the HTTP response.
- Job handler: notification called after `saveAttempt` and `historyRepo.appendEvent` when worker-reached `finalState.kind` is `confirmed` or `failed`.
- Job handler: notification NOT called on `partial` / `pending`.
- Job handler: adapter throwing does not affect the returned reconciliation result.
- Integration: replaying the same `attemptId` is safe because regime-engine returns idempotent success.

### Unit 4 — CLMM: BFF-enriched position detail with current S/R levels (~3h)

**Target repo:** `clmm-superpowers-v2`

**Requirements:** R3, R4, R9, R10, R12

**Goal:** Surface current regime-engine levels in CLMM's existing position-detail view through the BFF. No direct client fetch to regime-engine.

**Files:**

- Modify: `packages/application/src/dto/index.ts` (additive optional `srLevels` block on `PositionDetailDto`)
- Create: `packages/adapters/src/outbound/regime-engine/CurrentSrLevelsAdapter.ts`
- Create: `packages/adapters/src/outbound/regime-engine/CurrentSrLevelsAdapter.test.ts`
- Modify: `packages/adapters/src/inbound/http/AppModule.ts`
- Modify: `packages/adapters/src/inbound/http/tokens.ts`
- Modify: `packages/adapters/src/inbound/http/PositionController.ts` (enrich position detail response)
- Modify: `packages/adapters/src/inbound/http/PositionController.test.ts`
- Modify: `apps/app/src/api/positions.ts` (parse additive DTO)
- Modify: `apps/app/src/api/positions.test.ts`
- Modify: `packages/ui/src/view-models/PositionDetailViewModel.ts`
- Modify: `packages/ui/src/screens/PositionDetailScreen.tsx`
- Modify: `packages/ui/src/screens/PositionDetailScreen.test.tsx`

**DTO shape (additive):**

```typescript
PositionDetailDto {
  // existing fields…
  srLevels?: {
    symbol: string;
    source: string;
    capturedAtIso: string;
    supports: Array<{ price: number; rank?: string; timeframe?: string }>;
    resistances: Array<{ price: number; rank?: string; timeframe?: string }>;
  };
}
```

**Behavior:**

- `CurrentSrLevelsAdapter.getCurrent(symbol, source)` — server-side fetch to `${REGIME_ENGINE_BASE_URL}/v1/sr-levels/current?symbol=...&source=...` with 3s timeout and one retry.
- `PositionController` calls the adapter only when `result.position.poolId` matches a small configured allowlist for the sprint's single supported SOL/USDC pool. In that case it requests fixed `symbol='SOL/USDC', source='mco'`.
- For any other pool, `PositionController` skips the regime-engine call and omits `srLevels`. This avoids showing SOL/USDC levels on unrelated positions without introducing generalized pool-to-symbol mapping.
- On 200: enrich `PositionDetailDto.srLevels`.
- On 404 / timeout / transport failure: omit `srLevels`, return the rest of `PositionDetailDto` unchanged. Log a single WARN on transient failure; never throw.
- `apps/app/src/api/positions.ts` parses `srLevels` as optional (Zod `.optional()`). Unknown additional fields are ignored.
- `packages/ui` renders grouped supports/resistances sorted by `price` ascending with rank badge, plus `capturedAtIso` freshness; renders a "No regime levels available" empty state when `srLevels` is absent.
- Expo route (`apps/app/app/position/...`) stays thin — all rendering logic is in `packages/ui`.

**Client env:** the app uses `EXPO_PUBLIC_BFF_BASE_URL` only. No `EXPO_PUBLIC_REGIME_ENGINE_URL`. The regime-engine URL is backend-only.

**Test scenarios:**

- Controller: regime-engine returns levels → response includes `srLevels` with correct grouping.
- Controller: regime-engine returns 404 → response omits `srLevels`, other fields intact.
- Controller: regime-engine times out → response omits `srLevels`, logs warn, does not throw.
- Controller: non-target poolId → skips regime-engine call and omits `srLevels`.
- API parser: populated `srLevels` parses; missing `srLevels` parses.
- UI: populated levels render grouped and sorted with freshness.
- UI: missing `srLevels` renders stable empty state ("No regime levels available").
- Integration: app makes only one outbound request per view (to the BFF); no direct regime-engine request.

### Unit 5 — Deploy + manual validation runbook (~3h)

**Target repos:** `regime-engine`, `clmm-superpowers-v2`

**Requirements:** R9, R10, R11, R12, R13

**Dependencies:** Units 1, 2, 3, and 4

**Files — regime-engine:**

- Modify: `.env.example` (add `OPENCLAW_INGEST_TOKEN`, `CLMM_INTERNAL_TOKEN`; document `LEDGER_DB_PATH`, `HOST`)
- Modify: `src/server.ts` (default `HOST=::`, preserve `0.0.0.0` compatibility)
- Create: `docs/deploy-railway.md` (ordered runbook)
- Create: `docs/e2e-runbook.md` (manual validation with copy-pasteable curls)
- Modify: `README.md` (link to both runbooks; list new endpoints)
- Modify: `architecture.md` (note shared-secret ingress)
- Modify: `Dockerfile` if needed to guarantee `/app/tmp` exists and is writable by the `app` user.

**Files — clmm-superpowers-v2:**

- Modify: `packages/adapters/.env.sample` (add `REGIME_ENGINE_BASE_URL`, `REGIME_ENGINE_INTERNAL_TOKEN`)
- Modify: `apps/app/.env.example` (confirm **only** `EXPO_PUBLIC_BFF_BASE_URL` is app-public)
- Modify: `README.md` (note backend-only regime-engine env vars and client-read path through the BFF)

**Deploy runbook `docs/deploy-railway.md` — ordered steps:**

0. **Provision Railway volume at `/app/tmp` FIRST.** Without this, SQLite writes go to ephemeral FS and vanish on redeploy. This is step 0, not a footnote.
1. Set regime-engine env vars:
   - `HOST=::`
   - `PORT` (Railway-injected)
   - `LEDGER_DB_PATH=/app/tmp/ledger.sqlite`
   - `OPENCLAW_INGEST_TOKEN=<32-byte random>`
   - `CLMM_INTERNAL_TOKEN=<32-byte random, different from OPENCLAW>`
2. Enable public domain.
3. Deploy. Verify:
   - `curl https://<regime-public>/health` → `{"ok":true}`
   - `curl https://<regime-public>/v1/sr-levels/current?symbol=SOL/USDC&source=mco` → 404 (empty ledger)
4. In CLMM Railway project, add **backend** reference variables (applied to `clmm-api` and `clmm-worker` services):
   - `REGIME_ENGINE_BASE_URL=http://regime-engine.railway.internal:${{regime-engine.PORT}}`
   - `REGIME_ENGINE_INTERNAL_TOKEN=<same value as CLMM_INTERNAL_TOKEN on regime-engine>`
5. Confirm client env in `clmm-api` / Expo build remains limited to:
   - `EXPO_PUBLIC_BFF_BASE_URL=<existing public BFF URL>`
     (no `EXPO_PUBLIC_REGIME_ENGINE_URL`)
6. Redeploy CLMM. Verify from a `clmm-api` container:
   - `curl $REGIME_ENGINE_BASE_URL/health` → 200
   - `curl $REGIME_ENGINE_BASE_URL/v1/sr-levels/current?symbol=SOL/USDC&source=mco` → 404 (pre-seed)

**E2E runbook `docs/e2e-runbook.md` — concrete commands:**

```bash
# 1. Seed an S/R brief
curl -X POST https://$REGIME/v1/sr-levels \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: $OPENCLAW_INGEST_TOKEN" \
  -d '{"source":"mco","symbol":"SOL/USDC","brief":{"briefId":"mco-2026-04-17","sourceRecordedAtIso":"2026-04-17T10:00:00Z","summary":"Test brief"},"levels":[{"levelType":"support","price":142.5,"timeframe":"daily","rank":"key"},{"levelType":"resistance","price":158.0,"timeframe":"daily","rank":"key"}]}'
# Expect: 201 with {"briefId":"mco-2026-04-17","insertedCount":2}

# 2. Verify current read directly
curl "https://$REGIME/v1/sr-levels/current?symbol=SOL/USDC&source=mco"
# Expect: 200 with latest brief + 2 levels sorted by price

# 3. Verify BFF enrichment on the target SOL/USDC position (non-target pools should omit srLevels)
curl "$EXPO_PUBLIC_BFF_BASE_URL/positions/$WALLET/$POSITION"
# Expect: 200 JSON that includes srLevels block with supports/resistances

# 4. Idempotent replay of S/R brief
# Re-run command 1. Expect: 200 with {"status":"already_ingested"}

# 5. Seed a CLMM execution event directly (simulates adapter)
curl -X POST https://$REGIME/v1/clmm-execution-result \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: $CLMM_INTERNAL_TOKEN" \
  -d '{"schemaVersion":"1.0","correlationId":"test-corr-001","positionId":"...","breachDirection":"LowerBoundBreach","reconciledAtIso":"2026-04-17T12:01:00Z","txSignature":"...","tokenOut":"USDC","status":"confirmed"}'
# Expect: 200 with {"ok":true,"correlationId":"test-corr-001"}

# 6. Verify ledger state (from Railway CLI or volume inspection)
# sqlite3 /app/tmp/ledger.sqlite 'SELECT correlation_id, json_extract(event_json,"$.status") FROM clmm_execution_events'

# 7. Trigger real reconciliation via CLMM after a monitored position breach
#    (Weekend 2 Sunday — run once with $100 live)

# 8. Idempotent replay of CLMM event — re-run command 5 — expect 200 idempotent
# 9. Conflict check — change one field (e.g. status to 'failed') with same correlationId — expect 409
```

**Manual validation gate (Weekend 2 Saturday evening):** run steps 1–9 once against deployed environment. Any failure → fix → re-run. Do not CI-automate this.

## 7. Risks and mitigations

| Risk                                                                                           | Mitigation                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deploying regime-engine without mounting the Railway volume first → ledger silently ephemeral. | Unit 5 step 0 is "provision volume before first deploy" with explicit checkbox.                                                                                                                        |
| Posting to regime-engine before chain confirmation.                                            | Hooks are the controller's inline-reconciliation tail and `ReconcileExecutionAttempt` — both gated on `finalState.kind ∈ {confirmed, failed}`. No hook on `submitExecution`'s pre-reconciliation path. |
| Missing one of the two terminal seams → lost events.                                           | Both seams are wired in Unit 3 and each has a dedicated call-order test.                                                                                                                               |
| Outbound adapter failure blocking CLMM execution.                                              | Adapter swallows on final failure; controller and job handler both wrap call in try/catch. On-chain state is authoritative.                                                                            |
| `partial` state causes duplicate notifications or 409 conflicts.                               | Adapter only fires on `confirmed` or `failed`. `partial` is explicitly excluded at both seams.                                                                                                         |
| OpenClaw brief format diverges from proposed `POST /v1/sr-levels` shape.                       | Translation lives on OpenClaw side; regime-engine canonical schema is fixed. Until OpenClaw emits, use the curl runbook to seed manually.                                                              |
| Railway reference variables for private hostname get mis-wired.                                | Step 6 of deploy runbook verifies `curl $REGIME_ENGINE_BASE_URL/health` from CLMM container before declaring deploy healthy.                                                                           |
| BFF-enriched read couples position-detail latency to regime-engine.                            | 3s timeout + one retry; on failure `srLevels` is omitted and the rest of position-detail returns normally.                                                                                             |
| Fixed SOL/USDC enrichment leaks onto unrelated pools.                                          | `PositionController` guards on the sprint target-pool allowlist before calling regime-engine; non-target pools omit `srLevels`.                                                                        |
| Expo `EXPO_PUBLIC_*` var leaks regime-engine as a client-visible URL.                          | Unit 4 keeps `EXPO_PUBLIC_BFF_BASE_URL` as the only app-public URL; regime-engine envs are backend-only in `packages/adapters/.env.sample`.                                                            |
| Scope creep ("while I'm in here...").                                                          | Every such thought goes in the respective repo's `docs/post-shelf-ideas.md`. Do not enter sprint.                                                                                                      |

## 8. Explicit forbidden list

1. No `POST /v1/plan` calls from CLMM.
2. No runtime regime filter on exits.
3. No weekly-report changes (ledger accumulates events; report consumption is post-shelf).
4. No multi-analyst support beyond `mco`.
5. No shared libraries between repos.
6. No auth beyond shared-secret headers.
7. No platform migration away from Railway.
8. No capital ramp above $100.
9. No Postgres/Drizzle migration for regime-engine.
10. No domain DTO enrichment in CLMM to serve the outbound regime-engine integration.
11. No new application-layer port for analytics notification.
12. No direct Expo/web fetch to regime-engine.

## 9. Budget and gates

| Phase                 | Units                       | Gate                                                                                                                          |
| --------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Weekend 1 Saturday    | U1, U2 (regime-engine)      | Both unit test suites green against `:memory:` SQLite; `/v1/execution-result` non-regression tests pass                       |
| Weekend 1 Sunday      | U3 (CLMM dual-seam adapter) | Adapter unit tests + both `ExecutionController.test.ts` and `ReconciliationJobHandler.test.ts` green; call-order asserts pass |
| Weekend 2 Saturday AM | U4 (BFF enrichment + UI)    | `PositionController` + API parser + UI tests green; empty-state rendering verified                                            |
| Weekend 2 Saturday PM | U5 deploy + E2E             | Both services healthy on Railway; internal curl works; runbook steps 1–9 pass                                                 |
| Weekend 2 Sunday      | Live $100                   | Funded, position opened, monitor running                                                                                      |

**Hard stop:** if Weekend 1 ends without U1+U2+U3 green, shelf the sprint. Pronghorn starts Monday regardless.

## 10. After the sprint

The sprint ends Sunday. Monday is Pronghorn. Shelf state:

- Live $100 position running on Railway
- Truth ledger accumulating CLMM execution events
- S/R levels refreshing daily from OpenClaw (or manually-seeded until OpenClaw emits)
- No active development

Revisit at end of month 1. Decisions about graduating capital, adding whipsaw filtering, tuning regime logic, or adding a CLMM-events section to the weekly report wait until 30+ days of real data exist.

## 11. Sources

- Origin sprint draft: `docs/2026-04-17-clmm-regime-engine-integration-sprint.md`
- GPT plan reviewed: `docs/plans/2026-04-17-001-feat-clmm-regime-engine-integration-plan.md`
- Opus plan reviewed: `docs/superpowers/specs/2026-04-17-clmm-regime-engine-integration-design.md`
- Code: `regime-engine/src/ledger/writer.ts`, `regime-engine/src/http/routes.ts`, `regime-engine/src/contract/v1/types.ts`
- Code: `clmm-superpowers-v2/packages/application/src/use-cases/execution/ReconcileExecutionAttempt.ts`
- Code: `clmm-superpowers-v2/packages/adapters/src/inbound/http/ExecutionController.ts` (inline reconciliation seam — verified)
- Code: `clmm-superpowers-v2/packages/adapters/src/inbound/jobs/ReconciliationJobHandler.ts`
- Code: `clmm-superpowers-v2/packages/adapters/src/outbound/` (existing adapter patterns)
- Code: `clmm-superpowers-v2/packages/adapters/src/inbound/http/PositionController.ts` (BFF enrichment seam)
- Code: `clmm-superpowers-v2/apps/app/src/api/positions.ts` (single-URL client contract)
- External: Railway Volumes, Private Networking, Domains, Variables (reference)
