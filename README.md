# Regime Engine Microservice

Deterministic policy + analytics service for SOL/USDC. This service does not execute trades. It emits REQUEST\_\* actions, persists truth records, and generates ledger-only weekly reports.

## Scope boundary

- Regime Engine (this repo): computes plans, stores truth ledger, serves reports.
- CLMM Autopilot (external service): executes on-chain, posts execution results back.
- No Orca/Jupiter/Solana RPC execution code is implemented here.

## Quickstart

```bash
pnpm install
pnpm run dev
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
- `POST /v1/insights/sol-usdc` — CLMM insight ingestion (#20)
- `GET /v1/insights/sol-usdc/current` — current CLMM insight
- `GET /v1/insights/sol-usdc/history` — CLMM insight history
- `POST /v2/sr-levels` — v2 S/R thesis ingestion (#21)
- `GET /v2/sr-levels/current` — current v2 S/R thesis

## GeckoTerminal candle collector

The GeckoTerminal collector is a separate worker service from the same repo. It
does not start Fastify and does not write SQLite or Postgres directly. It fetches
the configured Solana SOL/USDC GeckoTerminal pool and posts normalized `1h`
candles to `POST /v1/candles` with `X-Candles-Ingest-Token`.

Local commands:

```bash
# Production start (reads .env automatically via --env-file-if-exists)
pnpm run start:gecko

# Dev mode (tsx watch — does NOT load .env, pass env vars inline)
REGIME_ENGINE_URL=http://localhost:8787 \
CANDLES_INGEST_TOKEN=<your-token> \
GECKO_POOL_ADDRESS=<pool-address> \
pnpm run dev:gecko
```

Worker env vars:

| Variable                     | Default         | Notes                                                                     |
| ---------------------------- | --------------- | ------------------------------------------------------------------------- |
| `REGIME_ENGINE_URL`          | -               | Absolute URL for the regime-engine web service.                           |
| `CANDLES_INGEST_TOKEN`       | -               | Shared secret sent as `X-Candles-Ingest-Token`; never commit real values. |
| `GECKO_SOURCE`               | `geckoterminal` | Must equal `geckoterminal` for MVP.                                       |
| `GECKO_NETWORK`              | `solana`        | Must equal `solana` for MVP.                                              |
| `GECKO_POOL_ADDRESS`         | -               | Explicit GeckoTerminal SOL/USDC pool address. Confirm before production.  |
| `GECKO_SYMBOL`               | `SOL/USDC`      | Must equal `SOL/USDC` for MVP.                                            |
| `GECKO_TIMEFRAME`            | `1h`            | Must equal `1h` for MVP.                                                  |
| `GECKO_LOOKBACK`             | `200`           | Rolling candle window size.                                               |
| `GECKO_POLL_INTERVAL_MS`     | `300000`        | Sleep after each completed cycle.                                         |
| `GECKO_MAX_CALLS_PER_MINUTE` | `6`             | Provider-scoped GeckoTerminal call cap.                                   |
| `GECKO_REQUEST_TIMEOUT_MS`   | `10000`         | Per-request timeout for provider and ingest calls.                        |

Railway services from the same repo (both use the same Dockerfile, selected via `SERVICE_TYPE`):

| Service                         | `SERVICE_TYPE` | Start                               |
| ------------------------------- | -------------- | ----------------------------------- |
| `regime-engine-web`             | _(unset)_      | `bash scripts/start.sh` → web       |
| `regime-engine-gecko-collector` | `collector`    | `bash scripts/start.sh` → collector |

Production setup and pool confirmation live in
`docs/runbooks/railway-deploy.md`.

## Commands

- `pnpm run dev`
- `pnpm run dev:gecko`
- `pnpm run build`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`
- `pnpm run test:pg`
- `pnpm run format`
- `pnpm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`
- `pnpm run db:migrate`
- `pnpm run db:generate`
- `pnpm run db:push`

## 3-minute local demo

1. Start service:

```bash
pnpm run dev
```

2. In a second terminal run harness:

```bash
pnpm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31
```

3. Inspect artifacts:

- `tmp/reports/weekly-2026-01-01-2026-01-31.md`
- `tmp/reports/weekly-2026-01-01-2026-01-31.json`

## Deploying to Railway

1. Push this repo to a Railway project — Railway detects the `railway.toml` config automatically.

2. Add a **persistent volume** in the Railway service settings (web service only):
   - Name: `ledger`
   - Mount path: `/data`

   The `railway.toml` declares `requiredMountPath = "/data"` which will prompt for volume creation on first deploy.

3. Set the `RAILWAY_RUN_UID` environment variable to `0` on the **web service**. The container runs as a non-root user (`app`), but Railway mounts volumes with root ownership. Setting `RAILWAY_RUN_UID=0` ensures the process can write to `/data/ledger.sqlite`.

