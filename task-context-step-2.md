# Task Context: Task 2

Title: Make baseline calculations accept only explicit canonical candles

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

- Modify: `src/report/baselines.ts`
- Modify: `src/report/__tests__/baselines.test.ts`
- Modify: `src/report/weekly.ts`

**Exported API change:** Replace `BaselineInputs.fallbackCandles?` with required `candles`, and remove `market.candles` from the plan-request shape used by baseline computation. `computeBaselines` remains the exported function but its required input member shape changes. `weekly.ts` is updated in the same commit to keep its caller compiling; Task 3 will remove its temporary database ownership entirely.

**Invariants to test first:**

- `uses only explicit canonical candles when legacy inline candles conflict`
- `filters canonical candles to the report window and sorts them by unixMs`
- `keeps SOL baselines at initial NAV and still accrues USDC when canonical candles are empty`
- `returns all-zero baselines when there are no plan requests`

- [ ] **Step 1: Rewrite the baseline tests around an explicit `candles` array.** Include unsorted in-window rows, rows outside both sides of the window, conflicting legacy inline candles represented through a cast for regression coverage, no-candle behavior, and no-plan behavior. Keep the existing USDC duration assertion.

- [ ] **Step 2: Run the focused tests and verify the old fallback/inline merge causes the new authority test to fail.**

  ```bash
  pnpm exec vitest run src/report/__tests__/baselines.test.ts
  ```

  Expected before implementation: the conflicting inline series changes SOL HODL/DCA or the new required input does not typecheck.

- [ ] **Step 3: Replace the fallback merge with a single canonical series.** The central shape is:

  ```ts
  export interface BaselineInputs {
    window: { fromUnixMs: number; toUnixMs: number };
    planRequests: Array<{
      asOfUnixMs: number;
      request: {
        portfolio: { navUsd: number };
        config: { baselines: PlanRequestConfig["baselines"] };
      };
    }>;
    candles: Array<{ unixMs: number; close: number }>;
  }
  ```

  Build the price series only from `input.candles`, defensively filter it to the report window, and sort ascending. Preserve the existing request ordering, first-request configuration, formulas, and six-decimal rounding.

- [ ] **Step 4: Update the existing `generateWeeklyReport` call site to pass the currently queried rows through the new `candles` property and remove any cast that advertises inline candles to `computeBaselines`.** This is an intermediate compatibility edit only; do not broaden or otherwise improve the direct SQLite query because Task 3 deletes it.

- [ ] **Step 5: Run scoped acceptance checks.**

  ```bash
  pnpm exec vitest run src/report/__tests__/baselines.test.ts src/report/__tests__/weeklyReport.snapshot.test.ts
  pnpm exec eslint src/report/baselines.ts src/report/weekly.ts src/report/__tests__/baselines.test.ts
  ```

  Expected: baseline and existing report regressions pass with no snapshot churn unrelated to explicit candle authority.

- [ ] **Step 6: Commit the baseline authority change.**

  ```bash
  git add src/report/baselines.ts src/report/weekly.ts src/report/__tests__/baselines.test.ts
  git commit -m "m55: make report baselines use explicit candles"
  ```

## Repository Targets

### Expected Files

- src/report/baselines.ts
- src/report/**tests**/baselines.test.ts
- src/report/weekly.ts

## Validation Commands

```bash
pnpm exec vitest run src/report/__tests__/baselines.test.ts src/report/__tests__/weeklyReport.snapshot.test.ts
pnpm exec eslint src/report/baselines.ts src/report/weekly.ts src/report/__tests__/baselines.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **canonical candle authority**: SOL HODL and DCA use only the explicit canonical candle array; legacy inline request candles cannot override or supplement it. (Test: `uses only explicit canonical candles when legacy inline candles conflict`)
- **defensive window normalization**: Canonical rows outside the report window are ignored and remaining rows are sorted by unixMs before baseline math. (Test: `filters canonical candles to the report window and sorts them by unixMs`)
- **empty canonical series**: With plan requests but no canonical rows, SOL baselines remain at initial NAV while USDC carry still accrues over the explicit window. (Test: `keeps SOL baselines at initial NAV and still accrues USDC when canonical candles are empty`)
- **no plan facts**: With no plan requests, all three baseline values remain zero regardless of candle input. (Test: `returns all-zero baselines when there are no plan requests`)
