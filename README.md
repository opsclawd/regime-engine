# Regime Engine Microservice

Deterministic policy + analytics service for SOL/USDC. This service does not execute trades. It emits REQUEST\_\* actions, persists truth records, and generates ledger-only weekly reports.

## Scope boundary

- Regime Engine (this repo): computes plans, stores truth ledger, serves reports.
- CLMM Autopilot (external service): executes on-chain, posts execution results back.
- No Orca/Jupiter/Solana RPC execution code is implemented here.

## Quickstart

```bash
npm install
npm run dev
```

Server endpoints:

- `GET /health`
- `GET /version`
- `GET /v1/openapi.json`
- `POST /v1/plan`
- `POST /v1/execution-result`
- `POST /v1/clmm-execution-result`
- `GET /v1/report/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST /v1/sr-levels`
- `GET /v1/sr-levels/current?symbol=SYMBOL&source=SOURCE`
- `POST /v1/candles` — ingest candle revisions for a logical feed
  (`source + network + poolAddress + symbol + timeframe`). Append-only,
  per-slot decision tree (insert / idempotent / revise / reject). Token-guarded
  by `X-Candles-Ingest-Token` / `CANDLES_INGEST_TOKEN`.
- `GET /v1/regime/current?symbol=&source=&network=&poolAddress=&timeframe=1h` —
  market-only regime classification + CLMM suitability. Stateless: no
  `RegimeState`, no portfolio/autopilot inputs, no plan-ledger writes.

## Commands

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:pg`
- `npm run format`
- `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
- `npm run db:migrate`
- `npm run db:generate`
- `npm run db:push`

## 3-minute local demo

1. Start service:

```bash
npm run dev
```

2. In a second terminal run harness:

```bash
npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31
```

3. Inspect artifacts:

- `tmp/reports/weekly-2026-01-01-2026-01-31.md`
- `tmp/reports/weekly-2026-01-01-2026-01-31.json`

## Deploying to Railway

1. Push this repo to a Railway project — Railway detects the `railway.toml` config automatically.

2. Add a **persistent volume** in the Railway service settings:
   - Name: `ledger`
   - Mount path: `/data`

   The `railway.toml` declares `requiredMountPath = "/data"` which will prompt for volume creation on first deploy.

3. Set the `RAILWAY_RUN_UID` environment variable to `0` in the Railway dashboard. The container runs as a non-root user (`app`), but Railway mounts volumes with root ownership. Setting `RAILWAY_RUN_UID=0` ensures the process can write to `/data/ledger.sqlite`.

4. Set environment variables in the Railway dashboard (or via `.env` file mounted at `/app/.env`):

   | Variable                | Default             | Description                                                                                                                                                                                                 |
   | ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `PORT`                  | —                   | Railway sets this automatically                                                                                                                                                                             |
   | `HOST`                  | `0.0.0.0`           | Host binding. **Set to `::` on Railway** so Fastify binds dual-stack and is reachable over private networking.                                                                                              |
   | `LEDGER_DB_PATH`        | `tmp/ledger.sqlite` | **Override to `/data/ledger.sqlite`** to use the persistent volume                                                                                                                                          |
   | `NODE_ENV`              | `production`        | Node environment                                                                                                                                                                                            |
   | `COMMIT_SHA`            | —                   | Optional, shown in `/version`                                                                                                                                                                               |
   | `OPENCLAW_INGEST_TOKEN` | —                   | Required shared secret for `POST /v1/sr-levels`                                                                                                                                                             |
   | `CLMM_INTERNAL_TOKEN`   | —                   | Required shared secret for `POST /v1/clmm-execution-result`                                                                                                                                                 |
   | `CANDLES_INGEST_TOKEN`  | —                   | Required for `POST /v1/candles`. Sent via `X-Candles-Ingest-Token`, compared with `timingSafeEqual`. Missing env returns 500 only on the candle ingest route — service boot and read routes are unaffected. |
   | `DATABASE_URL`          | —                   | Postgres connection string. When set, enables Postgres features with `regime_engine` schema isolation                                                                                                       |
   | `RAILWAY_RUN_UID`       | `0`                 | **Required** — allows volume writes for non-root container                                                                                                                                                  |

5. Railway handles HTTPS termination and SIGTERM — the service shuts down gracefully on deploy.

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

## Multi-Schema Postgres Architecture

Regime Engine runs alongside clmm-v2 on a shared Railway Postgres instance. Schema isolation keeps data separate:

- `regime_engine` schema — Regime Engine's Postgres tables (future: #20 v2 S/R Levels, #21 CLMM Insights)
- `public` schema — clmm-v2's tables (owned by that service)

SQLite stays for the append-only receipt ledger (plans, execution results, CLMM events). Postgres is used for features that need JSONB, native arrays, indexing, and concurrent reads from the CLMM Autopilot app.

### Connection config

- `DATABASE_URL` — When set, the service connects to Postgres with `search_path=regime_engine` (set via postgres.js `connection.search_path`). When not set, the service runs in SQLite-only mode.
- Migrations run via `npm run db:migrate` (Drizzle Kit), executed as a Railway `preDeployCommand` before the app starts.
- The service hard-fails at startup if Postgres is unreachable (when `DATABASE_URL` is set). Railway's restart policy handles transient failures.

### Health endpoint

`GET /health` reports both store statuses:

```json
{ "ok": true, "postgres": "ok", "sqlite": "ok" }
```

Possible `postgres` values: `"ok"`, `"unavailable"`, `"not_configured"` (when `DATABASE_URL` is not set).

### Running Postgres integration tests locally

```bash
docker compose -f docker-compose.test.yml up -d
npm run db:push
npm run test:pg
docker compose -f docker-compose.test.yml down
```

## Determinism strategy

- Canonical JSON with sorted object keys.
- `planHash = sha256(canonicalPlanJson)`.
- Snapshot tests for canonical/hash/plan/report outputs.
- Stable validation error ordering and canonical error codes.

## Repo map

- `src/contract/v1`: types, validation, canonical JSON, hash
- `src/engine`: features, regime, churn, allocation, plan builder
- `src/http`: routes, handlers, OpenAPI, error taxonomy
- `src/ledger`: sqlite schema, store, writer
- `src/ledger/pg`: Postgres db factory, Drizzle schema (regime_engine)
- `src/ledger/storeContext`: unified StoreContext (SQLite + Postgres)
- `src/report`: baselines + weekly report generation
- `scripts/harness.ts`: fixture runner end-to-end
- `fixtures/demo`: deterministic uptrend/downtrend/chop/whipsaw fixtures
