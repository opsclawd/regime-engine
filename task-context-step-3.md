# Task Context: Task 3

Title: Implement leased cursor transitions in the Postgres adapter
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-78
Repository: opsclawd/regime-engine
Branch: ai/issue-78
Start Commit: c8bcac54261f45e46e11f79b38cc9d55167fe4f5

## Task Requirements

**Files:**

- Create: `src/application/ports/policyInsightSynthesisTriggerPort.ts`
- Create: `src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts`
- Create: `src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`
- Reference: `src/ledger/pg/schema/policyInsightSynthesisCursor.ts`
- Reference: `src/ledger/pg/schema/evidenceBundles.ts`
- Reference: `src/adapters/postgres/postgresEvidenceBundleRepository.ts`

- [ ] **Step 1: Write the state-transition tests first.** Add the exact cases `claims the newest historical pair receipt when the cursor is absent`, `coalesces multiple pending pair receipts to the highest id`, `never claims non-pair evidence`, `returns idle while another unexpired lease owns the claim`, `reclaims the target after lease expiry`, `only the matching owner and target can complete a claim`, `success advances the cursor and clears retry state`, `permanent failure advances the cursor`, and `transient failure preserves the cursor and schedules retry`.
- [ ] **Step 2: Verify the adapter test fails.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`; expect missing port/adapter failures.
- [ ] **Step 3: Define the port and implement every method in the same task.** Export `PolicyInsightSynthesisClaim`, `PolicyInsightSynthesisOutcome`, and `PolicyInsightSynthesisTriggerPort` with methods `claimLatestPairEvidence(input)`, `complete(input)`, and `releaseForRetry(input)`. `PolicyInsightSynthesisClaim` must include `targetReceiptId`, `attemptCount`, and `leaseOwner`. Each mutation input must include `cursorKey`, `leaseOwner`, `targetReceiptId`, and a captured `nowUnixMs`; claims additionally include `leaseDurationMs`, and retry release includes classification, sanitized message, and `retryAtUnixMs`.
- [ ] **Step 4: Implement atomic Postgres transitions.** `claimLatestPairEvidence` must use one transaction and row locking/upsert semantics to initialize the cursor, honor `next_attempt_at_unix_ms`, reject live leases, select `MAX(evidence_bundles.id)` where `pair = 'SOL/USDC'`, `scope_key = 'pair'`, and ID is above the cursor, then lease only that target. `complete` and `releaseForRetry` must use owner+target compare-and-set predicates and return whether the transition applied. Do not mark `evidence_bundles.processed_at_unix_ms`; the cursor table is the sole trigger state.
- [ ] **Step 5: Run focused verification.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts` and `pnpm exec eslint src/application/ports/policyInsightSynthesisTriggerPort.ts src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`; expect all transition tests to pass. This task deliberately combines the new port and its only adapter so workspace typechecking is never left with an unimplemented interface.
- [ ] **Step 6: Commit.** Commit as `m78: add leased pair synthesis trigger adapter`.

## Repository Targets

### Expected Files
- src/application/ports/policyInsightSynthesisTriggerPort.ts
- src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts
- src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts

### Reference Files
- src/ledger/pg/schema/policyInsightSynthesisCursor.ts
- src/ledger/pg/schema/evidenceBundles.ts
- src/adapters/postgres/postgresEvidenceBundleRepository.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts
["pnpm","exec","eslint","src/application/ports/policyInsightSynthesisTriggerPort.ts","src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts","src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **historical startup claim**: When no cursor exists, claim chooses the highest existing pair receipt so evidence predating deployment is processed. (Test: `claims the newest historical pair receipt when the cursor is absent`)
- **burst coalescing**: When several pair receipts are above the cursor, only the highest ID becomes the target. (Test: `coalesces multiple pending pair receipts to the highest id`)
- **pair scope isolation**: Position wallet and whirlpool evidence rows never become pair synthesis claims. (Test: `never claims non-pair evidence`)
- **exclusive live lease**: A second owner receives no work while the current lease is unexpired, but can reclaim after expiry. (Test: `returns idle while another unexpired lease owns the claim`)
- **compare and set completion**: Only the owner of the current target can advance or release it; stale workers cannot mutate newer state. (Test: `only the matching owner and target can complete a claim`)
- **transient retry retains cursor**: A transient failure releases the lease and schedules retry without advancing last processed receipt. (Test: `transient failure preserves the cursor and schedules retry`)
- **terminal outcomes advance**: Success and permanent failure both advance past the target and clear lease state. (Test: `permanent failure advances the cursor`)

