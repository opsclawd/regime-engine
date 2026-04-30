# v2 S/R Thesis Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an additive, Postgres-backed `/v2/sr-levels` slice that stores and serves the full raw thesis payload (one row per thesis) without changing the existing v1 SQLite-backed S/R endpoint.

**Architecture:** New Drizzle table `regime_engine.sr_theses_v2` (one flat row per thesis; native `TEXT[]` for `support_levels`, `resistance_levels`, `targets`; `TEXT` for ISO timestamps to preserve exact inbound strings). Idempotency keyed by composite unique index `(source, symbol, brief_id, asset, source_handle)` with per-row `payload_hash` for replay vs conflict. New v2 contract module with version-specific error envelopes (`schemaVersion: "2.0"`) so no v1 helpers that hardcode `1.0` are reused. New `SrThesesV2Store` (Drizzle, transactional batch insert) wired through `StoreContext`. Two Fastify handlers (`POST /v2/sr-levels`, `GET /v2/sr-levels/current`); both register unconditionally and 503 when the Postgres-backed store is null (POST 503s only after auth succeeds). v1 endpoint, storage path, and tests are not modified.

**Tech Stack:** TypeScript, Fastify 5, Zod 3, Drizzle ORM 0.36 / drizzle-kit 0.31, Postgres 15+ (via `postgres` driver), Vitest 3, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-04-30-v2-sr-thesis-storage-design.md` (issue [#21](https://github.com/opsclawd/regime-engine/issues/21)).

---

## File Structure

### New files

| Path | Purpose |
| ---- | ------- |
| `src/ledger/pg/schema/srThesesV2.ts` | Drizzle table definition for `regime_engine.sr_theses_v2`. |
| `drizzle/0003_create_sr_theses_v2.sql` | Generated migration (`pnpm exec drizzle-kit generate --name create_sr_theses_v2`). |
| `drizzle/meta/0003_snapshot.json` | Generated Drizzle metadata snapshot for migration 0003. |
| `src/contract/v2/errors.ts` | V2 error envelope (`schemaVersion: "2.0"`), `V2_ERROR_CODES`, `V2ContractValidationError`, builders for `validation`, `unsupportedSchemaVersion`, `unauthorized`, `serverMisconfiguration`, `serviceUnavailable`, `srThesisV2NotFound`, `srThesisV2Conflict`, `internalError`. |
| `src/contract/v2/srLevels.ts` | TS types (request, thesis, current response), Zod schema, `parseSrLevelsV2IngestRequest`, `computeSrThesisV2CanonicalAndHash`. |
| `src/contract/v2/__tests__/srLevels.validation.test.ts` | Validation matrix for the v2 ingest parser. |
| `src/contract/v2/__tests__/srLevels.canonicalHash.snapshot.test.ts` | Canonical JSON + sha256 snapshot, key-order independence, exact timestamp string sensitivity. |
| `src/ledger/srThesesV2Store.ts` | `SrThesesV2Store` class wrapping a Drizzle `Db`; `SrThesisV2ConflictError`; `SR_THESIS_V2_ERROR_CODES`; row-to-wire mapper. |
| `src/ledger/__tests__/srThesesV2Store.test.ts` | PG-gated integration test for `insertBrief` + `getCurrent`. |
| `src/http/handlers/srLevelsV2Ingest.ts` | `POST /v2/sr-levels` handler. |
| `src/http/handlers/srLevelsV2Current.ts` | `GET /v2/sr-levels/current` handler. |
| `src/http/__tests__/srLevelsV2.e2e.test.ts` | Fastify-injected e2e for the no-`DATABASE_URL` (503 + 500 + 401) paths. |
| `src/http/__tests__/srLevelsV2.e2e.pg.test.ts` | PG-gated Fastify-injected e2e for ingest + current. |

### Touched files

| Path | Change |
| ---- | ------ |
| `src/ledger/pg/schema/index.ts` | Re-export `srThesesV2`, `SrThesisV2Row`, `SrThesisV2Insert`. |
| `src/ledger/pg/db.ts` | Add `verifySrThesesV2Table` mirroring `verifyClmmInsightsTable`. |
| `src/ledger/storeContext.ts` | Construct `new SrThesesV2Store(pg)` and expose on `StoreContext`. |
| `src/server.ts` | Call `verifySrThesesV2Table` during Postgres startup verification. |
| `src/http/routes.ts` | Register `POST /v2/sr-levels` and `GET /v2/sr-levels/current` (always). |
| `src/http/openapi.ts` | Document both v2 paths and their response codes. |
| `src/http/errors.ts` | Export `zodIssueToDetails` and `stableSortDetails` (currently private) so v2 errors can reuse them without duplicating Zod issue translation. |
| `src/http/auth.ts` | Export `safeEqual` so v2 handler can do timing-safe token comparison while building v2 envelopes. |
| `src/http/__tests__/routes.contract.test.ts` | Assert OpenAPI advertises both v2 paths and the v2 routes are wired. |
| `package.json` | Extend `test:pg` script to include `src/ledger/__tests__/srThesesV2Store.test.ts` and `src/http/__tests__/srLevelsV2.e2e.pg.test.ts`. |
| `drizzle/meta/_journal.json` | Auto-updated by `drizzle-kit generate` to add the new entry. |

---

## Task 1: Add Drizzle schema for `sr_theses_v2`

**Files:**
- Create: `src/ledger/pg/schema/srThesesV2.ts`
- Modify: `src/ledger/pg/schema/index.ts`

- [ ] **Step 1: Write the failing schema-shape test**

Append to `src/ledger/pg/schema/index.ts` does not have a test file yet, so add this minimal smoke test as the failing case. Create `src/ledger/pg/schema/__tests__/srThesesV2.shape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { srThesesV2 } from "../index.js";

