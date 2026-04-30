---
title: "Additive API Versioning: Postgres-Backed v2 Slices Alongside SQLite v1"
date: "2026-04-30"
category: best-practices
module: contract,http,ledger
problem_type: best_practice
component: database
severity: high
applies_when:
  - Adding a v2 (or vN) API endpoint alongside an existing v1 without modifying v1
  - Choosing between flat columns and JSON blobs in Drizzle for structured thesis payloads
  - Building idempotent ingestion with three outcomes (created/idempotent/conflict)
  - Computing content hashes for dedup where auto-generated fields must be excluded
  - Injecting optional Postgres stores alongside required SQLite stores
  - Sharing auth utilities across API versions without coupling error envelope versions
tags:
  - additive-versioning
  - postgres
  - drizzle
  - idempotency
  - canonical-json
  - hash-dedup
  - store-context
  - dual-store
  - error-envelopes
  - schema-versioning
related_issues:
  - 21
related_docs:
  - postgres-schema-isolation-2026-04-28
  - sqlite-to-postgres-drizzle-orm-migration-2026-04-29
  - fastify-sqlite-ingestion-endpoint-patterns-2026-04-18
  - health-probe-separation-and-coverage-2026-04-28
  - pg-dependent-route-test-isolation-2026-04-30
---

# Additive API Versioning: Postgres-Backed v2 Slices Alongside SQLite v1

## Context

Regime Engine's original `/v1/sr-levels` endpoint uses SQLite for storage with `"1.0"` error envelopes. When the team needed a richer thesis model (flat columns for timeframe, bias, setupType, supportLevels, etc.) and Postgres-backed storage for concurrent reads, the question was how to add it without breaking v1. The answer: an **additive v2 slice** — new `/v2/sr-levels` routes backed by Postgres, with their own `"2.0"` error envelopes, independent contract schemas, and a separate idempotency model. The v1 SQLite routes remain untouched.

This pattern emerged after several non-obvious pitfalls: reusing v1's `"1.0"` schemaVersion in v2 error envelopes, using JSON blob columns instead of flat columns, and forgetting to null-check the Postgres store before querying.

## Guidance

### 1. Drizzle schema with flat columns in non-default pgSchema

Use flat typed columns instead of JSON blobs. This gives you type safety, indexable fields, and deterministic serialization. All tables must live in the `regime_engine` schema, defined via `pgSchema`:

```typescript
// src/ledger/pg/schema/srThesesV2.ts
import {
  bigint, index, serial, text, uniqueIndex, varchar
} from "drizzle-orm/pg-core";
import { regimeEngine } from "./candleRevisions.js";

export const srThesesV2 = regimeEngine.table(
  "sr_theses_v2",
  {
    id: serial("id").primaryKey(),
    schemaVersion: varchar("schema_version", { length: 16 }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    symbol: varchar("symbol", { length: 64 }).notNull(),
    briefId: varchar("brief_id", { length: 256 }).notNull(),
    sourceRecordedAtIso: text("source_recorded_at_iso"),
    summary: text("summary"),
    capturedAtIso: varchar("captured_at_iso", { length: 64 }),
    capturedAtUnixMs: bigint("captured_at_unix_ms", { mode: "number" }),
    asset: varchar("asset", { length: 64 }).notNull(),
    timeframe: varchar("timeframe", { length: 64 }).notNull(),
    bias: text("bias"),
    setupType: text("setup_type"),
    supportLevels: text("support_levels").notNull().array().notNull(),
    resistanceLevels: text("resistance_levels").notNull().array().notNull(),
    entryZone: text("entry_zone"),
    targets: text("targets").notNull().array().notNull(),
    invalidation: text("invalidation"),
    triggerText: text("trigger_text"),
    chartReference: text("chart_reference"),
    sourceHandle: varchar("source_handle", { length: 256 }).notNull(),
    sourceChannel: text("source_channel"),
    sourceKind: text("source_kind"),
    sourceReliability: text("source_reliability"),
    rawThesisText: text("raw_thesis_text"),
    collectedAtIso: text("collected_at_iso"),
    publishedAtIso: text("published_at_iso"),
    sourceUrl: text("source_url"),
    notes: text("notes"),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_sr_theses_v2_idempotency").on(
      t.source, t.symbol, t.briefId, t.asset, t.sourceHandle
    ),
    index("idx_sr_theses_v2_symbol_received").on(
      t.symbol, t.source, t.capturedAtUnixMs, t.id
    ),
    index("idx_sr_theses_v2_source_brief").on(
      t.source, t.briefId, t.capturedAtUnixMs, t.id
    )
  ]
);
```

