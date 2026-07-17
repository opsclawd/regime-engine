# Regime Engine

Regime Engine is the deterministic market-regime, support/resistance, insight-store, and execution-result ledger service for the SOL/USDC CLMM Autopilot system.

It does not own the mobile app, wallet connection, position flow, Orca transaction assembly, or user signing surface. Those belong to `clmm-v2`.

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
              regime, S/R, S/R theses, current insights
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
- `regime-engine` is the deterministic analytics and ledger service. It stores market candles, computes regime state, stores S/R/current insight blocks, and records execution-result events.
- `sol-usdc-clmm-intelligence` is the advisory/evidence pipeline. It pulls CLMM bundles from `clmm-v2`, runs OpenClaw-backed analysis using durable policies and memory, and currently may interact with legacy final-insight surfaces.

## Open roadmap and future state

Open issues #57 through #63 define the next Regime Engine architecture: external systems should publish structured research evidence, and Regime Engine should synthesize the final canonical PolicyInsight internally.

### Evidence contract and persistence

Tracked by #58.

Regime Engine should define a strict versioned research-evidence contract containing:

- pair, source, run ID / idempotency key, `asOf`, and `expiresAt`;
- deterministic feature summaries;
- support/resistance thesis summary;
- flow context summary;
- perp/liquidation context summary;
- macro/protocol/event-risk summary;
- LLM research brief;
- source refs, freshness, confidence, and provenance metadata.

Evidence records should be append-only, hashable, idempotent on exact replay, conflict on same source/run ID with different payload, and stored separately from final PolicyInsights.

### Evidence ingest and query surface

Tracked by #59.

The planned evidence route is separate from final insights:

```text
POST /v1/evidence/sol-usdc
GET  /v1/evidence/sol-usdc/current
GET  /v1/evidence/sol-usdc/history
```

This replaces the architectural need for external callers to write final policy blocks. The legacy final-policy write route is expected to be retired after internal synthesis exists.

### Evidence selection and scoring

Tracked by #60.

Regime Engine should not blindly use the newest external payload. It needs deterministic selection rules for freshness, confidence, source quality, expiry, and evidence-family coverage. The selection result should record which evidence was used, which evidence was ignored, and why.

Missing or stale research evidence should degrade explicitly. It should not block deterministic market-state reads.

### Internal PolicyInsight synthesis

Tracked by #61.

The final user-facing PolicyInsight should be generated inside Regime Engine from:

- deterministic market regime state;
- selected structured research evidence;
- explicit policy rules.

The output should include market regime, fundamental regime, recommended action, confidence, risk level, CLMM policy, levels, reasoning, source refs, and freshness/status metadata.

Hard deterministic guards remain authoritative. Research evidence can affect posture, confidence, and risk, but it should not silently bypass stale-data or safety rules.

### Legacy final-policy write removal

Tracked by #62.

After synthesis is implemented, external final-policy ingest should be removed. The read surface remains:

```text
GET /v1/insights/sol-usdc/current
GET /v1/insights/sol-usdc/history
```

The write path changes from external final insight submission to evidence submission plus internal synthesis.

### Canonical PolicyInsights wire contract

Tracked by #63.

Regime Engine must publish one canonical final PolicyInsights read shape for `clmm-v2`. Known drift to resolve includes:

- `maxCapitalDeploymentPercent` vs `maxCapitalDeploymentPct`;
- `levels.support/resistance` vs `levels.supports/resistances`;
- percentage unit ambiguity: `0..100` vs `0..1`.

The mature contract should be strict, documented, fixture-backed, and consumable by `clmm-v2` without adapter-side guessing.

### Candle-store consistency

Tracked by #55.

Weekly reports should read from the same canonical candle store as `/v1/regime/current` and `/v1/plan`. If Postgres is the active candle store, reports should not silently read a stale or empty SQLite path.

## Mature system vision

The mature system is a closed feedback loop:

1. `regime-engine` maintains canonical market context for SOL/USDC: candles, regime classification, CLMM suitability, support/resistance, selected evidence, and internally synthesized PolicyInsights.
2. `sol-usdc-clmm-intelligence` publishes structured research evidence, not final policy conclusions.
3. `clmm-v2` reads the final canonical PolicyInsight and combines it with live LP state in the product experience.
4. `clmm-v2` records terminal outcomes back into Regime Engine.
5. Regime Engine becomes the audit-friendly analytical memory for measuring signal quality, stale evidence, false positives, fee capture, and outcome quality.

A future proof layer may include a minimal Anchor receipt/claim program that records one execution receipt per epoch after a completed user-approved flow. That proof layer is not part of Regime Engine today. Regime Engine remains the off-chain analytics and ledger service.

## Runtime surfaces

### Web service

Run locally:

```bash
pnpm run dev
```

Important current endpoints:

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
POST /v1/insights/sol-usdc       # legacy external final-insight write path; roadmap removes it
GET  /v1/insights/sol-usdc/current
GET  /v1/insights/sol-usdc/history
POST /v2/sr-levels
GET  /v2/sr-levels/current
```

Planned evidence endpoints:

```text
POST /v1/evidence/sol-usdc
GET  /v1/evidence/sol-usdc/current
GET  /v1/evidence/sol-usdc/history
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

`clmm-v2` currently posts terminal execution events to:

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

Planned plan/result integration also uses:

```text
POST /v1/plan
POST /v1/execution-result
```

### From Regime Engine into `clmm-v2`

`clmm-v2` reads current context through backend-only adapters:

```text
GET /v1/regime/current
GET /v1/sr-levels/current
GET /v2/sr-levels/current
GET /v1/insights/sol-usdc/current
```

The future `GET /v1/insights/sol-usdc/current` response should be the internally synthesized canonical PolicyInsight, not an externally authored block.

### From `sol-usdc-clmm-intelligence` into Regime Engine

Current/legacy final-policy ingest:

```text
POST /v1/insights/sol-usdc
Header: X-Insight-Ingest-Token: <INSIGHT_INGEST_TOKEN>
```

Roadmap evidence ingest:

```text
POST /v1/evidence/sol-usdc
Header: X-Evidence-Ingest-Token: <shared-secret>
```

New work should target the evidence contract and evidence route. The final-insight write path is transitional.

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

| Service                         | `SERVICE_TYPE` | Purpose                        |
| ------------------------------- | -------------- | ------------------------------ |
| `regime-engine-web`             | unset          | Fastify HTTP service           |
| `regime-engine-gecko-collector` | `collector`    | GeckoTerminal candle collector |

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
- Market regime is context, not transaction authority.
- Candle ingestion is append-only with explicit revision semantics.
- Provider-ingested candles are `15m`; `1h` is derived on read.
- Shared secrets protect write endpoints; never commit real token values.
- Keep CLMM operational state in `clmm-v2`; keep evidence production in `sol-usdc-clmm-intelligence`; keep deterministic market context, evidence selection, final policy synthesis, and result ledgers here.
