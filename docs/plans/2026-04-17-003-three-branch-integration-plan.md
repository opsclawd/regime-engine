---
title: "Three-branch comparison + integration plan (GLM, MMX, GPT)"
type: integration
status: active
date: 2026-04-17
canonical_spec: docs/superpowers/specs/2026-04-17-clmm-regime-engine-integration-merged.md
branches:
  - glm (.worktrees/glm)
  - mmx (.worktrees/mmx)
  - feat/clmmm-regime-engine-integration (.worktrees/clmm-regime-engine, "GPT")
---

# Three-branch comparison + integration plan

All three branches implemented Units 1–3 of the merged spec (S/R ledger, S/R HTTP surface, CLMM execution ingest). None attempted Units 4–6 (CLMM adapter, BFF enrichment, deploy/E2E). This plan compares them against the canonical merged spec and extracts an integration path.

---

## TL;DR

**Quality ranking: GLM > GPT > MMX.**

- **GLM** is the strongest overall: spec-aligned routes, correct auth primitives, unified error taxonomy, clean schema. One miss: `SrLevelsCurrentResponse` drops `briefId`, `sourceRecordedAtIso`, `summary` and conflates two distinct timestamps.
- **GPT** is structurally correct with strong transaction semantics on CLMM ingest, but has a schema.sql duplication bug that survives into the committed source and reuses the wrong error code for CLMM conflicts.
- **MMX** is the weakest: three spec divergences (routes, env var name, DTO shape), one real bug (`409 : 409` ternary), and racy CLMM ingest. Not recommended as the base.