Key points:
- Import `regimeEngine` from the existing schema module — never redefine `pgSchema("regime_engine")`
- Use `.array()` on `text()` columns for PostgreSQL `TEXT[]`
- Use `bigint("...", { mode: "number" })` so Drizzle returns JS numbers, not BigInt objects
- The unique index on `(source, symbol, briefId, asset, sourceHandle)` is the idempotency key

### 2. V2 error envelopes must use their own schemaVersion — never reuse v1's "1.0"

This is the single most important lesson. V1 error envelopes hardcode `"1.0"` via `SCHEMA_VERSION` from `src/contract/v1/types.ts`. If v2 imports v1's helper functions, the error responses will claim `"schemaVersion": "1.0"` even though v2 requests require `"2.0"`. This breaks clients that route on schemaVersion.

V2 must have its own error module:

```typescript
// src/contract/v2/errors.ts
export const V2_SCHEMA_VERSION = "2.0" as const;
export type V2SchemaVersion = typeof V2_SCHEMA_VERSION;

export const V2_ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  UNAUTHORIZED: "UNAUTHORIZED",
  SERVER_MISCONFIGURATION: "SERVER_MISCONFIGURATION",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  SR_THESIS_V2_CONFLICT: "SR_THESIS_V2_CONFLICT",
  SR_THESIS_V2_NOT_FOUND: "SR_THESIS_V2_NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export interface V2ErrorEnvelope {
  schemaVersion: V2SchemaVersion;
  error: {
    code: V2ErrorCode;
    message: string;
    details: ErrorDetail[];
  };
}
```

**What to share:** Low-level utilities like `ErrorDetail`, `zodIssueToDetails`, `stableSortDetails`, `ERROR_DETAIL_CODES` from `src/http/errors.ts`.

**What NOT to share:** `SCHEMA_VERSION`, `ErrorEnvelope` type, or any factory function that bakes in `"1.0"`.

To share the low-level utilities, export them from the v1 error module:

```typescript
// src/http/errors.ts — add these exports
export { zodIssueToDetails } from "./zodIssueToDetails.js";
export { stableSortDetails } from "./stableSortDetails.js";
```

Then import them in v2 without importing any v1 envelope code:

```typescript
// src/contract/v2/errors.ts
import { zodIssueToDetails, stableSortDetails } from "../../http/errors.js";
// NOT: import { SCHEMA_VERSION } from "../v1/types.js"
```

### 3. Idempotent batch insert: ON CONFLICT DO NOTHING + hash conflict detection

The idempotency contract is:
- Same `(source, symbol, briefId, asset, sourceHandle)` + same payload → `200 already_ingested`
- Same identity key, different payload → `409 conflict`
- New identity key → `201 created`

This requires a two-phase check inside a transaction:

```typescript
// src/ledger/srThesesV2Store.ts — insertBrief method
public async insertBrief(
  input: SrThesesV2InsertInput
): Promise<SrThesesV2InsertResult> {
  const { request, capturedAtUnixMs } = input;
  const receivedAtUnixMs = Date.now();

  return this.db.transaction(async (tx) => {
    let insertedCount = 0;
    let idempotentCount = 0;

    for (const thesis of request.theses) {
      const { hash } = computeSrThesisV2CanonicalAndHash(request, thesis);

      const inserted = await tx
        .insert(srThesesV2)
        .values({ /* ... all flat columns ... */ payloadHash: hash, receivedAtUnixMs })
        .onConflictDoNothing({
          target: [
            srThesesV2.source, srThesesV2.symbol,
            srThesesV2.briefId, srThesesV2.asset, srThesesV2.sourceHandle
          ]
        })
        .returning();

      if (inserted.length > 0) {
        insertedCount += 1;
        continue;
      }

      // ON CONFLICT did nothing — fetch the existing row to compare hashes
      const existing = await tx
        .select()
        .from(srThesesV2)
        .where(and(
          eq(srThesesV2.source, request.source),
          eq(srThesesV2.symbol, request.symbol),
          eq(srThesesV2.briefId, request.brief.briefId),
          eq(srThesesV2.asset, thesis.asset),
          eq(srThesesV2.sourceHandle, thesis.sourceHandle)
        ))
        .limit(1);

      const row = existing[0];
      if (!row) {
        throw new Error(
          "append-only invariant violated: ON CONFLICT did not insert but no existing row found"
        );
      }
      if (row.payloadHash !== hash) {
        // Same identity, different content → 409 conflict
        throw new SrThesisV2ConflictError({
          source: request.source,
          symbol: request.symbol,
          briefId: request.brief.briefId,
          asset: thesis.asset,
          sourceHandle: thesis.sourceHandle
        });
      }
      // Same identity, same content → idempotent replay
      idempotentCount += 1;
    }

    if (insertedCount > 0) {
      return { status: "created", insertedCount, idempotentCount };
    }
    return { status: "already_ingested", insertedCount: 0, idempotentCount };
  });
}
```

Why `onConflictDoNothing` + re-query instead of `onConflictDoUpdate`? Because we need three-way branching (created / idempotent / conflict), and `ON CONFLICT DO UPDATE` can only distinguish two. The re-query is inside the same transaction, so it's consistent.

### 4. Canonical JSON hashing for dedup — exclude auto-generated fields

The hash input for dedup must be **deterministic** — the same logical content always produces the same hash. Auto-generated fields (`id`, `capturedAtUnixMs`, `receivedAtUnixMs`, `payloadHash`) must be excluded:

```typescript
// src/contract/v2/srLevels.ts
export const computeSrThesisV2CanonicalAndHash = (
  request: SrLevelsV2IngestRequest,
  thesis: SrThesisV2
): { canonical: string; hash: string } => {
  const canonical = toCanonicalJson({
    schemaVersion: request.schemaVersion,
    source: request.source,
    symbol: request.symbol,
    brief: request.brief,
    thesis
  });
  return { canonical, hash: sha256Hex(canonical) };
};
```

This reuses v1's `toCanonicalJson` (deterministic key sorting, no whitespace) and `sha256Hex`. The input object explicitly includes only the fields that define content identity:

- `schemaVersion`, `source`, `symbol` — request-level context
- `brief` — brief-level metadata
- `thesis` — the per-thesis payload

**Crucially excluded:** `id`, `capturedAtUnixMs`, `receivedAtUnixMs`, `payloadHash`. These differ between replays of the same content and would break idempotency.

### 5. StoreContext injection for Postgres alongside SQLite — null-check → 503 pattern

When Postgres (`DATABASE_URL`) is not configured, the v2 store is `null`. Handlers must check before every operation:

```typescript
// src/http/handlers/srLevelsV2Ingest.ts
export const createSrLevelsV2IngestHandler = (
  store: SrThesesV2Store | null
) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // ... auth check first ...
    if (!store) {
      return reply.code(503).send(
        serviceUnavailableV2Error(
          "S/R thesis v2 store is not available (no DATABASE_URL configured)"
        )
      );
    }
    // ... proceed with store ...
  };
};
```

The `StoreContext` bundles all stores and gracefully handles the absence of PG:

