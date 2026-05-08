---
title: Clean Architecture Seam for Candle Ingestion (Domain → Ports → Adapters)
date: 2026-05-08
category: best-practices
module: engine
problem_type: best_practice
component: service_object
severity: medium
applies_when:
  - Extracting tightly-coupled IO logic into a testable domain layer
  - Adding a second storage backend (SQLite → Postgres) without duplicating business logic
  - Designing port interfaces that support both synchronous and async adapters
  - Using the withIngestLock / session pattern for transactional writes
  - Maintaining backward compatibility while refactoring a module boundary
symptoms:
  - Domain logic entangled with SQL/framework dependencies
  - Can't unit-test business rules without database or HTTP fixtures
  - Adding a second persistence adapter requires touching core logic
root_cause: missing_abstraction
resolution_type: workflow_improvement
related_components:
  - domain/candle
  - application/ports
  - application/use-cases
  - adapters/sqlite
  - adapters/postgres
  - ledger/candlesWriter
  - ledger/candleStore
  - http/routes
tags:
  - clean-architecture
  - ports-and-adapters
  - unit-of-work
  - dependency-inversion
  - sqlite
  - postgres
  - candle-ingestion
  - regime-engine
---

# Clean Architecture Seam for Candle Ingestion (Domain → Ports → Adapters)

## Context

Candle ingestion logic was tightly coupled in `src/ledger/`: `candleRevisionLogic.ts` held pure domain logic but lived alongside IO-bound code; `candlesWriter.ts` was synchronous, calling `db.prepare()`/`db.exec()` directly; `candleStore.ts` was async with Drizzle operations; HTTP handlers branched on `DATABASE_URL` with if/else to pick SQLite or PG. This made business logic untestable in isolation, duplicated across two storage backends, and forced any new backend to duplicate the classification/revision policy.

## Guidance

### Layer into Domain → Application → Adapters

**Domain layer** (`src/domain/candle/candleRevision.ts`): Pure logic with zero framework or IO imports. Only imports from `contract/v1/` (canonical.js, hash.js).

```typescript
// src/domain/candle/candleRevision.ts — no IO, no DB, no framework
export const classifyCandle = (
  existing: ExistingLatest | undefined,
  ohlcvHash: string,
  incomingSourceRecordedAtUnixMs: number
): CandleDecision => { ... };
```

**Application layer** (`src/application/ports/`, `src/application/use-cases/`): Port interfaces and use-case orchestration. Ports express what the use case needs, not how it's implemented.

