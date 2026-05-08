# Candle Ingestion Seam Design

**Issue:** #38
**Date:** 2026-05-08
**Status:** Approved

## Problem

The candle ingestion path is one of the highest-risk parts of Regime Engine
because it owns revision semantics, idempotency, stale-revision rejection, batch
behavior, and SQLite/Postgres parity. Today those rules are split across the
HTTP handler, SQLite writer, Postgres store, and a pure helper that still lives
under `src/ledger`.

#38 extracts an explicit domain/application seam for candle ingestion while
preserving the current HTTP contract and storage behavior exactly.

## Goals

- Move or wrap pure candle revision logic under `src/domain/candle`.
- Add application ports for candle writes, candle reads, and time.
- Add `IngestCandlesUseCase` for POST `/v1/candles`.
- Keep ingestion policy testable without Fastify, SQLite, or Postgres.
- Preserve existing SQLite fallback behavior when `DATABASE_URL` is absent.
- Preserve existing Postgres behavior when `DATABASE_URL` is present.
- Add both read and write candle adapters for SQLite and Postgres.
- Keep the current response shape, count semantics, and rejection details.

## Non-Goals

- Do not extract `GetCurrentRegimeUseCase`.
- Do not thin or redesign `GET /v1/regime/current`; that belongs to #39.
- Do not change regime candle read planning, aggregation, freshness, or
  classification behavior.
- Do not change plan generation or report generation.
- Do not decouple engine code from `contract/v1` types.
- Do not change candle migration SQL unless a test proves it is required.

## Current Shape

Current code already has the behavior that must be preserved:

- `src/http/handlers/candlesIngest.ts` authenticates, parses, chooses the
  Postgres or SQLite path, calls `Date.now()`, and returns the response.
- `src/ledger/candleStore.ts` owns Postgres ingestion orchestration, including
  transaction, advisory lock, latest-row selection, classification calls, and
  inserts.
- `src/ledger/candlesWriter.ts` owns SQLite fallback ingestion, including
  `BEGIN IMMEDIATE`, latest-row selection, classification calls, and inserts.
- `src/ledger/candleRevisionLogic.ts` contains pure `computeOhlcv` and
  `classifyCandle`, but its location is in the storage layer.
- `src/http/handlers/regimeCurrent.ts` uses the same current data access
  functions to read latest candles for regime classification.

## Design Decisions

| Decision               | Choice                     | Rationale                                                                                                       |
| ---------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Ingestion policy owner | `IngestCandlesUseCase`     | The policy becomes testable without HTTP or database dependencies.                                              |
| Transaction boundary   | Storage-owned unit of work | The read/classify/write loop must run inside the same SQLite transaction or Postgres transaction/advisory lock. |
| Domain extraction      | `src/domain/candle`        | OHLCV hashing and revision classification are pure domain rules and should not live under `src/ledger`.         |
| Read port timing       | Add now, use minimally     | #38 adds read adapters for symmetry and #39 prep, but avoids redesigning regime-current.                        |
| HTTP contract          | Preserve exactly           | Existing clients should see the same response shapes, status codes, and error payloads.                         |

## Target Structure

```text
src/domain/candle/
  candleRevision.ts
  __tests__/

src/application/ports/
  candlePorts.ts
  clock.ts

src/application/use-cases/
  IngestCandlesUseCase.ts
  __tests__/

src/adapters/postgres/
  PostgresCandleReadAdapter.ts
  PostgresCandleRevisionUnitOfWork.ts

src/adapters/sqlite/
  SqliteCandleReadAdapter.ts
  SqliteCandleRevisionUnitOfWork.ts
```

Exact filenames may be adjusted during implementation to match local naming
conventions, but the ownership boundaries should remain stable.

## Domain Layer

`src/domain/candle` owns pure candle revision rules:

- OHLCV canonical JSON and hash calculation.
- Latest-revision value shape used for classification.
- `classifyCandle(existing, incomingOhlcvHash, incomingSourceRecordedAtUnixMs)`.
- Accepted revision value construction helpers if they keep the use case clear.

The domain layer may import pure contract helpers such as canonical JSON and
hashing. It must not import HTTP, ledger, adapters, database packages, workers,
`process`, or `process.env`.

