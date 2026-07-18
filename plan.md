<!-- plan-review-required -->

# Canonical Weekly Report Candle Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make weekly SOL HODL and DCA baselines use the same active canonical candle store, complete feed identity, and closed-candle policy as regime and plan reads while preserving the public weekly-report contract.

**Architecture:** Keep SQLite as the source of report facts, expose those facts through a ledger-data port, and let `GetWeeklyReportUseCase` coordinate that port with the already-selected `CandleReadPort`. Add one bounded feed-window operation to both candle adapters, then make the pure report renderer consume explicit facts and canonical candles instead of querying a database or considering legacy inline candles.

**Tech Stack:** TypeScript, Node.js, Vitest, Fastify, SQLite (`node:sqlite`), PostgreSQL/Drizzle, pnpm.

---

**Non-goals**

- Do not change `/v1/plan`, candle ingestion, aggregation, regime classification, or freshness configuration.
- Do not change the weekly report request, response envelope, summary schema, Markdown sections, formulas, or rounding.
- Do not move plan requests, plans, execution results, or CLMM-event facts from SQLite.
- Do not add cross-store retries, fallback probing, backfills, multi-feed reports, pagination, or report-window limits.
- Do not aggregate canonical 15-minute prices into hourly candles for baseline math.

**Affected files**

- `src/application/ports/candlePorts.ts` — bounded canonical candle-window contract.
- `src/adapters/sqlite/sqliteCandleReadAdapter.ts` — SQLite implementation of the window read.
- `src/adapters/postgres/postgresCandleReadAdapter.ts` — PostgreSQL implementation of the window read.
- `src/application/use-cases/__tests__/fakes/fakeCandleReadPort.ts` — in-memory implementation of both candle-read methods.
- `src/adapters/sqlite/__tests__/sqliteCandleReadAdapter.test.ts` — SQLite window-query contract tests (new).
- `src/adapters/postgres/__tests__/postgresCandleReadAdapter.test.ts` — PostgreSQL window-query contract tests (new).
- `src/report/baselines.ts` — explicit canonical price-series input; remove inline-candle authority.
- `src/report/__tests__/baselines.test.ts` — baseline authority and window-filter regression tests.
- `src/application/ports/weeklyReportReadPort.ts` — replace rendered-report port with typed ledger-facts port.
- `src/adapters/sqlite/sqliteWeeklyReportReadAdapter.ts` — return parsed, ordered SQLite report facts only.
- `src/adapters/sqlite/__tests__/sqliteWeeklyReportReadAdapter.test.ts` — ledger adapter range, ordering, and parse tests (new).
- `src/report/weekly.ts` — pure date-window helper and explicit-input report renderer.
- `src/report/__tests__/weeklyReport.snapshot.test.ts` — deterministic renderer and HTTP error regression updates.
- `src/report/__tests__/__snapshots__/weeklyReport.snapshot.test.ts.snap` — expected deterministic output, changed only if explicit inputs alter the stored serialization.
- `src/application/use-cases/getWeeklyReportUseCase.ts` — feed selection, canonical read planning, and report orchestration.
- `src/application/use-cases/__tests__/fakes/fakeWeeklyReportReadPort.ts` — fake ledger-facts port.
- `src/application/use-cases/__tests__/getWeeklyReportUseCase.test.ts` — use-case invariants and error propagation.
- `src/composition/buildApplication.ts` — inject the selected candle port and SQLite report-facts port into the use case.
- `src/composition/__tests__/weeklyReportCandleStore.e2e.test.ts` — SQLite-only composition regression (new).
- `src/composition/__tests__/weeklyReportCandleStore.e2e.pg.test.ts` — PostgreSQL authority/no-SQLite-fallback regression (new).
- `package.json` — include the new PostgreSQL tests in `test:pg`.
- `README.md` — replace “ledger-only” wording with split fact/price authority.
- `architecture.md` — document canonical report candle flow and store responsibilities.
- `documentation.md` — correct current weekly-report descriptions while retaining historical milestone context as historical.
- `src/adapters/http/openapi.ts` — describe ledger facts plus active canonical candle prices.
- `src/composition/__tests__/buildApp.e2e.test.ts` — assert the corrected OpenAPI summary.
- `docs/solutions/best-practices/composition-root-pattern-2026-05-08.md` — update the durable composition-root example.