describe("srThesesV2 schema", () => {
  it("exposes the expected column names", () => {
    const columns = Object.keys(srThesesV2);
    for (const expected of [
      "id",
      "source",
      "symbol",
      "briefId",
      "sourceRecordedAtIso",
      "summary",
      "capturedAtUnixMs",
      "asset",
      "timeframe",
      "bias",
      "setupType",
      "sourceHandle",
      "sourceChannel",
      "sourceKind",
      "sourceReliability",
      "rawThesisText",
      "chartReference",
      "sourceUrl",
      "collectedAtIso",
      "publishedAtIso",
      "supportLevels",
      "resistanceLevels",
      "targets",
      "entryZone",
      "invalidation",
      "triggerText",
      "notes",
      "payloadHash"
    ]) {
      expect(columns).toContain(expected);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ledger/pg/schema/__tests__/srThesesV2.shape.test.ts`
Expected: FAIL with module-not-found / `srThesesV2` is not exported.

- [ ] **Step 3: Create the Drizzle table**

Create `src/ledger/pg/schema/srThesesV2.ts`:

```ts
import { bigint, index, serial, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { regimeEngine } from "./candleRevisions.js";

export const srThesesV2 = regimeEngine.table(
  "sr_theses_v2",
  {
    id: serial("id").primaryKey(),

    source: text("source").notNull(),
    symbol: text("symbol").notNull(),
    briefId: text("brief_id").notNull(),
    sourceRecordedAtIso: text("source_recorded_at_iso"),
    summary: text("summary"),
    capturedAtUnixMs: bigint("captured_at_unix_ms", { mode: "number" }).notNull(),

    asset: text("asset").notNull(),
    timeframe: text("timeframe").notNull(),
    bias: text("bias"),
    setupType: text("setup_type"),
    sourceHandle: text("source_handle").notNull(),
    sourceChannel: text("source_channel"),
    sourceKind: text("source_kind").notNull(),
    sourceReliability: text("source_reliability"),
    rawThesisText: text("raw_thesis_text"),
    chartReference: text("chart_reference"),
    sourceUrl: text("source_url"),
    collectedAtIso: text("collected_at_iso"),
    publishedAtIso: text("published_at_iso"),

    supportLevels: text("support_levels").array().notNull(),
    resistanceLevels: text("resistance_levels").array().notNull(),
    targets: text("targets").array().notNull(),

    entryZone: text("entry_zone"),
    invalidation: text("invalidation"),
    triggerText: text("trigger_text"),
    notes: text("notes"),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_sr_theses_v2_identity").on(
      t.source,
      t.symbol,
      t.briefId,
      t.asset,
      t.sourceHandle
    ),
    index("idx_sr_theses_v2_asset").on(t.asset),
    index("idx_sr_theses_v2_source").on(t.source),
    index("idx_sr_theses_v2_brief_id").on(t.briefId),
    index("idx_sr_theses_v2_bias").on(t.bias),
    index("idx_sr_theses_v2_symbol_source").on(t.symbol, t.source),
    index("idx_sr_theses_v2_current").on(t.symbol, t.source, t.capturedAtUnixMs, t.id)
  ]
);

export type SrThesisV2Row = typeof srThesesV2.$inferSelect;
export type SrThesisV2Insert = typeof srThesesV2.$inferInsert;
```

- [ ] **Step 4: Re-export from the schema index**

Edit `src/ledger/pg/schema/index.ts` to read:

```ts
export { candleRevisions, regimeEngine, PG_SCHEMA_NAME } from "./candleRevisions.js";
export { clmmInsights } from "./clmmInsights.js";
export type { ClmmInsightRow, ClmmInsightInsert } from "./clmmInsights.js";
export { srThesesV2 } from "./srThesesV2.js";
export type { SrThesisV2Row, SrThesisV2Insert } from "./srThesesV2.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/ledger/pg/schema/__tests__/srThesesV2.shape.test.ts`
Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ledger/pg/schema/srThesesV2.ts src/ledger/pg/schema/index.ts src/ledger/pg/schema/__tests__/srThesesV2.shape.test.ts
git commit -m "feat: add sr_theses_v2 drizzle schema"
```

---

## Task 2: Generate the `0003_create_sr_theses_v2` migration

**Files:**
- Create (generated): `drizzle/0003_create_sr_theses_v2.sql`
- Create (generated): `drizzle/meta/0003_snapshot.json`
- Modify (generated): `drizzle/meta/_journal.json`

- [ ] **Step 1: Generate the migration via Drizzle CLI**

Run from repo root (no `DATABASE_URL` is required for generation; the CLI compares schema vs prior snapshot):

```bash
pnpm exec drizzle-kit generate --name create_sr_theses_v2
```

Expected: prints `Your SQL migration file ➜ drizzle/0003_create_sr_theses_v2.sql`, updates `_journal.json` with an `idx: 3` entry, and writes `0003_snapshot.json`.

- [ ] **Step 2: Verify the generated SQL**

Open `drizzle/0003_create_sr_theses_v2.sql`. Confirm it matches the spec exactly:

```sql
CREATE TABLE "regime_engine"."sr_theses_v2" (
  "id" serial PRIMARY KEY NOT NULL,
  "source" text NOT NULL,
  "symbol" text NOT NULL,
  "brief_id" text NOT NULL,
  "source_recorded_at_iso" text,
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
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_sr_theses_v2_identity" ON "regime_engine"."sr_theses_v2" USING btree ("source","symbol","brief_id","asset","source_handle");--> statement-breakpoint
CREATE INDEX "idx_sr_theses_v2_asset" ON "regime_engine"."sr_theses_v2" USING btree ("asset");--> statement-breakpoint
CREATE INDEX "idx_sr_theses_v2_source" ON "regime_engine"."sr_theses_v2" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_sr_theses_v2_brief_id" ON "regime_engine"."sr_theses_v2" USING btree ("brief_id");--> statement-breakpoint
CREATE INDEX "idx_sr_theses_v2_bias" ON "regime_engine"."sr_theses_v2" USING btree ("bias");--> statement-breakpoint
CREATE INDEX "idx_sr_theses_v2_symbol_source" ON "regime_engine"."sr_theses_v2" USING btree ("symbol","source");--> statement-breakpoint
CREATE INDEX "idx_sr_theses_v2_current" ON "regime_engine"."sr_theses_v2" USING btree ("symbol","source","captured_at_unix_ms","id");
```

If the generator emits something materially different (different column types, extra `CREATE EXTENSION`, or missing indexes), stop and fix the schema in Task 1 — never hand-edit the generated SQL or snapshot.

- [ ] **Step 3: Verify journal entry**

Open `drizzle/meta/_journal.json`; confirm there is now an `entries` element with `"idx": 3` and `"tag": "0003_create_sr_theses_v2"`. Do not edit by hand; the file is generated.

- [ ] **Step 4: Run lint, format, typecheck**

```bash
pnpm run typecheck
pnpm run lint
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0003_create_sr_theses_v2.sql drizzle/meta/0003_snapshot.json drizzle/meta/_journal.json
git commit -m "feat: generate 0003_create_sr_theses_v2 drizzle migration"
```

---

## Task 3: Add `verifySrThesesV2Table` startup check

**Files:**
- Modify: `src/ledger/pg/db.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ledger/pg/__tests__/verifySrThesesV2Table.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { verifySrThesesV2Table } from "../db.js";

describe.skipIf(!process.env.DATABASE_URL)("verifySrThesesV2Table", () => {
  it("is exported from db module", () => {
    expect(typeof verifySrThesesV2Table).toBe("function");
  });

  it("resolves when the table exists (PG)", async () => {
    const { createDb } = await import("../db.js");
    const { db, client } = createDb(process.env.DATABASE_URL!);
    try {
      await expect(verifySrThesesV2Table(db)).resolves.toBeUndefined();
    } finally {
      await client.end();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ledger/pg/__tests__/verifySrThesesV2Table.test.ts`
Expected: FAIL with `verifySrThesesV2Table` is not exported.

- [ ] **Step 3: Add the verifier**

Edit `src/ledger/pg/db.ts`. After `verifyClmmInsightsTable`, add:

```ts
export const verifySrThesesV2Table = async (db: Db): Promise<void> => {
  const result = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'regime_engine' AND tablename = 'sr_theses_v2'`
  );
  if (result.length === 0) {
    throw new Error(
      "FATAL: sr_theses_v2 table not found in regime_engine schema — run migrations first"
    );
  }
};
```

- [ ] **Step 4: Run the unit-level export test**

Run: `pnpm vitest run src/ledger/pg/__tests__/verifySrThesesV2Table.test.ts`
Expected: PASS for the export check (the PG case is skipped without `DATABASE_URL`).

- [ ] **Step 5: Wire it into server startup**

Edit `src/server.ts` lines 2-8 to add the import:

```ts
import {
  createDb,
  verifyPgConnection,
  verifyPgSchema,
  verifyCandleRevisionsTable,
  verifyClmmInsightsTable,
  verifySrThesesV2Table
} from "./ledger/pg/db.js";
```

Then under `verifyClmmInsightsTable(pg);` add:

```ts
await verifySrThesesV2Table(pg);
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ledger/pg/db.ts src/ledger/pg/__tests__/verifySrThesesV2Table.test.ts src/server.ts
git commit -m "feat: verify sr_theses_v2 table at postgres startup"
```

---

## Task 4: Build v2 error envelope helpers

**Files:**
- Create: `src/contract/v2/errors.ts`
- Modify: `src/http/errors.ts`

- [ ] **Step 1: Write the failing test**

Create `src/contract/v2/__tests__/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  V2ContractValidationError,
  unsupportedSchemaVersionV2Error,
  validationErrorV2FromZod,
  serviceUnavailableV2Error,
  unauthorizedV2Error,
  serverMisconfigurationV2Error,
  srThesisV2NotFoundError,
  srThesisV2ConflictError,
  internalErrorV2
} from "../errors.js";
import { z, ZodError } from "zod";

describe("v2 error envelopes", () => {
  it("UNSUPPORTED_SCHEMA_VERSION envelope uses schemaVersion 2.0", () => {
    const err = unsupportedSchemaVersionV2Error("1.5");
    expect(err.statusCode).toBe(400);
    expect(err.response.schemaVersion).toBe("2.0");
    expect(err.response.error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(err.response.error.details[0].path).toBe("$.schemaVersion");
  });

  it("VALIDATION_ERROR envelope translates Zod issues with v2 envelope", () => {
    const schema = z.object({ foo: z.string() });
    const result = schema.safeParse({});
    const issues = (result.error as ZodError).issues;
    const err = validationErrorV2FromZod("Invalid /v2/sr-levels request body", issues);
    expect(err.statusCode).toBe(400);
    expect(err.response.schemaVersion).toBe("2.0");
    expect(err.response.error.code).toBe("VALIDATION_ERROR");
    expect(err.response.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.foo", code: "REQUIRED" })
      ])
    );
  });

  it("503 envelope uses schemaVersion 2.0 and SERVICE_UNAVAILABLE", () => {
    const env = serviceUnavailableV2Error("Postgres-backed S/R thesis store unavailable");
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("SERVICE_UNAVAILABLE");
  });

  it("401 envelope uses schemaVersion 2.0 and UNAUTHORIZED", () => {
    const env = unauthorizedV2Error();
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("UNAUTHORIZED");
  });

  it("500 SERVER_MISCONFIGURATION envelope uses schemaVersion 2.0", () => {
    const env = serverMisconfigurationV2Error("OPENCLAW_INGEST_TOKEN");
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("SERVER_MISCONFIGURATION");
    expect(env.error.message).toContain("OPENCLAW_INGEST_TOKEN");
  });

  it("404 SR_THESIS_V2_NOT_FOUND envelope uses schemaVersion 2.0", () => {
    const env = srThesisV2NotFoundError("SOL", "macro-charts");
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("SR_THESIS_V2_NOT_FOUND");
  });

  it("409 SR_THESIS_V2_CONFLICT envelope uses schemaVersion 2.0", () => {
    const env = srThesisV2ConflictError({
      source: "macro-charts",
      symbol: "SOL",
      briefId: "b-1",
      asset: "SOL",
      sourceHandle: "@trader"
    });
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("SR_THESIS_V2_CONFLICT");
  });

  it("INTERNAL_ERROR envelope uses schemaVersion 2.0", () => {
    const env = internalErrorV2();
    expect(env.schemaVersion).toBe("2.0");
    expect(env.error.code).toBe("INTERNAL_ERROR");
  });

  it("V2ContractValidationError carries statusCode and response", () => {
    const env = unsupportedSchemaVersionV2Error("1.0");
    expect(env).toBeInstanceOf(V2ContractValidationError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/contract/v2/__tests__/errors.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Export Zod-issue translators from `src/http/errors.ts`**

Edit `src/http/errors.ts` and change `const zodIssueToDetails = ...` to `export const zodIssueToDetails = ...` and `const stableSortDetails = ...` to `export const stableSortDetails = ...`. No other v1 behavior changes.

- [ ] **Step 4: Implement `src/contract/v2/errors.ts`**

```ts
import type { ZodIssue } from "zod";
import {
  type ErrorDetail,
  zodIssueToDetails,
  stableSortDetails,
  ERROR_DETAIL_CODES
} from "../../http/errors.js";

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

export type V2ErrorCode = (typeof V2_ERROR_CODES)[keyof typeof V2_ERROR_CODES];

export interface V2ErrorEnvelope {
  schemaVersion: V2SchemaVersion;
  error: {
    code: V2ErrorCode;
    message: string;
    details: ErrorDetail[];
  };
}

export class V2ContractValidationError extends Error {
  public readonly statusCode: number;
  public readonly response: V2ErrorEnvelope;

  public constructor(statusCode: number, response: V2ErrorEnvelope) {
    super(response.error.message);
    this.statusCode = statusCode;
    this.response = response;
  }
}

export const unsupportedSchemaVersionV2Error = (received: string): V2ContractValidationError => {
  return new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: V2_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      message: `Unsupported schemaVersion "${received}". Expected "${V2_SCHEMA_VERSION}".`,
      details: [
        {
          path: "$.schemaVersion",
          code: ERROR_DETAIL_CODES.INVALID_VALUE,
          message: "Invalid value"
        }
      ]
    }
  });
};

export const validationErrorV2FromZod = (
  message: string,
  issues: ZodIssue[]
): V2ContractValidationError => {
  const details = stableSortDetails(issues.flatMap((issue) => zodIssueToDetails(issue)));
  return new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: V2_ERROR_CODES.VALIDATION_ERROR,
      message,
      details
    }
  });
};

export const validationErrorV2 = (
  message: string,
  details: ErrorDetail[] = []
): V2ContractValidationError => {
  return new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: V2_ERROR_CODES.VALIDATION_ERROR,
      message,
      details
    }
  });
};

export const serviceUnavailableV2Error = (message: string): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.SERVICE_UNAVAILABLE,
    message,
    details: []
  }
});

export const unauthorizedV2Error = (): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.UNAUTHORIZED,
    message: "Invalid or missing authentication token",
    details: []
  }
});

export const serverMisconfigurationV2Error = (envVar: string): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.SERVER_MISCONFIGURATION,
    message: `Server misconfiguration: ${envVar} is not set.`,
    details: []
  }
});

export const srThesisV2NotFoundError = (symbol: string, source: string): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.SR_THESIS_V2_NOT_FOUND,
    message: `No S/R thesis brief found for symbol="${symbol}" and source="${source}".`,
    details: []
  }
});

export interface SrThesisV2ConflictKey {
  source: string;
  symbol: string;
  briefId: string;
  asset: string;
  sourceHandle: string;
}

export const srThesisV2ConflictError = (key: SrThesisV2ConflictKey): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.SR_THESIS_V2_CONFLICT,
    message: `S/R thesis v2 conflict for source="${key.source}" symbol="${key.symbol}" briefId="${key.briefId}" asset="${key.asset}" sourceHandle="${key.sourceHandle}".`,
    details: []
  }
});

