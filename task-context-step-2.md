# Task Context: Task 2

Title: Implement atomic dual-source claim, completion, and retry coordination
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-84
Repository: opsclawd/regime-engine
Branch: ai/issue-84
Start Commit: fe6cd852f09f3928795fb106d28125a71fbc74d7

## Task Requirements

**Files:**

- Modify: `src/application/ports/policyInsightSynthesisTriggerPort.ts`
- Modify: `src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts`
- Modify: `src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`
- Modify: `src/workers/policyInsight/runSynthesisCycle.ts`
- Modify: `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`
- Reference only: `src/ledger/pg/schema/srThesesV2.ts`
- Reference only: `src/ledger/pg/schema/policyInsightSynthesisCursor.ts`
- Reference only: `src/workers/policyInsightSynthesisWorker.ts`
- Reference only: `src/workers/__tests__/policyInsightSynthesisWorker.test.ts`

This task intentionally keeps the exported port shapes, their only PostgreSQL implementation, the worker consumer, and all affected fixtures together. The required-member changes would otherwise fail the automatic workspace typecheck between tasks.

**Behavioral invariants:**

- `claims when only evidence advances and snapshots both source maxima`
- `claims when only SR theses advance and snapshots both source maxima`
- `returns idle when neither source has advanced`
- `coalesces simultaneous evidence and SR advances into one dual-pointer claim`
- `increments attempts only when reclaiming the same dual-pointer target`
- `completion requires the matching owner and both targets`
- `completion advances both pointers to the exact claimed targets`
- `transient release preserves both processed pointers and retries the same target pair`
- `does not ping-pong after completing a single-source advance`
- `propagates both claim targets through every worker terminal path`

- [ ] **Step 1: Write failing adapter transition tests first.** Add an `insertSrThesis` helper that inserts a minimal unique `sr_theses_v2` row for a requested symbol and returns its numeric ID; delete those test rows in `afterEach`. Update existing completion/retry calls to carry `targetSrThesesMaxId`, then add the exact invariant-named cases above. Assert claim values include:

  ```ts
  {
    targetReceiptId: expectedEvidenceMax,
    targetSrThesesMaxId: expectedSrMax,
    lastProcessedReceiptId: expectedProcessedEvidence,
    lastProcessedSrThesesMaxId: expectedProcessedSr
  }
  ```

  Cover empty-table maxima as `0`, custom `pair` as both the evidence `pair` filter and SR `symbol` filter, mismatched SR-target compare-and-set, completion of evidence-only and SR-only claims followed by an idle poll, and retry/reclaim of the same target pair.

- [ ] **Step 2: Write failing worker propagation tests.** Add `targetSrThesesMaxId` and `lastProcessedSrThesesMaxId` to every mocked claim. In the existing success, validation/permanent, exhausted-retry/permanent, transient, and lease-loss cases, assert `complete` or `releaseForRetry` receives the same `targetSrThesesMaxId`. Use the exact test name `propagates both claim targets through every worker terminal path` for the focused table-driven/parameterized coverage; do not split this 500-plus-line test file into a standalone test-only task.

