# Task Context: Task 8

Title: Process position requests with structured retry and supersession
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

- Create: `src/workers/policyInsight/runPositionSynthesisCycle.ts`
- Create: `src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts`

**Exported API changes:** Add `runPositionPolicyInsightSynthesisCycle`, its dependencies, and discriminated result type.

**Behavioral invariants / tests written first:**

- `returns idle when no request can be claimed`.
- `loads the exact plan by hash and completes one matching request`.
- `supersedes a claim when a newer eligible plan exists`.
- `supersedes a claim when recomputed selectionHash differs`.
- `fails missing plan invalid hash stale evidence and scope mismatch with their structured codes`.
- `retries market evidence and policy store outages without inspecting messages`.
- `fails a transient request after the configured retry budget is exhausted`.
- `returns lease_lost when a stale worker cannot mutate the claimed request`.

- [ ] Write one test per invariant with fake queue/read/synthesis ports and error messages deliberately unrelated to classification.
- [ ] Run `pnpm exec vitest run src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts`; expect the missing cycle failure.
- [ ] Claim a bounded batch, compare each claim with `getLatestPositionPlan` and `getPositionPlanByHash`, then call synthesis with exact `positionPlan` and `expectedSelectionHash`. Switch only on `error.errorCode`: validation codes fail, `EVIDENCE_SELECTION_SUPERSEDED` or newer plans supersede, and unavailable codes retry with capped attempts. All logs contain request/scope/hash/attempt/duration but no raw payload or secret.
- [ ] Re-run the targeted test and `pnpm exec eslint src/workers/policyInsight/runPositionSynthesisCycle.ts src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts`; expect success and the automatic typecheck gate.
- [ ] Commit with `git add src/workers/policyInsight/runPositionSynthesisCycle.ts src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts && git commit -m "m79: process position synthesis requests"`.

## Repository Targets

### Expected Files
- src/workers/policyInsight/runPositionSynthesisCycle.ts
- src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts

### Reference Files
- src/workers/policyInsight/runSynthesisCycle.ts
- src/workers/policyInsight/config.ts
- src/application/use-cases/synthesizePolicyInsightUseCase.ts

## Validation Commands

```bash
pnpm exec vitest run src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts
pnpm exec eslint src/workers/policyInsight/runPositionSynthesisCycle.ts src/workers/policyInsight/__tests__/runPositionSynthesisCycle.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **exact claimed identity**: The worker loads the claimed plan hash and selected evidence hash before completing. (Test: `loads the exact plan by hash and completes one matching request`)
- **newer plan supersession**: A claim for a plan older than the latest eligible plan is superseded without synthesis. (Test: `supersedes a claim when a newer eligible plan exists`)
- **code based retry**: Only structured unavailable codes retry; messages do not affect classification. (Test: `retries market evidence and policy store outages without inspecting messages`)
- **stale owner containment**: A lost lease prevents completion and returns lease_lost. (Test: `returns lease_lost when a stale worker cannot mutate the claimed request`)