Classification remains exactly:

- No latest revision means `insert`.
- Same OHLCV hash means `idempotent`, regardless of source-recorded timestamp.
- Different OHLCV with a newer incoming `sourceRecordedAtUnixMs` means `revise`.
- Different OHLCV with an older or equal incoming source timestamp means
  `stale`, returning the latest stored `existingSourceRecordedAtIso`.

## Application Ports

### `ClockPort`

```ts
export interface ClockPort {
  nowUnixMs(): number;
}
```

The HTTP/composition layer injects a real clock. Tests can inject a fixed clock.

### `CandleReadPort`

```ts
export interface CandleReadPort {
  getLatestCandlesForFeed(params: GetLatestCandlesParams): Promise<CandleRow[]>;
}
```

This port supports latest-candle reads needed by `GET /v1/regime/current` and
future #39 work. In #38, any regime-current change should be mechanical and
behavior-identical.

### `CandleWritePort` / `CandleRevisionUnitOfWork`

The ingest path must not be modeled as loose read and write calls with no shared
transaction boundary. The write-side application port is intentionally a
storage-owned lock/session:

```ts
export interface CandleWritePort {
  withIngestLock<T>(
    feed: CandleFeed,
    unixMsValues: number[],
    fn: (session: CandleIngestSession) => Promise<T>
  ): Promise<T>;
}

export interface CandleIngestSession {
  readLatestRevisions(unixMsValues: number[]): Promise<Map<number, ExistingLatestCandleRevision>>;
  insertRevisions(revisions: CandleRevisionInsert[]): Promise<void>;
}
```

The implementation may use `CandleRevisionUnitOfWork` as the concrete interface
or type alias if that makes the transaction semantics clearer, but there should
not be a separate loose write port that inserts revisions outside the ingest
lock/session.

The unit of work owns transaction and lock mechanics. The use case owns policy
inside the callback.

## Use Case

`IngestCandlesUseCase` accepts a parsed `CandleIngestRequest` and a
`receivedAtUnixMs` value, then returns `Omit<CandleIngestResponse,
"schemaVersion">`.

The use case owns:

1. Deriving the feed from the request.
2. Parsing `sourceRecordedAtIso` into `incomingSourceRecordedAtUnixMs`.
3. Building `unixMsValues` from the incoming candles.
4. Calling `candleWritePort.withIngestLock(feed, unixMsValues, callback)`.
5. Reading latest revisions through the session inside the callback.
6. Computing OHLCV canonical JSON and hash for each candle.
7. Classifying each candle as insert, idempotent, revise, or stale.
8. Building accepted revision insert objects for insert/revise decisions.
9. Counting inserted, revised, idempotent, rejected outcomes.
10. Recording stale rejections with `existingSourceRecordedAtIso`.
11. Calling `session.insertRevisions` with accepted revisions.
12. Sorting rejections by `unixMs`.
13. Returning the existing response payload shape.

`Date.parse` behavior should remain as today. Contract validation normally
ensures `sourceRecordedAtIso` is valid, but if parsing ever produces an invalid
number, the use case should throw the same generic `Error` shape currently used
by `CandleStore`/`candlesWriter`.

## Adapter Responsibilities

Adapters own persistence mechanics only.

### SQLite

The SQLite unit-of-work adapter must preserve:

- `BEGIN IMMEDIATE`.
- `COMMIT` on success.
- `ROLLBACK` on error.
- Current latest-row selection SQL:
  `ORDER BY source_recorded_at_unix_ms DESC, id DESC LIMIT 1`.
- Current insert columns and stored values.

The SQLite read adapter must preserve `getLatestCandlesForFeed` behavior,
including latest-per-slot ordering, cutoff filtering, limit behavior, and
ascending output order.

### Postgres

The Postgres unit-of-work adapter must preserve:

- Drizzle transaction usage.
- `pg_advisory_xact_lock` keyed by the same feed hash behavior.
- Current batch latest-row selection SQL shape and ordering:
  `sourceRecordedAtUnixMs DESC, id DESC`, first row per slot wins.
- Current insert columns and stored values.
- Bulk insert behavior for accepted revisions.

The Postgres read adapter must preserve the current CTE query behavior, null
guarding, numeric conversion, cutoff filtering, limit behavior, and ascending
output order.