**Behavioral invariants**

- A window read matches all five feed fields: `symbol`, `source`, `network`, `poolAddress`, and `timeframe`.
- The window is inclusive at `fromUnixMs` and `closedCandleCutoffUnixMs`.
- Exactly one candle is returned per slot; newest `sourceRecordedAtUnixMs` wins, then greatest row `id` breaks ties.
- Window results are ordered by `unixMs ASC` and an empty match returns `[]`.
- The first chronologically ordered plan request with a complete, supported market identity selects the report feed.
- Both requested `15m` and `1h` use canonical source timeframe `15m`; the report never aggregates the price series.
- The read upper bound is the shared source closed-candle cutoff calculated with `window.toUnixMs` as `nowUnixMs`.
- Missing or incomplete feed metadata skips the candle port; an empty canonical result stays empty and never triggers another store read.
- Candle-read failures propagate; they are never converted to empty candles.
- Inline `request.market.candles` never override or supplement canonical rows.
- Invalid/reversed report dates remain `ReportRangeApplicationError` at the application boundary and HTTP 400 at the handler; malformed persisted JSON remains an unexpected HTTP 500.
- Identical ordered ledger facts and canonical candle rows produce byte-identical Markdown and JSON output.

## Task 1: Add the canonical feed-window candle read to every adapter

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

## Task 2: Make baseline calculations accept only explicit canonical candles

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

## Task 3: Coordinate report facts and canonical candles in the weekly use case

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

## Task 4: Wire and prove active-store selection without fallback

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

## Task 5: Correct current architecture and API documentation

**Files:**

- Modify: `README.md`
- Modify: `architecture.md`
- Modify: `documentation.md`
- Modify: `src/adapters/http/openapi.ts`
- Modify: `src/composition/__tests__/buildApp.e2e.test.ts`
- Modify: `docs/solutions/best-practices/composition-root-pattern-2026-05-08.md`

- [ ] **Step 1: Add an OpenAPI regression assertion.** Extend only the existing `serves /v1/openapi.json` case to assert the weekly endpoint summary states that report facts come from the ledger and baseline prices come from the active canonical candle store.

- [ ] **Step 2: Run the focused OpenAPI test and confirm the old “ledger data” summary fails the new assertion.**

  ```bash
  pnpm exec vitest run src/composition/__tests__/buildApp.e2e.test.ts -t "serves /v1/openapi.json"
  ```

- [ ] **Step 3: Update current documentation.** In README and architecture descriptions, replace “ledger-only” with the precise split: append-only SQLite provides plan/execution facts; the active SQLite/PostgreSQL `CandleReadPort` provides SOL baseline closes. Update the weekly-report flow to include complete feed selection, canonical 15-minute source timeframe, and closed cutoff. In `documentation.md`, correct current endpoint/module descriptions while leaving dated Milestone 15 claims explicitly framed as historical implementation history.

- [ ] **Step 4: Update the durable composition-root solution.** Show `WeeklyReportLedgerReadPort` plus the selected `CandleReadPort` entering `createGetWeeklyReportUseCase`; remove the obsolete high-level SQLite weekly adapter example. Do not rewrite unrelated historical guidance.

