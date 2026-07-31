# Task Context: Task 6

Title: Wake the queue from evidence and plan persistence
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

- Modify: `src/application/use-cases/ingestEvidenceBundleUseCase.ts`
- Modify: `src/application/use-cases/generatePlanUseCase.ts`
- Modify: `src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/generatePlanUseCase.test.ts`
- Modify: `src/adapters/http/handlers/evidenceIngest.ts`
- Modify: `src/adapters/http/handlers/plan.ts`
- Create: `src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts`
- Create: `src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts`
- Modify: `src/composition/buildApplication.ts`
- Create: `src/composition/__tests__/positionPolicyInsightWiring.test.ts`

**Exported API changes:** Add an optional position-synthesis requester dependency to `createIngestEvidenceBundleUseCase` and `GeneratePlanUseCaseDeps`; extend `ApplicationDependencies` with the plan reader, queue, and requester. The optional dependency preserves SQLite-only operation, while Postgres composition always supplies it.

**Behavioral invariants / tests written first:**

- `new and idempotently replayed position evidence both wake reconciliation`.
- `non-position evidence never wakes the position queue`.
- `a persisted plan with wallet identity wakes reconciliation after SQLite commit`.
- `a plan without wallet identity remains valid but cannot form a position evidence scope`.
- `a queue outage after source persistence returns a retryable 503 and replay closes the wake-up gap`.
- `SQLite-only composition retains plan and evidence behavior without a queue`.

- [ ] Add the named tests to the existing small use-case test files and new focused handler/composition files. Do not add more cases to the existing 674-line evidence-ingest handler test.
- [ ] Run `pnpm exec vitest run src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts src/application/use-cases/__tests__/generatePlanUseCase.test.ts src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts src/composition/__tests__/positionPolicyInsightWiring.test.ts`; expect failures for missing wake-ups/wiring.
- [ ] Invoke reconciliation after `append` for both `created` and `already_ingested` position evidence. Invoke it after `writePlan` only when `position.walletId` exists, constructing the exact `solana-mainnet` position scope from request fields. Map structured queue/store unavailability to a sanitized 503 in both handlers so clients can safely replay already-persisted source data.
- [ ] Wire one SQLite read adapter and one Postgres queue adapter/requester in `buildApplication`; expose null requester/queue when Postgres is absent. Do not change `PlanLedgerWritePort.writePlan` or add a port method without its adapter.
- [ ] Re-run the targeted tests and `pnpm exec eslint src/application/use-cases/ingestEvidenceBundleUseCase.ts src/application/use-cases/generatePlanUseCase.ts src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts src/application/use-cases/__tests__/generatePlanUseCase.test.ts src/adapters/http/handlers/evidenceIngest.ts src/adapters/http/handlers/plan.ts src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts src/composition/buildApplication.ts src/composition/__tests__/positionPolicyInsightWiring.test.ts`; expect success and the automatic typecheck gate.
- [ ] Commit the task files with `git commit -m "m79: enqueue position synthesis from source writes"`.

## Repository Targets

### Expected Files
- src/application/use-cases/ingestEvidenceBundleUseCase.ts
- src/application/use-cases/generatePlanUseCase.ts
- src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts
- src/application/use-cases/__tests__/generatePlanUseCase.test.ts
- src/adapters/http/handlers/evidenceIngest.ts
- src/adapters/http/handlers/plan.ts
- src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts
- src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts
- src/composition/buildApplication.ts
- src/composition/__tests__/positionPolicyInsightWiring.test.ts

### Reference Files
- src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts
- src/adapters/sqlite/sqlitePlanLedgerReadAdapter.ts
- src/adapters/postgres/postgresPositionPolicyInsightSynthesisQueueAdapter.ts

## Validation Commands

```bash
pnpm exec vitest run src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts src/application/use-cases/__tests__/generatePlanUseCase.test.ts src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts src/composition/__tests__/positionPolicyInsightWiring.test.ts
pnpm exec eslint src/application/use-cases/ingestEvidenceBundleUseCase.ts src/application/use-cases/generatePlanUseCase.ts src/application/use-cases/__tests__/ingestEvidenceBundleUseCase.test.ts src/application/use-cases/__tests__/generatePlanUseCase.test.ts src/adapters/http/handlers/evidenceIngest.ts src/adapters/http/handlers/plan.ts src/adapters/http/handlers/__tests__/evidenceIngest.positionSynthesis.test.ts src/adapters/http/__tests__/plan.positionSynthesis.e2e.test.ts src/composition/buildApplication.ts src/composition/__tests__/positionPolicyInsightWiring.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **evidence replay repairs wakeup**: Both newly created and idempotently replayed position evidence invoke reconciliation after persistence. (Test: `new and idempotently replayed position evidence both wake reconciliation`)
- **plan wakeup ordering**: A wallet-identified plan invokes reconciliation only after its SQLite transaction commits. (Test: `a persisted plan with wallet identity wakes reconciliation after SQLite commit`)
- **queue outage replay contract**: A post-persistence queue outage is retryable and a replay can recreate the missing wake-up. (Test: `a queue outage after source persistence returns a retryable 503 and replay closes the wake-up gap`)