## HTTP Wiring

`createCandlesIngestHandler` should become thin:

1. Authenticate with `requireSharedSecret`.
2. Parse with `parseCandleIngestRequest`.
3. Get `receivedAtUnixMs` from `ClockPort`.
4. Call `IngestCandlesUseCase`.
5. Add `schemaVersion: SCHEMA_VERSION`.
6. Preserve current auth, validation, and internal-error mapping.

`registerRoutes` or composition code should choose SQLite or Postgres adapters
based on the same `DATABASE_URL` behavior used today.

`GET /v1/regime/current` should not be redesigned in #38. If needed, its
constructor can switch from `(LedgerStore, CandleStore?)` to a single
`CandleReadPort`, but the handler should keep its existing planning,
aggregation, freshness, and classification logic.

## Error Handling

HTTP-visible errors remain unchanged:

- Missing or invalid ingest token returns the current auth error response.
- Missing `CANDLES_INGEST_TOKEN` returns `SERVER_MISCONFIGURATION`.
- Contract validation still returns existing error codes and payloads for:
  - unsupported schema version
  - validation errors
  - `BATCH_TOO_LARGE`
  - `DUPLICATE_CANDLE_IN_BATCH`
  - `MALFORMED_CANDLE`
- Unexpected use-case or adapter errors still map to `500 INTERNAL_ERROR`.

The use case does not introduce new HTTP error types.

## Behavior Parity

The refactor must preserve:

- Batch duplicate rejection before ingestion policy runs.
- OHLCV validation behavior.
- Insert count semantics.
- Idempotent count semantics.
- Revised count semantics.
- Stale revision rejection semantics.
- Stale rejection shape and `existingSourceRecordedAtIso`.
- Source-recorded timestamp comparison behavior.
- Latest-per-slot semantics.
- Rejection sort order by `unixMs`.
- SQLite fallback when `DATABASE_URL` is absent.
- Postgres path when `DATABASE_URL` is present.
- Existing response shapes and error codes.

## Testing

### Domain Tests

Add tests under `src/domain/candle/__tests__/` for:

- OHLCV canonical/hash determinism.
- `classifyCandle` returns insert when no latest revision exists.
- `classifyCandle` returns idempotent on equal OHLCV hash.
- `classifyCandle` returns revise on changed OHLCV with newer source timestamp.
- `classifyCandle` returns stale on changed OHLCV with older or equal source
  timestamp.

### Use-Case Tests

Add tests under `src/application/use-cases/__tests__/` using an in-memory fake
`CandleWritePort` that enforces callback/session behavior. Cover:

- Inserting brand-new slots.
- Byte-equal replay is idempotent with no new inserts.
- Newer changed OHLCV appends revisions and counts revised slots.
- Older changed OHLCV produces stale rejections.
- Mixed insert/idempotent/revise/stale behavior in one batch.
- Rejections are sorted by `unixMs`.

These tests prove ingestion policy without Fastify, SQLite, or Postgres.

### Adapter And Route Regression Tests

Existing SQLite and Postgres storage tests should keep their current assertions
while moving toward adapter names where practical. Existing HTTP E2E tests for
`POST /v1/candles`, SQLite fallback, and PG behavior must continue to pass
without weakened assertions.

Required validation for the implementation PR:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:pg
npm run build
npm run boundaries
```

If `npm run test:pg` cannot run locally, the PR must explicitly say why and
identify which PG adapter behavior remains locally unvalidated.

## Migration Strategy

The implementation should be behavior-preserving and incremental:

1. Add domain helpers and tests.
2. Add ports and the use case with fake-session tests.
3. Add SQLite adapters by moving logic out of `candlesWriter` or making
   `candlesWriter` a thin compatibility wrapper.
4. Add Postgres adapters by moving logic out of `CandleStore` or making
   `CandleStore` a thin compatibility wrapper.
5. Wire `POST /v1/candles` to the use case.
6. Wire latest-candle reads through `CandleReadPort` only if needed, keeping
   `regimeCurrent` behavior identical.
7. Run the full validation list.

Compatibility wrappers are acceptable during #38 if they reduce churn and keep
existing tests meaningful. They should not preserve duplicate policy
implementations long term.
