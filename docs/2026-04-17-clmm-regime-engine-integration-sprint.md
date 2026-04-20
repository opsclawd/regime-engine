# Design: CLMM + Regime Engine Integration Sprint

**Date:** 2026-04-17
**Status:** Draft
**Budget:** 18-26 hours across 2 weekends. If weekend 1 (items 1-4) doesn't land by end of Sunday, pause the sprint — do not extend into weekday time.

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

---

## Problem

CLMM V2 MVP is functional. Regime Engine microservice exists as a separate repo with the scope boundary defined in its README: it computes plans, stores a truth ledger, and serves reports. It does not execute. CLMM executes. OpenClaw produces daily S/R briefs from ingested MCO videos but those briefs land nowhere persistent.

Three gaps between "MVP works" and "running live with $100":

1. **S/R levels produced by OpenClaw have no durable store.** Each daily brief is ephemeral. Position-placement decisions can't reference historical level evolution or current active levels in a structured way.
2. **CLMM has no feedback path to Regime Engine.** Execution events (breaches, exits, reconciliations) happen inside CLMM and stay there. The Regime Engine can't build its truth ledger or generate meaningful weekly reports without receiving execution results.
3. **Neither service is deployed together.** Regime Engine runs locally via `npm run dev`. CLMM runs on Railway. The integration requires both services co-located with internal networking.

This sprint closes those three gaps and gets the combined system running live with $100 on a single SOL/USDC position.

## Goals

- S/R levels from OpenClaw briefs persist in the Regime Engine's database, queryable by symbol and timeframe.
- CLMM posts execution results to Regime Engine after every exit, including breach direction, position state, and transaction reference.
- Both services deployed on the same Railway project, communicating over internal networking.
- End-to-end simulated breach exercises the full path: detection → exit → execution-result POST → Regime Engine persistence.
- Live $100 deployment on one SOL/USDC position, one wallet, on mainnet.

## Non-Goals

- Building or modifying Regime Engine's plan computation logic (`POST /v1/plan`). The CLMM app does not call `/v1/plan` in this sprint. Plans are analytics, not execution inputs.
- Building a runtime regime filter that gates CLMM exits based on regime state. Exit direction is determined by breach direction (lower-bound breach → USDC, upper-bound breach → SOL). Regime Engine is analytics-only in this sprint.
- Dashboards, report tuning, or UI for reading Regime Engine weekly reports. The reports are useful after 30+ days of data; reading them during the sprint is scope creep.
- Multi-analyst S/R support. One source (`mco`) only. Schema is extensible; logic is not.
- Whipsaw filtering, confidence weighting, level expiry policies. Post-shelf decisions.
- Monitoring, alerting, kill switch infrastructure. Required before graduating above $100. Not required for $100.
- Cannabis, Pronghorn, or AER work. Those are different projects.

## Scope boundary

This sprint crosses two repos:

- `clmm-v2` — adds outbound adapter for execution-result posting, adds minimal UI element for viewing current S/R levels.
- `regime-engine` — adds inbound adapter for S/R level ingestion, adds DB migration for S/R levels table, adds read endpoint for current active levels.

No shared code. Integration is HTTP over Railway's private network. No library extracted. Scope boundary from the Regime Engine README is preserved: Regime Engine does not import CLMM code and CLMM does not import Regime Engine code.

---

## Architecture

### Deployment topology (Railway, single project)

```
Railway project: clmm-v2
├── clmm-v2-api         (existing) — public, Hono/NestJS API + PWA
├── clmm-v2-monitor     (existing) — Railway cron / pg-boss worker
├── clmm-v2-postgres    (existing) — Postgres instance, shared
└── regime-engine       (NEW)       — internal-only, Node service
```

Postgres is shared. `regime_engine` schema is separate from CLMM's schema. No foreign keys cross schemas. No cross-schema joins in application code. Drizzle Kit migrations for each service target their own schema explicitly.

### Integration points

