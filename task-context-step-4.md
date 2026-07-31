# Task Context: Task 4

Title: Implement one pair synthesis cycle and failure classification
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

- Create: `src/workers/policyInsight/runSynthesisCycle.ts`
- Create: `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`
- Reference: `src/application/ports/policyInsightSynthesisTriggerPort.ts`
- Reference: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Reference: `src/application/errors/policyInsightErrors.ts`
- Reference: `src/application/errors/evidenceErrors.ts`
- Reference: `src/application/errors/regimeErrors.ts`
- Reference: `src/workers/gecko/logger.ts`

- [ ] **Step 1: Write failing cycle tests.** Add exact cases `returns idle without calling synthesis when no receipt is claimable`, `synthesizes pair scope with the canonical market selector`, `logs required identifiers and duration before completing success`, `classifies validation failure as permanent and advances the cursor`, `classifies store and regime availability failures as transient without advancing when below max attempts`, `converts transient failure to permanent failure when attempt count reaches max attempts budget`, `classifies an unknown operational error as transient`, and `does not advance when completion compare-and-set loses ownership`.
- [ ] **Step 2: Verify the tests fail.** Run `pnpm exec vitest run src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`; expect the cycle module to be missing.
- [ ] **Step 3: Implement `runPolicyInsightSynthesisCycle`.** Inject the trigger port, `SynthesizePolicyInsightUseCase`, config, logger, stable `leaseOwner`, and clock. Capture start time, claim once, call synthesis exactly once with `{ scope: { kind: "pair" }, marketSelector, positionPlan: null }`, and return a discriminated result `idle | succeeded | permanent_failure | transient_failure | lease_lost` for testability.
- [ ] **Step 4: Implement explicit failure classification, retry budget enforcement, and safe logging.** Treat `PolicyInsightValidationError` and invalid canonical configuration as permanent; treat policy/evidence store unavailability, regime/candle availability errors, and unknown runtime errors as transient when `claim.attemptCount < config.maxAttempts`. When a transient failure occurs and `claim.attemptCount >= config.maxAttempts`, convert the outcome to permanent failure, log that the retry budget (`maxAttempts`) was exhausted for `receiptId`, and invoke `triggerPort.complete` with outcome `permanent_failure` to advance past the poison receipt. Log `receiptId`, `scope: "pair"`, `synthesisInputHash` and `insightId` from the successful read model, `durationMs`, `attemptCount`, outcome, and sanitized error code/message. Never log evidence payloads, tokens, or database URLs.
- [ ] **Step 5: Run focused verification.** Run `pnpm exec vitest run src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts` and `pnpm exec eslint src/workers/policyInsight/runSynthesisCycle.ts src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`; expect pass/zero warnings.
- [ ] **Step 6: Commit.** Commit as `m78: synthesize pair insights from durable claims`.

## Repository Targets

### Expected Files
- src/workers/policyInsight/runSynthesisCycle.ts
- src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts

### Reference Files
- src/application/ports/policyInsightSynthesisTriggerPort.ts
- src/application/use-cases/synthesizePolicyInsightUseCase.ts
- src/application/errors/policyInsightErrors.ts
- src/application/errors/evidenceErrors.ts
- src/application/errors/regimeErrors.ts
- src/workers/gecko/logger.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts"]
["pnpm","exec","eslint","src/workers/policyInsight/runSynthesisCycle.ts","src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **idle performs no synthesis**: When claim returns no receipt, the cycle returns idle and never invokes synthesis or cursor completion. (Test: `returns idle without calling synthesis when no receipt is claimable`)
- **pair-only synthesis input**: Every claim invokes synthesis once with pair scope, canonical selector, and no position plan. (Test: `synthesizes pair scope with the canonical market selector`)
- **success logs and completes**: A successful insight logs receipt scope hash insight ID and duration before applying successful completion. (Test: `logs required identifiers and duration before completing success`)
- **permanent poison receipt advancement**: A policy validation failure is recorded as permanent and advances past the target so newer evidence is not blocked. (Test: `classifies validation failure as permanent and advances the cursor`)
- **operational failures retry**: Store regime candle and unknown operational failures preserve the cursor and release the lease for a later retry while attempt count is below max attempts budget. (Test: `classifies store and regime availability failures as transient without advancing when below max attempts`)
- **retry budget exhaustion advances cursor**: When attempt count reaches max attempts budget, transient failures are converted to permanent failure and advance the cursor. (Test: `converts transient failure to permanent failure when attempt count reaches max attempts budget`)

