# Task Context: Task 5

Title: Reconcile evidence and plans into canonical queue identities
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

- Create: `src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts`
- Create: `src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts`

**Exported API changes:** Add `RequestPositionPolicyInsightSynthesisUseCase`, its input/result types, and `createRequestPositionPolicyInsightSynthesisUseCase`.

**Behavioral invariants / tests written first:**

- `evidence without a plan returns waiting_for_plan with a durable request id`.
- `plan without evidence returns waiting_for_evidence with a durable request id`.
- `matching evidence and plan enqueue the exact scope selection plan and ruleset identity`.
- `duplicate reconciliation returns the same request id`.
- `two positions sharing one intelligence correlation reconcile independently`.
- `an expired waiting evidence request fails with POSITION_STALE when a plan arrives`.
- `a newer plan creates a distinct ready identity and leaves the older request eligible for supersession`.
- `wallet position pool or five minute skew mismatches never become pending`.

- [ ] Build fakes for the queue, evidence repository, plan ledger reader, clock, and selector; write every invariant as an exact test name before implementation.
- [ ] Run `pnpm exec vitest run src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts`; expect the missing use case failure.
- [ ] Implement a use case that accepts a concrete position scope plus wake-up identity, loads the latest exact plan, reads latest evidence with the plan's inclusive five-minute bounds when possible, filters expired records, runs the existing pure selector, computes `selectionHash`, and calls `enqueueOrReconcile`. Return `{requestId, status, selectionHash, planHash, freshEvidenceRequired}` without synthesizing inline. For startup mode, reconcile the union of `listWaitingScopes`, currently unexpired position scopes supplied by the queue adapter, and `listLatestPositionPlans`; a plan-only scope becomes `waiting_for_evidence` with `freshEvidenceRequired: true` so deployment automation must initiate a fresh upstream intelligence run rather than silently declaring backfill complete.
- [ ] Re-run the targeted test and `pnpm exec eslint src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts`; expect success and then the automatic typecheck gate.
- [ ] Commit with `git add src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts && git commit -m "m79: reconcile position synthesis inputs"`.

## Repository Targets

### Expected Files
- src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts
- src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts

### Reference Files
- src/application/ports/positionPolicyInsightSynthesisQueuePort.ts
- src/application/ports/planLedgerPort.ts
- src/application/ports/evidenceBundleRepositoryPort.ts
- src/engine/evidence/selectEvidence.ts
- src/engine/policy/ruleset.ts

## Validation Commands

```bash
pnpm exec vitest run src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts
pnpm exec eslint src/application/use-cases/requestPositionPolicyInsightSynthesisUseCase.ts src/application/use-cases/__tests__/requestPositionPolicyInsightSynthesisUseCase.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **evidence first**: Evidence without a plan remains durable and promotes when a compatible plan arrives. (Test: `evidence without a plan returns waiting_for_plan with a durable request id`)
- **plan first**: A plan without evidence remains durable and promotes when compatible evidence arrives. (Test: `plan without evidence returns waiting_for_evidence with a durable request id`)
- **expired waiting evidence**: Evidence that expires before its plan can arrive transitions permanently to POSITION_STALE. (Test: `an expired waiting evidence request fails with POSITION_STALE when a plan arrives`)
- **new plan identity**: A newer plan against unchanged selected evidence produces a distinct ready identity. (Test: `a newer plan creates a distinct ready identity and leaves the older request eligible for supersession`)