```
OpenClaw (external, daily cron)
    │
    │  POST /v1/sr-levels  (HTTPS, public endpoint with shared-secret auth)
    ▼
regime-engine (Railway, internal + public endpoints)
    ▲
    │  POST /v1/execution-result  (internal only, no auth)
    │
clmm-v2-monitor (Railway, internal)
```

Public endpoints on regime-engine are limited to:

- `GET /health`
- `GET /v1/sr-levels/current?symbol=SOL/USDC` (read, for PWA consumption)
- `POST /v1/sr-levels` (write, shared-secret auth)
- `GET /v1/report/weekly` (read, optionally gated)

Internal-only endpoints:

- `POST /v1/execution-result` (CLMM → Regime Engine)
- `POST /v1/plan` (not called this sprint, available for future)

### Data flow: S/R levels

```
MCO publishes video → OpenClaw daily cron →
  ingest → LLM extract → structured brief →
  POST /v1/sr-levels { source: 'mco', levels: [...], brief_metadata } →
  regime-engine validates + persists →
  CLMM PWA GET /v1/sr-levels/current → display
```

### Data flow: execution results

```
CLMM monitor detects breach →
  CLMM executes exit via Orca + Jupiter →
  CLMM writes internal execution record →
  CLMM ExecutionResultPort → POST /v1/execution-result (fire-and-forget with retry) →
  regime-engine persists to truth ledger
```

**Execution-result posting is best-effort.** A POST failure must not block or fail the execution itself. The execution has already happened on-chain. The Regime Engine record is analytics. If the POST fails, retry up to 3 times with exponential backoff, then log + move on. A later sprint can add a reconciliation job that pulls missed execution-results from CLMM's DB.

---

## Work item specs

### 1. S/R levels schema + migration (regime-engine, 2h)

**Location:** `regime-engine/src/db/schema/sr-levels.ts`, migration via Drizzle Kit.

**Schema:**

```sql
CREATE SCHEMA IF NOT EXISTS regime_engine;

CREATE TABLE regime_engine.sr_levels (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol           TEXT NOT NULL,                     -- 'SOL/USDC'
  source           TEXT NOT NULL,                     -- 'mco'
  level_type       TEXT NOT NULL CHECK (level_type IN ('support', 'resistance')),
  price            NUMERIC(20, 8) NOT NULL,
  timeframe        TEXT,                              -- 'daily' | 'weekly' | '4h' | etc.
  rank             TEXT,                              -- 'key' | 'minor' | NULL
  invalidation     NUMERIC(20, 8),                    -- price at which level is invalidated, optional
  notes            TEXT,                              -- analyst rationale, free text
  brief_id         TEXT NOT NULL,                     -- OpenClaw brief identifier
  source_recorded_at TIMESTAMPTZ,                    -- when the analysis was made
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT now(),-- when we received it
  superseded_at    TIMESTAMPTZ,                       -- non-null when replaced by newer brief
  UNIQUE (source, brief_id, level_type, price)
);

CREATE INDEX idx_sr_levels_current
  ON regime_engine.sr_levels (symbol, source, superseded_at)
  WHERE superseded_at IS NULL;

CREATE INDEX idx_sr_levels_captured_at
  ON regime_engine.sr_levels (captured_at DESC);
```

**Behavior:**

- When a new brief arrives for a given `(symbol, source)`, all existing rows for that pair get `superseded_at = now()`. New levels from the brief are inserted fresh. This preserves history without requiring application code to reason about "active" state — current levels are `WHERE superseded_at IS NULL`.
- Supersession and insert happen in a single transaction. Partial ingestion is not allowed.

**Done criteria:**

- Migration runs clean against a fresh Postgres.
- Drizzle schema types compile.
- A manual `INSERT` via psql succeeds, `SELECT` against the current-levels index returns rows.

---

### 2. OpenClaw brief → levels adapter (regime-engine, 4-6h)

