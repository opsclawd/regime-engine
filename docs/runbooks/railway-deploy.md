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
   - `CANDLES_INGEST_TOKEN` — shared with the candle collector service, sent via `X-Candles-Ingest-Token`.

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

| Variable                | Value                             | Notes                                                     |
| ----------------------- | --------------------------------- | --------------------------------------------------------- |
| `HOST`                  | `::`                              | Dual-stack bind for Railway private networking.           |
| `PORT`                  | _(leave unset — Railway injects)_ | Fastify reads `process.env.PORT`.                         |
| `LEDGER_DB_PATH`        | `/data/ledger.sqlite`             | Must be on the mounted volume.                            |
| `NODE_ENV`              | `production`                      |                                                           |
| `OPENCLAW_INGEST_TOKEN` | strong random string              | Share with OpenClaw operator.                             |
| `CLMM_INTERNAL_TOKEN`   | strong random string              | Referenced from CLMM service (see Step 5).                |
| `CANDLES_INGEST_TOKEN`  | strong random string              | Required for `POST /v1/candles`. Sent via `X-Candles-Ingest-Token`. |
| `RAILWAY_RUN_UID`       | `0`                               | Required — volume is root-owned; container user is `app`. |
| `COMMIT_SHA`            | `${{RAILWAY_GIT_COMMIT_SHA}}`     | Optional; surfaces in `/version`.                         |

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