export const internalErrorV2 = (): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.INTERNAL_ERROR,
    message: "Internal server error",
    details: []
  }
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/contract/v2/__tests__/errors.test.ts`
Expected: PASS.

- [ ] **Step 6: Run typecheck and lint**

```bash
pnpm run typecheck
pnpm run lint
```

Expected: PASS (the v1 errors.ts only changed a `const` to `export const`; nothing else).

- [ ] **Step 7: Commit**

```bash
git add src/contract/v2/errors.ts src/contract/v2/__tests__/errors.test.ts src/http/errors.ts
git commit -m "feat: add v2 error envelope helpers (schemaVersion 2.0)"
```

---

## Task 5: Build the v2 contract module (types, schema, parser)

**Files:**
- Create: `src/contract/v2/srLevels.ts`

The contract module owns the wire schema, parser, and TS types. The `computeSrThesisV2CanonicalAndHash` helper is added in Task 6 alongside its tests so it can be exercised end-to-end with the parsed shape.

- [ ] **Step 1: Write the failing test**

Create `src/contract/v2/__tests__/srLevels.types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { SrLevelsV2IngestRequest, SrThesisV2 } from "../srLevels.js";
import { parseSrLevelsV2IngestRequest } from "../srLevels.js";

describe("SrLevelsV2IngestRequest types", () => {
  it("compiles with the canonical wire shape", () => {
    const thesis: SrThesisV2 = {
      asset: "SOL",
      timeframe: "1d",
      bias: "bullish",
      setupType: "breakout",
      supportLevels: ["140.50"],
      resistanceLevels: ["160.00"],
      entryZone: "145-148",
      targets: ["170", "180"],
      invalidation: "<135",
      trigger: "close above 160",
      chartReference: "https://example.com/chart.png",
      sourceHandle: "@trader",
      sourceChannel: "twitter",
      sourceKind: "post",
      sourceReliability: "medium",
      rawThesisText: "raw text",
      collectedAt: "2026-04-29T13:00:00Z",
      publishedAt: "2026-04-29T12:00:00Z",
      sourceUrl: "https://x.com/trader/status/1",
      notes: null
    };
    const request: SrLevelsV2IngestRequest = {
      schemaVersion: "2.0",
      source: "macro-charts",
      symbol: "SOL",
      brief: {
        briefId: "mco-sol-2026-04-29",
        sourceRecordedAtIso: "2026-04-29T11:00:00Z",
        summary: "summary"
      },
      theses: [thesis]
    };
    expect(request.theses[0].asset).toBe("SOL");
  });

  it("parser is exported", () => {
    expect(typeof parseSrLevelsV2IngestRequest).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/contract/v2/__tests__/srLevels.types.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the contract module**

Create `src/contract/v2/srLevels.ts`:

```ts
import { z } from "zod";
import {
  V2ContractValidationError,
  V2_SCHEMA_VERSION,
  type V2SchemaVersion,
  unsupportedSchemaVersionV2Error,
  validationErrorV2FromZod
} from "./errors.js";

const ISO = z.string().datetime({ offset: true });
const requiredString = z.string().min(1);

const thesisSchema = z
  .object({
    asset: requiredString,
    timeframe: requiredString,
    bias: z.string().nullable(),
    setupType: z.string().nullable(),
    supportLevels: z.array(z.string()),
    resistanceLevels: z.array(z.string()),
    entryZone: z.string().nullable(),
    targets: z.array(z.string()),
    invalidation: z.string().nullable(),
    trigger: z.string().nullable(),
    chartReference: z.string().nullable(),
    sourceHandle: requiredString,
    sourceChannel: z.string().nullable(),
    sourceKind: requiredString,
    sourceReliability: z.string().nullable(),
    rawThesisText: z.string().nullable(),
    collectedAt: ISO.nullable(),
    publishedAt: ISO.nullable(),
    sourceUrl: z.string().nullable(),
    notes: z.string().nullable()
  })
  .strict();

const briefSchema = z
  .object({
    briefId: requiredString,
    sourceRecordedAtIso: ISO.nullable(),
    summary: z.string().nullable()
  })
  .strict();

export const srLevelsV2IngestRequestSchema = z
  .object({
    schemaVersion: z.literal(V2_SCHEMA_VERSION),
    source: requiredString,
    symbol: requiredString,
    brief: briefSchema,
    theses: z.array(thesisSchema).min(1)
  })
  .strict();

export type SrLevelsV2IngestRequest = z.infer<typeof srLevelsV2IngestRequestSchema>;
export type SrThesisV2 = z.infer<typeof thesisSchema>;
export type SrLevelsV2Brief = z.infer<typeof briefSchema>;

export interface SrLevelsV2CurrentResponse {
  schemaVersion: V2SchemaVersion;
  source: string;
  symbol: string;
  brief: SrLevelsV2Brief;
  capturedAtIso: string;
  theses: SrThesisV2[];
}

export interface SrLevelsV2IngestCreatedResponse {
  schemaVersion: V2SchemaVersion;
  status: "created";
  briefId: string;
  insertedCount: number;
  idempotentCount: number;
}

export interface SrLevelsV2IngestAlreadyIngestedResponse {
  schemaVersion: V2SchemaVersion;
  status: "already_ingested";
  briefId: string;
  insertedCount: 0;
  idempotentCount: number;
}

const duplicateThesisIdentityError = (duplicateIndex: number): V2ContractValidationError =>
  new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: "VALIDATION_ERROR",
      message: "Duplicate thesis identity in request",
      details: [
        {
          path: `$.theses[${duplicateIndex}]`,
          code: "INVALID_VALUE",
          message:
            "Duplicate (source, symbol, briefId, asset, sourceHandle) within a single request is not allowed"
        }
      ]
    }
  });

export const parseSrLevelsV2IngestRequest = (raw: unknown): SrLevelsV2IngestRequest => {
  const probe = z.object({ schemaVersion: z.string() }).passthrough().safeParse(raw);
  if (probe.success && probe.data.schemaVersion !== V2_SCHEMA_VERSION) {
    throw unsupportedSchemaVersionV2Error(probe.data.schemaVersion);
  }

  const parsed = srLevelsV2IngestRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw validationErrorV2FromZod("Invalid /v2/sr-levels request body", parsed.error.issues);
  }

  const seen = new Set<string>();
  for (let i = 0; i < parsed.data.theses.length; i += 1) {
    const t = parsed.data.theses[i];
    const key = `${parsed.data.source} ${parsed.data.symbol} ${parsed.data.brief.briefId} ${t.asset} ${t.sourceHandle}`;
    if (seen.has(key)) {
      throw duplicateThesisIdentityError(i);
    }
    seen.add(key);
  }

  return parsed.data;
};
```

- [ ] **Step 4: Run the type test**

Run: `pnpm vitest run src/contract/v2/__tests__/srLevels.types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contract/v2/srLevels.ts src/contract/v2/__tests__/srLevels.types.test.ts
git commit -m "feat: add v2 sr-levels ingest contract types and parser"
```

---

## Task 6: Add canonical-JSON + payload hash helper for thesis rows

**Files:**
- Modify: `src/contract/v2/srLevels.ts`
- Create: `src/contract/v2/__tests__/srLevels.canonicalHash.snapshot.test.ts`

The hash helper hashes one thesis row's comparable payload (the spec's section 6 shape: `{ schemaVersion, source, symbol, brief, thesis }`). Timestamps are not normalized.

- [ ] **Step 1: Write the failing snapshot/property test**

Create `src/contract/v2/__tests__/srLevels.canonicalHash.snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  computeSrThesisV2CanonicalAndHash,
  parseSrLevelsV2IngestRequest,
  type SrLevelsV2IngestRequest,
  type SrThesisV2
} from "../srLevels.js";
import { toCanonicalJson } from "../../v1/canonical.js";

const baseThesis = (overrides: Partial<SrThesisV2> = {}): SrThesisV2 => ({
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: "breakout",
  supportLevels: ["140.50", "135.00"],
  resistanceLevels: ["160.00"],
  entryZone: "145-148",
  targets: ["170", "180"],
  invalidation: "<135",
  trigger: "close above 160",
  chartReference: "https://example.com/chart.png",
  sourceHandle: "@trader",
  sourceChannel: "twitter",
  sourceKind: "post",
  sourceReliability: "medium",
  rawThesisText: "raw text",
  collectedAt: "2026-04-29T13:00:00Z",
  publishedAt: "2026-04-29T12:00:00Z",
  sourceUrl: "https://x.com/trader/status/1",
  notes: null,
  ...overrides
});

const baseRequest = (overrides: Partial<SrLevelsV2IngestRequest> = {}): SrLevelsV2IngestRequest =>
  ({
    schemaVersion: "2.0",
    source: "macro-charts",
    symbol: "SOL",
    brief: {
      briefId: "mco-sol-2026-04-29",
      sourceRecordedAtIso: "2026-04-29T11:00:00Z",
      summary: "summary"
    },
    theses: [baseThesis()],
    ...overrides
  }) as SrLevelsV2IngestRequest;

describe("computeSrThesisV2CanonicalAndHash", () => {
  it("snapshot of canonical JSON is stable", () => {
    const req = baseRequest();
    const { canonical } = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    expect(canonical).toMatchSnapshot();
  });

  it("snapshot of payload hash is stable", () => {
    const req = baseRequest();
    const { hash } = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    expect(hash).toMatchSnapshot();
  });

  it("is byte-identical across object key permutations", () => {
    const reqA = baseRequest();
    const reqB = parseSrLevelsV2IngestRequest({
      // re-ordered keys at every level
      theses: [
        {
          notes: null,
          sourceUrl: "https://x.com/trader/status/1",
          publishedAt: "2026-04-29T12:00:00Z",
          collectedAt: "2026-04-29T13:00:00Z",
          rawThesisText: "raw text",
          sourceReliability: "medium",
          sourceKind: "post",
          sourceChannel: "twitter",
          sourceHandle: "@trader",
          chartReference: "https://example.com/chart.png",
          trigger: "close above 160",
          invalidation: "<135",
          targets: ["170", "180"],
          entryZone: "145-148",
          resistanceLevels: ["160.00"],
          supportLevels: ["140.50", "135.00"],
          setupType: "breakout",
          bias: "bullish",
          timeframe: "1d",
          asset: "SOL"
        }
      ],
      brief: {
        summary: "summary",
        sourceRecordedAtIso: "2026-04-29T11:00:00Z",
        briefId: "mco-sol-2026-04-29"
      },
      symbol: "SOL",
      source: "macro-charts",
      schemaVersion: "2.0"
    });
    const a = computeSrThesisV2CanonicalAndHash(reqA, reqA.theses[0]);
    const b = computeSrThesisV2CanonicalAndHash(reqB, reqB.theses[0]);
    expect(a.canonical).toBe(b.canonical);
    expect(a.hash).toBe(b.hash);
  });

  it("preserves exact non-null timestamp strings (different ISO formats produce different hashes)", () => {
    const reqNoMillis = baseRequest({
      brief: {
        briefId: "b-1",
        sourceRecordedAtIso: "2026-04-29T11:00:00Z",
        summary: null
      },
      theses: [baseThesis({ collectedAt: "2026-04-29T11:00:00Z", publishedAt: null })]
    });
    const reqWithMillis = baseRequest({
      brief: {
        briefId: "b-1",
        sourceRecordedAtIso: "2026-04-29T11:00:00.000Z",
        summary: null
      },
      theses: [baseThesis({ collectedAt: "2026-04-29T11:00:00.000Z", publishedAt: null })]
    });
    const a = computeSrThesisV2CanonicalAndHash(reqNoMillis, reqNoMillis.theses[0]);
    const b = computeSrThesisV2CanonicalAndHash(reqWithMillis, reqWithMillis.theses[0]);
    expect(a.hash).not.toBe(b.hash);
  });

  it("preserves null timestamps in the canonical output", () => {
    const req = baseRequest({
      brief: { briefId: "b-1", sourceRecordedAtIso: null, summary: null },
      theses: [baseThesis({ collectedAt: null, publishedAt: null })]
    });
    const { canonical } = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    expect(canonical).toContain('"sourceRecordedAtIso":null');
    expect(canonical).toContain('"collectedAt":null');
    expect(canonical).toContain('"publishedAt":null');
  });

  it("produces different hashes for different theses in the same request", () => {
    const req = baseRequest({
      theses: [
        baseThesis({ asset: "SOL" }),
        baseThesis({ asset: "BTC", sourceHandle: "@trader2" })
      ]
    });
    const a = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    const b = computeSrThesisV2CanonicalAndHash(req, req.theses[1]);
    expect(a.hash).not.toBe(b.hash);
  });

  it("alternative canonical JSON output uses the v1 canonical helper as a sanity check", () => {
    const req = baseRequest();
    const { canonical } = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    const expected = toCanonicalJson({
      schemaVersion: req.schemaVersion,
      source: req.source,
      symbol: req.symbol,
      brief: req.brief,
      thesis: req.theses[0]
    });
    expect(canonical).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/contract/v2/__tests__/srLevels.canonicalHash.snapshot.test.ts`
Expected: FAIL — `computeSrThesisV2CanonicalAndHash` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/contract/v2/srLevels.ts` (after `parseSrLevelsV2IngestRequest`):

```ts
import { toCanonicalJson } from "../v1/canonical.js";
import { sha256Hex } from "../v1/hash.js";

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

(Keep these as top-of-file imports in the final edit, not at the bottom.)

- [ ] **Step 4: Run the snapshot test**

Run: `pnpm vitest run src/contract/v2/__tests__/srLevels.canonicalHash.snapshot.test.ts`
Expected: PASS. The first run writes snapshots; review the snapshot file to confirm the canonical JSON sorts keys lexicographically and the hash is a 64-char lower-hex string.

- [ ] **Step 5: Commit**

```bash
git add src/contract/v2/srLevels.ts src/contract/v2/__tests__/srLevels.canonicalHash.snapshot.test.ts src/contract/v2/__tests__/__snapshots__/
git commit -m "feat: add v2 sr-thesis canonical JSON and payload hash helper"
```

---

## Task 7: Validation matrix tests for the v2 parser

**Files:**
- Create: `src/contract/v2/__tests__/srLevels.validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/contract/v2/__tests__/srLevels.validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSrLevelsV2IngestRequest } from "../srLevels.js";
import { V2ContractValidationError } from "../errors.js";

const validThesis = (overrides: Record<string, unknown> = {}) => ({
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: "breakout",
  supportLevels: ["140.50"],
  resistanceLevels: ["160.00"],
  entryZone: "145-148",
  targets: ["170"],
  invalidation: "<135",
  trigger: "close above 160",
  chartReference: null,
  sourceHandle: "@trader",
  sourceChannel: "twitter",
  sourceKind: "post",
  sourceReliability: "medium",
  rawThesisText: null,
  collectedAt: "2026-04-29T13:00:00Z",
  publishedAt: "2026-04-29T12:00:00Z",
  sourceUrl: null,
  notes: null,
  ...overrides
});

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "2.0",
  source: "macro-charts",
  symbol: "SOL",
  brief: {
    briefId: "mco-sol-2026-04-29",
    sourceRecordedAtIso: "2026-04-29T11:00:00Z",
    summary: "summary"
  },
  theses: [validThesis()],
  ...overrides
});

const expectReject = (overrides: Record<string, unknown>): V2ContractValidationError => {
  try {
    parseSrLevelsV2IngestRequest({ ...validPayload(), ...overrides });
  } catch (err) {
    if (err instanceof V2ContractValidationError) return err;
    throw err;
  }
  throw new Error("Expected V2ContractValidationError, got success");
};

describe("parseSrLevelsV2IngestRequest — acceptance", () => {
  it("accepts the canonical fixture", () => {
    expect(() => parseSrLevelsV2IngestRequest(validPayload())).not.toThrow();
  });

  it("preserves exact inbound timestamp strings (no normalization)", () => {
    const payload = validPayload({
      brief: {
        briefId: "b1",
        sourceRecordedAtIso: "2026-04-29T11:00:00.000Z",
        summary: null
      },
      theses: [
        validThesis({
          collectedAt: "2026-04-29T13:00:00+00:00",
          publishedAt: "2026-04-29T12:00:00.500Z"
        })
      ]
    });
    const parsed = parseSrLevelsV2IngestRequest(payload);
    expect(parsed.brief.sourceRecordedAtIso).toBe("2026-04-29T11:00:00.000Z");
    expect(parsed.theses[0].collectedAt).toBe("2026-04-29T13:00:00+00:00");
    expect(parsed.theses[0].publishedAt).toBe("2026-04-29T12:00:00.500Z");
  });

  it("accepts null sourceRecordedAtIso, summary, collectedAt, publishedAt", () => {
    const payload = validPayload({
      brief: { briefId: "b1", sourceRecordedAtIso: null, summary: null },
      theses: [validThesis({ collectedAt: null, publishedAt: null })]
    });
    const parsed = parseSrLevelsV2IngestRequest(payload);
    expect(parsed.brief.sourceRecordedAtIso).toBeNull();
    expect(parsed.brief.summary).toBeNull();
    expect(parsed.theses[0].collectedAt).toBeNull();
    expect(parsed.theses[0].publishedAt).toBeNull();
  });

  it("accepts empty supportLevels / resistanceLevels / targets arrays", () => {
    const payload = validPayload({
      theses: [validThesis({ supportLevels: [], resistanceLevels: [], targets: [] })]
    });
    expect(() => parseSrLevelsV2IngestRequest(payload)).not.toThrow();
  });
});

describe("parseSrLevelsV2IngestRequest — rejections", () => {
  it("rejects schemaVersion !== '2.0' with UNSUPPORTED_SCHEMA_VERSION", () => {
    const err = expectReject({ schemaVersion: "1.0" });
    expect(err.statusCode).toBe(400);
    expect(err.response.error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(err.response.schemaVersion).toBe("2.0");
  });

  it("rejects missing source", () => {
    const err = expectReject({ source: undefined });
    expect(err.response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty source", () => {
    expect(expectReject({ source: "" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing symbol", () => {
    expect(expectReject({ symbol: undefined }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing brief", () => {
    expect(expectReject({ brief: undefined }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty theses array", () => {
    expect(expectReject({ theses: [] }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing required thesis fields (asset, timeframe, sourceHandle, sourceKind)", () => {
    for (const field of ["asset", "timeframe", "sourceHandle", "sourceKind"] as const) {
      const t: Record<string, unknown> = validThesis();
      delete t[field];
      expect(expectReject({ theses: [t] }).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects empty required thesis strings", () => {
    for (const field of ["asset", "timeframe", "sourceHandle", "sourceKind"] as const) {
      const t = validThesis({ [field]: "" });
      expect(expectReject({ theses: [t] }).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects nullable scalars when absent (must be present, may be null)", () => {
    for (const field of [
      "bias",
      "setupType",
      "entryZone",
      "invalidation",
      "trigger",
      "chartReference",
      "sourceChannel",
      "sourceReliability",
      "rawThesisText",
      "collectedAt",
      "publishedAt",
      "sourceUrl",
      "notes"
    ] as const) {
      const t: Record<string, unknown> = validThesis();
      delete t[field];
      expect(expectReject({ theses: [t] }).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects bad ISO timestamps (sourceRecordedAtIso, collectedAt, publishedAt)", () => {
    expect(
      expectReject({
        brief: { briefId: "b1", sourceRecordedAtIso: "yesterday", summary: null }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({ theses: [validThesis({ collectedAt: "yesterday" })] }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({ theses: [validThesis({ publishedAt: "tomorrow" })] }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(expectReject({ extra: 1 }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown thesis keys (strict)", () => {
    const t = { ...validThesis(), surprise: 1 };
    expect(expectReject({ theses: [t] }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown brief keys (strict)", () => {
    expect(
      expectReject({
        brief: {
          briefId: "b1",
          sourceRecordedAtIso: null,
          summary: null,
          extra: 1
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate thesis identities in one request", () => {
    const dup = validThesis({ asset: "SOL", sourceHandle: "@trader" });
    const err = expectReject({ theses: [validThesis(), dup] });
    expect(err.response.error.code).toBe("VALIDATION_ERROR");
    expect(err.response.error.details[0].path).toBe("$.theses[1]");
    expect(err.response.error.details[0].message).toMatch(/Duplicate/i);
  });

  it("rejects duplicate identities even when payloads are otherwise identical", () => {
    const t = validThesis();
    expect(expectReject({ theses: [t, t] }).response.error.code).toBe("VALIDATION_ERROR");
  });
});
```

- [ ] **Step 2: Run the validation tests**

Run: `pnpm vitest run src/contract/v2/__tests__/srLevels.validation.test.ts`
Expected: PASS. All assertions exercise the implementation from Tasks 5–6.

- [ ] **Step 3: Commit**

```bash
git add src/contract/v2/__tests__/srLevels.validation.test.ts
git commit -m "test: v2 sr-levels ingest validation matrix"
```

---

## Task 8: Implement `SrThesesV2Store` (insertBrief + getCurrent)

**Files:**
- Create: `src/ledger/srThesesV2Store.ts`

- [ ] **Step 1: Write the failing unit test (no DB)**

Create `src/ledger/__tests__/srThesesV2Store.unit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  SrThesesV2Store,
  SrThesisV2ConflictError,
  SR_THESIS_V2_ERROR_CODES
} from "../srThesesV2Store.js";

describe("SrThesesV2Store module", () => {
  it("exports SrThesesV2Store class, conflict error, and error codes", () => {
    expect(SrThesesV2Store).toBeDefined();
    expect(SrThesisV2ConflictError).toBeDefined();
    expect(SR_THESIS_V2_ERROR_CODES.SR_THESIS_V2_CONFLICT).toBe("SR_THESIS_V2_CONFLICT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ledger/__tests__/srThesesV2Store.unit.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the store**

Create `src/ledger/srThesesV2Store.ts`:

```ts
import { and, asc, desc, eq } from "drizzle-orm";
import { srThesesV2 } from "./pg/schema/index.js";
import type { SrThesisV2Row } from "./pg/schema/index.js";
import type { Db } from "./pg/db.js";
import {
  computeSrThesisV2CanonicalAndHash,
  type SrLevelsV2IngestRequest,
  type SrLevelsV2CurrentResponse,
  type SrThesisV2
} from "../contract/v2/srLevels.js";

export const SR_THESIS_V2_ERROR_CODES = {
  SR_THESIS_V2_CONFLICT: "SR_THESIS_V2_CONFLICT"
} as const;

export interface SrThesisV2ConflictKey {
  source: string;
  symbol: string;
  briefId: string;
  asset: string;
  sourceHandle: string;
}

export class SrThesisV2ConflictError extends Error {
  public readonly errorCode = SR_THESIS_V2_ERROR_CODES.SR_THESIS_V2_CONFLICT;
  public readonly key: SrThesisV2ConflictKey;

  public constructor(key: SrThesisV2ConflictKey) {
    super(
      `S/R thesis v2 conflict for source="${key.source}" symbol="${key.symbol}" briefId="${key.briefId}" asset="${key.asset}" sourceHandle="${key.sourceHandle}"`
    );
    this.key = key;
  }
}

export type SrThesesV2InsertResult =
  | { status: "created"; insertedCount: number; idempotentCount: number }
  | { status: "already_ingested"; insertedCount: 0; idempotentCount: number };

export interface SrThesesV2InsertInput {
  request: SrLevelsV2IngestRequest;
  capturedAtUnixMs: number;
}

const rowToThesis = (row: SrThesisV2Row): SrThesisV2 => ({
  asset: row.asset,
  timeframe: row.timeframe,
  bias: row.bias,
  setupType: row.setupType,
  supportLevels: row.supportLevels,
  resistanceLevels: row.resistanceLevels,
  entryZone: row.entryZone,
  targets: row.targets,
  invalidation: row.invalidation,
  trigger: row.triggerText,
  chartReference: row.chartReference,
  sourceHandle: row.sourceHandle,
  sourceChannel: row.sourceChannel,
  sourceKind: row.sourceKind,
  sourceReliability: row.sourceReliability,
  rawThesisText: row.rawThesisText,
  collectedAt: row.collectedAtIso,
  publishedAt: row.publishedAtIso,
  sourceUrl: row.sourceUrl,
  notes: row.notes
});

export class SrThesesV2Store {
  public constructor(private readonly db: Db) {}

  public async insertBrief(input: SrThesesV2InsertInput): Promise<SrThesesV2InsertResult> {
    const { request, capturedAtUnixMs } = input;

    return this.db.transaction(async (tx) => {
      let insertedCount = 0;
      let idempotentCount = 0;

      for (const thesis of request.theses) {
        const { hash } = computeSrThesisV2CanonicalAndHash(request, thesis);

        const inserted = await tx
          .insert(srThesesV2)
          .values({
            source: request.source,
            symbol: request.symbol,
            briefId: request.brief.briefId,
            sourceRecordedAtIso: request.brief.sourceRecordedAtIso,
            summary: request.brief.summary,
            capturedAtUnixMs,
            asset: thesis.asset,
            timeframe: thesis.timeframe,
            bias: thesis.bias,
            setupType: thesis.setupType,
            sourceHandle: thesis.sourceHandle,
            sourceChannel: thesis.sourceChannel,
            sourceKind: thesis.sourceKind,
            sourceReliability: thesis.sourceReliability,
            rawThesisText: thesis.rawThesisText,
            chartReference: thesis.chartReference,
            sourceUrl: thesis.sourceUrl,
            collectedAtIso: thesis.collectedAt,
            publishedAtIso: thesis.publishedAt,
            supportLevels: thesis.supportLevels,
            resistanceLevels: thesis.resistanceLevels,
            targets: thesis.targets,
            entryZone: thesis.entryZone,
            invalidation: thesis.invalidation,
            triggerText: thesis.trigger,
            notes: thesis.notes,
            payloadHash: hash
          })
          .onConflictDoNothing({
            target: [
              srThesesV2.source,
              srThesesV2.symbol,
              srThesesV2.briefId,
              srThesesV2.asset,
              srThesesV2.sourceHandle
            ]
          })
          .returning();

        if (inserted.length > 0) {
          insertedCount += 1;
          continue;
        }

        const existing = await tx
          .select()
          .from(srThesesV2)
          .where(
            and(
              eq(srThesesV2.source, request.source),
              eq(srThesesV2.symbol, request.symbol),
              eq(srThesesV2.briefId, request.brief.briefId),
              eq(srThesesV2.asset, thesis.asset),
              eq(srThesesV2.sourceHandle, thesis.sourceHandle)
            )
          )
          .limit(1);

        const row = existing[0];
        if (!row) {
          throw new Error(
            "append-only invariant violated: ON CONFLICT did not insert but no existing row found"
          );
        }
        if (row.payloadHash !== hash) {
          throw new SrThesisV2ConflictError({
            source: request.source,
            symbol: request.symbol,
            briefId: request.brief.briefId,
            asset: thesis.asset,
            sourceHandle: thesis.sourceHandle
          });
        }
        idempotentCount += 1;
      }

      if (insertedCount > 0) {
        return { status: "created", insertedCount, idempotentCount };
      }
      return { status: "already_ingested", insertedCount: 0, idempotentCount };
    });
  }

  public async getCurrent(
    symbol: string,
    source: string
  ): Promise<SrLevelsV2CurrentResponse | null> {
    const latest = await this.db
      .select()
      .from(srThesesV2)
      .where(and(eq(srThesesV2.symbol, symbol), eq(srThesesV2.source, source)))
      .orderBy(desc(srThesesV2.capturedAtUnixMs), desc(srThesesV2.id))
      .limit(1);

    const head = latest[0];
    if (!head) return null;

    const rows = await this.db
      .select()
      .from(srThesesV2)
      .where(
        and(
          eq(srThesesV2.source, source),
          eq(srThesesV2.symbol, symbol),
          eq(srThesesV2.briefId, head.briefId)
        )
      )
      .orderBy(asc(srThesesV2.id));

    return {
      schemaVersion: "2.0",
      source: head.source,
      symbol: head.symbol,
      brief: {
        briefId: head.briefId,
        sourceRecordedAtIso: head.sourceRecordedAtIso,
        summary: head.summary
      },
      capturedAtIso: new Date(head.capturedAtUnixMs).toISOString(),
      theses: rows.map(rowToThesis)
    };
  }
}
```

- [ ] **Step 4: Run unit test to verify it passes**

Run: `pnpm vitest run src/ledger/__tests__/srThesesV2Store.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ledger/srThesesV2Store.ts src/ledger/__tests__/srThesesV2Store.unit.test.ts
git commit -m "feat: add SrThesesV2Store with transactional insertBrief and getCurrent"
```

---

## Task 9: PG-gated integration tests for `SrThesesV2Store`

**Files:**
- Create: `src/ledger/__tests__/srThesesV2Store.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/ledger/__tests__/srThesesV2Store.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../pg/db.js";
import { srThesesV2 } from "../pg/schema/index.js";
import { SrThesesV2Store, SrThesisV2ConflictError } from "../srThesesV2Store.js";
import type { SrLevelsV2IngestRequest, SrThesisV2 } from "../../contract/v2/srLevels.js";

const validThesis = (overrides: Partial<SrThesisV2> = {}): SrThesisV2 => ({
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: "breakout",
  supportLevels: ["140.50", "135.00"],
  resistanceLevels: ["160.00"],
  entryZone: "145-148",
  targets: ["170"],
  invalidation: "<135",
  trigger: "close above 160",
  chartReference: null,
  sourceHandle: "@trader",
  sourceChannel: "twitter",
  sourceKind: "post",
  sourceReliability: "medium",
  rawThesisText: null,
  collectedAt: "2026-04-29T13:00:00Z",
  publishedAt: "2026-04-29T12:00:00Z",
  sourceUrl: null,
  notes: null,
  ...overrides
});

const validRequest = (overrides: Partial<SrLevelsV2IngestRequest> = {}): SrLevelsV2IngestRequest =>
  ({
    schemaVersion: "2.0",
    source: "macro-charts",
    symbol: "SOL",
    brief: {
      briefId: "mco-sol-2026-04-29",
      sourceRecordedAtIso: "2026-04-29T11:00:00Z",
      summary: "summary"
    },
    theses: [validThesis()],
    ...overrides
  }) as SrLevelsV2IngestRequest;

describe.skipIf(!process.env.DATABASE_URL)("SrThesesV2Store (PG)", () => {
  let db: Db;
  let client: { end: () => Promise<void> };
  let store: SrThesesV2Store;

  beforeAll(() => {
    const result = createDb(process.env.DATABASE_URL!);
    db = result.db;
    client = result.client;
    store = new SrThesesV2Store(db);
  });

  afterAll(async () => {
    await client.end();
  });

  afterEach(async () => {
    await db.delete(srThesesV2).execute();
  });

  it("inserts one row per thesis and returns 'created'", async () => {
    const req = validRequest({
      theses: [
        validThesis({ asset: "SOL", sourceHandle: "@a" }),
        validThesis({ asset: "BTC", sourceHandle: "@b" })
      ]
    });

    const result = await store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 });

    expect(result).toEqual({ status: "created", insertedCount: 2, idempotentCount: 0 });
    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(2);
  });

  it("byte-identical replay returns 'already_ingested'", async () => {
    const req = validRequest();
    await store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 });

    const second = await store.insertBrief({
      request: req,
      capturedAtUnixMs: 1_777_000_001_000
    });
    expect(second).toEqual({ status: "already_ingested", insertedCount: 0, idempotentCount: 1 });
    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1);
  });

  it("mixed created/idempotent batch returns 'created' with both counts", async () => {
    const reqA = validRequest({
      theses: [validThesis({ asset: "SOL", sourceHandle: "@a" })]
    });
    await store.insertBrief({ request: reqA, capturedAtUnixMs: 1_777_000_000_000 });

    const reqB = validRequest({
      theses: [
        validThesis({ asset: "SOL", sourceHandle: "@a" }), // idempotent
        validThesis({ asset: "BTC", sourceHandle: "@b" }) // new
      ]
    });
    const result = await store.insertBrief({
      request: reqB,
      capturedAtUnixMs: 1_777_000_001_000
    });
    expect(result).toEqual({ status: "created", insertedCount: 1, idempotentCount: 1 });
  });

  it("different-payload same identity throws SrThesisV2ConflictError", async () => {
    const original = validRequest();
    await store.insertBrief({ request: original, capturedAtUnixMs: 1_777_000_000_000 });

    const conflicting = validRequest({
      theses: [validThesis({ bias: "bearish" })]
    });
    await expect(
      store.insertBrief({ request: conflicting, capturedAtUnixMs: 1_777_000_001_000 })
    ).rejects.toBeInstanceOf(SrThesisV2ConflictError);

    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1);
    expect(all[0].bias).toBe("bullish");
  });

  it("rolls back partial inserts on conflict (transactional)", async () => {
    const baseline = validRequest({
      theses: [validThesis({ asset: "BTC", sourceHandle: "@b", bias: "bullish" })]
    });
    await store.insertBrief({ request: baseline, capturedAtUnixMs: 1_777_000_000_000 });

    const mixed = validRequest({
      theses: [
        validThesis({ asset: "SOL", sourceHandle: "@new" }), // would be new
        validThesis({ asset: "BTC", sourceHandle: "@b", bias: "bearish" }) // conflicts
      ]
    });
    await expect(
      store.insertBrief({ request: mixed, capturedAtUnixMs: 1_777_000_001_000 })
    ).rejects.toBeInstanceOf(SrThesisV2ConflictError);

    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1); // only the baseline row remains
    expect(all[0].sourceHandle).toBe("@b");
  });

  it("concurrent identical inserts: exactly one row, the other is 'already_ingested'", async () => {
    const req = validRequest();
    const settled = await Promise.allSettled([
      store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 }),
      store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_500 })
    ]);
    const fulfilled = settled.filter((s) => s.status === "fulfilled") as PromiseFulfilledResult<{
      status: string;
    }>[];
    expect(fulfilled).toHaveLength(2);
    const statuses = fulfilled.map((r) => r.value.status).sort();
    expect(statuses).toEqual(["already_ingested", "created"]);
    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1);
  });

  it("getCurrent returns null when no rows match", async () => {
    expect(await store.getCurrent("SOL", "macro-charts")).toBeNull();
  });

  it("getCurrent selects the latest brief by capturedAtUnixMs DESC, id DESC", async () => {
    await store.insertBrief({
      request: validRequest({ brief: { briefId: "old", sourceRecordedAtIso: null, summary: null } }),
      capturedAtUnixMs: 1_777_000_000_000
    });
    await store.insertBrief({
      request: validRequest({
        brief: { briefId: "new", sourceRecordedAtIso: null, summary: null }
      }),
      capturedAtUnixMs: 1_777_000_001_000
    });

    const current = await store.getCurrent("SOL", "macro-charts");
    expect(current?.brief.briefId).toBe("new");
  });

  it("getCurrent returns all theses for the selected brief ordered by id ASC", async () => {
    const req = validRequest({
      theses: [
        validThesis({ asset: "SOL", sourceHandle: "@a" }),
        validThesis({ asset: "BTC", sourceHandle: "@b" }),
        validThesis({ asset: "ETH", sourceHandle: "@c" })
      ]
    });
    await store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 });
    const current = await store.getCurrent("SOL", "macro-charts");
    expect(current?.theses.map((t) => t.asset)).toEqual(["SOL", "BTC", "ETH"]);
  });

  it("preserves arrays, nullable fields, exact non-null timestamp strings, and null timestamps round-trip", async () => {
    const req = validRequest({
      brief: {
        briefId: "rt-1",
        sourceRecordedAtIso: "2026-04-29T11:00:00.000Z",
        summary: null
      },
      theses: [
        validThesis({
          supportLevels: ["140.50", "135.00"],
          resistanceLevels: [],
          targets: ["170"],
          collectedAt: null,
          publishedAt: "2026-04-29T12:00:00+00:00",
          notes: null,
          chartReference: null
        })
      ]
    });
    await store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 });

    const current = await store.getCurrent("SOL", "macro-charts");
    expect(current?.brief.sourceRecordedAtIso).toBe("2026-04-29T11:00:00.000Z");
    const t = current?.theses[0]!;
    expect(t.supportLevels).toEqual(["140.50", "135.00"]);
    expect(t.resistanceLevels).toEqual([]);
    expect(t.targets).toEqual(["170"]);
    expect(t.collectedAt).toBeNull();
    expect(t.publishedAt).toBe("2026-04-29T12:00:00+00:00");
    expect(t.notes).toBeNull();
    expect(t.chartReference).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test against an ephemeral PG**

