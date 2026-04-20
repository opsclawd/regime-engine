---
title: "Fastify + SQLite Ingestion Endpoint Patterns: Auth, Idempotency, Transactions"
date: "2026-04-18"
category: best-practices
module: regime-engine
problem_type: best_practice
component: development_workflow
severity: low
applies_when:
  - adding new ingestion endpoints to a Fastify + SQLite service
  - implementing shared-secret auth on new API routes
  - setting up idempotent writes with canonical-JSON hashing
  - creating transactional ledger writers for domain events
tags:
  - fastify
  - sqlite
  - idempotency
  - auth
  - ingestion
  - transactions
  - canonical-json
related_components:
  - authentication
  - database
---

# Fastify + SQLite Ingestion Endpoint Patterns: Auth, Idempotency, Transactions

## Context

When adding ingestion endpoints (S/R levels, CLMM execution events) to regime-engine's Fastify + SQLite microservice, we needed consistent patterns for auth, idempotency, transactions, error handling, and testing. Without clear patterns, each new endpoint risks implementing these cross-cutting concerns differently, leading to subtle bugs (timing attacks, partial writes, inconsistent error shapes) and duplicated logic.

## Guidance

### 1. Auth: `AuthError` class + `timingSafeEqual` + env-var check

Use a dedicated `AuthError` class (extending `Error`) with `statusCode` and `response` properties. Compare tokens with `crypto.timingSafeEqual` to prevent timing attacks. Missing env var = 500 (server misconfiguration), wrong/missing token = 401.

```typescript
// src/http/auth.ts
export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly response: unknown;
  public constructor(statusCode: number, response: unknown) {
    super("AuthError");
    this.statusCode = statusCode;
    this.response = response;
  }
}

export const requireSharedSecret = (
  headers: IncomingHttpHeaders,
  headerName: string,
  envVar: string
): void => {
  const token = process.env[envVar];
  if (!token) {
    throw new AuthError(500, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: "SERVER_MISCONFIGURATION",
        message: `Server misconfiguration: ${envVar} is not set.`,
        details: []
      }
    });
  }
  const providedValue = headers[headerName.toLowerCase()];
  if (!providedValue || !safeEqual(providedValue, token)) {
    throw new AuthError(401, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing authentication token",
        details: []
      }
    });
  }
};
```

Each endpoint calls with its own header name and env var: `requireSharedSecret(headers, "X-Ingest-Token", "OPENCLAW_INGEST_TOKEN")` or `requireSharedSecret(headers, "X-CLMM-Internal-Token", "CLMM_INTERNAL_TOKEN")`.

### 2. Idempotency: Canonical JSON comparison + domain-specific conflict codes

Serialize the request payload with `toCanonicalJson()` (sorted keys, deterministic numbers), then compare byte-for-byte against the stored `*_json` column. On duplicate: byte-equal → idempotent success (200 with status indicator), different → 409 with a domain-specific error code from `LEDGER_ERROR_CODES`.

```typescript
// src/ledger/srLevelsWriter.ts
const canonicalBrief = toCanonicalJson(input);
const existing = store.db
  .prepare(`SELECT brief_json FROM sr_level_briefs WHERE source = ? AND brief_id = ?`)
  .get(input.source, input.brief.briefId);

if (existing) {
  if (existing.brief_json === canonicalBrief) {
    return { briefId: input.brief.briefId, insertedCount: 0, status: "already_ingested" };
  }
  throw new LedgerWriteError(LEDGER_ERROR_CODES.SR_LEVEL_BRIEF_CONFLICT, `...`);
}
```

Never reuse a generic conflict code — each domain gets its own: `SR_LEVEL_BRIEF_CONFLICT`, `CLMM_EXECUTION_EVENT_CONFLICT`, etc.

### 3. Transactions: `BEGIN IMMEDIATE` for check-then-insert, `runInTransaction` for simple multi-row writes

Any write that inserts into more than one table (or uses a check-then-insert pattern) must run inside a transaction. For check-then-insert patterns (existence check followed by conditional insert), use explicit `BEGIN IMMEDIATE` to acquire the write lock before the SELECT, preventing TOCTOU races. For simple multi-row inserts without existence checks, `runInTransaction()` (deferred `BEGIN`) is sufficient.

