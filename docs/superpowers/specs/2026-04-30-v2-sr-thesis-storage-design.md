# v2 S/R Thesis Storage Endpoint - Design Spec

- **Issue:** [#21](https://github.com/opsclawd/regime-engine/issues/21)
- **Date:** 2026-04-30
- **Status:** Approved (pre-plan)

## 1. Problem

`/v1/sr-levels` stores transformed support/resistance levels in SQLite. It drops raw thesis fields such as `rawThesisText`, `bias`, `setupType`, `entryZone`, `targets`, `invalidation`, `trigger`, `chartReference`, `sourceChannel`, `sourceKind`, `sourceReliability`, `collectedAt`, `publishedAt`, and `sourceUrl`.

The service needs an additive v2 API that stores and serves the complete raw thesis payload for the latest S/R brief, without changing the v1 endpoint or the SQLite-backed v1 storage path.

## 2. Non-goals

This work must not:

- Change `/v1/sr-levels` request, response, storage, or tests except where route registration tests need awareness of v2 routes.
- Add a shared v1/v2 S/R abstraction.
- Store a raw JSON blob or add join tables.
- Add typed timestamp query columns beyond `captured_at_unix_ms`.
- Call Solana, Orca, Jupiter, or external APIs.
- Treat S/R theses as execution instructions.

If timestamp range queries become necessary later, add derived typed columns or a follow-up migration then.

## 3. Locked Decisions

| Topic | Decision |
| --- | --- |
| Persistence | Postgres via Drizzle in the existing `regime_engine` schema. |
| Table | `sr_theses_v2`, one flat row per thesis. |
| Arrays | Native Postgres `TEXT[]` for `support_levels`, `resistance_levels`, and `targets`. |
| Timestamp fields | `source_recorded_at_iso`, `collected_at_iso`, and `published_at_iso` are `TEXT` for exact round-trip. They are validated as ISO datetimes at the contract boundary but are not normalized before storage, hashing, or response. |
| Ordering | `captured_at_unix_ms BIGINT NOT NULL` is server-generated and used for latest-brief selection. |
| Idempotency | Unique `(source, symbol, brief_id, asset, source_handle)` plus `payload_hash VARCHAR(64) NOT NULL`. |
| Routes | `POST /v2/sr-levels` and `GET /v2/sr-levels/current`. |
| Store wiring | `StoreContext` gets `srThesesV2Store` alongside `candleStore` and `insightsStore` when `DATABASE_URL` is configured. |
| No Postgres | v2 handlers return `503 SERVICE_UNAVAILABLE` when `srThesesV2Store` is null. |
| Error envelopes | All `/v2` error envelopes use `schemaVersion: "2.0"`, including auth, validation, 503, 404, and conflict responses. |
| Auth | Reuse the existing ingest-token pattern for S/R ingest: `X-Ingest-Token` checked against `OPENCLAW_INGEST_TOKEN`. |

## 4. Architecture

This is a separate Postgres-backed v2 S/R slice. It follows the comparable CLMM insights pattern for Drizzle storage, `payloadHash` idempotency, route wiring, and Postgres-unavailable behavior.

New files:

```text
src/contract/v2/srLevels.ts
src/ledger/pg/schema/srThesesV2.ts
src/ledger/srThesesV2Store.ts
src/http/handlers/srLevelsV2Ingest.ts
src/http/handlers/srLevelsV2Current.ts
src/contract/v2/__tests__/srLevels.validation.test.ts
src/contract/v2/__tests__/srLevels.canonicalHash.snapshot.test.ts
src/ledger/__tests__/srThesesV2Store.test.ts
src/http/__tests__/srLevelsV2.e2e.test.ts
src/http/__tests__/srLevelsV2.e2e.pg.test.ts
```

Touched files:

- `src/ledger/pg/schema/index.ts` re-exports `srThesesV2` and its row/insert types.
- `src/ledger/storeContext.ts` constructs `new SrThesesV2Store(pg)`.
- `src/ledger/pg/db.ts` adds `verifySrThesesV2Table`.
- `src/server.ts` calls `verifySrThesesV2Table` during Postgres startup verification.
- `src/http/routes.ts` registers both v2 routes and passes `storeContext?.srThesesV2Store ?? null`.
- `src/http/openapi.ts` documents both v2 routes.
- `src/http/errors.ts` either gains version-aware helpers or v2 handlers construct v2 envelopes directly. Helpers that hardcode v1 `SCHEMA_VERSION` must not be reused for v2 responses.
- `package.json` extends `test:pg` with the new v2 PG store and e2e test files.

## 5. Contract

`src/contract/v2/srLevels.ts` owns the v2 wire schema, response types, parsing, canonical JSON generation, and `payloadHash` computation.

The request shape is:

```ts
interface SrLevelsV2IngestRequest {
  schemaVersion: "2.0";
  source: string;
  symbol: string;
  brief: {
    briefId: string;
    sourceRecordedAtIso: string;
    summary: string | null;
  };
  theses: SrThesisV2[];
}

interface SrThesisV2 {
  asset: string;
  timeframe: string;
  bias: string | null;
  setupType: string | null;
  supportLevels: string[];
  resistanceLevels: string[];
  entryZone: string | null;
  targets: string[];
  invalidation: string | null;
  trigger: string | null;
  chartReference: string | null;
  sourceHandle: string;
  sourceChannel: string | null;
  sourceKind: string;
  sourceReliability: string | null;
  rawThesisText: string | null;
  collectedAt: string | null;
  publishedAt: string | null;
  sourceUrl: string | null;
  notes: string | null;
}
```

Validation rules:

- `schemaVersion` must be exactly `"2.0"`.
- `source`, `symbol`, `brief.briefId`, `brief.sourceRecordedAtIso`, `brief.summary`, and `theses` are required.
- `theses` must contain at least one item.
- `asset`, `timeframe`, `sourceHandle`, and `sourceKind` are required non-empty strings for each thesis.
- `supportLevels`, `resistanceLevels`, and `targets` are required arrays of strings. They may be empty.
- `brief.summary` is a required nullable field.
- Nullable thesis scalars must be present and may be `null`.
- `brief.sourceRecordedAtIso`, `collectedAt`, and `publishedAt` are validated as ISO datetime strings when non-null. Their exact inbound string is preserved.
- Unknown keys are rejected with `VALIDATION_ERROR`.

The current response shape is:

```ts
interface SrLevelsV2CurrentResponse {
  schemaVersion: "2.0";
  source: string;
  symbol: string;
  brief: {
    briefId: string;
    sourceRecordedAtIso: string;
    summary: string | null;
  };
  capturedAtIso: string;
  theses: SrThesisV2[];
}
```

`capturedAtIso` is derived from server-side `captured_at_unix_ms`. It is not included in the idempotency hash.

## 6. Hashing and Idempotency

`computeSrThesisV2CanonicalAndHash` computes a SHA-256 hex hash over canonical JSON for one thesis row's comparable payload:

```ts
{
  schemaVersion: "2.0",
  source,
  symbol,
  brief,
  thesis
}
```

The hash uses the parsed v2 contract values exactly as provided after Zod parsing. Timestamp strings are not normalized. The hash excludes server-generated and database-only fields: `id`, `captured_at_unix_ms`, `receivedAtIso`, and `payload_hash` itself.

`POST /v2/sr-levels` is transactional at the batch level:

1. Validate the full request.
2. Compute `captured_at_unix_ms = Date.now()` once for the batch.
3. For each thesis, compute the row `payloadHash`.
4. Attempt inserts keyed by `(source, symbol, brief_id, asset, source_handle)`.
5. On unique-key conflict, load the existing row by that composite key.
6. If the existing `payload_hash` matches, count it as idempotent.
7. If the existing `payload_hash` differs, abort the transaction and return `409 SR_THESIS_V2_CONFLICT`.

No partial inserts are allowed on conflict. A batch with at least one inserted row and no conflicts returns `201 created` with `insertedCount` and `idempotentCount`. A batch where all rows are idempotent returns `200 already_ingested`.

## 7. Database Schema

`src/ledger/pg/schema/srThesesV2.ts` defines `regime_engine.sr_theses_v2`.

```sql
CREATE TABLE "regime_engine"."sr_theses_v2" (
  "id" serial PRIMARY KEY NOT NULL,

  "source" text NOT NULL,
  "symbol" text NOT NULL,
  "brief_id" text NOT NULL,
  "source_recorded_at_iso" text NOT NULL,
  "summary" text,
  "captured_at_unix_ms" bigint NOT NULL,

  "asset" text NOT NULL,
  "timeframe" text NOT NULL,
  "bias" text,
  "setup_type" text,
  "source_handle" text NOT NULL,
  "source_channel" text,
  "source_kind" text NOT NULL,
  "source_reliability" text,
  "raw_thesis_text" text,
  "chart_reference" text,
  "source_url" text,
  "collected_at_iso" text,
  "published_at_iso" text,

  "support_levels" text[] NOT NULL,
  "resistance_levels" text[] NOT NULL,
  "targets" text[] NOT NULL,

  "entry_zone" text,
  "invalidation" text,
  "trigger_text" text,
  "notes" text,
  "payload_hash" varchar(64) NOT NULL
);

CREATE UNIQUE INDEX "uniq_sr_theses_v2_identity"
  ON "regime_engine"."sr_theses_v2" ("source","symbol","brief_id","asset","source_handle");

CREATE INDEX "idx_sr_theses_v2_asset" ON "regime_engine"."sr_theses_v2" ("asset");
CREATE INDEX "idx_sr_theses_v2_source" ON "regime_engine"."sr_theses_v2" ("source");
CREATE INDEX "idx_sr_theses_v2_brief_id" ON "regime_engine"."sr_theses_v2" ("brief_id");
CREATE INDEX "idx_sr_theses_v2_bias" ON "regime_engine"."sr_theses_v2" ("bias");
CREATE INDEX "idx_sr_theses_v2_symbol_source"
  ON "regime_engine"."sr_theses_v2" ("symbol","source");
CREATE INDEX "idx_sr_theses_v2_current"
  ON "regime_engine"."sr_theses_v2" ("symbol","source","captured_at_unix_ms","id");
```

The final SQL is generated by Drizzle, not hand-written. Generation must produce:

- `drizzle/0003_create_sr_theses_v2.sql`
- an updated `drizzle/meta/_journal.json`
- a generated snapshot metadata file for the new migration

## 8. Store Behavior

`SrThesesV2Store` wraps the Drizzle `Db` and exposes:

```ts
insertBrief(input: {
  request: SrLevelsV2IngestRequest;
  rowPayloads: Array<{ thesis: SrThesisV2; payloadHash: string }>;
  capturedAtUnixMs: number;
}): Promise<
  | { status: "created"; insertedCount: number; idempotentCount: number }
  | { status: "already_ingested"; insertedCount: 0; idempotentCount: number }
>;

getCurrent(symbol: string, source: string): Promise<SrLevelsV2CurrentResponse | null>;
```

`insertBrief` performs all row writes and conflict checks inside one transaction. `getCurrent` finds the newest brief row for `(symbol, source)` ordered by `captured_at_unix_ms DESC, id DESC`, then returns all rows for that `(source, symbol, brief_id)` ordered by `id ASC`.

The store maps snake_case database columns back to the camelCase v2 wire shape. It does not drop thesis fields.

## 9. HTTP Behavior

### POST /v2/sr-levels

Auth uses `X-Ingest-Token` against `OPENCLAW_INGEST_TOKEN`, matching existing S/R ingest operational configuration.

Responses:

- `201`:

```json
{
  "schemaVersion": "2.0",
  "status": "created",
  "briefId": "mco-sol-2026-04-28",
  "insertedCount": 2,
  "idempotentCount": 0
}
```

- `200`:

```json
{
  "schemaVersion": "2.0",
  "status": "already_ingested",
  "briefId": "mco-sol-2026-04-28",
  "insertedCount": 0,
  "idempotentCount": 2
}
```

- `400 VALIDATION_ERROR` or `400 UNSUPPORTED_SCHEMA_VERSION` from the v2 parser.
- `401 UNAUTHORIZED` for missing or wrong ingest token.
- `409 SR_THESIS_V2_CONFLICT` when any row exists with a different `payload_hash`.
- `500 SERVER_MISCONFIGURATION` when `OPENCLAW_INGEST_TOKEN` is missing.
- `503 SERVICE_UNAVAILABLE` when the Postgres-backed store is unavailable.

### GET /v2/sr-levels/current

Query params:

- `symbol`: required non-empty string.
- `source`: required non-empty string.

Responses:

- `200` with `SrLevelsV2CurrentResponse`.
- `400 VALIDATION_ERROR` when `symbol` or `source` is missing, empty, or non-string.
- `404 SR_THESIS_V2_NOT_FOUND` when no rows exist for the selector.
- `503 SERVICE_UNAVAILABLE` when the Postgres-backed store is unavailable.

## 10. Error Envelopes

`/v2` uses a version-specific error envelope:

```ts
interface V2ErrorEnvelope {
  schemaVersion: "2.0";
  error: {
    code:
      | "VALIDATION_ERROR"
      | "UNSUPPORTED_SCHEMA_VERSION"
      | "UNAUTHORIZED"
      | "SERVER_MISCONFIGURATION"
      | "SERVICE_UNAVAILABLE"
      | "SR_THESIS_V2_CONFLICT"
      | "SR_THESIS_V2_NOT_FOUND"
      | "INTERNAL_ERROR";
    message: string;
    details: ErrorDetail[];
  };
}
```

Do not reuse v1 helpers that hardcode `schemaVersion: "1.0"`. Either make shared helpers version-aware or construct v2 envelopes in the v2 contract/handler layer.

## 11. OpenAPI

`src/http/openapi.ts` adds:

- `POST /v2/sr-levels`
- `GET /v2/sr-levels/current`

The existing endpoint path remains `/v1/openapi.json`; the document can describe both v1 and v2 routes.

## 12. Tests

Contract tests:

- Accept the issue sample payload.
- Reject `schemaVersion !== "2.0"` with `UNSUPPORTED_SCHEMA_VERSION` and `schemaVersion: "2.0"` in the error envelope.
- Reject missing `source`, `symbol`, `brief`, empty `theses`, missing required thesis fields, bad ISO timestamp strings, and unknown keys.
- Prove exact timestamp strings survive parsing and hash input without normalization.
- Snapshot `payloadHash` for a representative thesis row.
- Prove object key order does not affect `payloadHash`.
- Prove exact timestamp string differences do affect `payloadHash`.

Store PG tests:

- Created insert writes one row per thesis and returns `created`.
- All-idempotent replay returns `already_ingested`.
- Mixed created/idempotent batch returns `created` with both counts.
- Different-payload same unique key throws `SrThesisV2ConflictError`.
- Conflict rollback leaves no partial inserts.
- Concurrent identical insert creates exactly one row and treats the other as idempotent.
- `getCurrent` returns null for no data.
- `getCurrent` selects latest brief by `captured_at_unix_ms DESC, id DESC`.
- `getCurrent` returns all rows for the selected brief ordered by `id ASC`.
- Row-to-wire reconstruction preserves arrays, nullable fields, and exact timestamp strings.

HTTP tests without `DATABASE_URL`:

- `POST /v2/sr-levels` returns `503 SERVICE_UNAVAILABLE` with `schemaVersion: "2.0"`.
- `GET /v2/sr-levels/current` returns `503 SERVICE_UNAVAILABLE` with `schemaVersion: "2.0"`.

PG e2e tests:

- POST created/idempotent/conflict responses.
- POST conflict is transactional with no partial insert.
- Missing/wrong auth returns `401` with `schemaVersion: "2.0"`.
- Missing auth env var returns `500 SERVER_MISCONFIGURATION` with `schemaVersion: "2.0"`.
- Validation errors return `400` with `schemaVersion: "2.0"`.
- GET missing/empty/non-string selector returns `400` with `schemaVersion: "2.0"`.
- GET no rows returns `404 SR_THESIS_V2_NOT_FOUND` with `schemaVersion: "2.0"`.
- GET success returns the latest brief and exact stored thesis fields.
- `/v1/sr-levels` behavior remains unchanged.

Route/OpenAPI tests:

- Route contract tests include both v2 paths.
- OpenAPI includes both v2 paths and expected response codes.

`package.json` `test:pg` must include the new `src/ledger/__tests__/srThesesV2Store.test.ts` and `src/http/__tests__/srLevelsV2.e2e.pg.test.ts` files.

## 13. Deployment

Migrations are applied by the existing Railway pre-deploy command:

```text
npm run db:migrate
```

Startup verification must fail fast if `DATABASE_URL` is configured but `regime_engine.sr_theses_v2` is missing. This mirrors `verifyCandleRevisionsTable` and `verifyClmmInsightsTable`.

## 14. Acceptance Criteria

- `POST /v2/sr-levels` persists each thesis as one row in `regime_engine.sr_theses_v2`.
- Timestamp fields round-trip as the exact inbound strings.
- Duplicate rows with matching `payload_hash` are idempotent.
- Duplicate rows with different `payload_hash` return `409 SR_THESIS_V2_CONFLICT` and do not partially insert the batch.
- `GET /v2/sr-levels/current` returns the latest brief for `symbol` and `source`, with all thesis fields preserved.
- All v2 error envelopes use `schemaVersion: "2.0"`.
- v1 S/R behavior is unchanged.
- `pnpm run typecheck`, `pnpm run test`, `pnpm run lint`, `pnpm run build`, and the extended `pnpm run test:pg` pass in the appropriate environments.
