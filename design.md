# Design: Trigger pair PolicyInsight synthesis on new sr_theses_v2 data

## The problem being solved and why it matters

Currently, the synthesis of `PolicyInsight` is gated entirely on the availability of new `evidence_bundles`. The synthesis worker checks `regime_engine.evidence_bundles` to see if `MAX(id)` is greater than the tracked `last_processed_receipt_id`. Because the data source for `evidence_bundles` (`sol-usdc-clmm-intelligence`) is broken and not producing pair-scoped evidence bundles, the cursor never advances and no synthesis cycles are run.

At the same time, `crypto-aggregator` is successfully emitting `sr_theses_v2` (support and resistance) data. This new data is ignored by the synthesis trigger, blocking the generation of insights that could leverage this available information.

By allowing either `evidence_bundles` OR `sr_theses_v2` to trigger a synthesis cycle, we can unblock the worker and ensure that fresh support and resistance data translates into actionable policy insights without waiting on the broken `evidence_bundles` collector.

## Key design decisions and trade-offs considered

1. **Schema Extension vs. Opaque Combined Cursor:**
   - _Option A:_ Combine the max IDs of `evidence_bundles` and `sr_theses_v2` into a single opaque cursor (e.g., `"10|25"`) stored in the existing `target_receipt_id` column.
   - _Option B:_ Explicitly extend the `regime_engine.policy_insight_synthesis_cursor` schema with `last_processed_sr_theses_max_id` and `target_sr_theses_max_id` columns.
   - _Trade-off:_ Option A avoids database schema changes but overloads the semantics of the `target_receipt_id` field, making debugging harder and database-level checks weaker. Option B requires a DB migration but provides clear, independent tracking of both sources and maintains type safety.
   - _Decision:_ **Option B (Schema Extension)**. It aligns with the existing architecture and makes the claim query logic much simpler and robust.

2. **Claim Trigger Condition (Dual Pointers):**
   - The cycle must run if **either**:
     - `MAX(evidence_bundles.id) > last_processed_receipt_id` OR
     - `MAX(sr_theses_v2.id) > last_processed_sr_theses_max_id` (scoped to `symbol = 'SOL/USDC'`).
   - _Decision:_ Both max IDs will be queried in `claimLatestPairEvidence`. If either condition is met, both `target_receipt_id` and `target_sr_theses_max_id` are set to their current respective maximums in the `policy_insight_synthesis_cursor` table.

3. **Advance Pointer Behavior (Preventing Ping-Ponging):**
   - If a synthesis cycle is triggered by `sr_theses_v2`, but `evidence_bundles` hasn't changed, completing the cycle MUST update both `last_processed_*` pointers to the exact `target_*` values that were claimed. This prevents the unchanged source from inadvertently re-triggering the cycle in subsequent polls.

## Proposed approach with rationale

1. **Schema Changes:**
   - Update `src/ledger/pg/schema/policyInsightSynthesisCursor.ts` to add:
     - `lastProcessedSrThesesMaxId: bigint("last_processed_sr_theses_max_id", { mode: "number" }).notNull().default(0)`
     - `targetSrThesesMaxId: bigint("target_sr_theses_max_id", { mode: "number" })`
   - Generate and apply a Drizzle migration. Update the table constraints (e.g., `chk_synthesis_cursor_non_negative`, `chk_synthesis_cursor_lease_coherence`) to ensure the new columns follow the same coherence rules as the existing ones.

2. **Type/Port Updates:**
   - Update `PolicyInsightSynthesisClaim` in `src/application/ports/policyInsightSynthesisTriggerPort.ts` to include `targetSrThesesMaxId` and `lastProcessedSrThesesMaxId`.
   - Update `CompletePolicyInsightSynthesisInput` and `ReleaseForRetryInput` to require `targetSrThesesMaxId` alongside `targetReceiptId`.
   - Document in the types that `targetReceiptId` represents the `evidence_bundles` cursor, while `targetSrThesesMaxId` represents the `sr_theses_v2` cursor.