**Check-then-insert pattern — use `BEGIN IMMEDIATE`:**

```typescript
// src/ledger/srLevelsWriter.ts / src/ledger/writer.ts
store.db.exec("BEGIN IMMEDIATE");
try {
  const existing = store.db
    .prepare(`SELECT brief_json FROM sr_level_briefs WHERE source = ? AND brief_id = ?`)
    .get(input.source, input.brief.briefId);
  if (existing) {
    /* idempotent or conflict */
  }
  // ... inserts ...
  store.db.exec("COMMIT");
  return result;
} catch (error) {
  try {
    store.db.exec("ROLLBACK");
  } catch (_e) {
    void _e;
  }
  throw error;
}
```

**Simple multi-row insert — use `runInTransaction`:**

```typescript
// src/ledger/store.ts
export const runInTransaction = <T>(store: LedgerStore, operation: () => T): T => {
  store.db.exec("BEGIN");
  try {
    const result = operation();
    store.db.exec("COMMIT");
    return result;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
};
```

Without `BEGIN IMMEDIATE`, a check-then-insert pattern has a TOCTOU race: two concurrent requests could both pass the SELECT check and then one fails with an unhandled SQLite UNIQUE constraint error instead of a proper `LedgerWriteError`. With deferred `BEGIN`, SQLite doesn't acquire the write lock until the first write statement — by then the check has already passed.

### 4. Handler error catching: `AuthError` → `ContractValidationError` → `LedgerWriteError` → rethrow

Every POST handler uses the same catch ordering. All error responses include `schemaVersion`.

```typescript
try {
  requireSharedSecret(request.headers, "X-Ingest-Token", "OPENCLAW_INGEST_TOKEN");
  const body = parseSrLevelBriefRequest(request.body);
  const result = writeSrLevelBrief(store, body);
  // ... success response
} catch (error) {
  if (error instanceof AuthError) return reply.code(error.statusCode).send(error.response);
  if (error instanceof ContractValidationError)
    return reply.code(error.statusCode).send(error.response);
  if (error instanceof LedgerWriteError)
    return reply.code(409).send({
      schemaVersion: SCHEMA_VERSION,
      error: { code: error.code, message: error.message, details: [] }
    });
  throw error;
}
```

### 5. Schema design for new ingestion tables

Add an index on the foreign key column (e.g., `brief_id` in `sr_levels`) and on query patterns (e.g., `symbol, source, captured_at_unix_ms DESC` for "current" queries). Store the canonical JSON of the entire request for idempotency comparison. Use `UNIQUE` constraints on natural keys (`source, brief_id` or `correlation_id`).

### 6. Test patterns for ingestion endpoints

- **Auth failure tests**: Verify response status AND that no DB rows were written (open a fresh `LedgerStore` against the same database file).
- **Idempotency tests**: POST the same payload twice; assert second response includes idempotent indicator and zero new rows.
- **Conflict tests**: POST same natural key with different payload → 409 with domain-specific error code in response body.
- **Transaction rollback test**: Cause a failure mid-transaction and verify both parent and child tables have zero rows.
- **Missing env var → 500**: `delete process.env.TOKEN_VAR`, then POST → 500.

## Why This Matters

- **Timing-safe token comparison** prevents auth bypass via timing side-channels. Using `AuthError` as a class (not a thrown plain object) ensures `instanceof` matching works reliably in catch blocks and produces proper stack traces.
- **Canonical JSON idempotency** means replaying the same HTTP request always succeeds without side effects — critical for at-least-once delivery systems. Byte-equal comparison (not hash) avoids hash collision risks.
- **Transaction wrapping** prevents partial state: a brief without its levels, or an event record without data, would corrupt query results and break determinism.
- **Domain-specific error codes** (`SR_LEVEL_BRIEF_CONFLICT` vs `CLMM_EXECUTION_EVENT_CONFLICT`) let callers distinguish conflict domains without parsing error messages.
- **Consistent error response shape** with `schemaVersion` on every error response (not just success) means callers always know which contract version they're dealing with.

## When to Apply

