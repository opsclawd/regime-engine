# Canonical Weekly Report Candle Reads

**Issue:** #55  
**Status:** Proposed design  
**Date:** 2026-07-16

## Problem and motivation

The service currently has two candle authorities in one process. `buildApplication`
selects a `CandleReadPort` and `CandleWritePort` from Postgres when `DATABASE_URL`
is configured, otherwise from SQLite. Candle ingestion, `GET /v1/regime/current`, and
position-scoped `POST /v1/plan` therefore agree on a store. In contrast,
`createSqliteWeeklyReportReadAdapter` calls `generateWeeklyReport`, which queries
the SQLite ledger's `candle_revisions` table directly.

In the deployed Postgres topology, valid candles can exist in
`regime_engine.candle_revisions` while the report sees an empty or stale SQLite
table. `computeBaselines` then returns initial NAV for SOL HODL and DCA, producing
a plausible but incorrect report. This is more dangerous than a hard failure
because regime and plan outputs can use current market data while analytics
silently describe a different market history.

The direct report query also differs from the canonical adapters in important
ways:

- It keys by `source`, `network`, and `poolAddress`, but omits `symbol` and
  `timeframe`.
- It loads revisions in ascending order and relies on later `Map` writes for
  deduplication instead of expressing the shared latest-revision-per-slot rule.
- It can still let inline candles from legacy plan requests override stored
  candles in `computeBaselines`.
- It treats the SQLite `candle_revisions` table as an implicit fallback even
  when application wiring selected Postgres.

Correcting the store selection and these semantic differences makes candle
history have one authority across planning, regime classification, and reporting.

## Goals

- Make weekly SOL HODL and DCA baselines read candles through the active
  `CandleReadPort` selected by the composition root.
- Preserve SQLite-only local and test behavior when `DATABASE_URL` is absent.
- Use the complete logical market identity: `symbol`, `source`, `network`,
  `poolAddress`, and canonical source `timeframe`.
- Read only candles that are closed as of the report window end, using the same
  cutoff semantics as the regime and plan paths.
- Preserve latest-revision-per-slot ordering and deterministic report output.
- Remove any silent SQLite or inline-request candle fallback when the configured
  candle source has no rows.
- Preserve the public weekly report request and response contracts.

## Non-goals

- Changing plan generation, candle ingestion, aggregation, classification, or
  freshness policy.
- Changing the weekly report response schema or adding candle-source metadata.
- Moving plan, execution-result, or CLMM-event ledgers from SQLite to Postgres.
- Supporting several market feeds in one report or combining their price series.
- Adding a market-data provider fallback, cross-database retry, or store probing.
- Backfilling or copying historical SQLite candles into Postgres.
- Recomputing historical plans or execution results.

## Current architecture

```text
buildStoreContext
  -> SQLite ledger always
  -> Postgres context when DATABASE_URL is set

buildApplication
  -> candleReadPort: Postgres or SQLite
  -> ingestCandles/getCurrentRegime/generatePlan: selected candle port
  -> getWeeklyReport: SQLite weekly adapter only

SQLite weekly adapter
  -> generateWeeklyReport
       -> SQLite plans, plan_requests, execution_results
       -> SQLite candle_revisions               <-- split-brain read
       -> computeBaselines
```

The application layer already establishes the desired pattern: use cases own
orchestration, depend on ports, and remain independent of concrete databases.
The composition root is the only place that chooses adapters. The report fix
should follow that pattern instead of teaching report code how to inspect
`DATABASE_URL`.

## Design alternatives

### 1. Inject the active candle port into the existing SQLite weekly adapter

The adapter could receive both `LedgerStore` and `CandleReadPort`, then fetch
candles before invoking `generateWeeklyReport`.

This is the smallest wiring change, but it makes an infrastructure adapter
coordinate another port and either duplicates the plan-request query needed to
choose a feed or pushes asynchronous port orchestration into `src/report`. It
also leaves the nominal application use case as a pass-through. This conflicts
with the repository's established use-case boundary and is not recommended.

### 2. Add a Postgres-specific weekly report adapter