**Location:** `regime-engine/src/adapters/inbound/http/sr-levels.ts`, wired into the existing Fastify/Express app.

**Endpoint:** `POST /v1/sr-levels`

**Auth:** Shared secret in header `X-Ingest-Token`. Token stored as Railway env var `OPENCLAW_INGEST_TOKEN`. Mismatched or missing token returns 401.

**Request schema:**

```typescript
{
  source: 'mco',                      // literal for now; extensible later
  symbol: 'SOL/USDC',
  brief: {
    brief_id: string,                 // OpenClaw-generated stable ID
    source_recorded_at?: string,      // ISO 8601, optional
    summary?: string,                 // MCO's overall thesis, free text
  },
  levels: Array<{
    level_type: 'support' | 'resistance',
    price: number,
    timeframe?: string,
    rank?: 'key' | 'minor',
    invalidation?: number,
    notes?: string,
  }>
}
```

**Validation:**

- Zod schema enforces shape, rejects with 400 on mismatch.
- Duplicate `(source, brief_id)` returns 200 with body `{ status: 'already_ingested' }` — idempotent on brief_id. Does not re-supersede.
- Empty `levels` array is rejected with 400. A brief with no levels is meaningless.

**Persistence:** Single transaction — supersede existing current rows for `(symbol, source)`, then insert new rows.

**Response:** `201` with `{ brief_id, inserted_count, superseded_count }`.

**Done criteria:**

- POST with valid payload persists rows and supersedes prior set.
- POST with invalid auth returns 401.
- POST with malformed body returns 400 with Zod error details.
- Duplicate POST (same brief_id) is idempotent.
- Integration test with in-memory Postgres or test DB covers the happy path and the idempotency case.

**Unknown to resolve at implementation time:** OpenClaw's actual brief output format. If OpenClaw already emits JSON in a different shape, write a translation layer on the OpenClaw side, not on the regime-engine side. Regime-engine's accepted schema stays canonical.

---

### 3. Read endpoint + PWA UI for current levels (regime-engine + clmm-v2, 2-3h)

**Regime-engine side:**

`GET /v1/sr-levels/current?symbol=SOL/USDC&source=mco`

Response:

```typescript
{
  symbol: 'SOL/USDC',
  source: 'mco',
  captured_at: string,                // timestamp of most recent brief
  brief_id: string,
  levels: Array<{
    level_type: 'support' | 'resistance',
    price: number,
    timeframe: string | null,
    rank: 'key' | 'minor' | null,
    invalidation: number | null,
    notes: string | null,
  }>
}
```

Returns 404 if no current levels exist for `(symbol, source)`. Public endpoint, no auth required (levels are not sensitive — they're a public analyst's calls).

**CLMM PWA side:**

Minimal view in the existing PWA: a `/levels` route or a section on the position-open screen showing current MCO levels for SOL/USDC. Fetch from regime-engine's public URL. Plain list grouped by `level_type`, sorted by price. Show `rank` as a badge. Show `captured_at` so the user knows how fresh the data is.

No editing. No creation. Read-only display to inform manual position-bound placement when opening a new position.

**Environment variable on the PWA:** `REGIME_ENGINE_PUBLIC_URL` — Railway service public URL.

**Done criteria:**

- `curl` to the read endpoint returns current levels JSON.
- PWA route renders the levels list.
- Stale-data handling: if the endpoint 404s, the UI shows "No levels available — check OpenClaw ingestion" instead of crashing.

**Explicitly out of scope:**

- Editing, overriding, or manually adding levels via UI.
- Historical level comparisons.
- Charting. Don't plot anything.
- Realtime updates. Page refresh is fine.

---

### 4. ExecutionResultPort adapter in CLMM (clmm-v2, 2-3h)

**Location:** `packages/application/src/ports/ExecutionResultPort.ts` (new port), `packages/adapters/src/outbound/regime-engine/HttpExecutionResultAdapter.ts` (new adapter).

**Port interface:**