If you do not already have a Postgres test instance, start one matching the `test:pg` script:

```bash
docker compose -f docker-compose.test.yml up -d
```

Then apply migrations:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run db:migrate
```

Run the integration test:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm vitest run src/ledger/__tests__/srThesesV2Store.test.ts
```

Expected: all assertions pass.

- [ ] **Step 3: Commit**

```bash
git add src/ledger/__tests__/srThesesV2Store.test.ts
git commit -m "test: PG-gated integration tests for SrThesesV2Store"
```

---

## Task 10: Wire `SrThesesV2Store` into `StoreContext`

**Files:**
- Modify: `src/ledger/storeContext.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ledger/__tests__/storeContextV2.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { StoreContext } from "../storeContext.js";

describe("StoreContext interface", () => {
  it("declares srThesesV2Store", () => {
    const probe: StoreContext = null as unknown as StoreContext;
    void probe;
    type HasField = StoreContext extends { srThesesV2Store: unknown } ? true : false;
    const ok: HasField = true;
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ledger/__tests__/storeContextV2.test.ts`
Expected: FAIL — type assertion `HasField` is `false`, narrowing `true` → compile error.

- [ ] **Step 3: Wire the store**

Edit `src/ledger/storeContext.ts` to read:

```ts
import type { LedgerStore } from "./store.js";
import type { Db } from "./pg/db.js";
import { CandleStore } from "./candleStore.js";
import { InsightsStore } from "./insightsStore.js";
import { SrThesesV2Store } from "./srThesesV2Store.js";
import { createLedgerStore } from "./store.js";
import { createDb } from "./pg/db.js";

export interface StoreContext {
  ledger: LedgerStore;
  pg: Db;
  pgClient: { end: () => Promise<void> };
  candleStore: CandleStore;
  insightsStore: InsightsStore;
  srThesesV2Store: SrThesesV2Store;
}

export const createStoreContext = (
  ledgerPath: string,
  pgConnectionString: string
): StoreContext => {
  const ledger = createLedgerStore(ledgerPath);
  try {
    const { db: pg, client: pgClient } = createDb(pgConnectionString);
    const candleStore = new CandleStore(pg);
    const insightsStore = new InsightsStore(pg);
    const srThesesV2Store = new SrThesesV2Store(pg);
    return { ledger, pg, pgClient, candleStore, insightsStore, srThesesV2Store };
  } catch (err) {
    ledger.close();
    throw err;
  }
};

export const closeStoreContext = async (ctx: StoreContext): Promise<void> => {
  try {
    ctx.ledger.close();
  } finally {
    await ctx.pgClient.end();
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/ledger/__tests__/storeContextV2.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ledger/storeContext.ts src/ledger/__tests__/storeContextV2.test.ts
git commit -m "feat: wire SrThesesV2Store through StoreContext"
```

