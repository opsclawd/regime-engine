# Add durable position-scoped PolicyInsight synthesis pipeline (blocked on clmm-v2 plan submission)

## Corrections (verified against real code before rewriting)

This issue's original queue design had real gaps, confirmed against the actual synthesis code:

**Queue identity was insufficient.** `computePolicyInsightFingerprints` already hashes `positionPlan` (via `positionHash`) into `synthesisInputHash`, alongside evidence selection. A queue keyed on `scopeKey + evidenceHash + rulesetVersion` alone cannot represent "same evidence, newer plan" — after a first synthesis completes, a fresh plan against unchanged evidence needs to produce a new synthesis input. Key on `scopeKey + selectionHash + planHash + rulesetVersion` (or an equivalent "latest desired evidence+plan version" coordinator per scope), not a single evidence hash.

**One claim from the original review that I checked and is false — do not implement it:** it stated "Regime Engine rejects plan positions older than sixty seconds." Checked `src/engine/policy/ruleset.ts` directly: `positionMaxAgeMs: 86400000` (24 hours), not 60 seconds. `clmm-v2`'s current 5-minute observation staleness tolerance is well within this. No freshness-limit alignment is needed here.

## This issue remains blocked

Confirmed via a 30-day production HTTP log search: `POST /v1/plan` has never been called. This issue cannot be completed independent of the companion `clmm-v2` issue (which turned out to require substantially more work than "start calling an endpoint" — see that issue for the real scope: endpoint mismatch, contract mismatch, missing auth, plan-identity handling).

## Revised scope

1. **`PlanLedgerReadPort`** — read the exact stored `PlanRequest`/`PlanResponse` (not a lossy reconstruction; `planHash` is verified via `sha256Hex(toCanonicalJson(planWithoutHash))`).
2. **Plan storage topology — needs an explicit decision, not an assumption.** Plans are currently written to a local SQLite store (`plan_requests` table via `writePlanLedgerEntry`), separate from the Postgres `regime_engine` schema evidence/insights live in. A separately-deployed worker process cannot assume filesystem access to the HTTP service's SQLite volume. Either:
   - run the synthesis worker in the same service/container as the HTTP API (simplest), or
   - move/mirror plan storage into Postgres so plan persistence and queue wake-up can be transactional (cleaner long-term, avoids a cross-database dual-write gap).
   Decide and document this before writing the worker.
3. **SQLite plan schema lacks position-indexed lookup columns** (`plan_requests` only has `plan_id`, `request_json`, `plan_json`, timestamps — no `position_id`/`wallet_id`/`pool_address` columns). If keeping SQLite (option A above), add a migration with denormalized lookup columns; `PlanLedgerReadPort.getLatestPositionPlan()` otherwise requires JSON scans.
4. **Durable synthesis-request queue** (Postgres table, e.g. `policy_insight_synthesis_requests`) keyed as corrected above, enqueued from both the evidence-ingest and plan-write paths, with lease-recovery fields (`lockedAt`, `lockedBy`, `leaseExpiresAt`) — `FOR UPDATE SKIP LOCKED` alone doesn't recover a row a crashed process left `processing`.
5. **Worker** (`src/workers/policyInsightSynthesizer.ts`, `pnpm start:policy-synthesis`) — claims requests, resolves the latest eligible evidence + matching plan, invokes `synthesizePolicyInsightUseCase`.
6. **Internal trigger endpoint**: protected `POST /v1/internal/insights/sol-usdc/synthesis-requests`, returns `202` with the request ID, doesn't synthesize inline. Backfill/replay/deployment-verification use only.
7. **Temporal compatibility rules** — specify explicitly: exact wallet/position/pool equality; max evidence↔position observation skew; behavior when evidence expires while waiting on a plan; whether a newer plan supersedes an older queued request.
8. **Structured error codes** on `PolicyInsightValidationError`/`PolicyInsightStoreUnavailableError` (currently message-only) so the worker classifies retryable vs. permanent without string matching: `POSITION_PLAN_MISSING`, `POSITION_STALE`, `PLAN_HASH_INVALID`, `POSITION_SCOPE_MISMATCH`, `POOL_SCOPE_MISMATCH`, `MARKET_DATA_UNAVAILABLE`, `EVIDENCE_STORE_UNAVAILABLE`, `POLICY_STORE_UNAVAILABLE`, `OUTPUT_SCHEMA_INVALID`.

## Explicitly out of scope for this issue

- Pair/whirlpool-scoped synthesis (#78 — independent, no plan dependency).
- Anything in `clmm-v2` (tracked in that repo's companion issue).

## Acceptance criteria

1. A newly published position evidence bundle creates a durable synthesis request.
2. A matching recent position plan causes one canonical `PolicyInsight` to be persisted.
3. `GET /v1/insights/sol-usdc/current?scope=position&walletAddress=...&whirlpoolAddress=...&positionId=...` returns that insight.
4. Duplicate evidence publication does not create duplicate insights.
5. A new plan against unchanged evidence produces a new synthesis (queue identity fix, not just evidence replay detection).
6. Two positions from the same intelligence pipeline run synthesize independently.
7. Evidence arriving before the plan waits and later completes; plan arriving before evidence later completes.
8. A worker restart does not lose or duplicate work (lease recovery verified, not just SKIP LOCKED).
9. Missing/stale candles and invalid plan hashes are classified via structured codes, not uniformly retried.
10. Enqueue every currently eligible, unexpired position scope on deployment; for scopes with no eligible evidence, trigger a fresh intelligence run rather than treating it as a backfill gap.
