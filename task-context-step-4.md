# Task Context: Task 4

Title: Wire and prove active-store selection without fallback
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-55
Repository: opsclawd/regime-engine
Branch: ai/issue-55
Start Commit: bbd4e0d6cb492a7e4ed4cbcc6a2f59e1161aaeea

## Task Requirements

**Files:**

- Create: `src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts`
- Create: `src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts`
- Modify: `package.json`

**Exported API change:** (none — composition root wiring was updated in Task 3)

**Invariants to test first:**

- `uses SQLite canonical candles when DATABASE_URL is absent`
- `uses PostgreSQL canonical candles when DATABASE_URL is configured`
- `ignores conflicting SQLite candles when PostgreSQL is the active candle store`
- `does not fall back to SQLite when the active PostgreSQL feed is empty`

- [ ] **Step 1: Write the SQLite composition regression.** Create an isolated SQLite ledger, write a plan request/plan plus canonical revisions through the SQLite candle writer, build `RuntimeStoreContext` with `pg: null`, and call the composed weekly use case. Assert non-flat HODL/DCA values derived from those revisions and unchanged report envelope fields.

- [ ] **Step 2: Write the conditional PostgreSQL composition regressions.** Use `describe.skipIf(!process.env.DATABASE_URL)`, a unique feed key, SQLite plan facts, and PostgreSQL candle revisions. Seed conflicting SQLite closes that would yield visibly different baselines; assert only PostgreSQL prices win. In a separate test leave the PostgreSQL feed empty while SQLite has rows and assert flat SOL baselines, proving no fallback. Clean up only the unique PostgreSQL rows and close both stores in `finally`/hooks.

- [ ] **Step 3: Run the focused tests against the composed application.** The composition root was updated in Task 3, so these tests validate the new wiring:

  ```bash
  pnpm exec vitest run src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts
  DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts
  ```

  Expected before implementation: dependency-shape/type failures or PostgreSQL authority assertions fail.

- [ ] **Step 4: Add the PostgreSQL composition suite to `test:pg` and run scoped acceptance checks.**

  ```bash
  pnpm exec vitest run src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts
  DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts
  pnpm exec eslint src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts
  ```

  Expected: SQLite-only, PostgreSQL authority, conflicting-SQLite, and empty-active-store cases pass.

- [ ] **Step 5: Commit the composition proof.**

  ```bash
  git add src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts package.json
  git commit -m "m55: wire weekly reports to the active candle store"
  ```

## Repository Targets

### Expected Files
- src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts
- src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts
- package.json

## Validation Commands

```bash
pnpm exec vitest run src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts
pnpm exec eslint src/composition/buildApplication.ts src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **SQLite local authority**: Without DATABASE_URL, the composed report reads baseline candles from the same SQLite candle adapter used by regime and plan paths. (Test: `uses SQLite canonical candles when DATABASE_URL is absent`)
- **PostgreSQL deployed authority**: With DATABASE_URL configured, the composed report derives baselines from PostgreSQL candle rows while report facts remain in SQLite. (Test: `uses PostgreSQL canonical candles when DATABASE_URL is configured`)
- **conflicting SQLite data ignored**: When PostgreSQL is active, conflicting SQLite candle prices cannot change report baselines. (Test: `ignores conflicting SQLite candles when PostgreSQL is the active candle store`)
- **no empty-source fallback**: When the active PostgreSQL feed returns no rows, SQLite candle rows are not consulted and SOL baselines remain at initial NAV. (Test: `does not fall back to SQLite when the active PostgreSQL feed is empty`)