3. **Adapter Updates (`postgresPolicyInsightSynthesisTriggerAdapter.ts`):**
   - In `claimLatestPairEvidence`:
     - Query `MAX(id)` for `evidence_bundles` (where `pair = 'SOL/USDC'`).
     - Query `MAX(id)` for `sr_theses_v2` (where `symbol = 'SOL/USDC'`).
     - Default both to `0` if null (e.g. empty table).
     - If both `maxEv <= lastProcessedReceiptId` AND `maxSr <= lastProcessedSrThesesMaxId`, return `null`.
     - Otherwise, compute the new `attempt_count` (increment if _both_ targets match the previously stored targets, otherwise `1`).
     - Update the cursor row setting `target_receipt_id = maxEv` and `target_sr_theses_max_id = maxSr`.
   - In `complete`:
     - Set `last_processed_receipt_id = target_receipt_id` and `last_processed_sr_theses_max_id = target_sr_theses_max_id`.
     - Null out both `target_` columns.
     - Include `target_sr_theses_max_id = ${targetSrThesesMaxId}` in the `WHERE` clause for safety against race conditions.
   - In `releaseForRetry`:
     - Null out both `target_` columns and update `last_outcome`. Include the new target in the `WHERE` clause.

4. **Worker / UseCase (`runSynthesisCycle.ts`):**
   - Update `runPolicyInsightSynthesisCycle` to pass both `targetReceiptId` and `targetSrThesesMaxId` to `complete()` and `releaseForRetry()`.

## Assumptions made

1. `sr_theses_v2` contains a `symbol` column that can be filtered using `'SOL/USDC'`, functionally equivalent to `pair` in `evidence_bundles`. (Confirmed via schema analysis).
2. The current `policy_insight_synthesis_cursor` table only has rows added for `'pair'`, making a migration with a `DEFAULT 0` for `last_processed_sr_theses_max_id` completely safe.
3. Fetching `MAX(id)` simultaneously from `evidence_bundles` and `sr_theses_v2` will not introduce unacceptable performance overhead or contention during the claim transaction.
4. If a table has no rows, `MAX(id)` evaluates to `null`. We will treat `null` as `0` during comparison to ensure the cursor can initialize correctly and gracefully handle empty tables.

## What is in scope

- Extending the `policy_insight_synthesis_cursor` schema with the two new `sr_theses_v2` tracking pointers.
- Modifying `claimLatestPairEvidence` to trigger a cycle based on either `evidence_bundles` or `sr_theses_v2` advancing.
- Advancing both pointers upon successful synthesis completion.
- Updating `PolicyInsightSynthesisClaim` and related port interfaces/types to track both component cursors.

## What is explicitly out of scope

- Fixing the `sol-usdc-clmm-intelligence` collectors (`support-resistance`, `news-evidence`, `on-chain-flow`). This is a separate reliability workstream.
- Modifying position-scoped synthesis (`scope_key = 'position'`). This uses a different claim path.
- Modifying the underlying synthesis logic (`synthesizePolicyInsightUseCase`). It already queries the correct current state; we only change _when_ it runs.

## Risks or concerns identified from code analysis

- **Ping-Pong Retriggering / Redundant Cycles:** If the adapter incorrectly updates only one of the pointers on success (or checks them inconsistently), the system could get caught in a loop where the unchanged data source continually retriggers synthesis. Advancing _both_ pointers to the claimed max values on success entirely mitigates this.
- **Lease Coherence Constraints:** The PostgreSQL `CHECK` constraint `chk_synthesis_cursor_lease_coherence` strictly validates that lease fields are entirely null or entirely non-null. When adding `target_sr_theses_max_id`, this constraint must be updated (e.g. `... AND target_sr_theses_max_id IS NOT NULL`) so the database doesn't reject valid claims.
- **Null `MAX(id)` Behavior:** If `sr_theses_v2` is completely empty, `MAX(id)` is null. The current logic in `claimLatestPairEvidence` explicitly fails the claim if `maxIdRaw === null`. We must update this to fallback to `0` (or `lastProcessed`) for each table, only returning `null` (no claim) if _both_ are effectively non-advancing.
