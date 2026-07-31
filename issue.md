# Trigger pair-scoped PolicyInsight synthesis on evidence ingest

## Correction (verified against real code before rewriting)

The original version of this issue was scope-broken. Verified directly:

- `selectEvidenceForSynthesisUseCase` calls `repository.getLatest({ pair, scope, ... })`, and the Postgres query is scope-exact: `WHERE pair = ? AND scope_key = ?`.
- `evidenceScopeKey({kind:"pair"})` → `"pair"`. `evidenceScopeKey({kind:"position",...})` → `"position:<len-prefixed wallet><len-prefixed pool><len-prefixed positionId>"`. Completely different strings.
- `sol-usdc-clmm-intelligence` only ever publishes `scope.kind: "position"` bundles.

So a naive "trigger pair-scoped synthesis on any evidence ingest" would query for `scope_key = "pair"`, find zero rows of the position evidence we just spent days getting to publish, and either fail or produce a market-only insight that silently uses none of it. That would clear the UI's "No policy insight available yet" message while being misleading about what's actually informing it — don't ship that.

Also corrected: `GET /v1/insights/sol-usdc/current` only accepts `scope` of `pair` or `position` (see `insightsCurrent.ts` — `"whirlpool"` throws `Invalid scope kind`). Drop "whirlpool scope" from this issue entirely; use pair scope.

## Revised scope

Pick one explicitly — do not let the implementation silently default to the degraded option while looking like the good one:

1. **Preferred**: file/build a companion change in `sol-usdc-clmm-intelligence` to additionally publish a pair-scoped evidence bundle containing only pair-safe evidence (no wallet/position/inventory/range data) — see companion issue in that repo.
2. Add a formal position→pair projection policy in `regime-engine` that strips position-specific fields before aggregating into a pair-level view.
3. Ship a regime-data-only pair insight now and be explicit in the UI/docs that intelligence evidence isn't reflected in it yet.

## Market selector

Pair scope carries no pool address, but `synthesizePolicyInsightUseCase`'s `marketSelector` always requires `{ source, network, poolAddress, timeframe }`. Define the canonical values (matching what `geckoCollector.ts` actually ingests candles under) as config, e.g.:

```
source      = geckoterminal
network     = solana
poolAddress = <configured canonical SOL/USDC pool>
timeframe   = 1h
```

## Trigger mechanics

Replace "fire-and-forget on evidence ingest" with something that survives a restart between the 201 response and synthesis:
- Only trigger after `ingestEvidenceBundleUseCase` returns `created` (not `already_ingested`).
- Catch and classify every synthesis failure — do not let it affect the evidence-ingest HTTP response (durability and insight availability are different concerns).
- Coalesce concurrent pair-synthesis attempts.
- Log evidence receipt ID, scope, `synthesisInputHash`, resulting insight ID, and duration.
- Add an explicit deployment/startup backfill step so this works against evidence already ingested, not only future publications.

## Acceptance criteria

1. Pair-scoped synthesis actually incorporates the pair-safe evidence path chosen above (verify this isn't silently empty).
2. `GET /v1/insights/sol-usdc/current` (no params — what `clmm-v2`'s app actually calls) returns real, evidence-informed data.
3. Duplicate evidence ingestion does not create duplicate insights (verify `synthesisInputHash` replay detection still holds under the new trigger).
4. Evidence ingest continues to return 201 even if synthesis fails or regime/candle data is temporarily unavailable.
5. A backfill run against already-ingested evidence produces a real insight without waiting for a new publish.
