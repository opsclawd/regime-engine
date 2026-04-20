---
title: "feat: Unit 6 — regime-engine deploy, smoke, docs, runbook"
type: feat
status: active
date: 2026-04-19
parent_plan: docs/plans/2026-04-17-002-opus-clmm-regime-engine-integration-plan.md
canonical_spec: docs/superpowers/specs/2026-04-17-clmm-regime-engine-integration-merged.md
scope: regime-engine repo only (Units 1-5 already merged)
---

# Unit 6 — regime-engine deploy, smoke, docs, runbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the regime-engine side of Unit 6 from the Opus integration plan: expand smoke test coverage, confirm Railway-compatible server binding, publish curl-verifiable deploy fixtures, refresh `README.md` + `architecture.md` + the sprint source doc, and add a step-by-step Railway deploy runbook so the service can be shipped alongside CLMM with one manual pass.

**Architecture:** Regime-engine is already Fastify + Zod + `node:sqlite` bound to `0.0.0.0:8787` with a multi-stage Dockerfile and `railway.toml` declaring `requiredMountPath = "/data"`. Units 1-5 added S/R ingest, S/R current read, and CLMM execution-event ingest endpoints (all guarded by `X-Ingest-Token` / `X-CLMM-Internal-Token` via `requireSharedSecret`). Unit 6 closes the deploy loop without touching runtime code: extend the smoke boot test to exercise the advertised surface, add two fixtures for the public curl runbook, and update documentation to reflect the shipped reality (SQLite, `/data` mount, dual-stack bind, append-only ledger + latest-brief query).

**Tech Stack:** Node 22 / Fastify 5 / Zod 3 / Vitest 3 / `node:sqlite` / Docker / Railway.

**Pre-flight checks before starting:**

- `git status` → working tree clean on `main`.
- `npm ci && npm run typecheck && npm run lint && npm run test` → all green. If any fail, stop — Unit 6 assumes a green baseline from Units 1-5.
- Confirm `src/http/routes.ts` registers `POST /v1/sr-levels`, `GET /v1/sr-levels/current`, `POST /v1/clmm-execution-result` (already landed on `main` commit `98d8b37`).
- Confirm `src/http/openapi.ts` mentions the three new routes (already present — `grep -c "sr-levels\|clmm-execution"` returns `3`+).
- Confirm `railway.toml` declares `requiredMountPath = "/data"`.
- Confirm `.env.example` already lists `OPENCLAW_INGEST_TOKEN` and `CLMM_INTERNAL_TOKEN`.

**Forbidden during this unit (carried from parent plan §7):**

1. Do not touch `src/report/weekly.ts`. CLMM events are accumulated only; no report integration this sprint.
2. Do not change the wire shape of any v1 contract. This is docs + fixtures + smoke test only.
3. Do not swap to Postgres/Drizzle. SQLite is the committed model.
4. Do not generalize pool/symbol mapping. Fixtures hardcode `SOL/USDC` + `mco`.
5. Do not alter `src/server.ts` listen semantics beyond what Task 2 specifies (explicit `HOST` env pass-through is already in place).

---

## File Structure

**Create:**

- `fixtures/sr-levels-brief.json` — deterministic valid payload for `POST /v1/sr-levels` curl.
- `fixtures/clmm-execution-event.json` — deterministic valid payload for `POST /v1/clmm-execution-result` curl.
- `docs/runbooks/railway-deploy.md` — step-by-step deploy + curl verification + private-networking fallback.

**Modify:**

- `src/__tests__/smoke.test.ts` — add `GET /version`, `GET /v1/openapi.json`, and public-surface presence assertions.
- `src/server.ts` — documentation-only comment clarifying `HOST=::` dual-stack intent; default stays `0.0.0.0`.
- `Dockerfile` — add a single inline comment documenting that production deploys override `LEDGER_DB_PATH` to the mounted volume path; no runtime change.
- `README.md` — point the Railway section at the new runbook; clarify `HOST=::` is the recommended Railway value; add a "curl verification" snippet pointing to fixtures.
- `architecture.md` — add the three new v1 endpoints to the runtime overview, document the two new tables, and make the append-only invariant + latest-brief-query rule explicit.
- `docs/2026-04-17-clmm-regime-engine-integration-sprint.md` — append a "Resolved assumptions" block so the sprint doc stops implying Postgres/Drizzle and plan-linked execution-result reuse.

**Out of scope (do not touch):**

- `src/ledger/**`, `src/contract/**`, `src/http/handlers/**` — Units 1-5 landed. Verify not-regressed via `npm run test`.
- `src/report/**` — deferred (§3.3 non-goals).
- `fixtures/demo/**` — harness fixtures; untouched.

---

## Task 1: Expand smoke test to cover advertised public surface

**Files:**

- Modify: `src/__tests__/smoke.test.ts`

The current smoke test only hits `GET /health`. The parent plan says Unit 6 smoke coverage must include `GET /health`, `GET /version`, and `GET /v1/openapi.json` — this is the set a deploy operator curls to verify the service booted and is serving its documented surface.