A second adapter could duplicate the report query and read Postgres candles
directly when `DATABASE_URL` is set.

This would fix the immediate deployment symptom, but it preserves two report
implementations, duplicates latest-revision and feed semantics, and creates the
silent backend-selection behavior the issue explicitly rejects. It is not
recommended.

### 3. Separate report-fact reads from candle reads and coordinate in the use case

Refine the reporting port so the SQLite adapter supplies report facts only
(plans, plan requests, and execution results). Inject that port and the active
`CandleReadPort` into `GetWeeklyReportUseCase`. The use case chooses the baseline
feed, requests its closed candle window, and passes both inputs to deterministic
report rendering.

This is the recommended approach. It is a somewhat larger refactor, but it
puts orchestration in the same layer as regime and plan orchestration, keeps
backend selection in `buildApplication`, makes store choice directly testable,
and removes candle SQL from reporting.

## Proposed design

### 1. Make the weekly ledger port return report facts

Replace the high-level `WeeklyReportReadPort.getWeeklyReport()` abstraction with
a narrowly named ledger-data port, such as `WeeklyReportLedgerReadPort`. Its
operation accepts `from` and `to` and returns a typed `WeeklyReportData` value:

- parsed report window (`fromUnixMs`, `toUnixMs`);
- ordered plan records;
- ordered plan-request records;
- ordered execution-result records.

The SQLite adapter remains responsible for its existing three ledger queries
and stable `ORDER BY` clauses. It must not read `candle_revisions`. Invalid date
ranges continue to become `ReportRangeApplicationError`, preserving HTTP 400
behavior. Malformed persisted JSON remains an unexpected error and therefore
preserves the existing HTTP 500 behavior.

The returned records should be domain-shaped rather than leaking SQLite column
names or raw database handles. This keeps `GetWeeklyReportUseCase` independent of
`LedgerStore` and allows `generateWeeklyReport` to operate on explicit inputs.

### 2. Add an explicit canonical candle-window operation

Extend `CandleReadPort` with a window-shaped operation, for example:

```ts
getCandlesForFeedWindow({
  symbol,
  source,
  network,
  poolAddress,
  timeframe,
  fromUnixMs,
  closedCandleCutoffUnixMs
}): Promise<CandleRow[]>
```

Both SQLite and Postgres adapters implement it with the same invariants already
used by `getLatestCandlesForFeed`:

- filter by the complete feed key, including `symbol` and `timeframe`;
- include `unix_ms >= fromUnixMs` and
  `unix_ms <= closedCandleCutoffUnixMs`;
- select the latest revision for each `unix_ms` by
  `source_recorded_at_unix_ms DESC, id DESC`;
- return one row per slot ordered by `unix_ms ASC`.

An explicit range operation is preferable to calculating a large `limit` for
`getLatestCandlesForFeed`. The endpoint currently accepts arbitrary valid date
ranges despite its weekly name, so a guessed limit can truncate long reports or
cause excessive over-read. Regime and plan continue using the existing latest-N
operation unchanged; all three paths still share the same port and concrete
adapters.

The two adapter methods should share private query/result-mapping helpers where
that reduces drift, while keeping backend-specific SQL inside their adapters.

### 3. Let `GetWeeklyReportUseCase` coordinate the sources

`createGetWeeklyReportUseCase` receives:

```text
weeklyReportLedgerReadPort
candleReadPort
```

For each request it:

1. Reads the ordered ledger facts and parsed window.
2. Scans plan requests in their existing chronological order for the first
   request with a complete market identity: `symbol`, `source`, `network`,
   `poolAddress`, and supported requested `timeframe`.
3. Builds the existing regime candle read plan with the request's timeframe and
   `nowUnixMs = window.toUnixMs`.
4. Reads the selected feed from `window.fromUnixMs` through
   `readPlan.sourceCutoffUnixMs`, using `readPlan.sourceTimeframe`.
5. Passes the ledger facts and returned candles to the report renderer.

