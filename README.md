# Regime Engine

Regime Engine is the deterministic market-regime, support/resistance, insight-store, and execution-result ledger service for the SOL/USDC CLMM Autopilot system. It does not execute trades; it emits REQUEST\_\* actions, persists truth records, and generates weekly reports. Report facts come from the append-only ledger; baseline prices (SOL HODL, SOL DCA, USDC carry) come from the active canonical candle store.

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

## Evidence-based PolicyInsight synthesis

Regime Engine synthesizes the final canonical PolicyInsight internally instead of accepting it from an external writer. This closed out issues #55 and #57 through #63: external systems publish structured research evidence, and Regime Engine selects it, synthesizes the final PolicyInsight, and serves one canonical read shape.

### Evidence contract and persistence

Regime Engine defines a strict versioned research-evidence contract (`EvidenceBundle` v1 — see `docs/contracts/evidence-bundle.v1.md`) containing:

- pair, source, run ID / idempotency key, `asOf`, and `expiresAt`;
- deterministic feature summaries;
- support/resistance thesis summary;
- flow context summary;
- perp/liquidation context summary;
- macro/protocol/event-risk summary;
- LLM research brief;
- source refs, freshness, confidence, and provenance metadata.

Evidence records are append-only, hashable, idempotent on exact replay, conflict on same source/run ID with a different payload, and stored separately from final PolicyInsights in the `regime_engine` Postgres schema.

### Evidence ingest and query surface

The evidence route is separate from final insights:

```text
POST /v1/evidence/sol-usdc
GET  /v1/evidence/sol-usdc/current
GET  /v1/evidence/sol-usdc/history
```

External callers (`sol-usdc-clmm-intelligence`) no longer write final policy blocks directly. The legacy final-policy write route has been removed (see PR #75).

### Evidence selection and scoring

Regime Engine does not blindly use the newest external payload. Deterministic selection rules score evidence on freshness, confidence, source quality, expiry, and evidence-family coverage, and record which evidence was used, which evidence was ignored, and why.

Missing or stale research evidence degrades explicitly. It does not block deterministic market-state reads.

### Internal PolicyInsight synthesis

The final user-facing PolicyInsight is generated inside Regime Engine (`src/engine/policy/synthesizePolicyInsight.ts`) from:

- deterministic market regime state;
- selected structured research evidence;
- explicit policy rules.

The output includes market regime, fundamental regime, recommended action, confidence, risk level, CLMM policy, levels, reasoning, source refs, and freshness/status metadata.

Hard deterministic guards remain authoritative. Research evidence can affect posture, confidence, and risk, but it cannot silently bypass stale-data or safety rules.

Note: Position policy insight synthesis is co-located with the Fastify HTTP service lifecycle in `src/composition/buildApp.ts` when both Postgres and SQLite stores are available. An operational standalone script `start:policy-synthesis` is also provided.

### Position Policy Insight Synthesis Worker

Position policy insight synthesis operates via a background worker registered against the Fastify lifecycle in `buildApp`:

- **Co-location and Storage Requirements**: The worker runs in-process with the Fastify HTTP service. Because position plans are stored in SQLite (`LEDGER_DB_PATH`) while queue states and evidence bundles live in Postgres, HTTP process replicas must share the same persistent `LEDGER_DB_PATH` volume.
- **Internal Replay Call**: Whenever evidence is posted (`POST /v1/evidence/sol-usdc`) or a position plan is generated (`POST /v1/plan`), the HTTP handler invokes the internal `requestPositionPolicyInsightSynthesis` use case to reconcile or enqueue synthesis work immediately.
- **Queue Status**: Requests move through deterministic lifecycle statuses: `waiting_for_plan`, `waiting_for_evidence`, `pending`, `processing`, `completed`, `failed`, and `superseded`.
- **Handling `freshEvidenceRequired`**: When a position synthesis request is created without sufficient fresh evidence, the response includes `freshEvidenceRequired: true`. The companion deployment must consume this signal to initiate an upstream intelligence run.
- **Dual-write Gap Repair**: Because SQLite and Postgres cannot commit atomically, source-write replay and startup reconciliation (`reconcileStartup`) scan waiting and eligible scopes on worker startup to repair any unavoidable SQLite/Postgres dual-write gap.

### Canonical PolicyInsights wire contract

Regime Engine publishes one canonical final PolicyInsights read shape for `clmm-v2` (`policy-insight.v1` — see `docs/contracts/policy-insight.v1.md`), resolving prior drift including:

- `maxCapitalDeploymentPercent` vs `maxCapitalDeploymentPct`;
- `levels.support/resistance` vs `levels.supports/resistances`;
- percentage unit ambiguity: `0..100` vs `0..1`.

The contract is strict, documented, fixture-backed, and consumable by `clmm-v2` without adapter-side guessing.

### Candle-store consistency

Weekly reports read from the same canonical candle store as `/v1/regime/current` and `/v1/plan`. If Postgres is the active candle store, reports no longer silently read a stale or empty SQLite path.

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
POST /v1/evidence/sol-usdc
GET  /v1/evidence/sol-usdc/current
GET  /v1/evidence/sol-usdc/history
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

Plan/result integration also uses:

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

`GET /v1/insights/sol-usdc/current` serves the internally synthesized canonical PolicyInsight rather than an externally authored block — see "Evidence-based PolicyInsight synthesis" above for the current synthesis-trigger caveat.

### From `sol-usdc-clmm-intelligence` into Regime Engine

Intelligence publishes structured research evidence:

```text
POST /v1/evidence/sol-usdc
Header: X-Evidence-Ingest-Token: <shared-secret>
```

Regime Engine synthesizes final PolicyInsight internally. The canonical GET routes return the internally synthesized result. Consumers read only the canonical GET routes.

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
pnpm run test:watch
pnpm run test:pg
pnpm run boundaries
pnpm run format
pnpm run db:migrate
pnpm run db:generate
pnpm run db:push
pnpm run contract:evidence:generate
pnpm run contract:evidence:check
pnpm run contract:policy-insight:generate
pnpm run contract:policy-insight:check
pnpm run harness -- --fixture ./fixtures/demo --from 2026-01-01 --to 2026-01-31
```

The `contract:evidence:*` and `contract:policy-insight:*` commands generate/check the versioned wire-contract artifacts (JSON Schema, hash vectors, fixtures) documented in `docs/contracts/evidence-bundle.v1.md` and `docs/contracts/policy-insight.v1.md`. `pnpm run test` runs `contract:policy-insight:check` before the test suite, so stale generated contract artifacts fail CI.

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
