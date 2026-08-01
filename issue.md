# Wire PolicyInsight synthesis to real support/resistance data (currently reads only from evidence bundles, which are empty)

## Problem

`synthesizePolicyInsightUseCase`'s `ctx.supportResistance` is populated exclusively from evidence-bundle contextual selection (`selectEvidence.ts`), sourced from `sol-usdc-clmm-intelligence`'s `support-resistance` collector. That collector is currently non-functional — `SUPPORT_RESISTANCE_API_URL` is unconfigured and it has never produced a single row (verified live: `SELECT count(*) FROM intelligence.normalized_observations WHERE evidence_family='support_resistance'` → 0).

Meanwhile, `regime-engine` already has real, live support/resistance data that policy synthesis never touches:

```
curl "$RE_URL/v1/sr-levels/current?symbol=SOL%2FUSDC&source=mco"
→ real data: briefId "mco-sol-2026-07-30", supports [32, 43, 48, 64.68, ...], resistances [77.34, 82-93.92], notes, timeframe, etc.
```

This is fed by a separate repo, `crypto-aggregator`, which runs an OpenClaw agent pipeline watching TA YouTube channels (including MoreCryptoOnline) and extracting structured theses. Confirmed via `grep`: `synthesizePolicyInsightUseCase`/`synthesizePolicyInsight.ts`/`selectEvidence.ts` have zero references connecting to this data — it's entirely separate from the evidence-bundle path.

## The complication: two SR stores, neither one is a clean fit as-is

- **v1** (`/v1/sr-levels`, `getCurrentSrLevels` in `src/ledger/srLevelsWriter.ts`) — has the real `mco` data, but is backed by the **local SQLite ledger** (`LEDGER_DB_PATH`, default `/data/ledger.sqlite` on a Railway volume). This is a real problem for reading it from the new `regime-engine-synthesis-worker` service (added for #78/#79): each Railway service gets its **own separate volume** — the synthesis worker's `/data` is a fresh, empty volume, not the main API service's. Wiring `synthesizePolicyInsightUseCase` to `getCurrentSrLevels` would work if synthesis ran inside the main API process, but not inside the separately-deployed worker that actually runs it today.
- **v2** (`/v2/sr-levels`, `srThesesV2Store`, backed by Postgres `regime_engine.sr_theses_v2`) — cross-service accessible (any service with `DATABASE_URL` can read it, including the synthesis worker), richer schema (bias, setupType, entryZone, targets, invalidation), but **currently has zero rows**. Confirmed live: `SELECT count(*) FROM regime_engine.sr_theses_v2` → 0. Nothing writes to it yet — `crypto-aggregator` (or whatever produces the v1 `mco` data) only ever targets the v1 endpoint.

## Scope

1. **Point real SR ingestion at v2 instead of (or in addition to) v1.** Whatever in `crypto-aggregator` currently POSTs to `regime-engine`'s v1 `/v1/sr-levels` should also/instead POST to `/v2/sr-levels` (`POST /v2/sr-levels`), so the data lands in Postgres where every service — including the synthesis worker — can actually read it. This may be entirely out-of-repo work (in `crypto-aggregator`); confirm and coordinate, or file a companion issue there.
2. **Add a read path from `sr_theses_v2` into `synthesizePolicyInsightUseCase`.** `srThesesV2Store` already exists and is wired into `buildApplication.ts`'s dependencies (`ctx.srThesesV2Store`), but `createSynthesizePolicyInsightUseCase`'s deps (`getCurrentRegime`, `selectEvidence`, `repository`, `clock`, `ruleset`) don't include it. Add a dependency (e.g. `getSrTheses`) and populate `ctx.supportResistance` (or an equivalent field the reducer at `synthesizePolicyInsight.ts` can consume) from it, independent of evidence-bundle contextual selection.
3. **Decide the relationship between this path and the evidence-bundle `supportResistance` path** (from `sol-usdc-clmm-intelligence`, once that collector is eventually fixed too — separate scope, not this issue). They shouldn't silently double-count or conflict; likely this SR-ledger read becomes the primary/authoritative source given it's real data today, with evidence-bundle SR as an additional corroborating input once/if it exists.
4. **Ensure `regime-engine-synthesis-worker`'s deploy config doesn't need the `/data` volume for this path** — confirm the v2/Postgres-backed read doesn't reintroduce a dependency on the local SQLite ledger.

## Acceptance criteria

1. `crypto-aggregator`'s (or whatever's) real SR data lands in `regime_engine.sr_theses_v2`, confirmed via `SELECT count(*) FROM regime_engine.sr_theses_v2` > 0 in production.
2. `synthesizePolicyInsightUseCase` incorporates that data into `ctx.supportResistance` (or equivalent) when synthesizing, running inside the actual `regime-engine-synthesis-worker` process (not just the main API process).
3. A live pair-scoped `PolicyInsight` synthesis run reflects real support/resistance levels, verified by inspecting the persisted `synthesisOutputJson`.
4. No regression to the existing evidence-bundle-sourced `supportResistance` path once `sol-usdc-clmm-intelligence`'s own collector is eventually fixed (tracked separately).
