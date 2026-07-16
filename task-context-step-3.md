# Task Context: Task 3

Title: Coordinate report facts and canonical candles in the weekly use case

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

- Modify: `src/application/ports/weeklyReportReadPort.ts`
- Modify: `src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts`
- Create: `src/adapters/sqlite/__tests__/sqliteWeeklyReportReadAdapter.test.ts`
- Modify: `src/report/weekly.ts`
- Modify: `src/report/__tests__/weeklyReport.snapshot.test.ts`
- Modify: `src/report/__tests__/__snapshots__/weeklyReport.snapshot.test.ts.snap`
- Modify: `src/application/use-cases/getWeeklyReportUseCase.ts`
- Modify: `src/application/use-cases/__tests__/fakes/fakeWeeklyReportReadPort.ts`
- Modify: `src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts`
- Modify: `src/composition/buildApplication.ts` (updated atomically with use-case API changes to maintain the typecheck gate)

**Exported API changes:** Replace `WeeklyReportReadPort.getWeeklyReport` with `WeeklyReportLedgerReadPort.getWeeklyReportData`; export `WeeklyReportData` and its domain-shaped records. Change `generateWeeklyReport` to accept `{ data, candles }`. Change `GetWeeklyReportUseCaseDeps` from `{ port }` to `{ weeklyReportLedgerReadPort, candleReadPort }`. The port declaration, its sole SQLite adapter/fake implementations, report caller, and use-case consumer are intentionally migrated in one task to satisfy the workspace typecheck gate.

**Invariants to test first:**

- `selects the first complete supported feed in chronological request order`
- `reads a 15m request from the canonical 15m source window`
- `reads a 1h request from the canonical 15m source window without aggregation`
- `uses the shared source closed-candle cutoff at the report end`
- `skips candle reads when no request has a complete supported feed`
- `does not retry or fall back when the canonical read returns no rows`
- `propagates canonical candle read failures`
- `preserves report range application errors`
- `returns ledger facts ordered by timestamp then insertion id`
- `keeps malformed persisted JSON as an unexpected error`
- `renders byte-identical output for identical explicit facts and candles`

- [ ] **Step 1: Replace pass-through use-case tests with orchestration tests.** Configure the fake ledger port with ordered facts and parsed windows, and assert the exact window call:

  ```ts
  expect(candleReadPort.windowCalls).toEqual([
    {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: "PoolWeekly1",
      timeframe: "15m",
      fromUnixMs,
      closedCandleCutoffUnixMs: expectedCutoff
    }
  ]);
  ```

  Give the `1h` case the same expected source timeframe and assert returned baseline values reflect the canonical closes. Add incomplete/unsupported feed, empty result, candle error, and range-error cases. Use the exact invariant names above as test names.

- [ ] **Step 2: Add focused SQLite weekly-ledger adapter tests.** Insert same-timestamp rows in reverse semantic order to prove `ORDER BY as_of_unix_ms ASC, id ASC`, assert parsed domain-shaped objects and window timestamps, assert invalid/reversed dates map to `ReportRangeApplicationError`, and assert malformed JSON rejects without conversion.

- [ ] **Step 3: Refactor the deterministic report snapshot test.** Build `WeeklyReportData` explicitly, call `generateWeeklyReport({ data, candles })`, and keep the existing summary/Markdown snapshots. Move endpoint-only invalid-date and malformed-row checks to use the composed path without reintroducing store access in the renderer.

- [ ] **Step 4: Run the focused suites and confirm failures describe the old APIs.**

  ```bash
  pnpm exec vitest run src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts src/adapters/sqlite/__tests__/sqliteWeeklyReportReadAdapter.test.ts src/report/__tests__/weeklyReport.snapshot.test.ts
  ```

  Expected before implementation: failures reference the pass-through port, store-based renderer, or missing ledger-data method.

- [ ] **Step 5: Define the ledger-facts port.** Keep the existing file path to minimize import churn, but export shapes equivalent to:

  ```ts
  export interface WeeklyReportData {
    window: { from: string; to: string; fromUnixMs: number; toUnixMs: number };
    plans: Array<{ asOfUnixMs: number; plan: PlanResponse }>;
    planRequests: Array<{ asOfUnixMs: number; request: PlanRequest }>;
    executionResults: Array<{ asOfUnixMs: number; result: ExecutionResultRequest }>;
  }

  export interface WeeklyReportLedgerReadPort {
    getWeeklyReportData(input: { from: string; to: string }): Promise<WeeklyReportData>;
  }
  ```

  Use the repository's actual execution-result contract name. Do not expose SQLite column names, JSON strings, or `LedgerStore`.

- [ ] **Step 6: Convert the SQLite adapter to facts-only reads.** Parse and validate the date window, execute only the existing `plans`, `plan_requests`, and `execution_results` queries with stable ordering, parse JSON into the port shapes, and translate only `ReportRangeError` to `ReportRangeApplicationError`. Delete every `candle_revisions` query and baseline-feed key construction from this adapter path.

- [ ] **Step 7: Make `generateWeeklyReport` pure over explicit data.** Export/reuse the date-window parser where the adapter needs it, but make rendering accept already parsed `WeeklyReportData` plus canonical `CandleRow[]`. Preserve calculations, Markdown labels, public summary fields, ordering, and rounding. Pass `{ unixMs, close }` projections to `computeBaselines`.

- [ ] **Step 8: Implement use-case orchestration.** After `getWeeklyReportData`, scan `data.planRequests` in adapter order. Treat a request as selectable only when symbol/source/network/pool address are non-empty strings and timeframe is `15m` or `1h`. Call `buildRegimeCandleReadPlan({ requestedTimeframe, nowUnixMs: data.window.toUnixMs })`, then `getCandlesForFeedWindow` with `data.window.fromUnixMs`, `readPlan.sourceTimeframe`, and `readPlan.sourceCutoffUnixMs`. If no feed qualifies, pass `[]` directly to the renderer. Do not catch candle errors or perform a second read.