```typescript
export interface ExecutionResultPort {
  recordExecutionResult(result: ExecutionResult): Promise<void>;
}

export interface ExecutionResult {
  correlation_id: string; // stable ID tying this to CLMM's internal record
  wallet_id: string;
  position_mint: string;
  pool_address: string;
  breach_direction: "lower" | "upper"; // lower = exit to USDC, upper = exit to SOL
  tick_lower: number;
  tick_upper: number;
  tick_at_detection: number;
  detected_at: string; // ISO 8601
  executed_at: string; // ISO 8601
  tx_signature: string; // Solana tx sig
  token_out: "SOL" | "USDC";
  amount_out: string; // string for precision, raw token amount
  status: "success" | "partial" | "failed";
  error_message?: string; // present if status !== 'success'
}
```

**Adapter behavior:**

- POSTs JSON to `POST ${REGIME_ENGINE_INTERNAL_URL}/v1/execution-result`.
- Timeout: 5 seconds.
- Retry: 3 attempts, exponential backoff starting at 500ms.
- On final failure: log the full payload at ERROR level, swallow the exception. **Do not throw.** Execution-result posting never blocks or fails the executing code path.
- No circuit breaker. At one execution per breach and breaches measured in hours, throughput is too low to justify one.

**Wiring:** Injected into the breach-execution use case in the application layer. Called after the on-chain transaction is confirmed AND the internal execution record is written to CLMM's DB.

**Environment variable:** `REGIME_ENGINE_INTERNAL_URL` — set to `http://regime-engine.railway.internal:PORT` in Railway. Falls back to a no-op adapter if unset (for local dev without regime-engine running).

**Done criteria:**

- Unit test: adapter POSTs correct payload, retries on 5xx, swallows final failure.
- Unit test: no-op adapter is used when env var is missing.
- Integration test (deferred to item 6): real POST lands in regime-engine's truth ledger.

**Regime-engine side:** `POST /v1/execution-result` already exists per the README. This sprint does not modify it. If its accepted schema differs from the `ExecutionResult` type above, reconcile by updating the CLMM adapter, not the regime-engine endpoint. Regime-engine's schema is canonical.

---

### 5. Deploy regime-engine to Railway (ops, 2-4h)

**Steps:**

1. Add `regime-engine` as a second service in the existing `clmm-v2` Railway project. Source = the `regime-engine` GitHub repo.
2. Provision env vars:
   - `DATABASE_URL` — same Postgres as CLMM, but ensure the `regime_engine` schema exists. Either the regime-engine's Drizzle migration creates the schema, or run a one-off `CREATE SCHEMA` via Railway's Postgres console.
   - `NODE_ENV=production`
   - `PORT` — let Railway inject this. Service binds to `0.0.0.0:$PORT`.
   - `OPENCLAW_INGEST_TOKEN` — generate a strong random value, store in Railway's secret store, and configure OpenClaw to send it in `X-Ingest-Token`.
3. **Bind address:** Confirm regime-engine listens on `0.0.0.0`, not `127.0.0.1` / `localhost`. Railway's internal networking requires this. Check the server init code before the first deploy; a 5-minute fix ahead of time prevents a 1-hour debugging session after.
4. **Internal hostname:** `http://regime-engine.railway.internal:${PORT}`. Confirm CLMM's `REGIME_ENGINE_INTERNAL_URL` env matches.
5. **Public domain:** Enable Railway's public domain for `regime-engine` only for `GET /v1/sr-levels/current`, `GET /v1/report/weekly`, `GET /health`, and `POST /v1/sr-levels`. Internal-only endpoints (`/v1/execution-result`, `/v1/plan`) are still reachable via the public URL but protected by ingress-level rules or simply by not being documented publicly.
   - Minimal protection: add a middleware that rejects `POST /v1/execution-result` unless the request originates from the internal network, identified by a header Railway's internal networking attaches or by source IP. If the exact Railway internal-identification mechanism is unclear at deploy time, fall back to a simple shared-secret header for execution-result too. Ship shared-secret; harden later.