- Every new **ingestion POST endpoint** (any endpoint that writes to the ledger) must follow the pattern: `AuthError` gate → `parseContract` → `writeInTransaction` → catch ordering.
- Every **read endpoint** that has no auth requirements still needs `ContractValidationError` handling for query parameter validation.
- When adding a new conflict domain, add a new key to `LEDGER_ERROR_CODES` — never reuse an existing code.
- When a write uses a check-then-insert pattern (existence check followed by conditional insert), use `BEGIN IMMEDIATE` to acquire the write lock before the SELECT.
- When a write only needs atomicity across multiple inserts (no existence check), `runInTransaction` is sufficient.

## Examples

**Adding a new ingestion endpoint** (e.g., a hypothetical `POST /v1/vault-snapshot`):

1. Add `VAULT_SNAPSHOT_CONFLICT` to `LEDGER_ERROR_CODES` in `src/ledger/writer.ts`
2. Create `src/ledger/vaultSnapshotWriter.ts` with a `writeVaultSnapshot()` function that:
   - Serializes with `toCanonicalJson()`
   - Checks for existing row by natural key inside a `BEGIN IMMEDIATE` transaction
   - Returns idempotent success or throws `LedgerWriteError(VAULT_SNAPSHOT_CONFLICT, ...)`
   - Uses explicit `COMMIT`/`ROLLBACK` around check-then-insert
3. Create `src/http/handlers/vaultSnapshot.ts` with:
   - `requireSharedSecret(headers, "X-Vault-Token", "VAULT_TOKEN")`
   - Parse with Zod
   - Write with the writer function
   - Catch `AuthError` → `ContractValidationError` → `LedgerWriteError` → rethrow
4. Write e2e tests that verify: auth failure = no DB rows, idempotent replay = no new rows, conflict = 409 with `VAULT_SNAPSHOT_CONFLICT`, missing env var = 500, validation failure = 400.

**Auth-no-DB-write test pattern** (from `src/http/__tests__/srLevels.e2e.test.ts`):

```typescript
it("missing X-Ingest-Token returns 401 without writing", async () => {
  const dbPath = join(tmpdir(), `regime-engine-sr-auth1-${Date.now()}.sqlite`);
  createdDbPaths.push(dbPath);
  process.env.LEDGER_DB_PATH = dbPath;
  process.env.OPENCLAW_INGEST_TOKEN = "test-token";

  const app = buildApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/sr-levels",
    payload: makePayload()
  });
  expect(response.statusCode).toBe(401);
  await app.close();

  const verifyStore = createLedgerStore(dbPath);
  expect(getLedgerCounts(verifyStore).srLevelBriefs).toBe(0);
  verifyStore.close();
});
```

**Transaction rollback test pattern** (from `src/ledger/__tests__/srLevels.test.ts`):

```typescript
it("rolls back brief insertion when level insertion fails mid-transaction", () => {
  store = createLedgerStore(":memory:");
  const levelsWithInvalidType = {
    ...makeBriefRequest(),
    levels: [
      { levelType: "support", price: 140.5 },
      { levelType: "invalid" as unknown as "support" | "resistance", price: 999 }
    ]
  };
  expect(() => writeSrLevelBrief(store, levelsWithInvalidType as SrLevelBriefRequest)).toThrow();
  expect(getLedgerCounts(store)).toEqual(
    expect.objectContaining({
      srLevelBriefs: 0,
      srLevels: 0
    })
  );
});
```

## Related

- `src/contract/v1/canonical.ts` — Canonical JSON serialization implementation
- `src/ledger/store.ts:33` — `runInTransaction` utility (for simple multi-row writes)
- `src/ledger/writer.ts:6` — `LEDGER_ERROR_CODES` registry
- `src/ledger/writer.ts:163` — `BEGIN IMMEDIATE` pattern for `writeClmmExecutionEvent`
- `src/ledger/srLevelsWriter.ts:15` — `BEGIN IMMEDIATE` pattern for `writeSrLevelBrief`
- `src/http/auth.ts:5` — `AuthError` class and `requireSharedSecret`
- `src/http/errors.ts:36` — `ContractValidationError` class
- `docs/superpowers/specs/2026-04-17-clmm-regime-engine-integration-merged.md` — Sprint design spec for U1 and U2
