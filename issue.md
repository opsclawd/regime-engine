# fix: route weekly report candle reads through canonical candle store

## Summary

Route `/v1/report/weekly` baseline candle reads through the same canonical candle read path used by candle ingestion, `/v1/regime/current`, and position-scoped `/v1/plan`.

A PR review on #54 identified a split-brain candle-store issue: when `DATABASE_URL` is configured, candle ingestion and market/regime reads use the active Postgres-backed candle store, but the weekly report baseline path still reads from the legacy SQLite `candle_revisions` adapter. That can make SOL HODL/DCA baselines collapse to initial NAV or otherwise use stale/empty data even though valid market candles exist in Postgres.

## Problem

Current deployed topology can diverge:

```text
POST /v1/candles
  -> active candle store, Postgres when DATABASE_URL is configured

GET /v1/regime/current
  -> active candle read path / candle store

POST /v1/plan
  -> active candle read path / candle store

GET /v1/report/weekly
  -> legacy SQLite weekly adapter / candle_revisions
```

This means reports may be computed against a different market-data source than regime and plan recommendations.

That is wrong. Anything that depends on candle history should read from one canonical candle store.

## Desired state

Use one canonical candle read path for:

- `/v1/regime/current`
- `/v1/plan`
- `/v1/report/weekly`

Weekly reports should not read directly from SQLite `candle_revisions` when the active candle store is Postgres-backed. They should use a shared `CandleReadPort`/store abstraction or equivalent canonical read interface.

## Scope

Fix weekly report baseline candle reads so they use the active candle store selected by application wiring.

Expected behavior:

```text
If DATABASE_URL is configured:
  /v1/report/weekly reads baseline candles from Postgres-backed candle store.

If DATABASE_URL is not configured:
  /v1/report/weekly reads from the standalone/local candle store consistently with the rest of the app.
```

Do not add another fallback that silently chooses between SQLite and Postgres. The report should use the same canonical candle source as the rest of regime-engine.

## Acceptance criteria

- [ ] Identify the current weekly report candle read path and remove direct dependency on legacy SQLite `candle_revisions` where it conflicts with active candle-store wiring.
- [ ] Route weekly report baseline calculations through the same candle read port/store used by `/v1/regime/current` and `/v1/plan`.
- [ ] Ensure reports use closed candles only, with the same market key semantics where applicable: `source`, `network`, `poolAddress`, `timeframe`.
- [ ] Add tests for Postgres-backed/store-context mode proving weekly report baselines use candles available in the active candle store.
- [ ] Add tests preventing empty/stale SQLite fallback when active candles exist in the configured store.
- [ ] Preserve local/test behavior when `DATABASE_URL` is absent.
- [ ] Update any docs or architecture notes that still imply reports read from a separate legacy candle source.

## Out of scope

- Changing the weekly report public response shape unless required to expose correct metadata.
- Changing `/v1/plan` position-scoped behavior.
- Changing candle ingestion semantics.
- Adding new market-data fallback sources.

## Context

This issue came from PR #54 review feedback. The position-scoped `/v1/plan` work removed inline candles from plan requests and made stored candles the canonical market-data source for planning. Weekly reports should be brought into the same model so regime, planning, and reporting do not disagree because they read from different stores.