- [ ] **Step 3: Run the focused tests and confirm the required fields/behavior fail.**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`

  Expected: FAIL because the port claim lacks SR fields and the adapter neither queries nor coordinates the SR maximum.

- [ ] **Step 4: Change the exported port shapes and their documentation.** Make these required additions:

  ```ts
  export interface PolicyInsightSynthesisClaim {
    cursorKey: string;
    targetReceiptId: number;
    targetSrThesesMaxId: number;
    attemptCount: number;
    leaseOwner: string;
    leaseExpiresAtUnixMs: number;
    lastProcessedReceiptId: number;
    lastProcessedSrThesesMaxId: number;
  }
  ```

  Add `targetSrThesesMaxId: number` to both `CompletePolicyInsightSynthesisInput` and `ReleaseForRetryInput`. Document `targetReceiptId` as the evidence-bundle component and the new property as the SR-thesis component. Do not add a new port method or alter `ClaimLatestPairEvidenceInput`.

- [ ] **Step 5: Implement the dual-pointer claim transaction.** Extend `CursorRow` with both snake-case SR fields. The cursor insert must initialize `last_processed_sr_theses_max_id` to `0`, and the locked select must read both SR fields. Query unfiltered maxima within the already scoped pair predicates and coalesce nulls to zero:

  ```sql
  SELECT COALESCE(MAX(id), 0) AS max_id
  FROM regime_engine.evidence_bundles
  WHERE pair = ${pair} AND scope_key = ${scopeKey}
  ```

  ```sql
  SELECT COALESCE(MAX(id), 0) AS max_id
  FROM regime_engine.sr_theses_v2
  WHERE symbol = ${pair}
  ```

  Return `null` only when both `targetReceiptId <= lastProcessedReceiptId` and `targetSrThesesMaxId <= lastProcessedSrThesesMaxId`. Treat the target pair as the retry identity:

  ```ts
  const isSameTarget =
    currentTargetReceiptId === targetReceiptId &&
    currentTargetSrThesesMaxId === targetSrThesesMaxId;
  const newAttemptCount = isSameTarget ? Number(cursor.attempt_count) + 1 : 1;
  ```

  Store both targets in the lease update and return both target and last-processed components in the claim. Keep next-attempt and unexpired-lease guards unchanged and before source queries.

- [ ] **Step 6: Implement two-component completion and retry compare-and-set.** Destructure `targetSrThesesMaxId` in both methods. `complete` must set both last-processed columns from the supplied targets, clear both target columns to NULL, clear lease fields and `next_attempt_at_unix_ms`, reset `attempt_count` to 0, and include both target values plus owner in its `WHERE`. `releaseForRetry` must leave both last-processed columns unchanged, PRESERVE both target columns (`target_receipt_id` and `target_sr_theses_max_id`), clear lease owner and expiry (`lease_owner = NULL`, `lease_expires_at_unix_ms = NULL`), schedule retry (`next_attempt_at_unix_ms = retryAtUnixMs`), and include both target values plus owner in its `WHERE`. Retain attempt reset on completion and attempt preservation on retry.

- [ ] **Step 7: Propagate the SR target through the worker.** Immediately capture `const targetSrThesesMaxId = claim.targetSrThesesMaxId` beside `receiptId`, and pass it to every `complete` and `releaseForRetry` call. Do not change synthesis inputs, result unions, or log field names.

- [ ] **Step 8: Run the focused transition and worker tests.**

  Run: `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`

  Expected: PASS, including evidence-only, SR-only, simultaneous, idle, retry, ownership-loss, and no-ping-pong cases.

- [ ] **Step 9: Check only the changed implementation/test files.**

  Run: `pnpm exec eslint src/application/ports/policyInsightSynthesisTriggerPort.ts src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/runSynthesisCycle.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`

  Run: `pnpm exec prettier --check src/application/ports/policyInsightSynthesisTriggerPort.ts src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/runSynthesisCycle.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`

  Expected: both commands exit 0. The orchestrated implementation loop also runs `pnpm -r typecheck` after this complete task, with port, adapter, worker, and test fixtures already synchronized.

- [ ] **Step 10: Commit the coordination unit.**

  ```bash
  git add src/application/ports/policyInsightSynthesisTriggerPort.ts src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/runSynthesisCycle.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts
  git commit -m "m84: trigger pair synthesis from evidence or sr theses"
  ```

## Repository Targets

### Expected Files
- src/application/ports/policyInsightSynthesisTriggerPort.ts
- src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts
- src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts
- src/workers/policyInsight/runSynthesisCycle.ts
- src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts

### Reference Files
- src/ledger/pg/schema/srThesesV2.ts
- src/ledger/pg/schema/policyInsightSynthesisCursor.ts
- src/workers/policyInsightSynthesisWorker.ts
- src/workers/__tests__/policyInsightSynthesisWorker.test.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts
["pnpm","exec","eslint","src/application/ports/policyInsightSynthesisTriggerPort.ts","src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts","src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts","src/workers/policyInsight/runSynthesisCycle.ts","src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts"]
["pnpm","exec","prettier","--check","src/application/ports/policyInsightSynthesisTriggerPort.ts","src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts","src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts","src/workers/policyInsight/runSynthesisCycle.ts","src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **Evidence-only claim**: When evidence advances and SR does not, one claim snapshots both current maxima. (Test: `claims when only evidence advances and snapshots both source maxima`)
- **SR-only claim**: When SR advances and evidence does not, one claim snapshots both current maxima. (Test: `claims when only SR theses advance and snapshots both source maxima`)
- **Dual-source idle**: The adapter returns null only when neither source maximum exceeds its last-processed pointer. (Test: `returns idle when neither source has advanced`)
- **Simultaneous coalescing**: Advances in both sources before a poll become one claim containing both newest IDs. (Test: `coalesces simultaneous evidence and SR advances into one dual-pointer claim`)
- **Retry identity is the target pair**: Attempt count increments only for the identical evidence/SR target pair and resets when either component changes. (Test: `increments attempts only when reclaiming the same dual-pointer target`)
- **Two-component completion CAS**: Completion advances nothing unless owner and both claimed target components match. (Test: `completion requires the matching owner and both targets`)
- **Atomic dual-pointer completion**: Success or permanent failure advances both processed pointers to their exact claimed values and clears lease/retry state. (Test: `completion advances both pointers to the exact claimed targets`)
- **Atomic transient release**: Transient release preserves both processed pointers, clears both targets, schedules retry, and reclaims the same pair later. (Test: `transient release preserves both processed pointers and retries the same target pair`)
- **No single-source ping-pong**: Completing a claim caused by only one source settles both high-water marks so the next unchanged poll is idle. (Test: `does not ping-pong after completing a single-source advance`)
- **Worker target propagation**: Every worker completion and retry path passes the SR target from the same claim as the evidence target. (Test: `propagates both claim targets through every worker terminal path`)