```typescript
// src/application/ports/candlePorts.ts
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

```typescript
// src/application/ports/clock.ts
export interface ClockPort {
  nowUnixMs(): number;
}
```

The use case orchestrates the full policy through ports — never touches SQL, Drizzle, or SQLite APIs:

```typescript
// src/application/use-cases/IngestCandlesUseCase.ts
export const createIngestCandlesUseCase = (
  deps: IngestCandlesUseCaseDeps
): IngestCandlesUseCase => {
  return async (input, receivedAtUnixMs) => {
    await deps.candleWritePort.withIngestLock(feed, unixMsValues, async (session) => {
      const existingBySlot = await session.readLatestRevisions(unixMsValues);
      // classify each candle via domain logic
      // upsert revisions through the session
      if (accepted.length > 0) {
        await session.insertRevisions(accepted);
      }
    });
  };
};
```

### Use `withIngestLock` (UnitOfWork) for transactional writes

Both adapters implement `CandleWritePort.withIngestLock()` which scopes the session lifecycle — the caller never sees commit/rollback:

**SQLite** — `BEGIN IMMEDIATE` locks the database, implicit commit on success, explicit `ROLLBACK` on error:

```typescript
// src/adapters/sqlite/SqliteCandleRevisionUnitOfWork.ts
export const createSqliteCandleRevisionUnitOfWork = (store: LedgerStore): CandleWritePort => {
  return {
    withIngestLock: async (feed, _unixMsValues, fn) => {
      store.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(buildSession(store, feed));
        store.db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          store.db.exec("ROLLBACK");
        } catch (rollbackError) {
          /* log */
        }
        throw error;
      }
    }
  };
};
```

**Postgres** — uses Drizzle's `db.transaction()` with `pg_advisory_xact_lock`:

```typescript
// src/adapters/postgres/PostgresCandleRevisionUnitOfWork.ts
export const createPostgresCandleRevisionUnitOfWork = (db: Db): CandleWritePort => {
  return {
    withIngestLock: async (feed, _unixMsValues, fn) => {
      const lockKey = feedHash(feed);
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
        const session: CandleIngestSession = { readLatestRevisions: ..., insertRevisions: ... };
        return fn(session);
      });
    }
  };
};
```

### Compose adapters in routes, not in handlers

`src/http/routes.ts` constructs the right adapter based on `DATABASE_URL` and injects it into the handler — no if/else branching in the handler itself.

### Preserve backward-compatible wrappers

`src/ledger/candlesWriter.ts` and `src/ledger/candleStore.ts` are thin wrappers delegating to the new adapters + use case, so existing imports continue to work:

```typescript
// src/ledger/candlesWriter.ts (backward-compatible wrapper)
export const writeCandles = async (store, input, receivedAtUnixMs) => {
  const useCase = createIngestCandlesUseCase({
    candleWritePort: createSqliteCandleRevisionUnitOfWork(store)
  });
  return useCase(input, receivedAtUnixMs);
};
```

### Ports enable fake implementations for unit tests

Because the use case depends on `CandleWritePort` and `ClockPort`, tests inject in-memory fakes — no SQLite or PG required to test classification logic or revision policy.

```typescript
// src/application/use-cases/__tests__/fakes/FakeCandleWritePort.ts
export const createFakeCandleWritePort = (): CandleWritePort => ({
  withIngestLock: async (_feed, _unixMs, fn) => fn(fakeSession)
});
```

## Why This Matters

Without this seam: (1) domain logic can't be unit-tested without a real database; (2) adding a storage backend means copy-pasting business logic; (3) HTTP handlers couple to storage mechanics. With the seam: domain logic is pure and testable, adapters are swappable, and new backends only need to implement the port interfaces. The `withIngestLock` pattern guarantees each backend uses its native concurrency primitive (SQLite `BEGIN IMMEDIATE` vs PG advisory lock) without the use case needing to know.

## When to Apply

- Any module where business logic is entangled with IO (DB, HTTP, filesystem)
- Adding a second storage backend or transport to an existing feature
- When handlers contain if/else branching for backend selection
- When you need to unit-test policy without standing up infrastructure
- When you want transactional semantics to be a port-implementation detail, not a caller concern

## Examples

### Before: Tightly coupled ledger code with direct DB calls

```typescript
// src/ledger/candlesWriter.ts (old) — synchronous, raw SQL inline
export const writeCandles = (
  store: LedgerStore,
  input: CandleIngestRequest,
  receivedAtUnixMs: number
): CandleIngestResponse => {
  // Direct db.prepare() calls mixed with classification logic
  const stmt = store.db.prepare(`SELECT ... FROM candle_revisions ...`);
  // Business logic and IO interleaved
};
```

```typescript
// HTTP handler (old) — if/else on DATABASE_URL
if (pgConnectionString) {
  const result = await candleStore.writeCandles(input, receivedAtUnixMs);
} else {
  const result = writeCandles(ledgerStore, input, receivedAtUnixMs);
}
```

### After: Domain → Ports → Adapters layered approach

```typescript
// Domain — pure, no IO
export const classifyCandle = (existing, ohlcvHash, timestamp) => { ... };

// Application — orchestrates through ports
export const createIngestCandlesUseCase = (deps) => {
  return async (input, receivedAtUnixMs) => {
    await deps.candleWritePort.withIngestLock(feed, unixMsValues, async (session) => {
      const existing = await session.readLatestRevisions(unixMsValues);
      // ... classify, insert
    });
  };
};

// Routes — compose and inject, no branching in handlers
const writePort = pgConnectionString
  ? createPostgresCandleRevisionUnitOfWork(db)
  : createSqliteCandleRevisionUnitOfWork(store);
```

### Before: Synchronous function signatures mixing IO and logic

```typescript
// Old — synchronous, can't be tested without SQLite
export const writeCandles = (store, input, receivedAtUnixMs) => { ... };
```

### After: Async port interfaces with testable fakes

```typescript
// Port interface — any implementation satisfies it
export interface CandleWritePort {
  withIngestLock<T>(feed, unixMsValues, fn: (session) => Promise<T>): Promise<T>;
}

// Fake for tests — no DB needed
const fakeWritePort: CandleWritePort = {
  withIngestLock: async (_feed, _unixMs, fn) => fn(fakeSession)
};
```

## Related

- [dependency-cruiser-boundary-guardrail-configuration-2026-05-07](./dependency-cruiser-boundary-guardrail-configuration-2026-05-07.md) — Guardrails that enforce the domain/application/adapters layer boundaries this seam extraction follows
- [fastify-sqlite-ingestion-endpoint-patterns-2026-04-18](./fastify-sqlite-ingestion-endpoint-patterns-2026-04-18.md) — Documents the previous dual-path handler pattern that this seam extraction replaces with DI
- [sqlite-to-postgres-drizzle-orm-migration-2026-04-29](./sqlite-to-postgres-drizzle-orm-migration-2026-04-29.md) — Documents the `candleStore ? ... : ...` branching that port injection eliminates
- [pg-dependent-route-test-isolation-2026-04-30](../developer-experience/pg-dependent-route-test-isolation-2026-04-30.md) — Documents `{} as never` mock pain that port fakes directly address
