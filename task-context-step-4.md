# Task Context: Task 4

Title: Implement atomic queue operations with lease recovery
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-79
Repository: opsclawd/regime-engine
Branch: ai/issue-79
Start Commit: d64e12669d308cc998d484d6eb84f9e0cbc35898

## Task Requirements

**Files:**

- Create: `src/application/ports/positionPolicyInsightSynthesisQueuePort.ts`
- Create: `src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts`
- Create: `src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts`

**Exported API changes:** Add `PositionPolicyInsightSynthesisQueuePort` and its request/claim/result types. Every port method is implemented by the Postgres adapter in this same task.

**Behavioral invariants / tests written first:**

- `replaying an identical ready identity returns the original request id`.
- `evidence first persists waiting_for_plan and plan reconciliation promotes it to pending`.
- `plan first persists waiting_for_evidence and evidence reconciliation promotes it to pending`.
- `claims independent positions in deterministic id order with skip locked`.
- `does not steal an unexpired processing lease`.
- `reclaims an expired processing lease and increments attempt count`.
- `only the current lease owner can complete fail supersede or release a request`.
- `release for retry keeps the identity and makes it claimable only at retryAtUnixMs`.
- `converts release for retry into permanent failure with EXHAUSTED_RETRIES when attempt count reaches max attempts`.

- [ ] Write the adapter tests first against real Postgres transactions and isolate rows by unique scope prefixes.
- [ ] Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts`; expect failure because the port/adapter do not exist.
- [ ] Define and implement `enqueueOrReconcile`, `claimBatch`, `complete`, `fail`, `supersede`, `releaseForRetry`, `listWaitingScopes`, `listEligiblePositionScopes`, and `getById`. `listEligiblePositionScopes` reads distinct unexpired position evidence scopes for startup/internal backfill. `claimBatch` must select eligible IDs using `FOR UPDATE SKIP LOCKED` and update/return claims in one transaction. `releaseForRetry` evaluates `attempt_count` against `max_attempts` (default 5); if `attempt_count >= max_attempts`, it transitions status to `failed` with `errorCode: "EXHAUSTED_RETRIES"`, enforcing a strict retry budget and preventing infinite retries on poison pills. All terminal mutations include `WHERE id = ? AND lease_owner = ? AND status = 'processing'` and return a boolean.
- [ ] Re-run the Postgres test command and `pnpm exec eslint src/application/ports/positionPolicyInsightSynthesisQueuePort.ts src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts`; expect success and then the automatic typecheck gate.
- [ ] Commit with `git add src/application/ports/positionPolicyInsightSynthesisQueuePort.ts src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts && git commit -m "m79: lease position synthesis requests"`.

## Repository Targets

### Expected Files
- src/application/ports/positionPolicyInsightSynthesisQueuePort.ts
- src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts
- src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts

### Reference Files
- src/adapters/postgres/postgresPolicyInsightSynthesisTriggerAdapter.ts
- src/application/ports/policyInsightSynthesisTriggerPort.ts

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts
pnpm exec eslint src/application/ports/positionPolicyInsightSynthesisQueuePort.ts src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts src/adapters/postgres/__tests__/postgresPositionPolicyInsightSynthesisQueueAdapter.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **idempotent ready enqueue**: Replaying the final four-part identity returns the original request ID. (Test: `replaying an identical ready identity returns the original request id`)
- **lease exclusion and recovery**: Live leases are exclusive and expired processing leases are recoverable with an incremented attempt. (Test: `reclaims an expired processing lease and increments attempt count`)
- **owner guarded mutation**: Only the active owner can complete, fail, supersede, or retry a processing request. (Test: `only the current lease owner can complete fail supersede or release a request`)
- **retry budget enforcement**: Fails transient requests whose attempt count reaches max attempts with EXHAUSTED_RETRIES instead of releasing for retry indefinitely. (Test: `converts release for retry into permanent failure with EXHAUSTED_RETRIES when attempt count reaches max attempts`)