---

## Task 11: Implement `POST /v2/sr-levels` handler

**Files:**
- Create: `src/http/handlers/srLevelsV2Ingest.ts`
- Modify: `src/http/auth.ts`

- [ ] **Step 1: Export `safeEqual` so the v2 handler can do timing-safe comparisons**

Edit `src/http/auth.ts`. Change `const safeEqual = ...` to `export const safeEqual = ...`. No other v1 changes.

- [ ] **Step 2: Write a handler-shape test**

Create `src/http/handlers/__tests__/srLevelsV2Ingest.shape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSrLevelsV2IngestHandler } from "../srLevelsV2Ingest.js";

describe("createSrLevelsV2IngestHandler", () => {
  it("returns a request handler when the store is null", () => {
    const handler = createSrLevelsV2IngestHandler(null);
    expect(typeof handler).toBe("function");
  });
});
```

Run: `pnpm vitest run src/http/handlers/__tests__/srLevelsV2Ingest.shape.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the handler**

Create `src/http/handlers/srLevelsV2Ingest.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  parseSrLevelsV2IngestRequest,
  type SrLevelsV2IngestCreatedResponse,
  type SrLevelsV2IngestAlreadyIngestedResponse
} from "../../contract/v2/srLevels.js";
import {
  V2ContractValidationError,
  V2_SCHEMA_VERSION,
  serverMisconfigurationV2Error,
  serviceUnavailableV2Error,
  unauthorizedV2Error,
  srThesisV2ConflictError,
  internalErrorV2
} from "../../contract/v2/errors.js";
import { SrThesesV2Store, SrThesisV2ConflictError } from "../../ledger/srThesesV2Store.js";
import { safeEqual } from "../auth.js";

