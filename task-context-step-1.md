# Task Context: Task 1

Title: Validate canonical pair synthesis configuration
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

- Create: `src/workers/policyInsight/config.ts`
- Create: `src/workers/policyInsight/__tests__/config.test.ts`
- Reference: `src/workers/gecko/config.ts`
- Reference: `src/engine/marketRegime/config.ts`

- [ ] **Step 1: Write failing configuration tests.** Define exact tests named `rejects a missing canonical SOL/USDC pool address`, `rejects placeholder pool addresses`, `returns the canonical pair market selector`, and `validates positive poll lease retry intervals and max attempts budget`. Cover defaults of source `geckoterminal`, network `solana`, timeframe `1h`, a 5-second poll, a 60-second lease, a bounded retry interval no greater than the lease, and default `maxAttempts` of 5.
- [ ] **Step 2: Verify the focused test fails because the parser does not exist.** Run `pnpm exec vitest run src/workers/policyInsight/__tests__/config.test.ts`; expect module-resolution/test failures.
- [ ] **Step 3: Implement the typed parser.** Export `PolicyInsightSynthesisWorkerConfig` and `parsePolicyInsightSynthesisWorkerConfig(env)`. Require `CANONICAL_SOL_USDC_POOL_ADDRESS`, reject empty strings and `<`/`>` placeholders, keep source/network/timeframe as literal canonical values, and parse positive integer `POLICY_INSIGHT_SYNTHESIS_POLL_INTERVAL_MS`, `POLICY_INSIGHT_SYNTHESIS_LEASE_MS`, `POLICY_INSIGHT_SYNTHESIS_RETRY_MS`, and `POLICY_INSIGHT_SYNTHESIS_MAX_ATTEMPTS` (default 5) values. The returned config must contain a reusable `marketSelector` matching `SynthesizePolicyInsightInput["marketSelector"]` and positive `maxAttempts` budget.
- [ ] **Step 4: Run focused verification.** Run `pnpm exec vitest run src/workers/policyInsight/__tests__/config.test.ts` and `pnpm exec eslint src/workers/policyInsight/config.ts src/workers/policyInsight/__tests__/config.test.ts`; expect all checks to pass with zero warnings.
- [ ] **Step 5: Commit.** Commit as `m78: add pair synthesis worker configuration`.

## Repository Targets

### Expected Files
- src/workers/policyInsight/config.ts
- src/workers/policyInsight/__tests__/config.test.ts

### Reference Files
- src/workers/gecko/config.ts
- src/engine/marketRegime/config.ts
- src/application/use-cases/synthesizePolicyInsightUseCase.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","src/workers/policyInsight/__tests__/config.test.ts"]
["pnpm","exec","eslint","src/workers/policyInsight/config.ts","src/workers/policyInsight/__tests__/config.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **canonical market selector**: Valid configuration always selects geckoterminal, solana, the configured canonical pool, and the 1h regime timeframe. (Test: `returns the canonical pair market selector`)
- **invalid pool fails closed**: A missing, empty, or placeholder canonical pool address prevents worker startup. (Test: `rejects placeholder pool addresses`)
- **positive bounded timings and retry budget**: Poll, lease, and retry intervals are positive integers, retry delay does not exceed lease duration, and max attempts budget defaults to positive integer. (Test: `validates positive poll lease retry intervals and max attempts budget`)