- [ ] **Step 1: Read the current smoke test to confirm the baseline.**

Run: `cat src/__tests__/smoke.test.ts`

Expected: file contains a single `describe("GET /health", ...)` block; no `/version` or `/v1/openapi.json` cases.

- [ ] **Step 2: Replace the smoke test with the expanded version.**

Write `src/__tests__/smoke.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

let app = buildApp();

afterEach(async () => {
  await app.close();
  app = buildApp();
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});

describe("GET /version", () => {
  it("returns service identity", async () => {
    const response = await app.inject({ method: "GET", url: "/version" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { name: string; version: string; commit?: string };
    expect(body.name).toBe("regime-engine");
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("includes commit SHA when COMMIT_SHA is set", async () => {
    const previous = process.env.COMMIT_SHA;
    process.env.COMMIT_SHA = "abcdef0";
    try {
      await app.close();
      app = buildApp();
      const response = await app.inject({ method: "GET", url: "/version" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ commit: "abcdef0" });
    } finally {
      if (previous === undefined) {
        delete process.env.COMMIT_SHA;
      } else {
        process.env.COMMIT_SHA = previous;
      }
    }
  });
});

describe("GET /v1/openapi.json", () => {
  it("advertises the documented public surface", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const doc = response.json() as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toMatch(/^3\./);
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/health",
        "/version",
        "/v1/plan",
        "/v1/execution-result",
        "/v1/clmm-execution-result",
        "/v1/report/weekly",
        "/v1/sr-levels",
        "/v1/sr-levels/current"
      ])
    );
  });
});
```

- [ ] **Step 3: Run the smoke test to confirm it passes.**

Run: `npx vitest run src/__tests__/smoke.test.ts`

Expected: all tests pass. If any path is missing from the OpenAPI doc, do NOT patch the test — fix `src/http/openapi.ts` to document the missing route (this is the point of the check).

- [ ] **Step 4: Run the full suite to confirm no regression.**

Run: `npm run test`

Expected: all existing Unit 1-5 tests remain green alongside the new smoke cases.

- [ ] **Step 5: Commit.**

```bash
git add src/__tests__/smoke.test.ts
git commit -m "test(smoke): cover /version and /v1/openapi.json public surface"
```

---

## Task 2: Document `HOST=::` intent without breaking local default

**Files:**

- Modify: `src/server.ts`

Fastify's `listen({ host: "::" })` binds dual-stack (IPv6+IPv4) and is the value Railway's private networking DNS expects. The current code `process.env.HOST ?? "0.0.0.0"` is already correct — we only add a comment so future readers don't "fix" it.

- [ ] **Step 1: Add an intent comment above the `host` constant in `src/server.ts`.**

Edit `src/server.ts` — change:

```ts
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
```

to:

```ts
const port = Number(process.env.PORT ?? 8787);
// Default to 0.0.0.0 for local dev. Production deploys (Railway) must set HOST=::
// so Fastify binds dual-stack and is reachable over Railway private networking.
const host = process.env.HOST ?? "0.0.0.0";
```

- [ ] **Step 2: Add a Vitest case confirming a dual-stack HOST value is accepted by the build.**

Append to `src/__tests__/smoke.test.ts` before the final closing line:

```ts
describe("server HOST handling", () => {
  it("boots when HOST is set to dual-stack '::'", async () => {
    const previous = process.env.HOST;
    process.env.HOST = "::";
    try {
      const fresh = buildApp();
      const response = await fresh.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
      await fresh.close();
    } finally {
      if (previous === undefined) {
        delete process.env.HOST;
      } else {
        process.env.HOST = previous;
      }
    }
  });
});
```

Rationale: `buildApp()` doesn't call `listen`, so the test covers the construction path (which is what Unit 6 smoke is for). Actual socket binding is exercised by the Railway healthcheck in Task 7.

- [ ] **Step 3: Run the smoke test.**

Run: `npx vitest run src/__tests__/smoke.test.ts`

Expected: all cases pass including the new HOST test.

- [ ] **Step 4: Commit.**

```bash
git add src/server.ts src/__tests__/smoke.test.ts
git commit -m "chore(server): document HOST=:: intent for Railway dual-stack bind"
```

---

## Task 3: Add a clarifying Dockerfile comment on the production `LEDGER_DB_PATH` override

**Files:**

- Modify: `Dockerfile`

The Dockerfile sets `ENV LEDGER_DB_PATH=tmp/ledger.sqlite` as the local default. Production (Railway) overrides it to `/data/ledger.sqlite` via the dashboard env var. Add one comment so future operators don't assume `/app/tmp` is durable.

- [ ] **Step 1: Edit `Dockerfile` around the `LEDGER_DB_PATH` env declaration.**

Find:

```dockerfile
ENV NODE_ENV=production
ENV PORT=8787
ENV LEDGER_DB_PATH=tmp/ledger.sqlite
```

Replace with:

```dockerfile
ENV NODE_ENV=production
ENV PORT=8787
# Local/dev default. Production deploys MUST override LEDGER_DB_PATH to a path
# backed by a persistent volume (Railway: /data/ledger.sqlite with the volume
# mounted at /data — see railway.toml and docs/runbooks/railway-deploy.md).
ENV LEDGER_DB_PATH=tmp/ledger.sqlite
```