const ENV_VAR = "OPENCLAW_INGEST_TOKEN";
const HEADER = "x-ingest-token";

export const createSrLevelsV2IngestHandler = (store: SrThesesV2Store | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = process.env[ENV_VAR];
    if (!token) {
      return reply.code(500).send(serverMisconfigurationV2Error(ENV_VAR));
    }
    const headerValue = request.headers[HEADER];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!provided || !safeEqual(provided, token)) {
      return reply.code(401).send(unauthorizedV2Error());
    }

    if (!store) {
      return reply
        .code(503)
        .send(
          serviceUnavailableV2Error(
            "S/R thesis v2 store is not available (no DATABASE_URL configured)"
          )
        );
    }

    try {
      const parsed = parseSrLevelsV2IngestRequest(request.body);
      const result = await store.insertBrief({
        request: parsed,
        capturedAtUnixMs: Date.now()
      });

      if (result.status === "created") {
        const response: SrLevelsV2IngestCreatedResponse = {
          schemaVersion: V2_SCHEMA_VERSION,
          status: "created",
          briefId: parsed.brief.briefId,
          insertedCount: result.insertedCount,
          idempotentCount: result.idempotentCount
        };
        return reply.code(201).send(response);
      }

      const response: SrLevelsV2IngestAlreadyIngestedResponse = {
        schemaVersion: V2_SCHEMA_VERSION,
        status: "already_ingested",
        briefId: parsed.brief.briefId,
        insertedCount: 0,
        idempotentCount: result.idempotentCount
      };
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof V2ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof SrThesisV2ConflictError) {
        return reply.code(409).send(srThesisV2ConflictError(error.key));
      }
      request.log.error(error, "Unhandled error in POST /v2/sr-levels");
      return reply.code(500).send(internalErrorV2());
    }
  };
};
```

- [ ] **Step 4: Run the shape test**

Run: `pnpm vitest run src/http/handlers/__tests__/srLevelsV2Ingest.shape.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/http/handlers/srLevelsV2Ingest.ts src/http/handlers/__tests__/srLevelsV2Ingest.shape.test.ts src/http/auth.ts
git commit -m "feat: implement POST /v2/sr-levels handler"
```

---

## Task 12: Implement `GET /v2/sr-levels/current` handler

**Files:**
- Create: `src/http/handlers/srLevelsV2Current.ts`

- [ ] **Step 1: Write a handler-shape test**

Create `src/http/handlers/__tests__/srLevelsV2Current.shape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSrLevelsV2CurrentHandler } from "../srLevelsV2Current.js";

describe("createSrLevelsV2CurrentHandler", () => {
  it("returns a request handler when the store is null", () => {
    const handler = createSrLevelsV2CurrentHandler(null);
    expect(typeof handler).toBe("function");
  });
});
```

Run: `pnpm vitest run src/http/handlers/__tests__/srLevelsV2Current.shape.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the handler**

