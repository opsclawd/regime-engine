# Regime Engine

Regime Engine is the deterministic market-regime, support/resistance, insight-store, and execution-result ledger service for the SOL/USDC CLMM Autopilot system.

It does not own the mobile app, wallet connection, position execution flow, Orca transaction assembly, or user signing surface. Those belong to `clmm-v2`.

This repo exists to answer one question reliably: **what is the current market/strategy context for SOL/USDC, and what has the system already observed or recorded?**

## Current state

Regime Engine currently provides:

- a Fastify HTTP service with health, version, OpenAPI, plan, execution-result, regime, S/R, insight, and report endpoints;
- a GeckoTerminal collector worker that posts normalized `15m` SOL/USDC candles into the service;
- append-only candle revision ingestion with idempotent/revise/reject behavior;
- current regime classification from stored `15m` candles, with `1h` reads derived from complete stored `15m` candles;
- S/R level ingestion and current-read endpoints;
- v2 S/R thesis ingestion and current-read endpoints;
- SOL/USDC policy-insight ingestion, current-read, and history endpoints;
- CLMM execution-result recording from `clmm-v2`;
- weekly ledger reports;
- SQLite ledger storage for plans/execution events and Postgres storage under the `regime_engine` schema for features that need JSONB, arrays, indexing, and concurrent reads.

Regime Engine emits recommendations and stores evidence. It does not submit transactions or handle wallet approval.

## How the three repos work together today

```text
                    GeckoTerminal / market candles
                                |
                                v
                         regime-engine
              regime, S/R, S/R theses, policy insights
                                ^
                                | execution result events
                                |
Wallet + App  <---- BFF/API + Worker ----> Orca / Jupiter / Solana RPC
  clmm-v2          positions, alerts,
                   previews, signing,
                   submission, history
                                |
                                | read-only bundle API
                                v
              sol-usdc-clmm-intelligence
       OpenClaw routines, evidence memory, advisory outputs
```

Today:

- `clmm-v2` is the operational product. It watches supported positions, qualifies breach triggers, prepares execution previews, obtains user approval, submits signed payloads, reconciles outcomes, and sends terminal execution events here.
- `regime-engine` is the deterministic analytics and ledger service. It stores market candles, computes regime state, stores S/R and policy-insight blocks, and records execution-result events.
- `sol-usdc-clmm-intelligence` is the advisory/evidence pipeline. It pulls CLMM bundles from `clmm-v2`, runs OpenClaw-backed analysis using durable policies and memory, and can publish policy insights into this service.

## Mature system vision

The mature system is a closed feedback loop:

1. `regime-engine` maintains canonical market context for SOL/USDC: candles, regime classification, CLMM suitability, support/resistance, and policy insights.
2. `clmm-v2` uses that context alongside live position state to decide what the user should see: hold, watch, prepare exit, refresh quote, or execute a user-approved exit.
3. `sol-usdc-clmm-intelligence` periodically adds higher-level research context and policy insight blocks, then posts those blocks into this service.
4. `clmm-v2` posts execution outcomes back into this service.
5. Regime Engine becomes the audit-friendly analytical memory for measuring signal quality, stale recommendations, false positives, fee capture, and avoided downside.

A future proof layer may include a minimal Anchor receipt/claim program that records one execution receipt per epoch after a completed user-approved execution. That proof layer is not part of Regime Engine today. Regime Engine remains the off-chain analytics and ledger service.

## Runtime surfaces

### Web service

Run locally:

```bash
pnpm run dev
```

Important endpoints:

```text
GET  /health
GET  /version
GET  /v1/openapi.json
POST /v1/plan
POST /v1/execution-result
POST /v1/clmm-execution-result
GET  /v1/report/weekly?from=YYYY-MM-DD&to=YYYY-MM-DD
POST /v1/sr-levels
GET  /v1/sr-levels/current?symbol=SYMBOL&source=SOURCE
POST /v1/candles
GET  /v1/regime/current?symbol=&source=&network=&poolAddress=&timeframe=15m|1h
POST /v1/insights/sol-usdc
GET  /v1/insights/sol-usdc/current
GET  /v1/insights/sol-usdc/history
POST /v2/sr-levels
GET  /v2/sr-levels/current
```

### GeckoTerminal collector

Run locally:

```bash
REGIME_ENGINE_URL=http://localhost:8787 \
CANDLES_INGEST_TOKEN=<your-token> \
GECKO_POOL_ADDRESS=<pool-address> \
pnpm run dev:gecko
```