- [ ] **Step 2: Rebuild the image locally to confirm the Dockerfile still parses.**

Run: `docker build -t regime-engine:unit6-check .`

Expected: build succeeds. If Docker is not available, skip — the comment change is textual and will be exercised by the next deploy.

- [ ] **Step 3: Commit.**

```bash
git add Dockerfile
git commit -m "docs(dockerfile): call out production LEDGER_DB_PATH override requirement"
```

---

## Task 4: Add deterministic curl-runbook fixtures

**Files:**

- Create: `fixtures/sr-levels-brief.json`
- Create: `fixtures/clmm-execution-event.json`

These fixtures are what the runbook curl commands post. Keep them byte-stable so an operator can rerun step 6 of the runbook and observe `{ idempotent: true }` on replay.

- [ ] **Step 1: Create `fixtures/sr-levels-brief.json`.**

```json
{
  "schemaVersion": "1.0",
  "source": "mco",
  "symbol": "SOL/USDC",
  "brief": {
    "briefId": "runbook-smoke-2026-04-19",
    "sourceRecordedAtIso": "2026-04-19T00:00:00.000Z",
    "summary": "Runbook smoke fixture; not a real MCO brief."
  },
  "levels": [
    {
      "levelType": "support",
      "price": 135.50,
      "timeframe": "4h",
      "rank": "primary",
      "invalidation": 132.00,
      "notes": "runbook fixture"
    },
    {
      "levelType": "support",
      "price": 128.75,
      "timeframe": "1d",
      "rank": "secondary"
    },
    {
      "levelType": "resistance",
      "price": 152.25,
      "timeframe": "4h",
      "rank": "primary",
      "invalidation": 155.00
    },
    {
      "levelType": "resistance",
      "price": 161.00,
      "timeframe": "1d",
      "rank": "secondary"
    }
  ]
}
```

- [ ] **Step 2: Create `fixtures/clmm-execution-event.json`.**

```json
{
  "schemaVersion": "1.0",
  "correlationId": "runbook-attempt-2026-04-19-001",
  "positionId": "runbook-position-sol-usdc-01",
  "breachDirection": "LowerBoundBreach",
  "reconciledAtIso": "2026-04-19T00:10:00.000Z",
  "txSignature": "RunbookTxSig1111111111111111111111111111111111111111111111111111",
  "tokenOut": "USDC",
  "status": "confirmed",
  "episodeId": "runbook-episode-2026-04-19",
  "previewId": "runbook-preview-2026-04-19",
  "detectedAtIso": "2026-04-19T00:09:45.000Z",
  "amountOutRaw": "100000000",
  "txFeesUsd": 0.02,
  "priorityFeesUsd": 0.01,
  "slippageUsd": 0.05
}
```

Notes on shape (cross-check against `src/contract/v1/validation.ts` → `parseClmmExecutionEventRequest`):

- `status` must be `"confirmed"` or `"failed"` — any other value is a Zod reject (parent plan §5.3, §10 item 4).
- `breachDirection = "LowerBoundBreach"` implies `tokenOut = "USDC"` (validator enforces this mapping — see commit `70e0e77`).
- `reconciledAtIso` and `detectedAtIso` must be ISO 8601 (commit `d507bb9`).
- `schemaVersion` must match the CLMM ingest schema contract (commit `ea17b5f`).

- [ ] **Step 3: Validate the fixtures against the real validators via a throwaway script.**

Run: `npx tsx -e "import('./src/contract/v1/validation.js').then(async (m) => { const fs = await import('node:fs'); const sr = JSON.parse(fs.readFileSync('fixtures/sr-levels-brief.json','utf8')); const ev = JSON.parse(fs.readFileSync('fixtures/clmm-execution-event.json','utf8')); m.parseSrLevelBriefRequest(sr); m.parseClmmExecutionEventRequest(ev); console.log('both fixtures valid'); })"`

Expected: prints `both fixtures valid`. If either fails, read the Zod error, adjust the fixture (not the validator), and re-run.

- [ ] **Step 4: Run the full test suite once more.**

Run: `npm run test`

Expected: all green. Fixtures are plain JSON and don't affect tests directly, but this confirms the repo is still healthy.

- [ ] **Step 5: Commit.**

```bash
git add fixtures/sr-levels-brief.json fixtures/clmm-execution-event.json
git commit -m "feat(fixtures): add Railway runbook fixtures for sr-levels + clmm-execution"
```

---

## Task 5: Update `architecture.md` for the three new endpoints and two new tables

**Files:**

- Modify: `architecture.md`

The current `architecture.md` lists the old surface (`/v1/plan`, `/v1/execution-result`, `/v1/report/weekly`) and omits both the S/R endpoints and the CLMM execution-event ingest. The append-only invariant is implied but the "latest-brief query is the current-set model" rule isn't stated.

- [ ] **Step 1: In the "Runtime overview" section, replace the endpoint list with the full shipped surface.**