- [ ] **Step 9: Update both fakes.** `FakeWeeklyReportReadPort` becomes a `WeeklyReportLedgerReadPort` fake with call capture and configurable `WeeklyReportData`/error. Keep candle window call/error tracking in `FakeCandleReadPort` deterministic and independent of latest-N calls.

- [ ] **Step 10: Update the composition root.** Update `buildApplication.ts` to construct `getWeeklyReport` with `weeklyReportLedgerReadPort` and `candleReadPort` to satisfy the new `GetWeeklyReportUseCaseDeps` signature. Do not branch on `DATABASE_URL` in reporting code.

- [ ] **Step 11: Run scoped acceptance checks and inspect snapshot changes.**

  ```bash
  pnpm exec vitest run src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts src/adapters/sqlite/__tests__/sqliteWeeklyReportReadAdapter.test.ts src/report/__tests__/baselines.test.ts src/report/__tests__/weeklyReport.snapshot.test.ts
  pnpm exec eslint src/application/ports/weeklyReportReadPort.ts src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts src/adapters/sqlite/__tests__/sqliteWeeklyReportReadAdapter.test.ts src/report/weekly.ts src/report/__tests__/weeklyReport.snapshot.test.ts src/application/use-cases/getWeeklyReportUseCase.ts src/application/use-cases/__tests__/fakes/fakeWeeklyReportReadPort.ts src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts
  ```

  Expected: every named invariant passes; snapshots retain the same response shape and deterministic values for the explicit fixture.

- [ ] **Step 12: Commit the coordinated weekly-report refactor.**

  ```bash
  git add src/application/ports/weeklyReportReadPort.ts src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts src/adapters/sqlite/__tests__/sqliteWeeklyReportReadAdapter.test.ts src/report/weekly.ts src/report/__tests__/weeklyReport.snapshot.test.ts src/report/__tests__/__snapshots__/weeklyReport.snapshot.test.ts.snap src/application/use-cases/getWeeklyReportUseCase.ts src/application/use-cases/__tests__/fakes/fakeWeeklyReportReadPort.ts src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts src/composition/buildApplication.ts
  git commit -m "m55: route weekly reports through canonical candles"
  ```

## Repository Targets

### Expected Files

- src/application/ports/weeklyReportReadPort.ts
- src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts
- src/adapters/sqlite/**tests**/sqliteWeeklyReportReadAdapter.test.ts
- src/report/weekly.ts
- src/report/**tests**/weeklyReport.snapshot.test.ts
- src/report/**tests**/**snapshots**/weeklyReport.snapshot.test.ts.snap
- src/application/use-cases/getWeeklyReportUseCase.ts
- src/application/use-cases/**tests**/fakes/fakeWeeklyReportReadPort.ts
- src/application/use-cases/**tests**/getWeeklyReportUseCase.test.ts
- src/composition/buildApplication.ts

## Validation Commands

```bash
pnpm exec vitest run src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts src/adapters/sqlite/__tests__/sqliteWeeklyReportReadAdapter.test.ts src/report/__tests__/baselines.test.ts src/report/__tests__/weeklyReport.snapshot.test.ts
pnpm exec eslint src/application/ports/weeklyReportReadPort.ts src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts src/adapters/sqlite/__tests__/sqliteWeeklyReportReadAdapter.test.ts src/report/weekly.ts src/report/__tests__/weeklyReport.snapshot.test.ts src/application/use-cases/getWeeklyReportUseCase.ts src/application/use-cases/__tests__/fakes/fakeWeeklyReportReadPort.ts src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **chronological complete feed selection**: The first ordered plan request with non-empty symbol, source, network, poolAddress, and a supported timeframe selects the report feed. (Test: `selects the first complete supported feed in chronological request order`)
- **direct source timeframe**: A requested 15m report feed reads canonical stored 15m candles for the complete market key. (Test: `reads a 15m request from the canonical 15m source window`)
- **derived request source timeframe**: A requested 1h report feed still reads raw canonical 15m closes and does not aggregate them for baseline math. (Test: `reads a 1h request from the canonical 15m source window without aggregation`)
- **shared closed cutoff**: The report uses buildRegimeCandleReadPlan at window.toUnixMs and forwards its sourceCutoffUnixMs as the inclusive upper bound. (Test: `uses the shared source closed-candle cutoff at the report end`)
- **missing feed skips read**: When no request has a complete supported market identity, the use case renders with an empty candle array and never calls the candle port. (Test: `skips candle reads when no request has a complete supported feed`)
- **empty active source is final**: An empty successful canonical read is passed to rendering without a second read or fallback probe. (Test: `does not retry or fall back when the canonical read returns no rows`)
- **candle error propagation**: A canonical candle adapter rejection propagates unchanged instead of becoming an empty result. (Test: `propagates canonical candle read failures`)
- **range error compatibility**: Invalid and reversed windows remain ReportRangeApplicationError at the use-case boundary. (Test: `preserves report range application errors`)
- **stable ledger ordering**: SQLite facts are returned by asOfUnixMs ascending and insertion id ascending for equal timestamps. (Test: `returns ledger facts ordered by timestamp then insertion id`)
- **malformed ledger JSON remains unexpected**: Malformed persisted JSON rejects as an unexpected error and is not translated into a range error or empty report. (Test: `keeps malformed persisted JSON as an unexpected error`)
- **deterministic explicit rendering**: Identical ordered report facts and canonical candle rows produce byte-identical Markdown and JSON output. (Test: `renders byte-identical output for identical explicit facts and candles`)