Create `src/http/handlers/srLevelsV2Current.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SrThesesV2Store } from "../../ledger/srThesesV2Store.js";
import {
  V2_SCHEMA_VERSION,
  internalErrorV2,
  serviceUnavailableV2Error,
  srThesisV2NotFoundError,
  validationErrorV2
} from "../../contract/v2/errors.js";

export const createSrLevelsV2CurrentHandler = (store: SrThesesV2Store | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!store) {
      return reply
        .code(503)
        .send(
          serviceUnavailableV2Error(
            "S/R thesis v2 store is not available (no DATABASE_URL configured)"
          )
        );
    }

    const query = request.query as Record<string, string | string[] | undefined>;
    const symbolRaw = query["symbol"];
    const sourceRaw = query["source"];
    const symbol = typeof symbolRaw === "string" ? symbolRaw : undefined;
    const source = typeof sourceRaw === "string" ? sourceRaw : undefined;

    if (!symbol || !source) {
      const missing: Array<{ path: string; code: "REQUIRED"; message: string }> = [];
      if (!symbol) {
        missing.push({ path: "$.symbol", code: "REQUIRED", message: "Field is required" });
      }
      if (!source) {
        missing.push({ path: "$.source", code: "REQUIRED", message: "Field is required" });
      }
      return reply
        .code(400)
        .send(
          validationErrorV2("Query parameters 'symbol' and 'source' are required", missing)
            .response
        );
    }

    try {
      const result = await store.getCurrent(symbol, source);
      if (!result) {
        return reply.code(404).send(srThesisV2NotFoundError(symbol, source));
      }
      return reply.code(200).send(result);
    } catch (error) {
      request.log.error(error, "Unhandled error in GET /v2/sr-levels/current");
      return reply.code(500).send(internalErrorV2());
    }
  };
};
```

`validationErrorV2(...)` returns a `V2ContractValidationError` (Task 4) whose `.response` is the JSON-ready envelope — that is the value sent on the wire. `store.getCurrent` already returns the `SrLevelsV2CurrentResponse` shape with `schemaVersion: "2.0"`, so the handler can send it as-is.

- [ ] **Step 3: Run the shape test**

Run: `pnpm vitest run src/http/handlers/__tests__/srLevelsV2Current.shape.test.ts`
Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http/handlers/srLevelsV2Current.ts src/http/handlers/__tests__/srLevelsV2Current.shape.test.ts
git commit -m "feat: implement GET /v2/sr-levels/current handler"
```

---

## Task 13: Register v2 routes in `src/http/routes.ts`

**Files:**
- Modify: `src/http/routes.ts`

- [ ] **Step 1: Write a routing smoke test**

Append to `src/http/__tests__/routes.contract.test.ts` (do not modify existing tests):

```ts
it("OpenAPI document advertises POST /v2/sr-levels", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
  expect(res.statusCode).toBe(200);
  const doc = res.json();
  expect(doc.paths["/v2/sr-levels"]).toBeDefined();
  expect(doc.paths["/v2/sr-levels"].post).toBeDefined();
});

it("OpenAPI document advertises GET /v2/sr-levels/current", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
  expect(res.statusCode).toBe(200);
  const doc = res.json();
  expect(doc.paths["/v2/sr-levels/current"]).toBeDefined();
  expect(doc.paths["/v2/sr-levels/current"].get).toBeDefined();
});

it("v2 routes are registered (returns 503 SERVICE_UNAVAILABLE for GET /v2/sr-levels/current without DATABASE_URL)", async () => {
  delete process.env.DATABASE_URL;
  const app = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/v2/sr-levels/current?symbol=SOL&source=macro-charts"
  });
  expect(res.statusCode).toBe(503);
  await app.close();
});
```

Run: `pnpm vitest run src/http/__tests__/routes.contract.test.ts`
Expected: the new assertions FAIL (paths missing, routes not registered).

- [ ] **Step 2: Wire the routes**

Edit `src/http/routes.ts`:

Add imports near the existing handler imports:

```ts
import { createSrLevelsV2IngestHandler } from "./handlers/srLevelsV2Ingest.js";
import { createSrLevelsV2CurrentHandler } from "./handlers/srLevelsV2Current.js";
```

Add the store reference next to `insightsStore`:

```ts
const srThesesV2Store = storeContext?.srThesesV2Store ?? null;
```

Register the routes after the existing v1 sr-level routes:

```ts
app.post("/v2/sr-levels", createSrLevelsV2IngestHandler(srThesesV2Store));
app.get("/v2/sr-levels/current", createSrLevelsV2CurrentHandler(srThesesV2Store));
```

- [ ] **Step 3: Run the route tests**

Run: `pnpm vitest run src/http/__tests__/routes.contract.test.ts`
Expected: PASS for the new assertions (the OpenAPI assertion will continue failing until Task 14; if so, add Task 14 OpenAPI doc updates here in the same step before running the routing-smoke test).

- [ ] **Step 4: Commit**

```bash
git add src/http/routes.ts src/http/__tests__/routes.contract.test.ts
git commit -m "feat: register POST /v2/sr-levels and GET /v2/sr-levels/current"
```

---

## Task 14: Document v2 routes in OpenAPI

**Files:**
- Modify: `src/http/openapi.ts`

- [ ] **Step 1: Add OpenAPI entries**

Edit `src/http/openapi.ts` and add the following two entries inside the `paths` object (after `/v1/insights/sol-usdc/history`):

```ts
"/v2/sr-levels": {
  post: {
    summary: "Ingest a v2 S/R thesis brief (one row per thesis)",
    responses: {
      "201": { description: "S/R thesis brief created" },
      "200": { description: "Idempotent replay (all theses already ingested)" },
      "400": { description: "Validation error or unsupported schemaVersion" },
      "401": { description: "Invalid or missing X-Ingest-Token" },
      "409": {
        description:
          "S/R thesis v2 conflict — same identity exists with a different payload hash"
      },
      "500": { description: "OPENCLAW_INGEST_TOKEN environment variable not set" },
      "503": {
        description: "S/R thesis v2 store not available (no DATABASE_URL configured)"
      }
    }
  }
},
"/v2/sr-levels/current": {
  get: {
    summary: "Get the latest v2 S/R thesis brief for a (symbol, source) pair",
    parameters: [
      { name: "symbol", in: "query", required: true, schema: { type: "string" } },
      { name: "source", in: "query", required: true, schema: { type: "string" } }
    ],
    responses: {
      "200": { description: "Latest brief with all preserved thesis fields" },
      "400": { description: "Missing/empty/non-string symbol or source" },
      "404": { description: "No S/R thesis brief found for selector" },
      "503": {
        description: "S/R thesis v2 store not available (no DATABASE_URL configured)"
      }
    }
  }
}
```

- [ ] **Step 2: Run the contract tests**

Run: `pnpm vitest run src/http/__tests__/routes.contract.test.ts`
Expected: PASS for all new v2 OpenAPI assertions.

- [ ] **Step 3: Commit**

```bash
git add src/http/openapi.ts
git commit -m "docs: add /v2/sr-levels and /v2/sr-levels/current to OpenAPI"
```

---

## Task 15: HTTP e2e tests without `DATABASE_URL` (auth and 503)

**Files:**
- Create: `src/http/__tests__/srLevelsV2.e2e.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/http/__tests__/srLevelsV2.e2e.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

const validRequest = () => ({
  schemaVersion: "2.0",
  source: "macro-charts",
  symbol: "SOL",
  brief: {
    briefId: "mco-sol-2026-04-29",
    sourceRecordedAtIso: "2026-04-29T11:00:00Z",
    summary: "summary"
  },
  theses: [
    {
      asset: "SOL",
      timeframe: "1d",
      bias: "bullish",
      setupType: "breakout",
      supportLevels: ["140.50"],
      resistanceLevels: ["160.00"],
      entryZone: "145-148",
      targets: ["170"],
      invalidation: "<135",
      trigger: "close above 160",
      chartReference: null,
      sourceHandle: "@trader",
      sourceChannel: "twitter",
      sourceKind: "post",
      sourceReliability: "medium",
      rawThesisText: null,
      collectedAt: "2026-04-29T13:00:00Z",
      publishedAt: "2026-04-29T12:00:00Z",
      sourceUrl: null,
      notes: null
    }
  ]
});

describe("v2 sr-levels endpoints without DATABASE_URL", () => {
  afterEach(() => {
    delete process.env.LEDGER_DB_PATH;
    delete process.env.DATABASE_URL;
    delete process.env.OPENCLAW_INGEST_TOKEN;
  });

  it("POST returns 503 SERVICE_UNAVAILABLE with schemaVersion 2.0 when auth succeeds and DATABASE_URL is missing", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validRequest()
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");

    await app.close();
  });

  it("POST returns 500 SERVER_MISCONFIGURATION with schemaVersion 2.0 when OPENCLAW_INGEST_TOKEN is missing (even without DATABASE_URL)", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    delete process.env.OPENCLAW_INGEST_TOKEN;
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "anything" },
      payload: validRequest()
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SERVER_MISCONFIGURATION");

    await app.close();
  });

  it("POST returns 401 UNAUTHORIZED with schemaVersion 2.0 when token is missing", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    process.env.OPENCLAW_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      payload: validRequest()
    });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("UNAUTHORIZED");

    await app.close();
  });

  it("GET /v2/sr-levels/current returns 503 SERVICE_UNAVAILABLE with schemaVersion 2.0 when DATABASE_URL is missing", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;
    const app = buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v2/sr-levels/current?symbol=SOL&source=macro-charts"
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");

    await app.close();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm vitest run src/http/__tests__/srLevelsV2.e2e.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/http/__tests__/srLevelsV2.e2e.test.ts
git commit -m "test: e2e v2 sr-levels behavior without DATABASE_URL"
```

---

## Task 16: HTTP e2e PG tests (full ingest + current happy/sad paths)

**Files:**
- Create: `src/http/__tests__/srLevelsV2.e2e.pg.test.ts`

- [ ] **Step 1: Write the failing PG e2e test**

Create `src/http/__tests__/srLevelsV2.e2e.pg.test.ts`:

```ts
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createDb, type Db } from "../../ledger/pg/db.js";
import { srThesesV2 } from "../../ledger/pg/schema/index.js";

const PG = process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/regime_engine_test";

const validThesis = (overrides: Record<string, unknown> = {}) => ({
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: "breakout",
  supportLevels: ["140.50"],
  resistanceLevels: ["160.00"],
  entryZone: "145-148",
  targets: ["170"],
  invalidation: "<135",
  trigger: "close above 160",
  chartReference: null,
  sourceHandle: "@trader",
  sourceChannel: "twitter",
  sourceKind: "post",
  sourceReliability: "medium",
  rawThesisText: null,
  collectedAt: "2026-04-29T13:00:00Z",
  publishedAt: "2026-04-29T12:00:00Z",
  sourceUrl: null,
  notes: null,
  ...overrides
});

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "2.0",
  source: "macro-charts",
  symbol: "SOL",
  brief: {
    briefId: "mco-sol-2026-04-29",
    sourceRecordedAtIso: "2026-04-29T11:00:00Z",
    summary: "summary"
  },
  theses: [validThesis()],
  ...overrides
});