**Recommended integration:** GLM as base + restore missing response fields from GPT's types + adopt GPT's `BEGIN IMMEDIATE` semantics in `writeClmmExecutionEvent` (optional — GLM's `runInTransaction` is acceptable). Then build Units 4–6 on top. Est. merge work: 1–2h.

---

## 1. Comparison matrix

| Dimension | GLM | GPT | MMX |
|---|---|---|---|
| Routes align with merged spec | ✅ `/v1/sr-levels`, `/v1/sr-levels/current?symbol&source`, `/v1/clmm-execution-result` | ✅ same as GLM | ❌ `/v1/sr-levels/ingest`, `/v1/sr-levels/:symbol/:source/current` |
| Env var names align | ✅ `OPENCLAW_INGEST_TOKEN`, `CLMM_INTERNAL_TOKEN` | ✅ same | ❌ `SR_LEVELS_INGEST_SECRET` for ingest |
| `.env.example` updated | ✅ both new vars added | ❌ no update | ❌ no update |
| Auth: constant-time compare | ✅ `timingSafeEqual` with length pre-check | ❌ plain `!==` | ❌ plain `!==` |
| Auth: misconfig vs bad token | ✅ 500 on missing env, 401 on bad token | ❌ both 401 | ❌ both 401 (but throws "missing env" text) |
| Error taxonomy: dedicated CLMM conflict code | ✅ `CLMM_EXECUTION_EVENT_CONFLICT` | ❌ reuses `EXECUTION_RESULT_CONFLICT` | ✅ `CLMM_EXECUTION_EVENT_CONFLICT` |
| Error taxonomy: unified vs split | ✅ single `LEDGER_ERROR_CODES` + `LedgerWriteError` | ❌ split (separate `SrLevelsWriteError`) | ❌ split (separate `SrLedgerWriteError` for sr-levels) |
| schema.sql cleanliness | ✅ clean, +bonus `idx_sr_levels_brief_id` | ❌ duplicated `CREATE TABLE sr_level_briefs/sr_levels` and duplicated `idx_sr_level_briefs_current` | ✅ clean |
| S/R write: check-then-insert in transaction | ✅ `runInTransaction` wraps both | ❌ existence check outside transaction; insert inside | ✅ `runInTransaction` wraps both |
| CLMM ingest: transaction semantics | 🟡 `runInTransaction` (deferred BEGIN) | ✅ explicit `BEGIN IMMEDIATE` with try/catch around COMMIT/ROLLBACK | ❌ no transaction at all — relies on UNIQUE alone |
| `SrLevelsCurrentResponse` shape matches spec | ❌ missing `briefId`, `sourceRecordedAtIso`, `summary`; conflates `sourceRecordedAtIso` and `capturedAtIso` | ✅ full shape: `briefId`, `sourceRecordedAtIso`, `summary`, `capturedAtIso`, `supports`, `resistances` | ❌ grouped `{ levels: { support, resistance } }` shape instead of flat `supports`/`resistances` |
| `ClmmExecutionEventRequest` shape matches spec | ✅ | ✅ | ✅ |
| Non-regression on plan-linked routes | ✅ existing tests untouched | ✅ existing tests untouched | ✅ existing tests untouched |
| Bugs | — | schema.sql dupes; wrong conflict code on CLMM handler | `clmmExecutionResult.ts:52` has `error.code === ... ? 409 : 409` — dead 500 path |
| Diff size | 20 files, ~1359 insertions | 18 files, ~1776 insertions | 16 files, ~1586 insertions |

---

## 2. Per-branch detail

### 2.1 GLM (`.worktrees/glm`, branch `glm`)

**Pros:**

- **Spec alignment across the board.** Routes (`/v1/sr-levels`, `/v1/sr-levels/current`, `/v1/clmm-execution-result`), env names (`OPENCLAW_INGEST_TOKEN`, `CLMM_INTERNAL_TOKEN`), request shapes, and status codes (201/200/401/409) all match the merged spec.
- **Auth done right.** `src/http/auth.ts:16-20` uses `timingSafeEqual` with a length pre-check — the one non-obvious primitive that matters for a shared-secret endpoint. 500 for missing env (ops misconfig) vs 401 for bad token (caller issue) is the correct distinction; any other branch conflates these.
- **Unified error taxonomy.** `LEDGER_ERROR_CODES` in `src/ledger/writer.ts:6-12` includes both `SR_LEVEL_BRIEF_CONFLICT` and `CLMM_EXECUTION_EVENT_CONFLICT` alongside the existing plan codes. Callers get a single enum to switch on — operators grepping logs see coherent codes.
- **Clean schema.** `src/ledger/schema.sql` appends §5.4 DDL once without duplicating existing tables. Adds a useful `idx_sr_levels_brief_id` index for child-row lookups.
- **Transaction-wrapped writes.** Both `writeSrLevelBrief` and `writeClmmExecutionEvent` use `runInTransaction` around check-then-insert. Under concurrent retries, SQLite's default locking upgrades correctly, and canonical-JSON equality handles idempotent replays.
- **`.env.example` updated.** Both new vars are documented.

**Cons:**

- **`SrLevelsCurrentResponse` drops spec fields.** `getCurrentSrLevels` in `srLevelsWriter.ts:103-129` returns only `{symbol, source, capturedAtIso, supports, resistances}`. The merged spec includes `briefId`, `sourceRecordedAtIso`, `summary` — needed so consumers can (a) correlate a read to a specific brief for audit, (b) distinguish when MCO recorded the analysis vs when regime-engine received it, and (c) surface the brief summary in the PWA.
- **Timestamp conflation.** `capturedAtIso: briefRow.source_recorded_at_iso ?? new Date(briefRow.captured_at_unix_ms).toISOString()` merges two distinct facts into one field. These should be separate columns in the response. This will bite in the BFF enrichment unit when the PWA tries to show "analyzed on" vs "fetched on" separately.
- **`writeSrLevelBrief` re-selects `briefRow.id` after insert instead of using `lastInsertRowid`.** Works, but an extra round-trip inside the transaction (`srLevelsWriter.ts:46-48`).
- **Deferred `BEGIN`** (via `runInTransaction`) vs GPT's `BEGIN IMMEDIATE` for CLMM ingest. Under contention, deferred BEGIN can upgrade mid-transaction and fail; IMMEDIATE locks the writer up front. Both work for this traffic level; IMMEDIATE is more robust.

**Overall:** Best base. The `SrLevelsCurrentResponse` fix is small — two missing fields and a timestamp split — and can land in 20 minutes.

### 2.2 GPT (`.worktrees/clmm-regime-engine`, branch `feat/clmmm-regime-engine-integration`)

**Pros:**

- **Strongest CLMM ingest transaction semantics.** `writer.ts:179` uses explicit `BEGIN IMMEDIATE` and wraps `COMMIT`/`ROLLBACK` in try/catch. The writer lock is acquired before the existence check, preventing the check-then-insert race under concurrent retries. This is textbook SQLite concurrency.
- **Spec-aligned routes and DTOs.** `/v1/sr-levels`, `/v1/sr-levels/current?symbol&source`, `/v1/clmm-execution-result` all match. `SrLevelsCurrentResponse` includes the full shape (`briefId`, `sourceRecordedAtIso`, `summary`, `capturedAtIso`, grouped supports/resistances with full inline fields).
- **Validation coverage is thorough.** `src/contract/v1/validation.ts` has strict Zod schemas (`.strict()`) with the full CLMM event optional-field surface (`episodeId`, `previewId`, `detectedAtIso`, `amountOutRaw`, cost fields).
- **Current-read handler strips empty strings cleanly.** `srLevelsCurrent.ts:11-25` groups level fields with `...(rank ? { rank } : {})` conditional spread, which keeps the response JSON lean.

**Cons:**

- **`schema.sql` has duplicate DDL (real bug).** Lines 30-51 and 62-83 both `CREATE TABLE IF NOT EXISTS sr_level_briefs` + `sr_levels`. Lines 85-86 and 98-99 both `CREATE INDEX IF NOT EXISTS idx_sr_level_briefs_current`. Idempotent because of `IF NOT EXISTS`, but the source is broken. A future schema edit that modifies the "first" definition will silently be clobbered by the second — or vice versa. **Must be fixed before shipping.**
- **Wrong conflict code for CLMM events.** `writer.ts:194` throws `LEDGER_ERROR_CODES.EXECUTION_RESULT_CONFLICT` for CLMM event conflicts. That code is reserved for plan-linked conflicts. The handler at `clmmExecutionResult.ts` then catches the same code. Functional but the taxonomy is muddled — operators seeing `EXECUTION_RESULT_CONFLICT` in logs can't tell whether the offending request was plan-linked or CLMM without reading the message.
- **S/R write: existence check outside transaction.** `srLevels.ts:65-90` runs the `SELECT brief_json` check before the `runInTransaction` block starts at line 92. Under concurrent retries with the same `(source, briefId)`, two workers can both see "no existing" and both try to insert; the UNIQUE constraint catches one, but the user sees a generic insert failure instead of a clean idempotent response. Put the check inside the transaction.
- **Auth is plain string compare.** `http/auth.ts:13` uses `provided !== expected` — timing-attack vulnerable. Missing env treated same as bad token (both 401) — misleading.
- **Split error class.** `SrLevelsWriteError` separate from `LedgerWriteError` forces handlers to catch both hierarchies. Minor inconvenience; worth unifying during the merge.
- **`.env.example` not updated.** Operators deploying from a fresh checkout won't discover the new env vars until runtime fails.

**Overall:** Best transaction discipline on CLMM ingest; cleanest contract shape for S/R reads. Held back by the schema.sql dupe and the wrong conflict code. Cherry-pick its `writer.ts` write-lock pattern and its `srLevels.ts` + `types.ts` response shape; reject the broken schema.sql.

### 2.3 MMX (`.worktrees/mmx`, branch `mmx`)

**Pros:**

- Unified `LEDGER_ERROR_CODES` + `LedgerWriteError` like GLM — contains a dedicated `CLMM_EXECUTION_EVENT_CONFLICT` code.
- Clean schema.sql with no duplicates.
- Plan-linked flow untouched; existing tests green.

**Cons:**

- **Three spec divergences** (merged spec §5.1–5.3):
  1. `POST /v1/sr-levels/ingest` instead of `POST /v1/sr-levels` (`routes.ts:45`).
  2. `GET /v1/sr-levels/:symbol/:source/current` instead of `GET /v1/sr-levels/current?symbol&source` (`routes.ts:46`). Path params change the call signature; clients must URL-encode `SOL/USDC` inside a path segment, which is a footgun.
  3. Env var `SR_LEVELS_INGEST_SECRET` instead of `OPENCLAW_INGEST_TOKEN`. Different ops footprint.
- **`SrLevelCurrentResponse` shape divergence.** Uses `{ levels: { support: [...], resistance: [...] } }` nested shape instead of spec's flat `supports`/`resistances`. PWA view-model code written against the merged spec won't parse it.
- **Real bug: `clmmExecutionResult.ts:52`**: `error.code === LEDGER_ERROR_CODES.CLMM_EXECUTION_EVENT_CONFLICT ? 409 : 409`. Both branches of the ternary return 409 — dead `500` fallback. Any non-conflict `LedgerWriteError` bubbling up (e.g. a future code added to the enum) will return 409 misleadingly. Clear copy-paste artifact.
- **Racy CLMM ingest.** `writer.ts:150-199` does check-then-insert with **no transaction** at all. The UNIQUE constraint on `correlation_id` is the only safety net. Under concurrent replay (both the controller seam and the worker seam notifying for the same `attemptId` in rapid succession), one insert will hit a `SqliteError: UNIQUE constraint failed` that surfaces as a 500 instead of an idempotent 200. Mitigation exists via UNIQUE, but the error surface is wrong.
- **Auth: plain `!==`.** Timing-attack vulnerable. `AuthError` hardcodes `statusCode = 401` in `auth.ts:4` so missing env and bad token both return 401 — same pathology as GPT.
- **No `.env.example` update.**
- **Client-provided `capturedAtUnixMs` in the ingest payload.** MMX's `SrLevelBriefRequest` includes `capturedAtUnixMs` as a client-stamped field and stores it directly. That contradicts an append-only, regime-engine-authoritative model where regime-engine stamps receive time. GLM and GPT both server-stamp `captured_at_unix_ms` at ingest (via `Date.now()` or the `receivedAtUnixMs` parameter).

**Overall:** Not recommended as the integration base. The route/env/DTO divergences each require a rewrite, the 409:409 bug needs fixing, and the no-transaction CLMM ingest needs wrapping. Nothing in MMX is uniquely valuable compared to GLM.

---

## 3. Load-bearing facts for integration

1. **Canonical routes:** `POST /v1/sr-levels`, `GET /v1/sr-levels/current?symbol=...&source=...`, `POST /v1/clmm-execution-result`.
2. **Canonical env vars:** `OPENCLAW_INGEST_TOKEN` (OpenClaw → regime-engine), `CLMM_INTERNAL_TOKEN` (CLMM → regime-engine).
3. **Canonical headers:** `X-Ingest-Token`, `X-CLMM-Internal-Token`.
4. **`SrLevelsCurrentResponse` (full):** `{ schemaVersion, source, symbol, briefId, sourceRecordedAtIso, summary, capturedAtIso, supports, resistances }`. Flat support/resistance arrays sorted by price.
5. **CLMM wire `status`:** `"confirmed" | "failed"` only — `partial`/`pending` do not travel.
6. **Server-stamped capture time.** regime-engine stamps `captured_at_unix_ms` on receipt. `sourceRecordedAtIso` comes from the brief payload (when MCO recorded the analysis).
7. **Auth primitives:** `timingSafeEqual` with length pre-check; 500 for missing env; 401 for bad/missing token.
8. **Error taxonomy:** unified `LEDGER_ERROR_CODES` with dedicated `SR_LEVEL_BRIEF_CONFLICT` and `CLMM_EXECUTION_EVENT_CONFLICT` codes.

---

## 4. Integration plan

### Strategy

**Base = GLM's branch. Cherry-pick two items from GPT. Reject MMX.**

GLM has the broadest spec alignment and the cleanest primitives. The only non-trivial work on top is restoring the spec-correct `SrLevelsCurrentResponse` shape. GPT contributes one tightening (CLMM ingest lock mode) and the canonical response type.

### Execution steps

Do the work on a new integration branch off `main` (do **not** merge any of GLM/MMX/GPT directly — we want a clean single commit per step for review).

#### Step 0 — Create integration branch (5 min)

```bash
git checkout main
git pull
git checkout -b feat/integration-sprint-merged
```

#### Step 1 — Seed from GLM (15 min)

Copy GLM's files as the starting point. Verify by running the full test suite.

```bash
BRANCH=glm
for path in \
  src/ledger/schema.sql \
  src/ledger/writer.ts \
  src/ledger/srLevelsWriter.ts \
  src/contract/v1/types.ts \
  src/contract/v1/validation.ts \
  src/http/auth.ts \
  src/http/handlers/srLevelsIngest.ts \
  src/http/handlers/srLevelsCurrent.ts \
  src/http/handlers/clmmExecutionResult.ts \
  src/http/routes.ts \
  src/http/openapi.ts \
  src/http/errors.ts \
  .env.example; do
  cp ".worktrees/glm/$path" "$path"
done

# Also copy GLM's tests
cp -r .worktrees/glm/src/ledger/__tests__/* src/ledger/__tests__/
cp -r .worktrees/glm/src/http/__tests__/* src/http/__tests__/

npm test
```

Commit: `feat: seed integration branch from glm implementation`.

#### Step 2 — Restore spec-correct `SrLevelsCurrentResponse` (30 min)

Fix GLM's missing fields. Two files change.

**`src/contract/v1/types.ts`** — extend the response interface:

```ts
export interface SrLevel {
  price: number;
  rank?: string;
  timeframe?: string;
  invalidation?: number;
  notes?: string;
}

export interface SrLevelsCurrentResponse {
  schemaVersion: SchemaVersion;
  source: string;
  symbol: string;
  briefId: string;
  sourceRecordedAtIso: string | null;
  summary: string | null;
  capturedAtIso: string;         // derived from captured_at_unix_ms
  supports: SrLevel[];
  resistances: SrLevel[];
}
```

**`src/ledger/srLevelsWriter.ts`** — rewrite `getCurrentSrLevels`:

- Select `brief_id`, `source_recorded_at_iso`, `summary`, `captured_at_unix_ms` from `sr_level_briefs`.
- Return all fields. `capturedAtIso = new Date(briefRow.captured_at_unix_ms).toISOString()`. `sourceRecordedAtIso = briefRow.source_recorded_at_iso` (nullable). Do **not** fall back from one to the other.
- Map each level fully (include `invalidation`, `notes` when non-null — GLM's current map drops them).

**`src/http/handlers/srLevelsCurrent.ts`** — pass `schemaVersion: SCHEMA_VERSION` in the response.

Update `src/http/__tests__/srLevels.e2e.test.ts` to assert the full shape, including freshness timestamps as distinct fields.

Commit: `fix: restore full SrLevelsCurrentResponse fields per merged spec`.

#### Step 3 — Adopt GPT's `BEGIN IMMEDIATE` for CLMM ingest (15 min, optional)

GLM's `runInTransaction`-wrapped `writeClmmExecutionEvent` is correct. GPT's explicit `BEGIN IMMEDIATE` is marginally safer under heavy write contention because the writer lock is acquired up front rather than upgrading mid-transaction.

For this sprint's traffic level (one breach every few hours at most), both work. Skip this step unless you care about the hardening. If you do adopt it, pattern is:

```ts
store.db.exec("BEGIN IMMEDIATE");
try {
  // existence check + insert
  store.db.exec("COMMIT");
  return result;
} catch (error) {
  store.db.exec("ROLLBACK");
  throw error;
}
```

Keep the same unified `CLMM_EXECUTION_EVENT_CONFLICT` code — do **not** copy GPT's reuse of `EXECUTION_RESULT_CONFLICT`.

Commit: `refactor: use BEGIN IMMEDIATE for CLMM execution event write lock`.

#### Step 4 — Fix schema.sql invariant check (5 min)

GLM's `schema.sql` is already clean. Just add a defensive comment at the bottom so future edits don't re-introduce GPT's duplication pattern:

```sql
-- End of schema. Do NOT re-declare tables or indexes below this line.
-- Every CREATE statement must appear exactly once.
```

Commit: `docs: guard schema.sql against duplicate DDL declarations`.

#### Step 5 — Run full test suite and `routes.contract.test.ts` (10 min)

Verify:

- All existing plan/execution tests pass unchanged.
- All new S/R ingest/read tests pass.
- All new CLMM ingest tests pass.
- The routes contract test lists exactly the 8 expected endpoints (health, version, openapi, plan, execution-result, sr-levels, sr-levels/current, clmm-execution-result, report/weekly — so 9 total).

#### Step 6 — Open PR (5 min)

PR body: link to this document, reference the merged spec, enumerate the three commits, note that Units 4–6 are still to build.

### Total merge budget: ~80 minutes

Plus ~5h to build Units 4–6 (CLMM outbound adapter, BFF enrichment, deploy runbook) which no branch attempted.

---

## 5. What to reject and why

| Rejected | Source | Why |
|---|---|---|
| `POST /v1/sr-levels/ingest` route | MMX | Diverges from merged spec `/v1/sr-levels` |
| `GET /v1/sr-levels/:symbol/:source/current` route | MMX | Diverges from merged spec; path-segment URL-encoding is a footgun for `SOL/USDC` |
| `SR_LEVELS_INGEST_SECRET` env var | MMX | Diverges from merged spec `OPENCLAW_INGEST_TOKEN` |
| Grouped `{ levels: { support, resistance } }` response shape | MMX | Diverges from merged spec's flat `supports`/`resistances` |
| Client-provided `capturedAtUnixMs` in ingest payload | MMX | Breaks the regime-engine-authoritative append-only model |
| `409 : 409` ternary in `clmmExecutionResult.ts` | MMX | Dead 500 path; any non-conflict `LedgerWriteError` returns 409 misleadingly |
| No-transaction CLMM ingest | MMX | Racy; UNIQUE catches writes but surfaces as 500, not idempotent 200 |
| Duplicated `CREATE TABLE` / `CREATE INDEX` in schema.sql | GPT | Broken source; future edits clobber one definition silently |
| Reusing `EXECUTION_RESULT_CONFLICT` for CLMM conflicts | GPT | Taxonomy confusion; operators can't distinguish plan-linked from CLMM conflicts from the code alone |
| Existence check outside the transaction in `writeSrLevelBrief` | GPT | Race window; UNIQUE catches writes but surfaces as generic insert failure |
| Plain `!==` secret compare | GPT, MMX | Timing-attack vulnerable |
| Both-401 auth (missing env = bad token) | GPT, MMX | Ops can't distinguish misconfig from caller error |
| Split error class hierarchies | GPT, MMX | Multiple catch branches per handler; unified enum is cleaner |
| Missing response fields in `SrLevelsCurrentResponse` | GLM | Spec requires `briefId`, `sourceRecordedAtIso`, `summary`; timestamp fields must stay distinct |

---

## 6. What still needs to be built after the merge

None of the branches attempted these, so no cherry-picks possible. Est. 5h on top of the 80-min merge:

- **Unit 4** — CLMM outbound `RegimeEngineExecutionEventAdapter` wired at both `ExecutionController` and `ReconciliationJobHandler` seams. 3h. Terminal-state gate (`confirmed | failed` only). No-op fallback when env unset.
- **Unit 5** — CLMM BFF position-detail enrichment via `CurrentSrLevelsAdapter`. 3h. Server-side fetch only, additive DTO, `EXPO_PUBLIC_BFF_BASE_URL` stays the sole app-public URL.
- **Unit 6** — Railway deploy runbook with volume-first ordering + copy-pasteable verification curls. 2h. E2E runbook for the weekend-2 manual validation.

See `docs/plans/2026-04-17-002-opus-clmm-regime-engine-integration-plan.md` §6 Units 4–6 for the full decomposition.

---

## 7. Verification checklist before declaring the merge done

- [ ] `npm test` green, including all existing plan/execution tests untouched
- [ ] `GET /v1/sr-levels/current?symbol=SOL/USDC&source=mco` returns the full response shape (7 top-level fields + flat supports/resistances)
- [ ] `POST /v1/sr-levels` without `X-Ingest-Token` returns 401; with `OPENCLAW_INGEST_TOKEN` unset returns 500
- [ ] `POST /v1/clmm-execution-result` without `X-CLMM-Internal-Token` returns 401; with `CLMM_INTERNAL_TOKEN` unset returns 500
- [ ] Duplicate `POST /v1/sr-levels` with byte-equal payload returns 200 `already_ingested`
- [ ] Duplicate `POST /v1/clmm-execution-result` with byte-equal payload returns 200 `{ idempotent: true }`
- [ ] Conflicting replays return 409 with `SR_LEVEL_BRIEF_CONFLICT` and `CLMM_EXECUTION_EVENT_CONFLICT` codes respectively
- [ ] `schema.sql` contains exactly one `CREATE TABLE` per table
- [ ] `.env.example` lists both `OPENCLAW_INGEST_TOKEN=` and `CLMM_INTERNAL_TOKEN=`
- [ ] `src/http/auth.ts` uses `timingSafeEqual`
