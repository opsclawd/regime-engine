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
- `GET /v1/report/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD`

## Commands

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run test:watch`
- `npm run format`
- `npm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31`

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

   | Variable | Default | Description |
   |---|---|---|
   | `PORT` | — | Railway sets this automatically |
   | `HOST` | `0.0.0.0` | Host binding |
   | `LEDGER_DB_PATH` | `tmp/ledger.sqlite` | **Override to `/data/ledger.sqlite`** to use the persistent volume |
   | `NODE_ENV` | `production` | Node environment |
   | `COMMIT_SHA` | — | Optional, shown in `/version` |
   | `RAILWAY_RUN_UID` | `0` | **Required** — allows volume writes for non-root container |

5. Railway handles HTTPS termination and SIGTERM — the service shuts down gracefully on deploy.

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
- `src/report`: baselines + weekly report generation
- `scripts/harness.ts`: fixture runner end-to-end
- `fixtures/demo`: deterministic uptrend/downtrend/chop/whipsaw fixtures