6. **First deploy verification:**
   - `curl https://<regime-engine-public>.up.railway.app/health` returns 200.
   - `curl https://<regime-engine-public>.up.railway.app/v1/sr-levels/current?symbol=SOL/USDC` returns 404 (no data yet).
   - From CLMM's container: `curl http://regime-engine.railway.internal:PORT/health` returns 200. (Use Railway's CLI or temporarily shell into the CLMM container.)
7. Run the sr-levels migration in production: either via Railway's deploy hook running `npm run db:migrate`, or manually via Railway Postgres console.

**Done criteria:**

- Both health endpoints return 200 from their respective external-facing URLs.
- CLMM can reach regime-engine internally (verified by curl from within CLMM's container).
- A test POST to `/v1/sr-levels` from a local machine with the correct token persists a row.

**Cost confirmation:** Both services in the same project share the Hobby $5/month subscription and its $5 included usage. Two small Node services at this traffic level will not exceed the $5 included — the bill stays at $5.

---

### 6. End-to-end test (both repos, 3-4h)

**Test scope:** One test exercising the full integrated path, run against the deployed Railway environment.

**Scenario:**

1. **Seed S/R levels.** POST to regime-engine `/v1/sr-levels` with a canned MCO-style brief. Confirm rows in DB.
2. **Verify levels exposure.** GET `/v1/sr-levels/current`. Confirm the seeded levels return.
3. **Seed a position.** Use an existing CLMM test helper (or write a minimal one) to insert a monitored position in CLMM's DB with known `tick_lower` and `tick_upper`. Position points to a real mainnet SOL/USDC pool. Do not use real funds for this test — use a test wallet with zero liquidity but a valid mint the monitor can iterate over. Alternative: mock the on-chain state at the adapter boundary and run the test against the mock.
4. **Trigger a breach.** Simulate breach detection by either:
   - Running the actual `BreachScan` cron against a fixture where current tick is outside the position's bounds, OR
   - Directly invoking the breach-handling use case with a synthetic breach event.
5. **Assert exit direction.** Verify the use case selects the correct `token_out`: lower-bound breach → USDC, upper-bound breach → SOL.
6. **Assert execution-result POST.** Either:
   - Observe the POST in regime-engine's request log, OR
   - Query regime-engine's truth ledger table for the expected row keyed on `correlation_id`.
7. **Assert idempotency.** Re-trigger the same breach with the same `correlation_id`. Confirm regime-engine does not double-write (requires regime-engine's `/v1/execution-result` to be idempotent on `correlation_id`; verify this is the case or add it if not).

**Execution:** Run this test once manually against the deployed environment. Do not invest in automating it to run in CI this sprint. One manual pass is the sprint deliverable.

**Done criteria:**

- All seven steps pass in a single manual run.
- Any failure results in a fix and a re-run, not a deferral.

---

## Verification gates

| Gate                             | Criteria                                               | Occurs after               |
| -------------------------------- | ------------------------------------------------------ | -------------------------- |
| Gate 1: Schema + adapter correct | Items 1-3 pass their individual done criteria, locally | End of Weekend 1 Saturday  |
| Gate 2: CLMM integration correct | Item 4 unit tests pass                                 | End of Weekend 1 Sunday    |
| Gate 3: Deploy healthy           | Item 5 done criteria pass                              | Weekend 2 Saturday morning |
| Gate 4: Integration verified     | Item 6 done criteria pass                              | Weekend 2 Saturday evening |
| Gate 5: Live ready               | $100 funded, position opened, monitor running          | Weekend 2 Sunday           |

If Gate 1 or Gate 2 misses end-of-Sunday Weekend 1: stop the sprint, shelf the project. Do not push into weekday time. Pronghorn starts Monday regardless.

If Gate 3 or Gate 4 miss in Weekend 2: finish Gate 4 if possible, skip Gate 5 (live deployment). Code-done without live deployment is still a shippable milestone — live deployment can wait 2-4 weeks until a spare Saturday opens up.

---

## Risks and mitigations

| Risk                                                                                                                    | Mitigation                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenClaw's actual brief output doesn't match the proposed `/v1/sr-levels` schema, requiring unplanned translation work. | Regime-engine schema is canonical. Translation layer goes on the OpenClaw side as a post-processor before POST. Budget 1h within item 2 for this. If OpenClaw output is a wildly different shape (free-form text, nested thesis narrative), defer the adapter and temporarily POST levels manually until post-sprint. |
| Regime-engine's `POST /v1/execution-result` existing schema differs from the `ExecutionResult` type proposed in item 4. | Regime-engine is canonical. CLMM adapter conforms. If the existing regime-engine schema is missing critical fields (e.g., breach_direction), add them via a regime-engine migration during item 5 — but flag that as scope creep and keep it minimal.                                                                 |
| Railway internal networking doesn't behave as expected on first deploy (DNS resolution, firewall, bind address).        | Item 5 step 3 pre-checks the bind address. Item 5 step 6 verifies internal reachability before CLMM wiring depends on it. If internal networking fails, fall back to public URL + shared-secret auth for the CLMM → regime-engine call. Same architectural outcome, slightly higher latency.                          |
| Drizzle migrations targeting multiple schemas in one Postgres conflict or clobber each other.                           | Each service runs its own migrations in its own schema, explicitly set via Drizzle config `schemaFilter` or equivalent. Migrations never run cross-schema. Verify by running CLMM's migration after regime-engine's — CLMM's tables should be unaffected.                                                             |
| Execution-result POSTs fail silently in production and go unnoticed, leaving the truth ledger incomplete.               | Item 4 mandates ERROR-level logging on final retry failure. Set up a simple alert on that log pattern post-sprint (not in sprint). For the sprint, manual inspection of regime-engine's ledger after each live breach confirms coverage.                                                                              |
| Scope creep: "while I'm in here I should also..." on either repo.                                                       | Every such thought goes into `docs/post-shelf-ideas.md` in the respective repo. Does not enter the sprint. Re-read this rule at the start of each work session.                                                                                                                                                       |

---

## Explicit forbidden list

1. Do not build or call `POST /v1/plan`. Out of scope.
2. Do not build any runtime regime filter that affects CLMM exit decisions. Breach direction alone determines exit direction.
3. Do not build dashboards or report-viewing UI. Reports are readable via existing regime-engine endpoints; that's sufficient for the sprint.
4. Do not add multi-analyst support. One source: `mco`. If a second analyst gets added later, it's a post-shelf decision.
5. Do not extract shared libraries between the two repos. HTTP is the only coupling.
6. Do not add authentication beyond the shared-secret tokens specified. Real auth (JWT, OAuth, mTLS) is post-shelf.
7. Do not deploy to Cloudflare Workers, Neon, Supabase, Oracle Cloud, or any platform other than Railway during this sprint. Infrastructure migration is a separate decision, revisited after 30+ days of live data.
8. Do not ramp above $100. Graduation criteria for $100 → $1000 → $10k are defined in a separate document authored post-sprint.

---

## Open questions

None. All decisions locked. If an implementation ambiguity surfaces mid-sprint, default to the simpler option and note it in post-shelf ideas.

---

## After the sprint

The sprint ends on a Sunday. Monday is Pronghorn. This project is shelved with:

- Live $100 position running autonomously on Railway
- Truth ledger accumulating execution-result records
- S/R levels refreshing daily from OpenClaw
- No active development

Revisit at the end of month 1. By then there are 30 days of live data. At that point — not before — decisions about graduating capital, adding whipsaw filtering, tuning regime logic, or adding streaming become grounded in real numbers instead of vibes.

Until then: no changes. No tweaks. No "just one more thing." The shelf is the shelf.
