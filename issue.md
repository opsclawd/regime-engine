# API: Expose Raw Observations API for Evidence Bundles

## Goal
Create a new read-adapter in `regime-engine` to query the `intelligence.raw_observations` Postgres table and expose it via a new HTTP GET endpoint (e.g., `GET /v1/evidence/sol-usdc/:id/raw`).

## Acceptance Criteria
- A new `GetRawObservationsForBundleUseCase` exists.
- A new Postgres read adapter fetches raw observations by bundle ID or pipeline run ID.
- A new `GET /v1/evidence/sol-usdc/:id/raw` endpoint is exposed.
- Tests are added for the use case and endpoint.

## Open Questions
None.