```typescript
// src/ledger/storeContext.ts
export interface StoreContext {
  ledger: LedgerStore;                              // always present (SQLite)
  pg: Db;                                            // always present if DATABASE_URL set
  pgClient: { end: () => Promise<void> };
  candleStore: CandleStore;
  insightsStore: InsightsStore;
  srThesesV2Store: SrThesesV2Store;
}

// In routes.ts:
const srThesesV2Store = storeContext?.srThesesV2Store ?? null;
app.post("/v2/sr-levels", createSrLevelsV2IngestHandler(srThesesV2Store));
```

The 503 response tells clients "this server doesn't support v2" rather than misleading with a 500. This is the same pattern used for `/v1/insights/sol-usdc` and `/v1/candles`.

### 6. Auth token handler separation — `safeEqual` as a standalone export

V1's auth lives in `requireSharedSecret()` which throws `AuthError` embedding v1's `SCHEMA_VERSION`. V2 needed its own auth flow with v2 error envelopes. The solution: extract `safeEqual` as a standalone export from `auth.ts`, keeping it version-agnostic:

```typescript
// src/http/auth.ts
import { timingSafeEqual } from "node:crypto";

export const safeEqual = (a: string, b: string): boolean => {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
};
```

V2 handlers use it directly with v2 error responses:

```typescript
// src/http/handlers/srLevelsV2Ingest.ts
import { safeEqual } from "../auth.js";

const token = process.env[ENV_VAR];
if (!token) {
  return reply.code(500).send(serverMisconfigurationV2Error(ENV_VAR));
}
const provided = request.headers[HEADER];
if (!provided || !safeEqual(String(provided), token)) {
  return reply.code(401).send(unauthorizedV2Error());
}
```

This avoids importing v1's `SCHEMA_VERSION` into v2 code while still using timing-safe comparison.

## Why This Matters

- **Reusing v1's `"1.0"` schemaVersion in v2 error responses** silently breaks clients that route on schemaVersion. A client receiving `{"schemaVersion":"1.0","error":{...}}` from a `/v2/` endpoint will misinterpret the error. V2 has its own error module with `V2_SCHEMA_VERSION = "2.0"` — this is non-negotiable.

- **Flat columns vs JSON blobs** — JSON blobs are opaque to queries, indexes, and Drizzle's type system. Flat columns let you index `symbol`, `timeframe`, `bias` individually and get type-safe queries. The original T1 schema used `brief text` and `thesis text` (JSON blobs); this was corrected to flat columns during implementation.

- **Idempotent 3-way branching cannot be done with `ON CONFLICT DO UPDATE`** — that only distinguishes "inserted" vs "updated". The `onConflictDoNothing` + re-query pattern inside a transaction gives you created/idempotent/conflict as distinct outcomes.

- **Canonical hash must exclude server-generated fields** — including `capturedAtUnixMs` or `receivedAtUnixMs` would make identical replays produce different hashes, breaking idempotency.

- **Null-store → 503 is honest** — a 500 implies a bug; a 503 tells the client the service intentionally doesn't support this capability. This matters for clients that route between v1-only and v1+v2 servers.

- **Extracting `safeEqual`** avoids importing v1's `SCHEMA_VERSION` into v2 handlers while keeping timing-safe auth comparison. The alternative (reimplementing `timingSafeEqual`) is duplication; importing `requireSharedSecret` couples v2 to v1's error format.

## When to Apply

- Adding any v2 (or vN) API endpoint alongside an existing v1 without modifying v1
- Choosing between flat columns and JSON blobs in Drizzle — prefer flat columns unless you truly need schemaless data
- Building idempotent ingestion with three outcomes (created/idempotent/conflict) — use `ON CONFLICT DO NOTHING` + re-query
- Computing content hashes for dedup — always exclude auto-generated fields (IDs, timestamps, the hash itself)
- Injecting optional Postgres stores alongside required SQLite stores — use `StoreContext | null` and return 503 when null
- Sharing auth utilities across API versions — extract version-agnostic primitives (`safeEqual`) rather than versioned error-throwing functions
- Creating new error envelope modules for new API versions — never import or reuse the old version's `schemaVersion` constant

