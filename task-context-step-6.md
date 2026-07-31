# Task Context: Task 6

Title: Add explicit backfill and deployment wiring
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

- Create: `scripts/backfill-pair-insights.ts`
- Modify: `src/workers/__tests__/policyInsightSynthesisWorker.test.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `scripts/start.sh`
- Modify: `scripts/predeploy.sh`
- Modify: `docs/runbooks/railway-deploy.md`
- Reference: `src/workers/policyInsightSynthesisWorker.ts`
- Reference: `src/workers/policyInsight/runSynthesisCycle.ts`

- [ ] **Step 1: Write script-level contract tests in the existing worker test file.** Keep executable dispatch behind small exported functions and add the exact cases `backfill exits zero after success or idle`, `backfill exits nonzero after transient failure`, and `service dispatch starts the synthesis worker only for synthesis-worker service type`.
- [ ] **Step 2: Implement the one-shot backfill command.** Compose the same config, store, trigger adapter, and synthesis use case as the worker; run exactly one cycle (which selects the newest historical pair receipt when the cursor is absent); emit a structured result; close resources in `finally`; return nonzero for transient/fatal setup failures. Do not reset or rewind an existing cursor.
- [ ] **Step 3: Add package and shell dispatch.** Add `dev:policy-insights`, `start:policy-insights`, and `backfill:pair-insights` scripts. Extend `scripts/start.sh` with explicit `api`, `collector`, and `synthesis-worker` cases and reject unknown service types. Ensure `scripts/predeploy.sh` skips migrations only for the collector, while API/synthesis-worker deployments still use the shared migration history safely.
- [ ] **Step 4: Document configuration and rollout.** Add the canonical pool, polling, lease, retry, and max attempts (`POLICY_INSIGHT_SYNTHESIS_MAX_ATTEMPTS`) variables to `.env.example`. Extend the Railway runbook with a synthesis-worker service, its health check, the explicit `pnpm run backfill:pair-insights` deployment command, log fields, a current-insight smoke check, restart recovery, and forward-only rollback guidance. State that the companion pair-safe publisher must be live before enabling the worker.
- [ ] **Step 5: Run focused verification.** Run `pnpm exec vitest run src/workers/__tests__/policyInsightSynthesisWorker.test.ts`, `pnpm exec eslint scripts/backfill-pair-insights.ts src/workers/policyInsightSynthesisWorker.ts`, `pnpm exec prettier --check package.json .env.example scripts/start.sh scripts/predeploy.sh docs/runbooks/railway-deploy.md`, and `bash -n scripts/start.sh scripts/predeploy.sh`; expect all checks to pass.
- [ ] **Step 6: Commit.** Commit as `m78: wire policy insight backfill deployment`.

## Repository Targets

### Expected Files
- scripts/backfill-pair-insights.ts
- src/workers/__tests__/policyInsightSynthesisWorker.test.ts
- package.json
- .env.example
- scripts/start.sh
- scripts/predeploy.sh
- docs/runbooks/railway-deploy.md

### Reference Files
- src/workers/policyInsightSynthesisWorker.ts
- src/workers/policyInsight/runSynthesisCycle.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","src/workers/__tests__/policyInsightSynthesisWorker.test.ts"]
["pnpm","exec","eslint","scripts/backfill-pair-insights.ts","src/workers/policyInsightSynthesisWorker.ts"]
["pnpm","exec","prettier","--check","package.json",".env.example","scripts/start.sh","scripts/predeploy.sh","docs/runbooks/railway-deploy.md"]
["bash","-n","scripts/start.sh","scripts/predeploy.sh"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **one shot backfill**: Backfill runs one durable cycle and exits zero only for success or idle, without rewinding an existing cursor. (Test: `backfill exits zero after success or idle`)
- **backfill failure signal**: Transient processing or fatal setup failure closes resources and produces a nonzero exit status. (Test: `backfill exits nonzero after transient failure`)
- **explicit service dispatch**: Only synthesis-worker service type starts the synthesis loop; collector and API keep their existing entry points and unknown types fail closed. (Test: `service dispatch starts the synthesis worker only for synthesis-worker service type`)