`buildRegimeCandleReadPlan` is reused only to establish canonical source
timeframe and closed-candle cutoff policy. A requested `1h` feed therefore reads
the canonical stored `15m` price series, matching current ingestion and the
source read performed by regime and plan paths. Weekly baseline math needs
closing prices rather than derived 1h indicator bars, so it does not aggregate
the series to 1h.

If there are no plan requests, or no request has a complete supported feed, the
use case skips the candle read. Existing baseline behavior remains: no plans
produces all-zero baselines; plans without canonical candle data leave SOL HODL
and DCA at initial NAV while USDC carry is still computed. It must not query a
different backend as a fallback.

### 4. Make report rendering consume explicit canonical candles

Refactor `generateWeeklyReport` to receive typed report facts and a canonical
candle series instead of a `LedgerStore`. It remains responsible for the
existing deterministic calculations and Markdown/JSON rendering.

Change `computeBaselines` from optional `fallbackCandles` plus legacy
`request.market.candles` to one explicit candle input. Plan requests remain the
source of initial NAV and baseline configuration, but never of price history.
This enforces the issue's one-candle-authority rule and prevents old inline data
from overriding active-store revisions.

The baseline module continues to filter candles to the parsed report window as
a defensive invariant, sort by `unixMs`, and preserve current rounding, DCA,
HODL, and USDC carry formulas. The public summary and Markdown remain unchanged.

### 5. Wire the already-selected port once

`buildApplication` continues to select `candleReadPort` exactly once:

```text
DATABASE_URL set   -> Postgres candle adapter
DATABASE_URL unset -> SQLite candle adapter
```

It constructs the SQLite weekly ledger adapter separately and passes both ports
to `createGetWeeklyReportUseCase`. There is no conditional report wiring and no
SQLite fallback branch inside the use case, report module, or HTTP handler.

The HTTP route and handler remain unchanged because the use-case input and output
contracts do not change. `ApplicationDependencies` should expose only the
dependencies needed by composition/tests; a concrete `weeklyReportReadPort`
does not need to remain public if it is no longer consumed outside wiring.

## Resulting data flow

```text
GET /v1/report/weekly?from&to
  -> HTTP handler
  -> GetWeeklyReportUseCase
       -> WeeklyReportLedgerReadPort
            -> SQLite plan_requests, plans, execution_results
       -> choose first complete plan market feed
       -> build canonical source read plan and closed cutoff
       -> CandleReadPort.getCandlesForFeedWindow
            -> Postgres when DATABASE_URL is set
            -> SQLite otherwise
       -> generateWeeklyReport(report facts, canonical candles)
       -> computeBaselines(canonical candles)
  -> unchanged response envelope
```

## Error handling and compatibility

- Missing `from` or `to` remains a handler-level 400.
- Invalid or reversed dates remain `INVALID_REPORT_RANGE` 400 responses with
  the current messages.
- Candle adapter failures are not converted into empty candle sets and do not
  trigger fallback reads; they propagate as 500 errors. A visible failure is
  safer than publishing a report from the wrong authority.
- A successful canonical read returning no rows preserves current baseline
  semantics rather than creating a new public error.
- Malformed ledger JSON continues to fail as 500.
- No response field, hash, plan record, or execution record changes.
- Deterministic output is preserved for identical ledger facts and canonical
  candle rows.

## Testing strategy

### Use-case tests

Replace the pass-through fake with a fake weekly ledger-data port and reuse or
extend `FakeCandleReadPort`.

Cover:

- complete feed selection includes `symbol`, `source`, `network`,
  `poolAddress`, and canonical source `timeframe`;
- requested `15m` and `1h` reports both read stored `15m` candles, with the
  latter using the existing derived read plan's source metadata;
- the upper bound is the shared closed-candle cutoff at report end;
- rows outside the report window and not-yet-closed rows do not affect baselines;
- canonical candle prices change SOL HODL/DCA as expected;
- no complete feed skips the candle port without probing another store;
- candle-port errors propagate;
- range errors preserve `ReportRangeApplicationError`.

### Adapter contract tests

Run equivalent SQLite and Postgres tests for the new window operation:

- full feed-key isolation, including symbol and timeframe;
- inclusive lower and closed upper bounds;
- newest revision wins for a slot, including the `id` tie-breaker;
- ascending deterministic output;
- empty result behavior.

Postgres tests remain conditional on `DATABASE_URL`, following the repository's
existing `test:pg` pattern and using unique feed keys/cleanup to prevent test
contamination.

### Composition and regression tests

- In Postgres-backed store-context mode, place report ledger facts in SQLite and
  baseline candles only in Postgres; the endpoint must calculate non-flat SOL
  baselines from Postgres.
- Put conflicting or stale candles in SQLite in that test; verify they do not
  influence the result. This directly guards against reintroducing fallback.
- In SQLite-only mode, ingest/write candles and ledger facts in SQLite and verify
  the endpoint preserves local behavior.
- Keep deterministic report snapshots, updated to provide explicit canonical
  candles. Add a regression proving legacy inline request candles cannot
  override the canonical series.
- Run the repository quality gate:
  `pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build`, plus
  the configured Postgres test command.

## Documentation changes

Update current documentation that calls reports "ledger-only." The accurate
statement is that plan/execution facts come from the append-only SQLite ledger,
while SOL baseline prices come from the active canonical candle store. At
minimum this includes `README.md`, the current architecture/milestone notes in
`plan.md`, and the weekly endpoint OpenAPI summary. Historical design records
may remain historical if clearly dated, but current guidance such as the
composition-root solution should show the weekly use case receiving both its
ledger-data port and the selected candle port.

## Assumptions

- A weekly report continues to represent one baseline market feed. The first
  chronologically ordered plan request with a complete supported feed remains
  authoritative, preserving current selection behavior.
- Current plan requests contain a `RegimeReadTimeframe` of `15m` or `1h`.
  Legacy requests without a complete feed are ignored for feed selection but
  remain included in plan/report totals and baseline configuration ordering.
- Provider ingestion remains canonical at `15m`; requested `1h` market data is
  derived for regime decisions and does not have a separately stored candle
  authority.
- Raw canonical 15m closes are appropriate for weekly HODL/DCA baselines even
  when the selected plan requested a 1h regime view.
- The report's `to` end-of-day timestamp is the as-of time for closed-candle
  eligibility. The normal configured ingestion delay remains part of that
  cutoff, matching regime and plan read semantics.
- An empty canonical result is a valid data condition with existing flat SOL
  baseline behavior; only querying a different source to hide it is forbidden.
- The SQLite ledger remains required in Postgres mode for plans and execution
  facts.

## Risks and mitigations

### Historical output changes

Reports that previously used SQLite or inline candles can produce different SOL
baselines after the fix. This is the intended correction. Snapshot changes must
be explained by their explicit canonical candle fixtures, not accepted as broad
snapshot churn.

### Ambiguous multi-feed reports

The endpoint can include plan facts from multiple feeds while computing one SOL
baseline. Preserving first-complete-feed selection avoids scope expansion, but
the limitation should be documented. Multi-feed segmentation is future work.

### Closed-cutoff edge behavior

Using the shared delay may exclude the last nominal bar of a report window. This
is deliberate: a bar is eligible only if it would be considered closed by the
same market-data policy used elsewhere. Boundary tests should use exact aligned
timestamps to prevent accidental lookahead.

### Large report windows

The endpoint does not enforce a seven-day maximum. A bounded window query avoids
the correctness problems of a guessed latest-N limit, but callers can still
request large datasets. Existing feed-window indexes should support the query;
range limits or pagination are out of scope unless profiling demonstrates a
production problem.

### Port expansion drift

Adding a second candle-read operation creates another adapter contract that
SQLite and Postgres must match. Shared invariants, mirrored contract tests, and
centralized row mapping reduce this risk.

### Layer refactor breadth

Changing the weekly port from rendered-output reads to ledger-data reads touches
tests and report function signatures. Keeping HTTP contracts, formulas, and
ordering unchanged contains the blast radius, and the cleaner separation makes
the store-selection guarantee testable without Fastify or real databases.