Find:

```markdown
- HTTP server exposes:
  - `GET /health`, `GET /version`
  - `GET /v1/openapi.json`
  - `POST /v1/plan`
  - `POST /v1/execution-result`
  - `GET /v1/report/weekly`
- Ledger is local SQLite (single file).
- Report generation reads ledger only (no network calls).
```

Replace with:

```markdown
- HTTP server exposes:
  - `GET /health`, `GET /version`
  - `GET /v1/openapi.json`
  - `POST /v1/plan`
  - `POST /v1/execution-result`
  - `POST /v1/clmm-execution-result` — token-guarded (`X-CLMM-Internal-Token`)
  - `GET /v1/report/weekly`
  - `POST /v1/sr-levels` — token-guarded (`X-Ingest-Token`)
  - `GET /v1/sr-levels/current?symbol&source`
- Ledger is local SQLite (single file; Railway mounts `/data`).
- Report generation reads ledger only (no network calls).
- CLMM execution events accumulate in `clmm_execution_events` for post-shelf analytics; the weekly report does NOT consume them in this sprint.
```

- [ ] **Step 2: Add a new "S/R brief ingestion" subsection after "Execution result ingestion" in the "Data flow" section.**

Append after the existing `### Execution result ingestion (POST /v1/execution-result)` block:

```markdown
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
```

- [ ] **Step 3: Expand the "Module layout" section's `src/ledger/` bullet.**

Find:

```markdown
- `src/ledger/` (I/O adapter)
  - schema, store, writer, queries
```

Replace with:

```markdown
- `src/ledger/` (I/O adapter)
  - `schema.sql` — append-only tables: `plan_requests`, `plans`, `execution_results`, `sr_level_briefs`, `sr_levels`, `clmm_execution_events`
  - `store.ts` — `node:sqlite` connection + canonical-JSON idempotency helpers
  - `writer.ts` — plan + execution result writes; plan-linked (`PLAN_NOT_FOUND` on missing planId)
  - `srLevels.ts` — `writeSrLevelBrief`, `getCurrentSrLevels`; `BEGIN IMMEDIATE` for check-then-insert
```

- [ ] **Step 4: Strengthen the "Security and safety posture" section to cover the new shared-secret surface.**

Find:

```markdown
## Security and safety posture (local-first)

- Service is designed to run locally and accept requests from trusted callers (Autopilot on same host).
- No secrets required in Regime Engine.
- Ledger is append-only for auditability (deletions/updates avoided; corrections via new rows if needed).
```

Replace with:

```markdown
## Security and safety posture

- Originally designed for local use. For the Railway deploy, two write routes are protected by shared-secret headers:
  - `POST /v1/sr-levels` — `X-Ingest-Token` compared against `OPENCLAW_INGEST_TOKEN` via `timingSafeEqual`.
  - `POST /v1/clmm-execution-result` — `X-CLMM-Internal-Token` compared against `CLMM_INTERNAL_TOKEN` via `timingSafeEqual`.
- A missing/empty token env var is an **ops misconfig** and responds `500`, not `401` — a caller cannot brute-force a service that has no configured token.
- Token comparison fails closed when caller and configured token differ in length (required by `timingSafeEqual`).
- Read routes (`GET /v1/sr-levels/current`, `GET /v1/report/weekly`) are unauthenticated. Treat them as public.
- **Append-only ledger.** No `UPDATE`s, no `DELETE`s on any truth row. "Current S/R set" is a read derived from the newest `(symbol, source)` brief — never a mutated `superseded_at` column. Corrections happen via a new brief with a later `captured_at_unix_ms`.
```

- [ ] **Step 5: Run lint + typecheck to make sure the markdown didn't accidentally touch TS files.**

Run: `npm run lint && npm run typecheck`

Expected: both pass.

- [ ] **Step 6: Commit.**

```bash
git add architecture.md
git commit -m "docs(architecture): document S/R + CLMM event surface, latest-brief rule, shared-secret posture"
```

---

## Task 6: Update `README.md` with runbook pointer, HOST guidance, and curl verification snippet

**Files:**

- Modify: `README.md`

The existing `Deploying to Railway` section already documents the volume, `RAILWAY_RUN_UID`, and envs. Unit 6 adds: (a) link to the new runbook, (b) recommended `HOST=::` for Railway, (c) short curl-verification snippet pointing to the fixtures committed in Task 4.

- [ ] **Step 1: Update the Railway env var table.**

Find the row:

```markdown
   | `HOST` | `0.0.0.0` | Host binding |
```

Replace with:

```markdown
   | `HOST` | `0.0.0.0` | Host binding. **Set to `::` on Railway** so Fastify binds dual-stack and is reachable over private networking. |
```

- [ ] **Step 2: Add a "Verifying the deploy" subsection directly after the Railway env var table.**

Insert after the existing step 5 (`Railway handles HTTPS termination…`):

```markdown
### Verifying the deploy

Once the service is live, run the curl runbook from a machine with the tokens loaded into env:

```bash
export RE_URL="https://<public>.up.railway.app"
export OPENCLAW_INGEST_TOKEN="<the token set in Railway>"
export CLMM_INTERNAL_TOKEN="<the token set in Railway>"

