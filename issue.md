# Trigger pair PolicyInsight synthesis on new sr_theses_v2 data, not just evidence bundles

## Problem

Pair-scoped `PolicyInsight` synthesis is gated entirely on evidence-bundle existence — confirmed live, currently blocking real work end-to-end:

`postgresPolicyInsightSynthesisTriggerAdapter.ts`'s `claimLatestPairEvidence` only checks:
```sql
SELECT MAX(id) FROM regime_engine.evidence_bundles
WHERE pair = 'SOL/USDC' AND scope_key = 'pair' AND id > last_processed_receipt_id
```

`sol-usdc-clmm-intelligence` has never produced a pair-scoped evidence bundle (its own contextual collectors — support-resistance, news-evidence — are unconfigured/broken; see that repo's issue history). So this cursor never advances, and the synthesis worker (#78/#79) never runs a single synthesis cycle, ever — confirmed live: `regime_engine.policy_insight_synthesis_cursor` sits at `last_processed_receipt_id = 0` indefinitely.

Meanwhile, `crypto-aggregator` #3 now successfully pushes real SOL/USDC support/resistance data into `regime_engine.sr_theses_v2` (confirmed live, real row present), and #82 wired `synthesizePolicyInsightUseCase` to read it. But that data is completely unreachable in practice — nothing can ever trigger a synthesis cycle to use it.

## Why this is the right fix (not fixing the evidence-bundle side instead)

Traced how the claimed receipt is actually used: `runPolicyInsightSynthesisCycle` calls `claimLatestPairEvidence` purely to decide *whether to run a cycle* — the claimed `targetReceiptId` is bookkeeping/idempotency identity, not an input to synthesis itself. `synthesizePolicyInsightUseCase` always independently re-queries the *current* evidence selection, market regime, and (post-#82) `sr_theses_v2` state at cycle time, regardless of which specific row triggered the cycle. This means adding a second trigger source is additive and safe — it doesn't change what gets synthesized, only when a cycle runs.

## Scope

1. Extend `regime_engine.policy_insight_synthesis_cursor` with a second tracked pointer, e.g. `last_processed_sr_theses_max_id` (same shape as the existing `last_processed_receipt_id`, just tracking `MAX(id)` from `regime_engine.sr_theses_v2` instead of `evidence_bundles`).
2. Change `claimLatestPairEvidence`'s claim condition to fire if **either** pointer has advanced: `evidence_bundles.MAX(id) > last_processed_receipt_id` OR `sr_theses_v2.MAX(id) > last_processed_sr_theses_max_id` (scoped to `symbol='SOL/USDC'` for the SR side).
3. On successful completion, advance **both** pointers to their current maxes (even if only one had actually changed) — otherwise a small lag in one source could cause redundant re-triggering.
4. Keep the existing lease/retry/attempt-count machinery as-is — this only changes the claim query's trigger condition, not the surrounding coordination logic.
5. `PolicyInsightSynthesisClaim`/`ClaimLatestPairEvidenceInput` types may need a note clarifying `targetReceiptId` no longer strictly means "an evidence_bundles.id" — document what it represents now (likely just "the evidence_bundles component of this claim's identity," with the SR component tracked separately, or an opaque combined cursor version — pick during implementation).

## Explicitly out of scope

- Fixing `sol-usdc-clmm-intelligence`'s own `support-resistance`/`news-evidence`/`on-chain-flow` collectors — real, separate reliability work, tracked independently. Once fixed, that data becomes an *additional* input to synthesis (already true post-#82's evidence-bundle read path), not a trigger dependency.
- Position-scoped synthesis (#79) — unaffected, uses a different claim path entirely.

## Acceptance criteria

1. A live `crypto-aggregator` SR emission (with no new evidence bundle) causes the synthesis worker to claim and run a cycle within one poll interval.
2. `GET /v1/insights/sol-usdc/current` returns a real synthesized `PolicyInsight` reflecting the SR data, without requiring `sol-usdc-clmm-intelligence` to ever publish a pair-scoped evidence bundle.
3. A new evidence bundle (once `sol-usdc-clmm-intelligence`'s side is eventually fixed) still independently triggers a cycle too — both paths coexist.
4. No duplicate/redundant synthesis cycles from the same underlying change (verify the dual-pointer advance logic doesn't cause a ping-pong retrigger).
