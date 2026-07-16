# Task Context: Task 1

Title: Add the canonical feed-window candle read to every adapter

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

- Modify: `src/application/ports/candlePorts.ts`
- Modify: `src/adapters/sqlite/sqliteCandleReadAdapter.ts`
- Modify: `src/adapters/postgres/postgresCandleReadAdapter.ts`
- Modify: `src/application/use-cases/__tests__/fakes/fakeCandleReadPort.ts`
- Create: `src/adapters/sqlite/__tests__/sqliteCandleReadAdapter.test.ts`
- Create: `src/adapters/postgres/__tests__/postgresCandleReadAdapter.test.ts`
- Modify: `package.json`
- Modify: `src/composition/buildApplication.ts`

**Exported API change:** Add required `CandleReadPort.getCandlesForFeedWindow(params)` and export its parameter shape from `candlePorts.ts`. The port, SQLite adapter, PostgreSQL adapter, and test fake are deliberately in this same task so the workspace-wide typecheck gate never sees a port-only state.

**Invariants to test first:**

- `returns only the complete feed key within inclusive bounds in ascending order`
- `returns the newest revision per slot and uses id as the tie breaker`
- `returns an empty array when the feed window has no rows`

- [ ] **Step 1: Write equivalent failing adapter contract tests.** Seed rows that vary one field at a time across symbol, source, network, pool address, and timeframe; include rows immediately below, at, and above both bounds; include two revisions of one slot plus equal-recorded-at rows inserted in a known order. Assert full OHLCV rows, not just closes. The PostgreSQL suite must use `describe.skipIf(!process.env.DATABASE_URL)`, unique feed values, and cleanup only its seeded keys.

- [ ] **Step 2: Run the focused tests and confirm the missing method is the failure.**

  ```bash
  pnpm exec vitest run src/adapters/sqlite/__tests__/sqliteCandleReadAdapter.test.ts
  DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresCandleReadAdapter.test.ts
  ```

  Expected before implementation: TypeScript/runtime failure because `getCandlesForFeedWindow` is absent. If PostgreSQL is unavailable, record that environment limitation; do not weaken or remove the conditional suite.

- [ ] **Step 3: Add the port input and required method.** Use the complete logical key and explicit lower/upper bounds:

  ```ts
  export interface GetCandlesForFeedWindowParams extends CandleFeed {
    fromUnixMs: number;
    closedCandleCutoffUnixMs: number;
  }

  export interface CandleReadPort {
    getLatestCandlesForFeed(params: GetLatestCandlesParams): Promise<CandleRow[]>;
    getCandlesForFeedWindow(params: GetCandlesForFeedWindowParams): Promise<CandleRow[]>;
  }
  ```

- [ ] **Step 4: Implement the SQLite query.** Reuse a private `RawRow` mapper. The query must filter all feed columns and `unix_ms >= ? AND unix_ms <= ?`, rank revisions with `row_number() OVER (PARTITION BY unix_ms ORDER BY source_recorded_at_unix_ms DESC, id DESC)`, retain `rn = 1`, and finish with `ORDER BY unix_ms ASC`. Do not call `getLatestCandlesForFeed` with a guessed limit.

- [ ] **Step 5: Implement the PostgreSQL query with identical semantics.** Keep the qualified `regime_engine.candle_revisions` table and numeric null checks. Extract the current row conversion to a private mapper so latest-N and window reads cannot drift in their result shape.

- [ ] **Step 6: Extend `FakeCandleReadPort`.** Track window calls separately and filter configured rows by inclusive lower and upper bounds without applying a limit. Preserve the current latest-N behavior and provide a configured error hook needed by Task 3.

- [ ] **Step 7: Add both focused PostgreSQL test paths to `test:pg`, then run scoped acceptance checks.**

  ```bash
  pnpm exec vitest run src/adapters/sqlite/__tests__/sqliteCandleReadAdapter.test.ts
  DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresCandleReadAdapter.test.ts
  pnpm exec eslint src/application/ports/candlePorts.ts src/adapters/sqlite/sqliteCandleReadAdapter.ts src/adapters/postgres/postgresCandleReadAdapter.ts src/application/use-cases/__tests__/fakes/fakeCandleReadPort.ts src/adapters/sqlite/__tests__/sqliteCandleReadAdapter.test.ts src/adapters/postgres/__tests__/postgresCandleReadAdapter.test.ts
  ```

  Expected: all available focused tests pass and ESLint reports zero warnings.

- [ ] **Step 8: Commit the atomic port-and-adapters change.**

  ```bash
  git add src/application/ports/candlePorts.ts src/adapters/sqlite/sqliteCandleReadAdapter.ts src/adapters/postgres/postgresCandleReadAdapter.ts src/application/use-cases/__tests__/fakes/fakeCandleReadPort.ts src/adapters/sqlite/__tests__/sqliteCandleReadAdapter.test.ts src/adapters/postgres/__tests__/postgresCandleReadAdapter.test.ts package.json
  git commit -m "m55: add canonical candle window reads"
  ```

## Repository Targets

### Expected Files

- src/application/ports/candlePorts.ts
- src/adapters/sqlite/sqliteCandleReadAdapter.ts
- src/adapters/postgres/postgresCandleReadAdapter.ts
- src/application/use-cases/**tests**/fakes/fakeCandleReadPort.ts
- src/adapters/sqlite/**tests**/sqliteCandleReadAdapter.test.ts
- src/adapters/postgres/**tests**/postgresCandleReadAdapter.test.ts
- package.json

## Validation Commands

```bash
pnpm exec vitest run src/adapters/sqlite/__tests__/sqliteCandleReadAdapter.test.ts
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/adapters/postgres/__tests__/postgresCandleReadAdapter.test.ts
pnpm exec eslint src/application/ports/candlePorts.ts src/adapters/sqlite/sqliteCandleReadAdapter.ts src/adapters/postgres/postgresCandleReadAdapter.ts src/application/use-cases/__tests__/fakes/fakeCandleReadPort.ts src/adapters/sqlite/__tests__/sqliteCandleReadAdapter.test.ts src/adapters/postgres/__tests__/postgresCandleReadAdapter.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **complete feed key and inclusive bounds**: A window read matches symbol, source, network, poolAddress, and timeframe, includes both time bounds, excludes all neighboring rows, and returns ascending slots. (Test: `returns only the complete feed key within inclusive bounds in ascending order`)
- **latest revision per slot**: For each unixMs, greatest sourceRecordedAtUnixMs wins and greatest insertion id breaks equal-recorded-at ties. (Test: `returns the newest revision per slot and uses id as the tie breaker`)
- **empty feed window**: A valid feed window with no matching rows resolves to an empty array without probing another source. (Test: `returns an empty array when the feed window has no rows`)