curl -fsS "$RE_URL/health"
curl -fsS "$RE_URL/version"
curl -fsS "$RE_URL/v1/openapi.json" | head -c 200

# S/R ingest — fresh insert
curl -fsS -X POST "$RE_URL/v1/sr-levels" \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: $OPENCLAW_INGEST_TOKEN" \
  -d @fixtures/sr-levels-brief.json

# Current read
curl -fsS "$RE_URL/v1/sr-levels/current?symbol=SOL/USDC&source=mco"

# CLMM event — fresh
curl -fsS -X POST "$RE_URL/v1/clmm-execution-result" \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: $CLMM_INTERNAL_TOKEN" \
  -d @fixtures/clmm-execution-event.json

# CLMM event — replay; expect { ok: true, correlationId, idempotent: true }
curl -fsS -X POST "$RE_URL/v1/clmm-execution-result" \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: $CLMM_INTERNAL_TOKEN" \
  -d @fixtures/clmm-execution-event.json
```

Full runbook (ordered steps, private-networking fallback, failure triage): see [`docs/runbooks/railway-deploy.md`](docs/runbooks/railway-deploy.md).
```

- [ ] **Step 3: Run `npm run format` to make sure prettier is happy with the README changes.**

Run: `npm run format`

Expected: no changes required (prettier doesn't rewrite Markdown by default — just confirms clean). If prettier flags the README, run `npx prettier --write README.md` and re-stage.

- [ ] **Step 4: Commit.**

```bash
git add README.md
git commit -m "docs(readme): link railway runbook, document HOST=::, add curl verification"
```

---

## Task 7: Create the Railway deploy runbook

**Files:**

- Create: `docs/runbooks/railway-deploy.md`

This is the document the parent plan §6 Unit 6 calls for: copy-paste curl verification, step-by-step order, private-networking fallback. It's the thing an operator opens at deploy time.

- [ ] **Step 1: Make the runbooks directory.**

Run: `mkdir -p docs/runbooks`

- [ ] **Step 2: Write `docs/runbooks/railway-deploy.md`.**

```markdown
---
title: "Runbook: Deploy regime-engine to Railway"
status: active
date: 2026-04-19
audience: on-call operator shipping regime-engine alongside clmm-superpowers-v2
parent_plan: docs/plans/2026-04-17-002-opus-clmm-regime-engine-integration-plan.md
---

# Deploy regime-engine to Railway

This runbook is the concrete, copy-paste sequence for landing regime-engine in the existing
`clmm-superpowers-v2` Railway project. Execute the steps in order. Do NOT reorder — the
volume-before-deploy rule is load-bearing (without the volume, SQLite writes go to ephemeral
disk and disappear on every deploy, silently).

## Prerequisites

- Railway project hosting `clmm-superpowers-v2` already exists.
- You have push access to the regime-engine GitHub repo and admin access to the Railway project.
- Two shared secrets generated out-of-band (keep them in a password manager):
  - `OPENCLAW_INGEST_TOKEN` — shared with whoever operates the OpenClaw ingest.
  - `CLMM_INTERNAL_TOKEN` — shared with the CLMM backend service (reference variable, not copied by hand).

## Step 1 — Create the persistent volume FIRST

In the Railway dashboard:

1. Add a new service: **New → GitHub Repo → regime-engine**.
2. **Before the first deploy completes**, open the service's "Volumes" tab.
3. Create a volume:
   - Name: `ledger`
   - Mount path: `/data`
4. `railway.toml` declares `requiredMountPath = "/data"`; Railway refuses to deploy without this volume.

Why first: without the volume, the first deploy writes SQLite to the container's ephemeral disk.
The service "works" until the next restart, at which point the ledger is gone. There is no recovery.

## Step 2 — Set environment variables

On the regime-engine service, set:

| Variable | Value | Notes |
|---|---|---|
| `HOST` | `::` | Dual-stack bind for Railway private networking. |
| `PORT` | _(leave unset — Railway injects)_ | Fastify reads `process.env.PORT`. |
| `LEDGER_DB_PATH` | `/data/ledger.sqlite` | Must be on the mounted volume. |
| `NODE_ENV` | `production` | |
| `OPENCLAW_INGEST_TOKEN` | strong random string | Share with OpenClaw operator. |
| `CLMM_INTERNAL_TOKEN` | strong random string | Referenced from CLMM service (see Step 5). |
| `RAILWAY_RUN_UID` | `0` | Required — volume is root-owned; container user is `app`. |
| `COMMIT_SHA` | `${{RAILWAY_GIT_COMMIT_SHA}}` | Optional; surfaces in `/version`. |

Do NOT set `DATABASE_URL` or any Postgres variable. regime-engine is SQLite-only.

## Step 3 — Trigger the first deploy

Click "Deploy" (or wait for the GitHub push to trigger). Watch the build log:

- Build stage runs `npm ci --ignore-scripts` then `npm run build`.
- Production stage runs as user `app`, starts `node --env-file-if-exists=.env dist/src/server.js`.
- Healthcheck at `/health` with 30s timeout (from `railway.toml`).

If the healthcheck fails:

- **Most common cause:** `HOST` was not set to `::`. Fastify binds only IPv4, Railway's private DNS serves AAAA, healthcheck misses.
- **Second most common:** `LEDGER_DB_PATH` points outside `/data` and the process lacks write permission — check logs for `SQLITE_CANTOPEN`.
- **Third:** `RAILWAY_RUN_UID=0` is missing and the non-root container can't write to the volume.

## Step 4 — Enable a public domain

On the regime-engine service: **Settings → Networking → Generate Domain**. This produces
`https://<something>.up.railway.app`. OpenClaw will POST S/R briefs to this public URL.

## Step 5 — Wire the CLMM backend

On the CLMM backend service (same Railway project), add:

```text
REGIME_ENGINE_BASE_URL = http://${{regime-engine.RAILWAY_PRIVATE_DOMAIN}}:${{regime-engine.PORT}}
REGIME_ENGINE_INTERNAL_TOKEN = ${{regime-engine.CLMM_INTERNAL_TOKEN}}
```

Reference variables (`${{service.VAR}}`) keep the token from being copied manually and
automatically update when the regime-engine service rotates its value. The private domain
resolves only inside Railway's network.

## Step 6 — Curl verification (from your laptop)

```bash
export RE_URL="https://<public>.up.railway.app"
export OPENCLAW_INGEST_TOKEN="<value from Step 2>"
export CLMM_INTERNAL_TOKEN="<value from Step 2>"

# 6.1 Health + version + openapi
curl -fsS "$RE_URL/health"
# → {"ok":true}

curl -fsS "$RE_URL/version"
# → {"name":"regime-engine","version":"0.1.0","commit":"<sha>"}

curl -fsS "$RE_URL/v1/openapi.json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sorted(d["paths"].keys()))'
# → expect the full surface including /v1/sr-levels and /v1/clmm-execution-result

# 6.2 Empty current-read
curl -sS -o /dev/null -w "%{http_code}\n" \
  "$RE_URL/v1/sr-levels/current?symbol=SOL/USDC&source=mco"
# → 404 (before the first ingest)

# 6.3 Auth rejection — should be 401, DB untouched
curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$RE_URL/v1/sr-levels" \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: obviously-wrong" \
  -d @fixtures/sr-levels-brief.json
# → 401

# 6.4 Fresh S/R ingest
curl -fsS -X POST "$RE_URL/v1/sr-levels" \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: $OPENCLAW_INGEST_TOKEN" \
  -d @fixtures/sr-levels-brief.json
# → 201 {"briefId":"runbook-smoke-2026-04-19","insertedCount":4}

# 6.5 Read current
curl -fsS "$RE_URL/v1/sr-levels/current?symbol=SOL/USDC&source=mco"
# → 200 with supports[] and resistances[] sorted by price ASC, capturedAtIso present

# 6.6 CLMM event fresh
curl -fsS -X POST "$RE_URL/v1/clmm-execution-result" \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: $CLMM_INTERNAL_TOKEN" \
  -d @fixtures/clmm-execution-event.json
# → 200 {"schemaVersion":"1.0","ok":true,"correlationId":"runbook-attempt-2026-04-19-001"}

# 6.7 CLMM event replay — idempotency
curl -fsS -X POST "$RE_URL/v1/clmm-execution-result" \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: $CLMM_INTERNAL_TOKEN" \
  -d @fixtures/clmm-execution-event.json
# → 200 with "idempotent":true

# 6.8 S/R ingest replay — idempotency
curl -fsS -X POST "$RE_URL/v1/sr-levels" \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: $OPENCLAW_INGEST_TOKEN" \
  -d @fixtures/sr-levels-brief.json
# → 200 {"status":"already_ingested"}
```

All eight must pass before you continue.

## Step 7 — Verify private networking from the CLMM container

Open a Railway shell on the CLMM backend service:

```bash
curl -fsS "http://regime-engine.railway.internal:${REGIME_ENGINE_PORT:-8787}/health"
# → {"ok":true}
```

If this fails but Step 6 passed, Railway private networking isn't resolving. **Fallback
without reverting the architecture:** on the CLMM backend, set
`REGIME_ENGINE_BASE_URL` to the public URL from Step 4. The shared secret still protects the
write route; you eat ~50-100ms of extra latency per event until private networking is fixed.

## Step 8 — Restart safety check (durability)

On the regime-engine service, click "Restart". After it comes back:

```bash
curl -fsS "$RE_URL/v1/sr-levels/current?symbol=SOL/USDC&source=mco"
# → 200 with the same briefId from Step 6.4
```

If this returns 404, the volume is NOT wired. Stop and fix Step 1 before any further work —
every day of operation without a volume is a day of silently-lost data.

## Step 9 — End-to-end path

1. OpenClaw posts a real brief to `POST /v1/sr-levels` (or repeat Step 6.4 with a real fixture).
2. Confirm the CLMM PWA position detail shows the levels + freshness label.
3. In CLMM staging (or via a fixture breach), trigger a breach.
4. Observe **one** `POST /v1/clmm-execution-result` in regime-engine logs (correlationId = attemptId).
5. If the reconciliation worker fires for the same attempt, observe a second POST returning
   `200 { idempotent: true }` — this is the double-post safety net working as designed.

Only after steps 1-9 pass: fund the live wallet with $100 and open the first real SOL/USDC position (parent plan G5).

## Rollback

Regime-engine is append-only. There is no destructive rollback — redeploy the previous commit
from Railway's deploy history. The ledger survives rollbacks because it's on the persistent volume.
If a deploy introduces a bad migration (no migrations exist today; adding one would mean adding
DDL to `src/ledger/schema.sql`), the fix is forward — ship a new deploy that adds the missing
columns. Do NOT delete the volume.
```

- [ ] **Step 3: Verify the runbook file is well-formed Markdown.**

Run: `npm run format`

Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add docs/runbooks/railway-deploy.md
git commit -m "docs(runbook): add step-by-step Railway deploy runbook with curl verification"
```

---

## Task 8: Annotate the sprint source doc with resolved assumptions

**Files:**

- Modify: `docs/2026-04-17-clmm-regime-engine-integration-sprint.md`

The original sprint doc predates the repo-reality check. The parent plan §2 called out four specific assumption mismatches. Leaving those unannotated in the source doc means future readers re-derive the same confusion. Add a short "Resolved assumptions" block at the top so the doc self-corrects.

- [ ] **Step 1: Append a "Resolved assumptions" block immediately under the existing frontmatter/headline.**

Insert after line 6 (`**Budget:** 18-26 hours…`) and before `---`:

```markdown

## Resolved assumptions (Unit 6 addendum, 2026-04-19)

The implementation plan at `docs/plans/2026-04-17-002-opus-clmm-regime-engine-integration-plan.md`
is the executable decomposition of this sprint. Units 1-5 have shipped on `main`. Where this
sprint doc's assumptions diverge from what was actually built, the implementation wins:

- **Storage engine:** regime-engine is Fastify + Zod + `node:sqlite` (native). Not Postgres, not
  Drizzle. The `CREATE SCHEMA regime_engine` DDL drafted here is non-applicable — real DDL is
  in `src/ledger/schema.sql` and is documented in the plan §5.4.
- **CLMM ingest route:** CLMM posts to a new endpoint, `POST /v1/clmm-execution-result`
  (token-guarded by `X-CLMM-Internal-Token`). It does NOT reuse `POST /v1/execution-result`,
  which is plan-linked and would return `PLAN_NOT_FOUND` for CLMM events.
- **Wire `status`:** restricted to `"confirmed" | "failed"` on the wire. Transient states
  (`partial`, `pending`, `submitted`) are NOT notified — they would 409-churn when the final
  state arrives later.
- **"Current S/R" model:** append-only ledger + latest-brief query (`ORDER BY
  captured_at_unix_ms DESC, id DESC LIMIT 1`). There is no `superseded_at` column. Corrections
  flow via a new brief, not a mutation.
- **Volume mount path:** `/data` (declared by `railway.toml`, documented in the Railway deploy
  runbook at `docs/runbooks/railway-deploy.md`). Local/dev default is still `tmp/ledger.sqlite`.
- **Weekly report integration with CLMM events:** deferred. Events accumulate in
  `clmm_execution_events` for post-shelf analytics; `src/report/weekly.ts` is untouched.
```

- [ ] **Step 2: Double-check the annotation rendered in a Markdown preview (or re-read it).**

Run: `head -60 docs/2026-04-17-clmm-regime-engine-integration-sprint.md`

Expected: the addendum block appears between the original budget line and the first `---`.

- [ ] **Step 3: Commit.**

```bash
git add docs/2026-04-17-clmm-regime-engine-integration-sprint.md
git commit -m "docs(sprint): annotate resolved assumptions (SQLite, new CLMM route, append-only)"
```

---

## Task 9: Final gate check — full suite + Docker boot smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full quality gate.**

Run: `npm run lint && npm run typecheck && npm run test && npm run format`

Expected: all pass. If `format` flags anything, run `npx prettier --write <file>`, stage, and amend the relevant commit (only the commit for the file prettier touched — do NOT amend unrelated commits).

- [ ] **Step 2: Local Docker smoke (optional if Docker unavailable).**

Run:

```bash
docker build -t regime-engine:unit6 .
docker run --rm -d --name re-smoke -p 18787:8787 \
  -e HOST=:: \
  -e OPENCLAW_INGEST_TOKEN=local-smoke-token-openclaw \
  -e CLMM_INTERNAL_TOKEN=local-smoke-token-clmm \
  -e LEDGER_DB_PATH=/app/tmp/ledger.sqlite \
  regime-engine:unit6
sleep 2
curl -fsS http://127.0.0.1:18787/health
curl -fsS http://127.0.0.1:18787/version
curl -fsS -X POST http://127.0.0.1:18787/v1/sr-levels \
  -H "Content-Type: application/json" \
  -H "X-Ingest-Token: local-smoke-token-openclaw" \
  -d @fixtures/sr-levels-brief.json
curl -fsS "http://127.0.0.1:18787/v1/sr-levels/current?symbol=SOL/USDC&source=mco"
curl -fsS -X POST http://127.0.0.1:18787/v1/clmm-execution-result \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: local-smoke-token-clmm" \
  -d @fixtures/clmm-execution-event.json
# Replay — expect idempotent:true
curl -fsS -X POST http://127.0.0.1:18787/v1/clmm-execution-result \
  -H "Content-Type: application/json" \
  -H "X-CLMM-Internal-Token: local-smoke-token-clmm" \
  -d @fixtures/clmm-execution-event.json
docker rm -f re-smoke
```

Expected: every curl succeeds; the replay POST returns `"idempotent":true`. If this works
locally, Step 6 of the runbook will work on Railway too (modulo the dual-stack bind and the volume).

If Docker is unavailable, skip this step — the Vitest smoke tests in Task 1 + Task 2 cover the
same surface at the application level.

- [ ] **Step 3: Open the PR.**

```bash
git push -u origin HEAD
gh pr create --title "feat: Unit 6 — regime-engine deploy, smoke, docs, runbook" --body "$(cat <<'EOF'
## Summary

- Expand smoke test to cover `/version` and `/v1/openapi.json` (and confirm `HOST=::` accepted)
- Add deterministic curl-runbook fixtures (`sr-levels-brief.json`, `clmm-execution-event.json`)
- Refresh `README.md` (HOST=:: for Railway, curl verification, runbook link)
- Refresh `architecture.md` (new endpoints + tables + append-only / latest-brief rule + shared-secret posture)
- Add `docs/runbooks/railway-deploy.md` (step-by-step with curls, private-networking fallback, durability check)
- Annotate `docs/2026-04-17-clmm-regime-engine-integration-sprint.md` with resolved assumptions
- Document production `LEDGER_DB_PATH` override in Dockerfile

Parent plan: `docs/plans/2026-04-17-002-opus-clmm-regime-engine-integration-plan.md` §6 Unit 6.

Scope: regime-engine repo only (Units 1-5 already merged).

## Test plan

- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run test` — all green, includes new smoke cases
- [x] `npm run format`
- [ ] Optional: local Docker smoke per Task 9 Step 2
- [ ] On-Railway: execute `docs/runbooks/railway-deploy.md` steps 1-8 end to end
EOF
)"
```

Expected: PR opens with all checks running. Do NOT merge until the reviewer confirms Task 9
Step 2 either ran clean or was skipped with reason.

---

## Requirements trace (parent plan §3, Unit 6 rows only)

| Parent req | Covered by |
|---|---|
| R9 — both services deployed in one Railway project | Tasks 6, 7 (documentation + runbook); Tasks 1-3 make the service healthy at boot |
| R10 — minimum public surface; internal routes guarded | Task 5 (architecture), Task 7 (runbook §6.3 auth rejection check) |
| R11 — shared-secret protection for write routes | Task 5 (architecture posture), Task 7 (Step 2 env table + Step 6 verification) |
| R12 — one manual end-to-end validation | Task 7 Steps 6-9 |
| R13 — live $100 position after validation | Task 7 Step 9 (explicit gate to funding) |

## Gates (parent plan §8, Unit 6 slice only)

- **G3 — Sat morning W2:** Tasks 1-8 complete; Task 9 Step 1 green; runbook Steps 1-6 executable from a fresh clone.
- **G4 — Sat evening W2:** runbook Steps 7-8 green; Unit 5 PR in CLMM merged so the PWA can consume enriched position detail.
- **G5 — Sun W2:** runbook Step 9 green end-to-end; $100 wallet funded; one live SOL/USDC position.

**Hard stop:** if G3 slips past Sat morning W2, ship code-done without the live position. The
doc + runbook changes in this plan are small enough that the cost of shelving is low.

## Budget

Task 1 0.5h · Task 2 0.25h · Task 3 0.1h · Task 4 0.25h · Task 5 0.5h · Task 6 0.3h · Task 7 0.5h · Task 8 0.15h · Task 9 0.45h  = **3.0h** (parent plan budgeted 2.5h; 0.5h over to absorb first-time Railway fumbles during Task 7 step 7 private networking verification).

## Self-review checklist

- [x] Every task has exact file paths.
- [x] Every code step has the actual code.
- [x] Every command step has an expected output.
- [x] No TODO / TBD / "handle edge cases" placeholders.
- [x] Type references (`parseSrLevelBriefRequest`, `parseClmmExecutionEventRequest`, `writeSrLevelBrief`, `writeClmmExecutionEvent`, `requireSharedSecret`) match Units 1-5 as shipped on `main` (commits `98d8b37`, `ea17b5f`, `d507bb9`, `70e0e77`).
- [x] Fixture shapes validate against the real Zod parsers (Task 4 Step 3 enforces this).
- [x] Scope is regime-engine only; no `clmm-superpowers-v2` files referenced.
- [x] Forbidden list from parent plan §7 carried forward in the preamble.