## Examples

### Before: Reusing v1 error helpers in v2 (WRONG)

```typescript
// PROBLEM: v2 error response claims "1.0"
import { validationErrorFromZod } from "../../http/errors.js";

throw validationErrorFromZod("Invalid request", issues);
// → { "schemaVersion": "1.0", "error": { ... } }
// Client expects "2.0" from /v2/ routes!
```

### After: V2 has its own error module (CORRECT)

```typescript
import { V2_SCHEMA_VERSION, validationErrorV2FromZod } from "../../contract/v2/errors.js";

throw validationErrorV2FromZod("Invalid request", issues);
// → { "schemaVersion": "2.0", "error": { ... } }
```

### Before: JSON blob columns (loses type safety and indexability)

```typescript
// BAD — opaque JSON, no typed queries, no per-column indexes
const srThesesV2 = regimeEngine.table("sr_theses_v2", {
  brief: text("brief").notNull(),      // JSON string
  thesis: text("thesis").notNull(),     // JSON string
});
// Can't do: WHERE timeframe = '1h' AND bias = 'bullish'
```

### After: Flat columns (type-safe, indexable)

```typescript
const srThesesV2 = regimeEngine.table("sr_theses_v2", {
  timeframe: varchar("timeframe", { length: 64 }).notNull(),
  bias: text("bias"),
  setupType: text("setup_type"),
  supportLevels: text("support_levels").notNull().array().notNull(),
  // ... etc
});
// Can index and query: WHERE timeframe = '1h' AND bias = 'bullish'
```

### Before: Auth importing v1's schema version

```typescript
import { requireSharedSecret } from "../auth.js";
// This embeds SCHEMA_VERSION ("1.0") in the 401/500 error response
```

### After: Auth using standalone `safeEqual`

```typescript
import { safeEqual } from "../auth.js";

const token = process.env[ENV_VAR];
if (!token) {
  return reply.code(500).send(serverMisconfigurationV2Error(ENV_VAR));
}
const provided = request.headers[HEADER];
if (!provided || !safeEqual(String(provided), token)) {
  return reply.code(401).send(unauthorizedV2Error());
}
// Error responses use V2_SCHEMA_VERSION = "2.0"
```

### Canonical hash: what goes in, what stays out

```typescript
// INCLUDED in the hash input (defines content identity):
{
  schemaVersion: "2.0",
  source: "telecope",
  symbol: "SOL/USDC",
  brief: { briefId: "b1", ... },
  thesis: { asset: "SOL", timeframe: "1h", ... }
}

// EXCLUDED from the hash input (differ between replays):
// id, capturedAtIso, capturedAtUnixMs, receivedAtUnixMs, payloadHash
```

## Related

- `docs/solutions/best-practices/postgres-schema-isolation-2026-04-28.md` — PG schema isolation pattern, StoreContext design, Drizzle migration setup, connection configuration
- `docs/solutions/best-practices/sqlite-to-postgres-drizzle-orm-migration-2026-04-29.md` — `pgSchema` usage, `doublePrecision` vs `real`, advisory locks, raw SQL type coercion, schema qualification
- `docs/solutions/best-practices/fastify-sqlite-ingestion-endpoint-patterns-2026-04-18.md` — v1 SQLite ingestion patterns that v2 parallels in Postgres (canonical JSON, idempotency, auth, error envelopes)
- `docs/solutions/best-practices/health-probe-separation-and-coverage-2026-04-28.md` — Health probe patterns for dual-store (null → `not_configured`, unavailable → `unavailable`)
- `docs/solutions/developer-experience/pg-dependent-route-test-isolation-2026-04-30.md` — Testing patterns for PG-dependent routes (`describe.skipIf`, StoreContext mock propagation, OpenAPI path counts)
- Issue #21: v2 S/R Levels — Raw Thesis Storage Endpoint (open)
- Issue #22: Postgres schema isolation (closed — prerequisite)