- [ ] **Step 5: Update the OpenAPI summary and run scoped acceptance checks.**

  ```bash
  pnpm exec vitest run src/composition/__tests__/buildApp.e2e.test.ts -t "serves /v1/openapi.json"
  pnpm exec prettier --check README.md architecture.md documentation.md src/adapters/http/openapi.ts src/composition/__tests__/buildApp.e2e.test.ts docs/solutions/best-practices/composition-root-pattern-2026-05-08.md
  pnpm exec eslint src/adapters/http/openapi.ts src/composition/__tests__/buildApp.e2e.test.ts
  ```

  Expected: the focused contract assertion passes and all changed documentation/code is formatted.

- [ ] **Step 6: Commit the documentation correction.**

  ```bash
  git add README.md architecture.md documentation.md src/adapters/http/openapi.ts src/composition/__tests__/buildApp.e2e.test.ts docs/solutions/best-practices/composition-root-pattern-2026-05-08.md
  git commit -m "m55: document canonical report candle authority"
  ```

**Tests to add or update**

- Add mirrored SQLite/PostgreSQL candle-window adapter contracts for complete feed isolation, inclusive bounds, revision tie-breaking, deterministic order, and empty results.
- Expand baseline tests to prove canonical-only authority, defensive window filtering, deterministic sorting, empty candles, and no requests.
- Add SQLite weekly-ledger adapter tests for parsed windows, stable row ordering, malformed persisted JSON, and range-error translation.
- Replace pass-through weekly use-case tests with feed-selection, `15m`/`1h`, cutoff, missing-feed, empty-store, and error-propagation cases.
- Update deterministic weekly report snapshots to use explicit report facts and candles.
- Add SQLite-only and PostgreSQL-backed composition tests, including conflicting SQLite data and empty-active-store no-fallback cases.
- Extend the existing OpenAPI composition test only within its weekly endpoint assertion.

**Validation commands**

Run after all implementation tasks complete; this is the validate phase, not a standalone implementation task:

```bash
pnpm -r typecheck
pnpm run test
pnpm run lint
pnpm run build
pnpm run boundaries
pnpm run format
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run test:pg
```

Expected: every command exits zero. The PostgreSQL command requires the repository's test database; inability to connect is an environment blocker, not permission to mark PostgreSQL coverage complete.

**Risk areas**

- The shared closed-candle delay can intentionally exclude the last nominal bar; boundary fixtures must calculate expectations through `buildRegimeCandleReadPlan`, not hard-code a looser report cutoff.
- PostgreSQL numeric values may arrive as strings; the existing null guard and `Number(...)` conversion must remain common to both read methods.
- Reports spanning several market feeds still select one baseline feed. Preserving the first complete chronological request avoids an unrequested multi-feed redesign.
- Existing snapshots may change because old SQLite/inline prices were wrong. Accept only differences explained by the new explicit canonical fixtures; public fields and Markdown structure must not drift.
- Malformed legacy requests may lack the modern market shape. They remain in totals/config ordering but cannot select a feed unless all required fields and a supported timeframe are present.
- Large report ranges can return many candles. The bounded indexed query is intentional; adding a guessed limit would silently truncate results.
- PostgreSQL tests share a database. Unique feed keys and scoped cleanup are required to avoid deleting another suite's rows.

**Stop conditions**

- Stop if repository types show that plan requests cannot provide `symbol`, `source`, `network`, `poolAddress`, and supported `timeframe` without changing the public request contract; revise the design rather than inventing feed defaults.
- Stop if implementing the window read requires a schema migration or index change not described by the design; document the query-plan evidence and obtain scope approval.
- Stop if any existing `CandleReadPort` implementation or fake is discovered beyond the SQLite adapter, PostgreSQL adapter, and application fake; add it to Task 1 before changing the interface.
- Stop if preserving the weekly response schema, formulas, deterministic ordering, or 400/500 error taxonomy proves incompatible with explicit report inputs.
- Stop if a proposed fix catches candle-store failures, probes a second store, reuses inline request candles, or reads `candle_revisions` from the weekly SQLite ledger adapter.
- Stop before claiming PostgreSQL acceptance if the configured test database cannot run the new adapter and composition suites.