The collector fetches the configured Solana SOL/USDC GeckoTerminal pool and posts normalized `15m` candles to `POST /v1/candles`. Provider ingestion is canonical at `15m`; `1h` regime reads are derived on demand from stored `15m` candles.

## Integration contracts

### From `clmm-v2` into Regime Engine

`clmm-v2` posts terminal execution events to:

```text
POST /v1/clmm-execution-result
Header: X-CLMM-Internal-Token: <CLMM_INTERNAL_TOKEN>
```

The matching env values are:

```bash
# regime-engine
CLMM_INTERNAL_TOKEN=<shared-secret>

# clmm-v2
REGIME_ENGINE_INTERNAL_TOKEN=<same-shared-secret>
REGIME_ENGINE_BASE_URL=http://localhost:8787
```

### From Regime Engine into `clmm-v2`

`clmm-v2` reads current context through backend-only adapters:

```text
GET /v1/regime/current
GET /v1/sr-levels/current
GET /v2/sr-levels/current
GET /v1/insights/sol-usdc/current
```

These calls are backend-to-backend. They should not be exposed through app public env vars.

### From `sol-usdc-clmm-intelligence` into Regime Engine

The intelligence pipeline can write OpenClaw-generated policy insight blocks to:

```text
POST /v1/insights/sol-usdc
Header: X-Insight-Ingest-Token: <INSIGHT_INGEST_TOKEN>
```

It can also feed S/R material through the S/R ingest endpoints when configured.

## Getting started

Prerequisites:

- Node.js 22.13+
- pnpm 10.33+
- SQLite path for the ledger
- optional Postgres for `regime_engine` schema features

Install and start:

```bash
pnpm install
cp .env.example .env
pnpm run dev
```

## Common commands

```bash
pnpm run dev
pnpm run dev:gecko
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:pg
pnpm run boundaries
pnpm run format
pnpm run db:migrate
pnpm run db:generate
pnpm run db:push
pnpm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31
```

## Storage model

Regime Engine uses two stores:

- SQLite ledger: append-only plan, execution-result, CLMM event, and weekly-report truth records.
- Postgres `regime_engine` schema: candle revisions, v2 S/R theses, CLMM policy insights, and other concurrent-read datasets.

When `DATABASE_URL` is set, the service connects to Postgres with `search_path=regime_engine`. When `DATABASE_URL` is not set, Postgres-backed features are unavailable and report `not_configured` or service-unavailable responses where applicable.

`GET /health` reports both store states:

```json
{ "ok": true, "postgres": "ok", "sqlite": "ok" }
```

## Railway deployment

The repo deploys as two Railway services from the same Dockerfile:

| Service | `SERVICE_TYPE` | Purpose |
| --- | --- | --- |
| `regime-engine-web` | unset | Fastify HTTP service |
| `regime-engine-gecko-collector` | `collector` | GeckoTerminal candle collector |

The web service owns migrations. The collector skips migrations and posts through the HTTP ingest route.

Full runbook: `docs/runbooks/railway-deploy.md`.

## Determinism strategy

- Canonical JSON with sorted object keys.
- `planHash = sha256(canonicalPlanJson)`.
- Snapshot tests for canonical/hash/plan/report outputs.
- Stable validation error ordering and canonical error codes.
- Append-only ledgers for auditable result history.

## Repo map

```text
src/contract/v1             Types, validation, canonical JSON, hashes, error taxonomy
src/engine                  Features, regime, churn, allocation, plan building
src/adapters/http           Fastify routes, handlers, OpenAPI, auth boundaries
src/ledger                  SQLite ledger schema, stores, writers, candle store
src/ledger/pg               Postgres db factory and Drizzle schema under regime_engine
src/composition             Application/store composition roots
src/report                  Baselines and weekly report generation
src/workers/gecko           GeckoTerminal collector config, normalization, client, retry
src/workers/geckoCollector.ts Collector entrypoint and polling loop
scripts                     Railway start/predeploy, harness, asset copying
drizzle                     Drizzle migrations
fixtures                    Demo and regression fixtures
```

## Guardrails

- Regime Engine does not own wallet connection, app UX, transaction preparation, or user approval.
- Market regime is context, not execution authority.
- Candle ingestion is append-only with explicit revision semantics.
- Provider-ingested candles are `15m`; `1h` is derived on read.
- Shared secrets protect write endpoints; never commit real token values.
- Keep CLMM operational state in `clmm-v2`; keep advisory memory in `sol-usdc-clmm-intelligence`; keep deterministic market context and result ledgers here.