4. Both services use the same Dockerfile and `railway.toml`. The `scripts/start.sh` entrypoint selects which process to run based on the `SERVICE_TYPE` env var. Similarly, `scripts/predeploy.sh` skips migrations for the collector.

   **Web service env vars:**

   | Variable                | Default             | Description                                                                                                                                                                                                 |
   | ----------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `SERVICE_TYPE`          | _(unset)_           | Leave unset for web service. `start.sh` defaults to the web server.                                                                                                                                         |
   | `PORT`                  | —                   | Railway sets this automatically                                                                                                                                                                             |
   | `HOST`                  | `0.0.0.0`           | Host binding. **Set to `::` on Railway** so Fastify binds dual-stack and is reachable over private networking.                                                                                              |
   | `LEDGER_DB_PATH`        | `tmp/ledger.sqlite` | **Override to `/data/ledger.sqlite`** to use the persistent volume                                                                                                                                          |
   | `NODE_ENV`              | `production`        | Node environment                                                                                                                                                                                            |
   | `COMMIT_SHA`            | —                   | Optional, shown in `/version`                                                                                                                                                                               |
   | `OPENCLAW_INGEST_TOKEN` | —                   | Required shared secret for `POST /v1/sr-levels`                                                                                                                                                             |
   | `CLMM_INTERNAL_TOKEN`   | —                   | Required shared secret for `POST /v1/clmm-execution-result`                                                                                                                                                 |
   | `CANDLES_INGEST_TOKEN`  | —                   | Required for `POST /v1/candles`. Sent via `X-Candles-Ingest-Token`, compared with `timingSafeEqual`. Missing env returns 500 only on the candle ingest route — service boot and read routes are unaffected. |
   | `DATABASE_URL`          | —                   | Postgres connection string. When set, enables Postgres features with `regime_engine` schema isolation                                                                                                       |
   | `RAILWAY_RUN_UID`       | `0`                 | **Required on web service** — allows volume writes for non-root container                                                                                                                                   |

   **Collector service env vars:**

   | Variable                     | Value                                                                  |
   | ---------------------------- | ---------------------------------------------------------------------- |
   | `SERVICE_TYPE`               | `collector`                                                            |
   | `REGIME_ENGINE_URL`          | `http://${{web-service.RAILWAY_PRIVATE_DOMAIN}}:${{web-service.PORT}}` |
   | `CANDLES_INGEST_TOKEN`       | `${{web-service.CANDLES_INGEST_TOKEN}}`                                |
   | `DATABASE_URL`               | `${{Postgres.DATABASE_URL}}` (for pre-deploy migration no-op)          |
   | `GECKO_SOURCE`               | `geckoterminal`                                                        |
   | `GECKO_NETWORK`              | `solana`                                                               |
   | `GECKO_POOL_ADDRESS`         | confirmed GeckoTerminal SOL/USDC pool address                          |
   | `GECKO_SYMBOL`               | `SOL/USDC`                                                             |
   | `GECKO_TIMEFRAME`            | `1h`                                                                   |
   | `GECKO_LOOKBACK`             | `200`                                                                  |
   | `GECKO_POLL_INTERVAL_MS`     | `300000`                                                               |
   | `GECKO_MAX_CALLS_PER_MINUTE` | `6`                                                                    |
   | `GECKO_REQUEST_TIMEOUT_MS`   | `10000`                                                                |

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

- `regime_engine` schema — Regime Engine's Postgres tables (candle revisions, v2 S/R theses, CLMM insights)
- `public` schema — clmm-v2's tables (owned by that service)

SQLite stays for the append-only receipt ledger (plans, execution results, CLMM events). Postgres is used for features that need JSONB, native arrays, indexing, and concurrent reads from the CLMM Autopilot app.

### Connection config

- `DATABASE_URL` — When set, the service connects to Postgres with `search_path=regime_engine` (set via postgres.js `connection.search_path`). When not set, the service runs in SQLite-only mode.
- Migrations run via `pnpm run db:migrate` (Drizzle Kit), executed as a Railway `preDeployCommand` before the app starts.
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
pnpm run db:push
pnpm run test:pg
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
- `src/ledger`: sqlite schema, store, writer, candle store
- `src/ledger/pg`: Postgres db factory, Drizzle schema (regime_engine)
- `src/ledger/storeContext`: unified StoreContext (SQLite + Postgres)
- `src/report`: baselines + weekly report generation
- `src/workers/gecko`: GeckoTerminal collector (config, normalize, ingest client, retry)
- `src/workers/geckoCollector.ts`: collector entrypoint + polling loop
- `scripts/start.sh`: Railway entrypoint (selects web or collector via `SERVICE_TYPE`)
- `scripts/predeploy.sh`: Railway pre-deploy (skips migrations for collector)
- `scripts/harness.ts`: fixture runner end-to-end
- `fixtures/demo`: deterministic uptrend/downtrend/chop/whipsaw fixtures
