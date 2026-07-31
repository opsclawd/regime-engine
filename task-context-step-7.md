# Task Context: Task 7

Title: Prove pair evidence, replay safety, and HTTP isolation end to end
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

- Create: `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`
- Modify: `package.json`
- Reference: `src/adapters/http/handlers/evidenceIngest.ts`
- Reference: `src/application/use-cases/ingestEvidenceBundleUseCase.ts`
- Reference: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Reference: `src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts`
- Reference: `contracts/evidence-bundle/v1/fixtures/valid/deterministic-only.json`

- [ ] **Step 1: Write the Postgres end-to-end tests first.** Add exact cases `backfills the newest pre-existing pair evidence into current insight`, `current pair insight includes selected lineage from pair evidence`, `coalesces two created receipts into one latest-input synthesis`, `duplicate evidence replay creates neither a new claim nor a duplicate insight`, `overlapping synthesis attempts converge on one synthesis input hash`, and `created evidence still returns 201 while the worker later records a transient synthesis failure`.
- [ ] **Step 2: Verify the new suite fails before final wiring.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`; expect failures until the migration, adapter, worker, candles, evidence, and current endpoint are composed in the fixture.
- [ ] **Step 3: Build deterministic fixtures.** Insert enough canonical 15-minute candle revisions for the existing 1-hour regime path, ingest valid pair-safe evidence through the real HTTP route, run the real cycle with a fixed clock, and read `GET /v1/insights/sol-usdc/current` without query parameters. Assert included lineage/evidence coverage rather than merely asserting `200`.
- [ ] **Step 4: Cover replay and isolation.** Replay the identical evidence run and assert the original receipt, no new claim, one `policy_insights` row for the synthesis input hash, and stable insight ID. Inject a temporarily unavailable regime/synthesis dependency after a created ingest response and assert the HTTP response remains `201` while cursor state remains retryable.
- [ ] **Step 5: Register the focused PG suite.** Add the new test path to `test:pg` without removing any existing paths.
- [ ] **Step 6: Run focused verification.** Run `DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts` and `pnpm exec eslint src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`; expect every acceptance test to pass. A skip caused by missing `DATABASE_URL` is not acceptance evidence.
- [ ] **Step 7: Commit.** Commit as `m78: verify pair insight trigger end to end`.

## Tests to add or update

- Unit config validation in `src/workers/policyInsight/__tests__/config.test.ts`.
- Postgres migration constraints and startup verification in `src/ledger/pg/__tests__/policyInsightSynthesisCursorMigration.test.ts` and `src/__tests__/pgStartup.test.ts`.
- Postgres state-transition and concurrency tests in `src/adapters/postgres/__tests__/postgresPolicyInsightSynthesisTriggerAdapter.test.ts`.
- Pure cycle classification/logging tests in `src/workers/policyInsight/__tests__/runSynthesisCycle.test.ts`.
- Loop, shutdown, composition, and backfill dispatch tests in `src/workers/__tests__/policyInsightSynthesisWorker.test.ts`.
- Postgres end-to-end acceptance coverage in `src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts`.
- Do not expand the 674-line `src/adapters/http/handlers/__tests__/evidenceIngest.test.ts`; the new worker E2E suite proves isolation without adding another oversized test-update task.

## Validation commands

After all implementation tasks, the dedicated validation phase should run exactly:

```bash
pnpm run typecheck
pnpm run test
pnpm run lint
pnpm run build
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run db:migrate
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run test:pg
docker compose -f docker-compose.test.yml down
```

The implementer must also perform the documented one-shot smoke check with valid local configuration:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false CANONICAL_SOL_USDC_POOL_ADDRESS=PoolTest111 pnpm run backfill:pair-insights
```

Expected result: structured `succeeded` or `idle`, never an unhandled rejection; after seeded pair evidence and candles, the current pair endpoint returns an insight whose selected lineage includes that evidence.

## Risk areas

- Lease correctness: a stale worker must not advance or release a claim owned by a newer worker.
- Poison evidence: permanent classification must be narrow enough not to discard recoverable infrastructure failures, but must prevent a structurally invalid receipt from blocking all newer evidence.
- Coalescing semantics intentionally synthesize only the newest pending pair receipt; older receipts remain in the append-only evidence history but do not each create an insight.
- The canonical pool must exactly match candle ingestion; a syntactically valid but wrong pool causes persistent missing-regime retries.
- A lease can expire during slow synthesis. The policy repository's unique synthesis fingerprint is therefore still required to converge overlapping attempts.
- Migration metadata must match the hand-authored SQL/schema and remain forward-only in production.
- Worker deployment is operationally required. Shipping code without enabling the synthesis-worker service leaves the cursor untouched, although explicit backfill remains available.
- Pair safety is an upstream trust boundary. Regime Engine uses scope-exact selection and must not reinterpret position evidence as pair evidence.

## Stop conditions

- Stop if the companion publisher does not produce a contract-valid `scope.kind: "pair"` bundle containing only pair-safe data; do not substitute position evidence or a market-only insight.
- Stop if the production canonical SOL/USDC pool address cannot be confirmed against the candle collector configuration.
- Stop if the cursor migration cannot be applied additively or Drizzle metadata disagrees with the SQL; do not edit production migration history or drop data.
- Stop if Postgres transition tests cannot exercise a real database; skipped tests are not enough to approve lease/cursor behavior.
- Stop if the existing `synthesisInputHash` uniqueness/replay tests regress, because lease expiry can otherwise create duplicate insights.
- Stop if implementing the trigger would require awaiting synthesis from `evidenceIngest.ts` or changing a created ingest response based on worker health.
- Stop if transient failure handling advances the cursor without reaching max attempts, or if retries exceed max attempts without converting to permanent failure and advancing.
- Stop if the no-parameter current endpoint returns `200` but the resulting insight has empty selected lineage despite valid fresh pair evidence; that is the degraded behavior this issue forbids.

## Repository Targets

### Expected Files
- src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts
- package.json

### Reference Files
- src/adapters/http/handlers/evidenceIngest.ts
- src/application/use-cases/ingestEvidenceBundleUseCase.ts
- src/application/use-cases/synthesizePolicyInsightUseCase.ts
- src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts
- contracts/evidence-bundle/v1/fixtures/valid/deterministic-only.json

## Validation Commands

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts
["pnpm","exec","eslint","src/workers/__tests__/policyInsightSynthesis.e2e.pg.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **historical evidence informed current insight**: One cycle over pre-existing pair-safe evidence produces a no-query current pair insight whose included lineage identifies that evidence. (Test: `current pair insight includes selected lineage from pair evidence`)
- **duplicate ingest idempotency**: An identical evidence replay creates no second receipt claim or policy insight row after the cursor is current. (Test: `duplicate evidence replay creates neither a new claim nor a duplicate insight`)
- **overlapping attempt convergence**: If lease overlap causes two synthesis attempts over identical inputs, repository replay detection converges on one synthesis input hash and insight ID. (Test: `overlapping synthesis attempts converge on one synthesis input hash`)
- **HTTP response isolation**: A committed pair evidence request returns 201 before a later worker failure is recorded as retryable. (Test: `created evidence still returns 201 while the worker later records a transient synthesis failure`)
- **latest receipt coalescing**: Two created pair receipts pending before the cycle result in one synthesis attempt based on selection after the highest receipt. (Test: `coalesces two created receipts into one latest-input synthesis`)