let db: Db;
let pgClient: { end: () => Promise<void> };

if (process.env.DATABASE_URL) {
  const r = createDb(PG);
  db = r.db;
  pgClient = r.client;
}

const setupPg = describe.skipIf(!process.env.DATABASE_URL);

afterAll(async () => {
  if (pgClient) await pgClient.end();
});

afterEach(async () => {
  delete process.env.LEDGER_DB_PATH;
  delete process.env.DATABASE_URL;
  delete process.env.OPENCLAW_INGEST_TOKEN;
  if (db) await db.delete(srThesesV2).execute();
});

const baseEnv = () => {
  process.env.LEDGER_DB_PATH = ":memory:";
  process.env.DATABASE_URL = PG;
  process.env.PG_SSL = "false";
  process.env.OPENCLAW_INGEST_TOKEN = "test-token";
};

setupPg("POST /v2/sr-levels (PG)", () => {
  it("returns 201 created on first ingest", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload()
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      schemaVersion: string;
      status: string;
      briefId: string;
      insertedCount: number;
      idempotentCount: number;
    };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.status).toBe("created");
    expect(body.briefId).toBe("mco-sol-2026-04-29");
    expect(body.insertedCount).toBe(1);
    expect(body.idempotentCount).toBe(0);
    await app.close();
  });

  it("returns 200 already_ingested on byte-identical replay", async () => {
    baseEnv();
    const app = buildApp();
    const payload = validPayload();
    await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload
    });
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { schemaVersion: string; status: string; idempotentCount: number };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.status).toBe("already_ingested");
    expect(body.idempotentCount).toBe(1);
    await app.close();
  });

  it("returns 409 SR_THESIS_V2_CONFLICT and does not partially insert the batch", async () => {
    baseEnv();
    const app = buildApp();

    // Seed identity (asset=BTC, sourceHandle=@b)
    await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({
        theses: [validThesis({ asset: "BTC", sourceHandle: "@b", bias: "bullish" })]
      })
    });

    // Send a batch where one thesis is new and one collides with different payload
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({
        theses: [
          validThesis({ asset: "SOL", sourceHandle: "@new" }),
          validThesis({ asset: "BTC", sourceHandle: "@b", bias: "bearish" })
        ]
      })
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SR_THESIS_V2_CONFLICT");

    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1); // baseline only
    expect(all[0].sourceHandle).toBe("@b");
    await app.close();
  });

  it("returns 401 with schemaVersion 2.0 on missing/wrong auth", async () => {
    baseEnv();
    const app = buildApp();
    const missing = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      payload: validPayload()
    });
    expect(missing.statusCode).toBe(401);
    expect((missing.json() as { schemaVersion: string }).schemaVersion).toBe("2.0");

    const wrong = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "wrong" },
      payload: validPayload()
    });
    expect(wrong.statusCode).toBe(401);
    expect((wrong.json() as { schemaVersion: string }).schemaVersion).toBe("2.0");
    await app.close();
  });

  it("returns 500 SERVER_MISCONFIGURATION when OPENCLAW_INGEST_TOKEN is missing (with DATABASE_URL set)", async () => {
    baseEnv();
    delete process.env.OPENCLAW_INGEST_TOKEN;
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "any" },
      payload: validPayload()
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SERVER_MISCONFIGURATION");
    await app.close();
  });

  it("returns 400 VALIDATION_ERROR for malformed payload", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: { garbage: true }
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("returns 400 VALIDATION_ERROR for duplicate thesis identities, before any writes", async () => {
    baseEnv();
    const app = buildApp();
    const dup = validThesis({ asset: "SOL", sourceHandle: "@trader" });
    const res = await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({ theses: [validThesis(), dup] })
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("VALIDATION_ERROR");

    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(0);
    await app.close();
  });
});

setupPg("GET /v2/sr-levels/current (PG)", () => {
  it("returns 400 VALIDATION_ERROR with schemaVersion 2.0 when symbol/source missing", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/v2/sr-levels/current" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("VALIDATION_ERROR");
    await app.close();
  });

  it("returns 404 SR_THESIS_V2_NOT_FOUND when no rows match", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v2/sr-levels/current?symbol=SOL&source=macro-charts"
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { schemaVersion: string; error: { code: string } };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.error.code).toBe("SR_THESIS_V2_NOT_FOUND");
    await app.close();
  });

  it("returns latest brief with exact-roundtrip thesis fields, including non-null and null timestamp strings", async () => {
    baseEnv();
    const app = buildApp();

    const olderTimestamp = "2026-04-28T11:00:00.000Z";
    await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({
        brief: { briefId: "old", sourceRecordedAtIso: olderTimestamp, summary: null }
      })
    });

    const newerTimestamp = "2026-04-29T11:00:00+00:00";
    await app.inject({
      method: "POST",
      url: "/v2/sr-levels",
      headers: { "X-Ingest-Token": "test-token" },
      payload: validPayload({
        brief: { briefId: "new", sourceRecordedAtIso: newerTimestamp, summary: "freshest" },
        theses: [
          validThesis({ collectedAt: null, publishedAt: "2026-04-29T12:00:00.500Z" }),
          validThesis({ asset: "BTC", sourceHandle: "@b" })
        ]
      })
    });

    const res = await app.inject({
      method: "GET",
      url: "/v2/sr-levels/current?symbol=SOL&source=macro-charts"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      schemaVersion: string;
      brief: { briefId: string; sourceRecordedAtIso: string };
      theses: Array<{ asset: string; collectedAt: string | null; publishedAt: string | null }>;
    };
    expect(body.schemaVersion).toBe("2.0");
    expect(body.brief.briefId).toBe("new");
    expect(body.brief.sourceRecordedAtIso).toBe(newerTimestamp);
    expect(body.theses.map((t) => t.asset)).toEqual(["SOL", "BTC"]);
    expect(body.theses[0].collectedAt).toBeNull();
    expect(body.theses[0].publishedAt).toBe("2026-04-29T12:00:00.500Z");
    await app.close();
  });
});

setupPg("v1 /v1/sr-levels behavior is unchanged when v2 is wired (PG present)", () => {
  it("v1 GET responds without using the v2 PG store (no rows in sr_theses_v2 are written or read)", async () => {
    baseEnv();
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/sr-levels/current?symbol=SOL&source=macro-charts"
    });
    // The v1 endpoint is SQLite-backed and returns 404 NOT_FOUND when no v1 brief exists.
    // It must not 503, must not crash, and must not touch the v2 PG table.
    expect([200, 404]).toContain(res.statusCode);
    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(0);
    await app.close();
  });
});
```

- [ ] **Step 2: Run the test against ephemeral PG**

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm vitest run src/http/__tests__/srLevelsV2.e2e.pg.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/http/__tests__/srLevelsV2.e2e.pg.test.ts
git commit -m "test: PG-gated e2e for v2 sr-levels endpoints"
```

---

## Task 17: Extend `package.json` `test:pg` to include v2 tests

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `test:pg`**

Edit `package.json`. Replace the existing `test:pg` value with:

```json
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false vitest run src/ledger/pg/__tests__/ src/__tests__/pgStartup.test.ts src/http/__tests__/storeContext.e2e.test.ts src/ledger/__tests__/candleStore.test.ts src/ledger/__tests__/insightsStore.test.ts src/http/__tests__/insights.e2e.pg.test.ts src/ledger/__tests__/srThesesV2Store.test.ts src/http/__tests__/srLevelsV2.e2e.pg.test.ts"
```

- [ ] **Step 2: Run the full PG test suite**

```bash
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run db:migrate
pnpm run test:pg
```

Expected: PASS for the full extended `test:pg` suite, including the two new v2 files.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include v2 sr-levels tests in test:pg suite"
```

---

## Task 18: Final verification + acceptance criteria sweep

**Files:**
- (no edits)

- [ ] **Step 1: Run the full pnpm checks**

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run test:pg
```

Expected: every command exits 0.

- [ ] **Step 2: Walk through acceptance criteria from the spec**

Tick each item against the running build:

- POST /v2/sr-levels persists each thesis as one row in `regime_engine.sr_theses_v2` (verified by `srLevelsV2.e2e.pg.test.ts` — `created` body and DB query).
- Timestamp fields round-trip exactly when non-null and as `null` when null (verified by canonical-hash snapshot test, store integration test, and PG e2e GET test).
- Duplicate thesis identities inside one request return `400 VALIDATION_ERROR` before any writes (verified by validation matrix and PG e2e test that asserts zero rows after the failed POST).
- Duplicate rows with matching `payload_hash` are idempotent (verified by 200 already_ingested test).
- Duplicate rows with different `payload_hash` return `409 SR_THESIS_V2_CONFLICT` and do not partially insert the batch (verified by `srThesesV2Store.test.ts` rollback test and PG e2e batch test).
- GET /v2/sr-levels/current returns the latest brief for `symbol` and `source` with all thesis fields preserved (verified by PG e2e test).
- All v2 error envelopes use `schemaVersion: "2.0"` (verified by `errors.test.ts`, `srLevelsV2.e2e.test.ts`, and `srLevelsV2.e2e.pg.test.ts`).
- v1 S/R behavior is unchanged (verified by the `/v1/sr-levels` regression in `srLevelsV2.e2e.pg.test.ts` and that no existing v1 test files were modified beyond appending v2 OpenAPI assertions).
- All pnpm scripts pass (verified by Step 1).

If any check is unmet, do not advance; fix and re-run.

- [ ] **Step 3: No-op commit (optional)**

If verification surfaces any small fix-ups, commit them as `fix:` follow-ups; otherwise this task closes the implementation.

---

## Notes for the engineer

- **Do not modify `/v1/sr-levels`** (request, response, SQLite-backed `srLevelsWriter.ts`, or its handlers/tests) except for additive route-registration coverage in `routes.contract.test.ts`.
- **Do not normalize timestamps** on the v2 path. The wire string goes into the parsed object, into the canonical hash, into Postgres `text`, and back out — byte-for-byte. Use `z.string().datetime({ offset: true }).nullable()` for ISO fields; do not convert to `Date` and back.
- **Do not reuse v1 helpers that hardcode `schemaVersion: "1.0"`** for v2 responses. The v2 module has its own envelope builders.
- **Generated migration only:** never hand-edit `drizzle/0003_create_sr_theses_v2.sql` or `drizzle/meta/*.json`. If the generator output differs from the spec's SQL block, fix the schema in `srThesesV2.ts` and regenerate.
- **Idempotency hash excludes** `id`, `captured_at_unix_ms`, `receivedAtIso`, and `payload_hash` itself. The hash includes `{ schemaVersion, source, symbol, brief, thesis }` exactly — no normalization.
- **Postgres-unavailable behavior:** POST runs auth first, then 503; GET 503s before any work since GET has no auth. This is verified by the no-DATABASE_URL e2e test.
- **Frequent commits:** each task ends with a commit. Do not collapse multiple tasks into one commit.
