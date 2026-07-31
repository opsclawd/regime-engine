# Task Context: Task 5

Title: Add the restart-safe polling worker process
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

- Create: `src/workers/policyInsightSynthesisWorker.ts`
- Create: `src/workers/__tests__/policyInsightSynthesisWorker.test.ts`
- Reference: `src/composition/buildStoreContext.ts`
- Reference: `src/composition/buildApplication.ts`
- Reference: `src/workers/geckoCollector.ts`
- Reference: `src/workers/policyInsight/runSynthesisCycle.ts`

- [ ] **Step 1: Write failing loop and lifecycle tests.** Add exact cases `runs a synthesis cycle immediately before the first sleep`, `continues polling after a transient cycle result`, `continues polling after an unexpected cycle throw`, `stops without another claim after abort`, `removes installed signal handlers on shutdown`, `fails startup without postgres-backed synthesis dependencies`, and `closes the store context exactly once`.
- [ ] **Step 2: Verify the tests fail.** Run `pnpm exec vitest run src/workers/__tests__/policyInsightSynthesisWorker.test.ts`; expect the worker module to be missing.
- [ ] **Step 3: Implement the polling loop.** Export `runPolicyInsightSynthesisWorker(config?, deps?)`, use an abort-aware sleep, run immediately, then poll at the configured interval. Cycle errors must be logged and followed by another poll unless aborted. Use a UUID/process-unique lease owner and install/remove SIGTERM/SIGINT listeners only when the worker owns its controller.
- [ ] **Step 4: Compose production dependencies.** In main-module execution, build the store context and application, require Postgres plus `synthesizePolicyInsight`, construct the Postgres trigger adapter and cycle, expose a minimal `/health` server for Railway, and close both health server and store context on shutdown or fatal startup. Do not register or call the evidence HTTP handler.
- [ ] **Step 5: Run focused verification.** Run `pnpm exec vitest run src/workers/__tests__/policyInsightSynthesisWorker.test.ts` and `pnpm exec eslint src/workers/policyInsightSynthesisWorker.ts src/workers/__tests__/policyInsightSynthesisWorker.test.ts`; expect pass/zero warnings.
- [ ] **Step 6: Commit.** Commit as `m78: run durable policy insight synthesis worker`.

## Repository Targets

### Expected Files
- src/workers/policyInsightSynthesisWorker.ts
- src/workers/__tests__/policyInsightSynthesisWorker.test.ts

### Reference Files
- src/composition/buildStoreContext.ts
- src/composition/buildApplication.ts
- src/workers/geckoCollector.ts
- src/workers/policyInsight/runSynthesisCycle.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","src/workers/__tests__/policyInsightSynthesisWorker.test.ts"]
["pnpm","exec","eslint","src/workers/policyInsightSynthesisWorker.ts","src/workers/__tests__/policyInsightSynthesisWorker.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **immediate startup recovery**: The worker performs one claim cycle before its first polling sleep, allowing restart recovery and startup backfill. (Test: `runs a synthesis cycle immediately before the first sleep`)
- **recoverable loop continuity**: Transient results and unexpected cycle throws are logged and followed by another poll while not aborted. (Test: `continues polling after an unexpected cycle throw`)
- **clean shutdown**: Abort or process signal prevents another claim, removes owned listeners, and closes resources exactly once. (Test: `closes the store context exactly once`)
- **postgres dependency required**: The synthesis worker refuses to start without Postgres-backed trigger and synthesis dependencies. (Test: `fails startup without postgres-backed synthesis dependencies`)

