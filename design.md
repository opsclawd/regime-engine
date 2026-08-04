# API: Expose Raw Observations API for Evidence Bundles

## 1. Problem and Why it Matters

Currently, the `evidence_bundles` table in `regime-engine` stores the synthesized final intelligence received from the `sol-usdc-clmm-intelligence` repo. However, it does not include the raw observations that were gathered originally. To debug, audit, or understand the lineage of a certain evidence bundle, developers need access to the raw observations. These raw observations reside in the `intelligence` schema (`intelligence.raw_observations`) on the same shared database cluster. Creating a read adapter in `regime-engine` to expose these observations via a `GET /v1/evidence/sol-usdc/:id/raw` endpoint enables seamless observability without requiring massive payloads over HTTP during regular evidence ingestion.

## 2. Key Design Decisions and Trade-offs

- **Querying External Schema (`intelligence.raw_observations`) Directly:**
  - _Trade-off:_ The architecture doc (`2026-05-09-evidence-driven-policy-pipeline-design.md`) strictly states "repos communicate via HTTP, not shared queries". Querying `intelligence.raw_observations` directly from `regime-engine` creates a direct database coupling to an external schema.
  - _Decision:_ Since this is an observability-focused read-only endpoint, and both schemas reside in the same database cluster, reading it directly is acceptable to fulfill the issue's requirements. We will use Drizzle's raw `sql` queries rather than defining a rigid schema in `regime-engine`, to keep the footprint small.
- **Handling the `:id` parameter:**
  - _Trade-off:_ Users might refer to an evidence bundle by its `regime-engine` primary key (`id`) or by the intelligence pipeline's `runId`.
  - _Decision:_ The read adapter will support fetching by either the bundle ID (numeric) or the pipeline run ID (string). If numeric, we can query `regime_engine.evidence_bundles` to resolve the `runId`, then fetch the raw observations matching that `runId`.

## 3. Proposed Approach with Rationale

1. **Domain Port and Adapter (`src/application/ports/`, `src/adapters/postgres/`)**
   - Create `RawObservationsReadPort.ts` in `src/application/ports/` defining the interface to fetch raw observations by `runId`.
   - Create `postgresRawObservationsReadAdapter.ts` in `src/adapters/postgres/`. It will use Drizzle's `sql` to execute: `SELECT * FROM intelligence.raw_observations WHERE run_id = $1`.
2. **Use Case (`src/application/use-cases/`)**
   - Create `GetRawObservationsForBundleUseCase.ts`.
   - The use case takes an identifier (bundle `id` or `runId`). If it's a numeric bundle `id`, it first delegates to the evidence bundles repository to get the `runId`. It then calls the `RawObservationsReadPort` to get the raw observations.
3. **HTTP Handler and Routing (`src/adapters/http/`)**
   - Create `src/adapters/http/handlers/evidenceRaw.ts` implementing the Fastify handler.
   - Wire the handler in `routes.ts` to `app.get("/v1/evidence/sol-usdc/:id/raw", ...)`.
4. **Testing (`src/adapters/http/handlers/__tests__/` and `src/adapters/postgres/__tests__/`)**
   - Create `evidenceRaw.test.ts` for HTTP testing.
   - Vitest tests to ensure determinism and correct handling of 404s when a bundle or its raw observations are missing.

## 4. Assumptions Made

- **Database Permissions:** We assume that the PostgreSQL role used by `regime-engine` has `SELECT` privileges on the `intelligence.raw_observations` table. No DDL grants will be included in this implementation.
- **Schema Shape:** We assume `intelligence.raw_observations` has a `run_id` (or equivalent) column that corresponds to the `runId` stored in `regime_engine.evidence_bundles`.
- **Read-Only Access:** We assume `regime-engine` only needs to read this table and never write to it.

## 5. Scope

- **In Scope:**
  - Creating `GetRawObservationsForBundleUseCase`.
  - Creating the new Postgres read adapter for `intelligence.raw_observations`.
  - Exposing the `GET /v1/evidence/sol-usdc/:id/raw` endpoint.
  - Adding corresponding tests.
- **Out of Scope:**
  - Defining Drizzle ORM schema files for `intelligence.raw_observations` (since it is owned by another repository).
  - Provisioning cross-schema DB permissions (handled via IaC/DBA processes).
  - Any multi-pair logic beyond `SOL/USDC`.

## 6. Risks or Concerns Identified

- **Architectural Drift:** Direct database reads into another repository's schema violate the strict isolation explicitly defined in `2026-05-09-evidence-driven-policy-pipeline-design.md`. This introduces fragile coupling: if the `sol-usdc-clmm-intelligence` repo renames its table or columns, the `regime-engine` endpoint will break without compilation warnings.
- **Mitigation:** Rely strictly on raw SQL with defensive try-catch blocks and explicit error taxonomy, ensuring failures in this observability endpoint do not affect core synthesis logic.
