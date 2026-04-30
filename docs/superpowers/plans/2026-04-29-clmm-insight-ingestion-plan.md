# CLMM Insight Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Postgres-backed ingest + read API surface for OpenClaw-generated SOL/USDC CLMM insights: `POST /v1/insights/sol-usdc`, `GET /v1/insights/sol-usdc/current`, `GET /v1/insights/sol-usdc/history`.

**Architecture:** New Drizzle table `clmm_insights` in the existing `regime_engine` Postgres schema. Append-only rows keyed by unique `(source, run_id)` for idempotent replay via `INSERT … ON CONFLICT DO NOTHING RETURNING`. Validation at the Zod boundary in a new `src/contract/v1/insights.ts`. Pure store (`InsightsStore` class wrapping a Drizzle `Db`) and three Fastify handlers, all wired through the existing `StoreContext`. Routes always register; handlers short-circuit to `503 POSTGRES_UNAVAILABLE` when the store is null.

**Tech Stack:** TypeScript, Fastify 5, Zod 3, Drizzle ORM 0.36 / drizzle-kit 0.31, Postgres 15+ (via `postgres` driver), Vitest 3, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-04-29-clmm-insight-ingestion-design.md` (commit `a397243` on branch `feat/m25-clmm-insight-ingestion`).

---

## File Structure

### New files

| Path                                                                | Purpose                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/ledger/pg/schema/clmmInsights.ts`                              | Drizzle table definition for `regime_engine.clmm_insights`.                                                |
| `drizzle/0002_create_clmm_insights.sql`                             | Generated migration (output of `pnpm exec drizzle-kit generate --name create_clmm_insights`).              |
| `src/contract/v1/insights.ts`                                       | Zod schema, TS types (request + responses), `parseInsightIngestRequest`, `computeInsightCanonicalAndHash`. |
| `src/contract/v1/__tests__/insights.validation.test.ts`             | Validation matrix (acceptance + each rejection rule).                                                      |
| `src/contract/v1/__tests__/insights.canonicalHash.snapshot.test.ts` | Canonical JSON + sha256 snapshot for the pinned fixture; key-order determinism.                            |
| `src/ledger/insightsStore.ts`                                       | `InsightsStore` class, `InsightConflictError`, `INSIGHT_ERROR_CODES`, `rowToInsightWire`.                  |
| `src/ledger/__tests__/insightsStore.test.ts`                        | PG integration test, gated by `DATABASE_URL`.                                                              |
| `src/http/handlers/insightsIngest.ts`                               | POST `/v1/insights/sol-usdc`.                                                                              |
| `src/http/handlers/insightsCurrent.ts`                              | GET `/v1/insights/sol-usdc/current`.                                                                       |
| `src/http/handlers/insightsHistory.ts`                              | GET `/v1/insights/sol-usdc/history`.                                                                       |
| `src/http/handlers/insightsResponses.ts`                            | Shared 503 helper used by all three handlers.                                                              |
| `src/http/__tests__/insightsIngest.e2e.test.ts`                     | E2E for POST.                                                                                              |
| `src/http/__tests__/insightsCurrent.e2e.test.ts`                    | E2E for GET current.                                                                                       |
| `src/http/__tests__/insightsHistory.e2e.test.ts`                    | E2E for GET history.                                                                                       |
| `src/http/__tests__/insightsOpenapi.test.ts`                        | Lightweight OpenAPI assertion for the three new paths.                                                     |

### Touched files

| Path                            | Change                                                                    |
| ------------------------------- | ------------------------------------------------------------------------- |
| `src/ledger/pg/schema/index.ts` | Re-export `clmmInsights`.                                                 |
| `src/ledger/pg/db.ts`           | Add `verifyClmmInsightsTable`.                                            |
| `src/http/routes.ts`            | Build `InsightsStore`, register the three new routes (always).            |
| `src/http/openapi.ts`           | Add the three new operations.                                             |
| `package.json`                  | Add `src/ledger/__tests__/insightsStore.test.ts` to the `test:pg` script. |
| `.env.example`                  | Uncomment `INSIGHT_INGEST_TOKEN=`.                                        |

### Tests at a glance

- Pure unit (no DB): contract validation, canonical+hash snapshot, OpenAPI presence. Run via `pnpm run test`.
- PG integration: `insightsStore.test.ts` (gated by `DATABASE_URL`). Run via `pnpm run test:pg`.
- HTTP e2e (Fastify `inject`, no DB needed for the null-store tests; PG-backed tests gated by `DATABASE_URL`). The non-PG slices run via `pnpm run test`; the PG-backed e2e slices run via `pnpm run test:pg` after we extend the script.

---

## Task 1: Add Drizzle table for `clmm_insights`

**Files:**

- Create: `src/ledger/pg/schema/clmmInsights.ts`
- Modify: `src/ledger/pg/schema/index.ts`

- [ ] **Step 1: Create the Drizzle table file**

Write `src/ledger/pg/schema/clmmInsights.ts`:

```ts
import { bigint, index, jsonb, serial, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { regimeEngine } from "./candleRevisions.js";

export const clmmInsights = regimeEngine.table(
  "clmm_insights",
  {
    id: serial("id").primaryKey(),
    schemaVersion: varchar("schema_version", { length: 16 }).notNull(),
    pair: varchar("pair", { length: 32 }).notNull(),
    asOfUnixMs: bigint("as_of_unix_ms", { mode: "number" }).notNull(),
    source: varchar("source", { length: 64 }).notNull(),
    runId: varchar("run_id", { length: 256 }).notNull(),
    marketRegime: varchar("market_regime", { length: 64 }).notNull(),
    fundamentalRegime: varchar("fundamental_regime", { length: 64 }).notNull(),
    recommendedAction: varchar("recommended_action", { length: 64 }).notNull(),
    confidence: varchar("confidence", { length: 16 }).notNull(),
    riskLevel: varchar("risk_level", { length: 16 }).notNull(),
    dataQuality: varchar("data_quality", { length: 16 }).notNull(),
    clmmPolicyJson: jsonb("clmm_policy_json").notNull(),
    levelsJson: jsonb("levels_json").notNull(),
    reasoningJson: jsonb("reasoning_json").notNull(),
    sourceRefsJson: jsonb("source_refs_json").notNull(),
    payloadCanonical: text("payload_canonical").notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    expiresAtUnixMs: bigint("expires_at_unix_ms", { mode: "number" }).notNull(),
    receivedAtUnixMs: bigint("received_at_unix_ms", { mode: "number" }).notNull()
  },
  (t) => [
    uniqueIndex("uniq_clmm_insights_source_run").on(t.source, t.runId),
    index("idx_clmm_insights_pair_as_of").on(t.pair, t.asOfUnixMs, t.id),
    index("idx_clmm_insights_pair_received").on(t.pair, t.receivedAtUnixMs, t.id)
  ]
);

export type ClmmInsightRow = typeof clmmInsights.$inferSelect;
export type ClmmInsightInsert = typeof clmmInsights.$inferInsert;
```

- [ ] **Step 2: Re-export from the schema index**

Modify `src/ledger/pg/schema/index.ts` to:

```ts
export { candleRevisions, regimeEngine, PG_SCHEMA_NAME } from "./candleRevisions.js";
export { clmmInsights } from "./clmmInsights.js";
export type { ClmmInsightRow, ClmmInsightInsert } from "./clmmInsights.js";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: clean exit (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/ledger/pg/schema/clmmInsights.ts src/ledger/pg/schema/index.ts
git commit -m "m25: add Drizzle table for clmm_insights"
```

---

## Task 2: Generate the Drizzle migration

**Files:**

- Create: `drizzle/0002_create_clmm_insights.sql` (generated)
- Create: `drizzle/meta/0002_snapshot.json` (generated)
- Modify: `drizzle/meta/_journal.json` (generated)

- [ ] **Step 1: Run drizzle-kit generate**

Run:

```bash
pnpm exec drizzle-kit generate --name create_clmm_insights
```

Expected output (abridged): a new file `drizzle/0002_create_clmm_insights.sql` is created. Drizzle prints something like `[✓] Your SQL migration file ➜ drizzle/0002_create_clmm_insights.sql 🚀`. The journal `drizzle/meta/_journal.json` is updated with a new entry.

- [ ] **Step 2: Inspect the generated SQL**

Read `drizzle/0002_create_clmm_insights.sql` and confirm it contains:

- `CREATE TABLE "regime_engine"."clmm_insights" (...)` with all 20 columns from Task 1.
- `CREATE UNIQUE INDEX "uniq_clmm_insights_source_run" ON "regime_engine"."clmm_insights" USING btree ("source","run_id");`
- `CREATE INDEX "idx_clmm_insights_pair_as_of" ON "regime_engine"."clmm_insights" USING btree ("pair","as_of_unix_ms","id");`
- `CREATE INDEX "idx_clmm_insights_pair_received" ON "regime_engine"."clmm_insights" USING btree ("pair","received_at_unix_ms","id");`

If anything is missing (e.g., a column drift), fix the schema in `clmmInsights.ts`, delete the generated SQL + snapshot, and re-run `pnpm exec drizzle-kit generate --name create_clmm_insights`.

- [ ] **Step 3: Commit**

```bash
git add drizzle/0002_create_clmm_insights.sql drizzle/meta/0002_snapshot.json drizzle/meta/_journal.json
git commit -m "m25: generate migration for clmm_insights table"
```

---

## Task 3: Add startup verification for `clmm_insights`

**Files:**

- Modify: `src/ledger/pg/db.ts`
- Test: `src/__tests__/pgStartup.test.ts` (add a sibling test, see Step 1)

- [ ] **Step 1: Write failing test**

Append to `src/__tests__/pgStartup.test.ts`:

```ts
describe("verifyClmmInsightsTable", () => {
  it("resolves when the table exists in regime_engine schema", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return;
    }

    const { createDb, verifyClmmInsightsTable } = await import("../ledger/pg/db.js");
    const { db, client } = createDb(connectionString);

    await expect(verifyClmmInsightsTable(db)).resolves.toBeUndefined();

    await client.end();
  });

  it("rejects with a clear message when the table is missing", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return;
    }

    const { createDb, verifyClmmInsightsTable } = await import("../ledger/pg/db.js");
    const { db, client } = createDb(connectionString);

    await db.execute(
      // sql is imported at the top of pgStartup.test.ts via the dynamic import below
      (await import("drizzle-orm/sql")).sql`SET search_path TO regime_engine`
    );

    await db.execute((await import("drizzle-orm/sql")).sql`DROP TABLE IF EXISTS clmm_insights`);

    await expect(verifyClmmInsightsTable(db)).rejects.toThrow(/clmm_insights/);

    await client.end();
  });
});
```

Note: the rejection-path test mutates schema and so must run last (or be isolated). Vitest runs `describe` blocks in definition order by default; this is the last block in the file. If the suite uses `--shuffle`, gate this test behind `RUN_DESTRUCTIVE_DB_TESTS=1` instead. For MVP, leave order-dependent.

- [ ] **Step 2: Run test, see it fail**

Run: `pnpm run test:pg`
Expected: the new tests fail with `verifyClmmInsightsTable is not a function` (or import error). The other tests in the file still pass.

- [ ] **Step 3: Implement `verifyClmmInsightsTable`**

Modify `src/ledger/pg/db.ts`. Append after the existing `verifyCandleRevisionsTable`:

```ts
export const verifyClmmInsightsTable = async (db: Db): Promise<void> => {
  const result = await db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'regime_engine' AND tablename = 'clmm_insights'`
  );
  if (result.length === 0) {
    throw new Error(
      "FATAL: clmm_insights table not found in regime_engine schema — run migrations first"
    );
  }
};
```

- [ ] **Step 4: Run test, see it pass**

Run: `pnpm run test:pg`
Expected: all tests in `pgStartup.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add src/ledger/pg/db.ts src/__tests__/pgStartup.test.ts
git commit -m "m25: add startup verification for clmm_insights table"
```

---

## Task 4: Wire startup verification into the app

**Files:**

- Modify: `src/ledger/pg/db.ts` (if a barrel `verifyAllTables` exists) OR `src/ledger/storeContext.ts` OR wherever `verifyCandleRevisionsTable` is currently called.

- [ ] **Step 1: Locate the existing call site for `verifyCandleRevisionsTable`**

Run: `grep -rn "verifyCandleRevisionsTable" src/`
Read the file(s) that call it. The call is most likely in `src/ledger/storeContext.ts` or `src/server.ts`. Whichever file calls `verifyCandleRevisionsTable(db)` will need a sibling call to `verifyClmmInsightsTable(db)`.

- [ ] **Step 2: Add the sibling call**

In the same file, immediately after `await verifyCandleRevisionsTable(db);`, add:

```ts
await verifyClmmInsightsTable(db);
```

Update the import on the corresponding line to include `verifyClmmInsightsTable`. Example (if the file currently imports `{ createDb, verifyCandleRevisionsTable }`):

```ts
import { createDb, verifyCandleRevisionsTable, verifyClmmInsightsTable } from "./pg/db.js";
```

If `verifyCandleRevisionsTable` is **not** currently called anywhere (i.e., startup verification is not yet wired), do not introduce that infrastructure in this PR — skip this task and add a TODO line `// TODO(m25-followup): call verifyClmmInsightsTable on app startup` to `src/server.ts`. Verify by running `grep -rn "verifyCandleRevisionsTable" src/` again.

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: clean.

- [ ] **Step 4: Run the full PG suite**

Run: `pnpm run test:pg`
Expected: all tests pass (including any startup-verification tests touched in Task 3).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "m25: call verifyClmmInsightsTable on app startup"
```

---

## Task 5: Add contract types and Zod schema for insights

**Files:**

- Create: `src/contract/v1/insights.ts`

- [ ] **Step 1: Create the contract module**

Write `src/contract/v1/insights.ts`:

```ts
import { z } from "zod";
import { SCHEMA_VERSION, type SchemaVersion } from "./types.js";
import { unsupportedSchemaVersionError, validationErrorFromZod } from "../../http/errors.js";
import { toCanonicalJson } from "./canonical.js";
import { sha256Hex } from "./hash.js";

const ISO = z.string().datetime({ offset: true });
const finitePositive = z.number().finite().positive();
const snakeCaseLabel = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64);

export const RECOMMENDED_ACTIONS = [
  "hold",
  "watch",
  "tighten_range",
  "widen_range",
  "exit_range",
  "pause_rebalances"
] as const;

export const POSTURES = [
  "aggressive",
  "moderately_aggressive",
  "neutral",
  "defensive",
  "paused"
] as const;

export const RANGE_BIASES = ["tight", "medium", "wide", "passive"] as const;
export const REBALANCE_SENSITIVITIES = ["low", "normal", "high", "paused"] as const;
export const CONFIDENCES = ["low", "medium", "high"] as const;
export const RISK_LEVELS = ["normal", "elevated", "critical"] as const;
export const DATA_QUALITIES = ["complete", "partial", "stale"] as const;

const clmmPolicySchema = z
  .object({
    posture: z.enum(POSTURES),
    rangeBias: z.enum(RANGE_BIASES),
    rebalanceSensitivity: z.enum(REBALANCE_SENSITIVITIES),
    maxCapitalDeploymentPercent: z.number().min(0).max(100)
  })
  .strict();

const levelsSchema = z
  .object({
    support: z.array(finitePositive).max(16),
    resistance: z.array(finitePositive).max(16)
  })
  .strict()
  .refine((v) => v.support.length + v.resistance.length >= 1, {
    message: "at least one support or resistance level is required"
  });

export const insightIngestRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    pair: z.literal("SOL/USDC"),
    asOf: ISO,
    source: z.enum(["openclaw"]),
    runId: z.string().min(1).max(256),
    marketRegime: snakeCaseLabel,
    fundamentalRegime: snakeCaseLabel,
    recommendedAction: z.enum(RECOMMENDED_ACTIONS),
    confidence: z.enum(CONFIDENCES),
    riskLevel: z.enum(RISK_LEVELS),
    dataQuality: z.enum(DATA_QUALITIES),
    clmmPolicy: clmmPolicySchema,
    levels: levelsSchema,
    reasoning: z.array(z.string().min(1).max(1024)).max(16),
    sourceRefs: z.array(z.string().min(1).max(512)).max(16),
    expiresAt: ISO
  })
  .strict()
  .refine((v) => Date.parse(v.expiresAt) > Date.parse(v.asOf), {
    path: ["expiresAt"],
    message: "expiresAt must be greater than asOf"
  });

export type InsightIngestRequest = z.infer<typeof insightIngestRequestSchema>;
export type InsightClmmPolicy = InsightIngestRequest["clmmPolicy"];
export type InsightLevels = InsightIngestRequest["levels"];

export interface InsightFreshness {
  generatedAtIso: string;
  expiresAtIso: string;
  ageSeconds: number;
  stale: boolean;
}

export interface InsightCurrentResponse extends InsightIngestRequest {
  status: "FRESH" | "STALE";
  payloadHash: string;
  receivedAtIso: string;
  freshness: InsightFreshness;
}

export interface InsightHistoryItem extends InsightIngestRequest {
  payloadHash: string;
  receivedAtIso: string;
}

export interface InsightHistoryResponse {
  schemaVersion: SchemaVersion;
  pair: "SOL/USDC";
  limit: number;
  items: InsightHistoryItem[];
}

export interface InsightIngestCreatedResponse {
  schemaVersion: SchemaVersion;
  status: "created";
  runId: string;
  payloadHash: string;
  receivedAtIso: string;
}

export interface InsightIngestAlreadyIngestedResponse {
  schemaVersion: SchemaVersion;
  status: "already_ingested";
  runId: string;
  payloadHash: string;
}

export const parseInsightIngestRequest = (raw: unknown): InsightIngestRequest => {
  const probe = z.object({ schemaVersion: z.string() }).passthrough().safeParse(raw);
  if (probe.success && probe.data.schemaVersion !== SCHEMA_VERSION) {
    throw unsupportedSchemaVersionError(probe.data.schemaVersion);
  }

  const parsed = insightIngestRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw validationErrorFromZod("Invalid /v1/insights/sol-usdc request body", parsed.error.issues);
  }

  return parsed.data;
};

export const computeInsightCanonicalAndHash = (
  req: InsightIngestRequest
): { canonical: string; hash: string } => {
  const canonical = toCanonicalJson(req);
  const hash = sha256Hex(canonical);
  return { canonical, hash };
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/contract/v1/insights.ts
git commit -m "m25: add Zod contract for insight ingest payload"
```

---

## Task 6: Validation matrix tests

**Files:**

- Create: `src/contract/v1/__tests__/insights.validation.test.ts`

- [ ] **Step 1: Write the validation test file**

Create `src/contract/v1/__tests__/insights.validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseInsightIngestRequest } from "../insights.js";
import { ContractValidationError } from "../../../http/errors.js";

const validPayload = () => ({
  schemaVersion: "1.0",
  pair: "SOL/USDC",
  asOf: "2026-04-27T13:00:00Z",
  source: "openclaw",
  runId: "clmm-daily-sol-usdc-insight-2026-04-27",
  marketRegime: "high_volatility_uptrend",
  fundamentalRegime: "constructive",
  recommendedAction: "widen_range",
  confidence: "medium",
  riskLevel: "elevated",
  dataQuality: "complete",
  clmmPolicy: {
    posture: "defensive",
    rangeBias: "wide",
    rebalanceSensitivity: "high",
    maxCapitalDeploymentPercent: 50
  },
  levels: {
    support: [138.5, 132.0],
    resistance: [154.0, 162.0]
  },
  reasoning: ["SOL volatility expanded.", "Range is near upper edge."],
  sourceRefs: ["openclaw:clmm-daily-sol-usdc-insight"],
  expiresAt: "2026-04-28T13:00:00Z"
});

const expectReject = (overrides: Record<string, unknown>): ContractValidationError => {
  const payload = { ...validPayload(), ...overrides };
  try {
    parseInsightIngestRequest(payload);
  } catch (err) {
    if (err instanceof ContractValidationError) return err;
    throw err;
  }
  throw new Error("Expected ContractValidationError, got success");
};

describe("parseInsightIngestRequest — acceptance", () => {
  it("accepts the canonical fixture", () => {
    expect(() => parseInsightIngestRequest(validPayload())).not.toThrow();
  });

  it("accepts an empty support array if resistance has at least one level", () => {
    const payload = { ...validPayload(), levels: { support: [], resistance: [150] } };
    expect(() => parseInsightIngestRequest(payload)).not.toThrow();
  });

  it("accepts an empty resistance array if support has at least one level", () => {
    const payload = { ...validPayload(), levels: { support: [140], resistance: [] } };
    expect(() => parseInsightIngestRequest(payload)).not.toThrow();
  });
});

describe("parseInsightIngestRequest — rejections", () => {
  it("rejects schemaVersion !== 1.0 with UNSUPPORTED_SCHEMA_VERSION", () => {
    const err = expectReject({ schemaVersion: "0.9" });
    expect(err.statusCode).toBe(400);
    expect(err.response.error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });

  it("rejects pair other than SOL/USDC", () => {
    const err = expectReject({ pair: "ETH/USDC" });
    expect(err.statusCode).toBe(400);
    expect(err.response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown source values", () => {
    expect(expectReject({ source: "manual" }).response.error.code).toBe("VALIDATION_ERROR");
    expect(expectReject({ source: "" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty runId", () => {
    expect(expectReject({ runId: "" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects runId over 256 chars", () => {
    expect(expectReject({ runId: "x".repeat(257) }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects asOf that is not ISO 8601", () => {
    expect(expectReject({ asOf: "April 27" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects expiresAt that is not ISO 8601", () => {
    expect(expectReject({ expiresAt: "next week" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects expiresAt <= asOf", () => {
    expect(
      expectReject({
        asOf: "2026-04-28T00:00:00Z",
        expiresAt: "2026-04-27T00:00:00Z"
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects marketRegime that violates snake_case regex", () => {
    expect(expectReject({ marketRegime: "Uppercase" }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
    expect(expectReject({ marketRegime: "1leading_digit" }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
    expect(expectReject({ marketRegime: "has-dash" }).response.error.code).toBe("VALIDATION_ERROR");
    expect(expectReject({ marketRegime: "" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects fundamentalRegime that violates snake_case regex", () => {
    expect(expectReject({ fundamentalRegime: "Constructive" }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects unknown recommendedAction", () => {
    expect(expectReject({ recommendedAction: "yolo" }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects unknown confidence / riskLevel / dataQuality", () => {
    expect(expectReject({ confidence: "extreme" }).response.error.code).toBe("VALIDATION_ERROR");
    expect(expectReject({ riskLevel: "minor" }).response.error.code).toBe("VALIDATION_ERROR");
    expect(expectReject({ dataQuality: "missing" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown clmmPolicy enums", () => {
    expect(
      expectReject({
        clmmPolicy: {
          posture: "ultra",
          rangeBias: "wide",
          rebalanceSensitivity: "high",
          maxCapitalDeploymentPercent: 50
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({
        clmmPolicy: {
          posture: "defensive",
          rangeBias: "ultra",
          rebalanceSensitivity: "high",
          maxCapitalDeploymentPercent: 50
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({
        clmmPolicy: {
          posture: "defensive",
          rangeBias: "wide",
          rebalanceSensitivity: "ultra",
          maxCapitalDeploymentPercent: 50
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects maxCapitalDeploymentPercent outside [0, 100]", () => {
    expect(
      expectReject({
        clmmPolicy: {
          posture: "defensive",
          rangeBias: "wide",
          rebalanceSensitivity: "high",
          maxCapitalDeploymentPercent: -1
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({
        clmmPolicy: {
          posture: "defensive",
          rangeBias: "wide",
          rebalanceSensitivity: "high",
          maxCapitalDeploymentPercent: 101
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects when both support and resistance arrays are empty", () => {
    expect(expectReject({ levels: { support: [], resistance: [] } }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects negative or zero level prices", () => {
    expect(expectReject({ levels: { support: [-1], resistance: [] } }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
    expect(expectReject({ levels: { support: [0], resistance: [] } }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects too many reasoning entries or over-length entries", () => {
    expect(
      expectReject({ reasoning: Array.from({ length: 17 }, () => "x") }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(expectReject({ reasoning: ["x".repeat(1025)] }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
    expect(expectReject({ reasoning: [""] }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects too many sourceRefs entries or over-length entries", () => {
    expect(
      expectReject({ sourceRefs: Array.from({ length: 17 }, () => "x") }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(expectReject({ sourceRefs: ["x".repeat(513)] }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(
      expectReject({ extraField: true } as unknown as Record<string, unknown>).response.error.code
    ).toBe("VALIDATION_ERROR");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm run test src/contract/v1/__tests__/insights.validation.test.ts`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/contract/v1/__tests__/insights.validation.test.ts
git commit -m "m25: add validation matrix tests for insight ingest"
```

---

## Task 7: Canonical + hash snapshot test

**Files:**

- Create: `src/contract/v1/__tests__/insights.canonicalHash.snapshot.test.ts`

- [ ] **Step 1: Write the snapshot test**

Create `src/contract/v1/__tests__/insights.canonicalHash.snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeInsightCanonicalAndHash } from "../insights.js";
import { toCanonicalJson } from "../canonical.js";

const fixtureA = {
  schemaVersion: "1.0",
  pair: "SOL/USDC",
  asOf: "2026-04-27T13:00:00Z",
  source: "openclaw",
  runId: "clmm-daily-sol-usdc-insight-2026-04-27",
  marketRegime: "high_volatility_uptrend",
  fundamentalRegime: "constructive",
  recommendedAction: "widen_range",
  confidence: "medium",
  riskLevel: "elevated",
  dataQuality: "complete",
  clmmPolicy: {
    posture: "defensive",
    rangeBias: "wide",
    rebalanceSensitivity: "high",
    maxCapitalDeploymentPercent: 50
  },
  levels: {
    support: [138.5, 132.0],
    resistance: [154.0, 162.0]
  },
  reasoning: ["SOL volatility expanded.", "Range is near upper edge."],
  sourceRefs: ["openclaw:clmm-daily-sol-usdc-insight"],
  expiresAt: "2026-04-28T13:00:00Z"
} as const;

// Same fields, deliberately different key order on every nested object.
const fixtureB = {
  expiresAt: "2026-04-28T13:00:00Z",
  sourceRefs: ["openclaw:clmm-daily-sol-usdc-insight"],
  reasoning: ["SOL volatility expanded.", "Range is near upper edge."],
  levels: {
    resistance: [154.0, 162.0],
    support: [138.5, 132.0]
  },
  clmmPolicy: {
    rebalanceSensitivity: "high",
    rangeBias: "wide",
    posture: "defensive",
    maxCapitalDeploymentPercent: 50
  },
  dataQuality: "complete",
  riskLevel: "elevated",
  confidence: "medium",
  recommendedAction: "widen_range",
  fundamentalRegime: "constructive",
  marketRegime: "high_volatility_uptrend",
  runId: "clmm-daily-sol-usdc-insight-2026-04-27",
  source: "openclaw",
  asOf: "2026-04-27T13:00:00Z",
  pair: "SOL/USDC",
  schemaVersion: "1.0"
} as const;

describe("insight canonical JSON + payload hash", () => {
  it("canonical JSON snapshot is stable", () => {
    expect(toCanonicalJson(fixtureA)).toMatchSnapshot();
  });

  it("payload hash snapshot is stable", () => {
    expect(computeInsightCanonicalAndHash(fixtureA as never).hash).toMatchSnapshot();
  });

  it("is byte-identical for semantically equal payloads with different key order", () => {
    expect(toCanonicalJson(fixtureA)).toBe(toCanonicalJson(fixtureB));
    expect(computeInsightCanonicalAndHash(fixtureA as never).hash).toBe(
      computeInsightCanonicalAndHash(fixtureB as never).hash
    );
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm run test src/contract/v1/__tests__/insights.canonicalHash.snapshot.test.ts`
Expected: all tests pass; snapshots are written to `src/contract/v1/__tests__/__snapshots__/insights.canonicalHash.snapshot.test.ts.snap`.

- [ ] **Step 3: Commit (including the snapshot file)**

```bash
git add src/contract/v1/__tests__/insights.canonicalHash.snapshot.test.ts
git add src/contract/v1/__tests__/__snapshots__/insights.canonicalHash.snapshot.test.ts.snap
git commit -m "m25: pin canonical JSON and payload hash for insight fixture"
```

---

## Task 8: `InsightsStore` — `insertInsight` (created path)

**Files:**

- Create: `src/ledger/insightsStore.ts`
- Test: `src/ledger/__tests__/insightsStore.test.ts`

- [ ] **Step 1: Write a failing test for the `created` path**

Create `src/ledger/__tests__/insightsStore.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../pg/db.js";
import { clmmInsights } from "../pg/schema/index.js";
import { InsightsStore, InsightConflictError, type InsightInsertInput } from "../insightsStore.js";
import { computeInsightCanonicalAndHash } from "../../contract/v1/insights.js";
import type { InsightIngestRequest } from "../../contract/v1/insights.js";

const validRequest = (overrides: Partial<InsightIngestRequest> = {}): InsightIngestRequest =>
  ({
    schemaVersion: "1.0",
    pair: "SOL/USDC",
    asOf: "2026-04-27T13:00:00Z",
    source: "openclaw",
    runId: "run-001",
    marketRegime: "high_volatility_uptrend",
    fundamentalRegime: "constructive",
    recommendedAction: "widen_range",
    confidence: "medium",
    riskLevel: "elevated",
    dataQuality: "complete",
    clmmPolicy: {
      posture: "defensive",
      rangeBias: "wide",
      rebalanceSensitivity: "high",
      maxCapitalDeploymentPercent: 50
    },
    levels: { support: [138.5], resistance: [154.0] },
    reasoning: ["expanded vol"],
    sourceRefs: ["openclaw:run-001"],
    expiresAt: "2026-04-28T13:00:00Z",
    ...overrides
  }) as InsightIngestRequest;

const makeInput = (
  req: InsightIngestRequest,
  receivedAtUnixMs = 1_700_000_000_000
): InsightInsertInput => {
  const { canonical, hash } = computeInsightCanonicalAndHash(req);
  return { request: req, payloadCanonical: canonical, payloadHash: hash, receivedAtUnixMs };
};

describe.skipIf(!process.env.DATABASE_URL)("InsightsStore (PG)", () => {
  let db: Db;
  let client: { end: () => Promise<void> };
  let store: InsightsStore;

  beforeAll(() => {
    const result = createDb(process.env.DATABASE_URL!);
    db = result.db;
    client = result.client;
    store = new InsightsStore(db);
  });

  afterAll(async () => {
    await client.end();
  });

  afterEach(async () => {
    await db.delete(clmmInsights).execute();
  });

  it("inserts a new row and returns status 'created'", async () => {
    const result = await store.insertInsight(makeInput(validRequest()));

    expect(result.status).toBe("created");
    expect(result.row.runId).toBe("run-001");
    expect(result.row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.row.pair).toBe("SOL/USDC");
    expect(result.row.asOfUnixMs).toBe(Date.parse("2026-04-27T13:00:00Z"));
    expect(result.row.expiresAtUnixMs).toBe(Date.parse("2026-04-28T13:00:00Z"));

    const all = await db.select().from(clmmInsights).execute();
    expect(all).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `pnpm run test:pg`
Expected: failure on import — `Cannot find module '../insightsStore.js'`.

- [ ] **Step 3: Implement the `created` path**

Create `src/ledger/insightsStore.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { clmmInsights } from "./pg/schema/index.js";
import type { ClmmInsightRow } from "./pg/schema/index.js";
import type { Db } from "./pg/db.js";
import type { InsightIngestRequest } from "../contract/v1/insights.js";

export const INSIGHT_ERROR_CODES = {
  RUN_CONFLICT: "INSIGHT_RUN_CONFLICT"
} as const;

type InsightErrorCode = (typeof INSIGHT_ERROR_CODES)[keyof typeof INSIGHT_ERROR_CODES];

export class InsightConflictError extends Error {
  public readonly code: InsightErrorCode = INSIGHT_ERROR_CODES.RUN_CONFLICT;

  public constructor(
    public readonly source: string,
    public readonly runId: string
  ) {
    super(`Insight conflict for source="${source}", runId="${runId}"`);
  }
}

export interface InsightInsertInput {
  request: InsightIngestRequest;
  payloadCanonical: string;
  payloadHash: string;
  receivedAtUnixMs: number;
}

export type InsightInsertResult =
  | { status: "created"; row: ClmmInsightRow }
  | { status: "already_ingested"; row: ClmmInsightRow };

export class InsightsStore {
  public constructor(private readonly db: Db) {}

  public async insertInsight(input: InsightInsertInput): Promise<InsightInsertResult> {
    const inserted = await this.db
      .insert(clmmInsights)
      .values({
        schemaVersion: input.request.schemaVersion,
        pair: input.request.pair,
        asOfUnixMs: Date.parse(input.request.asOf),
        source: input.request.source,
        runId: input.request.runId,
        marketRegime: input.request.marketRegime,
        fundamentalRegime: input.request.fundamentalRegime,
        recommendedAction: input.request.recommendedAction,
        confidence: input.request.confidence,
        riskLevel: input.request.riskLevel,
        dataQuality: input.request.dataQuality,
        clmmPolicyJson: input.request.clmmPolicy,
        levelsJson: input.request.levels,
        reasoningJson: input.request.reasoning,
        sourceRefsJson: input.request.sourceRefs,
        payloadCanonical: input.payloadCanonical,
        payloadHash: input.payloadHash,
        expiresAtUnixMs: Date.parse(input.request.expiresAt),
        receivedAtUnixMs: input.receivedAtUnixMs
      })
      .onConflictDoNothing({ target: [clmmInsights.source, clmmInsights.runId] })
      .returning();

    if (inserted.length > 0) {
      return { status: "created", row: inserted[0] };
    }

    const existingRows = await this.db
      .select()
      .from(clmmInsights)
      .where(
        and(
          eq(clmmInsights.source, input.request.source),
          eq(clmmInsights.runId, input.request.runId)
        )
      )
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      throw new Error(
        "append-only invariant violated: ON CONFLICT did not insert but no existing row found"
      );
    }
    if (existing.payloadHash === input.payloadHash) {
      return { status: "already_ingested", row: existing };
    }
    throw new InsightConflictError(input.request.source, input.request.runId);
  }
}
```

- [ ] **Step 4: Run test, see it pass**

Run: `pnpm run test:pg`
Expected: the new `created` test passes; previously-passing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/ledger/insightsStore.ts src/ledger/__tests__/insightsStore.test.ts
git commit -m "m25: insertInsight created path with InsightsStore class"
```

---

## Task 9: `InsightsStore` — idempotent + conflict + race

**Files:**

- Modify: `src/ledger/__tests__/insightsStore.test.ts`

- [ ] **Step 1: Append failing tests**

Inside the `describe.skipIf(...)` block in `src/ledger/__tests__/insightsStore.test.ts`, after the existing `it("inserts a new row...")` test, add:

```ts
it("returns 'already_ingested' for byte-identical replay without inserting a new row", async () => {
  await store.insertInsight(makeInput(validRequest()));

  const second = await store.insertInsight(makeInput(validRequest(), 1_700_000_001_000));
  expect(second.status).toBe("already_ingested");

  const all = await db.select().from(clmmInsights).execute();
  expect(all).toHaveLength(1);
});

it("throws InsightConflictError when same (source, runId) has different payload", async () => {
  await store.insertInsight(makeInput(validRequest()));

  const different = validRequest({ confidence: "high" });
  await expect(store.insertInsight(makeInput(different))).rejects.toBeInstanceOf(
    InsightConflictError
  );

  const all = await db.select().from(clmmInsights).execute();
  expect(all).toHaveLength(1);
});

it("concurrent identical inserts: exactly one is 'created', one is 'already_ingested'", async () => {
  const inputA = makeInput(validRequest(), 1_700_000_000_000);
  const inputB = makeInput(validRequest(), 1_700_000_000_500);

  const results = await Promise.all([store.insertInsight(inputA), store.insertInsight(inputB)]);

  const statuses = results.map((r) => r.status).sort();
  expect(statuses).toEqual(["already_ingested", "created"]);

  const all = await db.select().from(clmmInsights).execute();
  expect(all).toHaveLength(1);
});

it("concurrent different-payload-same-runId: one created, one InsightConflictError", async () => {
  const inputA = makeInput(validRequest());
  const inputB = makeInput(validRequest({ confidence: "high" }));

  const settled = await Promise.allSettled([
    store.insertInsight(inputA),
    store.insertInsight(inputB)
  ]);

  const fulfilled = settled.filter((r) => r.status === "fulfilled");
  const rejected = settled.filter((r) => r.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);

  const fulfilledValue = (fulfilled[0] as PromiseFulfilledResult<{ status: string }>).value;
  expect(fulfilledValue.status).toBe("created");
  expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsightConflictError);
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm run test:pg`
Expected: all tests in `insightsStore.test.ts` pass. The implementation in Task 8 already handles all four cases.

- [ ] **Step 3: Commit**

```bash
git add src/ledger/__tests__/insightsStore.test.ts
git commit -m "m25: cover idempotent replay, conflict, and concurrent ingest"
```

---

## Task 10: `InsightsStore.getCurrent`

**Files:**

- Modify: `src/ledger/insightsStore.ts`
- Modify: `src/ledger/__tests__/insightsStore.test.ts`

- [ ] **Step 1: Append failing tests**

In `src/ledger/__tests__/insightsStore.test.ts`, append more cases inside the `describe.skipIf(...)` block:

```ts
it("getCurrent returns null when the table is empty for the pair", async () => {
  expect(await store.getCurrent("SOL/USDC")).toBeNull();
});

it("getCurrent returns the newest row by (asOfUnixMs DESC, id DESC)", async () => {
  await store.insertInsight(
    makeInput(
      validRequest({
        runId: "run-A",
        asOf: "2026-04-25T00:00:00Z",
        expiresAt: "2026-04-26T00:00:00Z"
      })
    )
  );
  await store.insertInsight(
    makeInput(
      validRequest({
        runId: "run-C",
        asOf: "2026-04-27T00:00:00Z",
        expiresAt: "2026-04-28T00:00:00Z"
      })
    )
  );
  await store.insertInsight(
    makeInput(
      validRequest({
        runId: "run-B",
        asOf: "2026-04-26T00:00:00Z",
        expiresAt: "2026-04-27T00:00:00Z"
      })
    )
  );

  const latest = await store.getCurrent("SOL/USDC");
  expect(latest).not.toBeNull();
  expect(latest?.runId).toBe("run-C");
});
```

- [ ] **Step 2: Run tests, see them fail**

Run: `pnpm run test:pg`
Expected: failure — `store.getCurrent is not a function`.

- [ ] **Step 3: Implement `getCurrent`**

In `src/ledger/insightsStore.ts`, update the imports to include `desc`:

```ts
import { and, desc, eq } from "drizzle-orm";
```

Inside the `InsightsStore` class, append:

```ts
  public async getCurrent(pair: string): Promise<ClmmInsightRow | null> {
    const rows = await this.db
      .select()
      .from(clmmInsights)
      .where(eq(clmmInsights.pair, pair))
      .orderBy(desc(clmmInsights.asOfUnixMs), desc(clmmInsights.id))
      .limit(1);

    return rows[0] ?? null;
  }
```

- [ ] **Step 4: Run tests, see them pass**

Run: `pnpm run test:pg`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ledger/insightsStore.ts src/ledger/__tests__/insightsStore.test.ts
git commit -m "m25: getCurrent returns newest insight by asOf desc"
```

---

## Task 11: `InsightsStore.getHistory` with id tie-breaker

**Files:**

- Modify: `src/ledger/insightsStore.ts`
- Modify: `src/ledger/__tests__/insightsStore.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
it("getHistory returns rows newest-first by receivedAtUnixMs", async () => {
  await store.insertInsight(makeInput(validRequest({ runId: "old" }), 1_700_000_000_000));
  await store.insertInsight(makeInput(validRequest({ runId: "newer" }), 1_700_000_001_000));
  await store.insertInsight(makeInput(validRequest({ runId: "newest" }), 1_700_000_002_000));

  const rows = await store.getHistory("SOL/USDC", 30);
  expect(rows.map((r) => r.runId)).toEqual(["newest", "newer", "old"]);
});

it("getHistory respects the limit argument", async () => {
  await store.insertInsight(makeInput(validRequest({ runId: "a" }), 1_700_000_000_000));
  await store.insertInsight(makeInput(validRequest({ runId: "b" }), 1_700_000_001_000));
  await store.insertInsight(makeInput(validRequest({ runId: "c" }), 1_700_000_002_000));

  const rows = await store.getHistory("SOL/USDC", 2);
  expect(rows.map((r) => r.runId)).toEqual(["c", "b"]);
});

it("getHistory tie-breaks by id DESC when receivedAtUnixMs is equal", async () => {
  await store.insertInsight(makeInput(validRequest({ runId: "first" }), 1_700_000_000_000));
  await store.insertInsight(makeInput(validRequest({ runId: "second" }), 1_700_000_000_000));

  const rows = await store.getHistory("SOL/USDC", 30);
  expect(rows.map((r) => r.runId)).toEqual(["second", "first"]);
});

it("getHistory returns empty array when table empty", async () => {
  expect(await store.getHistory("SOL/USDC", 30)).toEqual([]);
});
```

- [ ] **Step 2: Run tests, see them fail**

Run: `pnpm run test:pg`
Expected: failure — `store.getHistory is not a function`.

- [ ] **Step 3: Implement `getHistory`**

In `src/ledger/insightsStore.ts`, append to the class:

```ts
  public async getHistory(pair: string, limit: number): Promise<ClmmInsightRow[]> {
    return this.db
      .select()
      .from(clmmInsights)
      .where(eq(clmmInsights.pair, pair))
      .orderBy(desc(clmmInsights.receivedAtUnixMs), desc(clmmInsights.id))
      .limit(limit);
  }
```

- [ ] **Step 4: Run tests, see them pass**

Run: `pnpm run test:pg`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ledger/insightsStore.ts src/ledger/__tests__/insightsStore.test.ts
git commit -m "m25: getHistory orders by receivedAt desc with id tie-breaker"
```

---

## Task 12: `rowToInsightWire` mapping

**Files:**

- Modify: `src/ledger/insightsStore.ts`
- Modify: `src/ledger/__tests__/insightsStore.test.ts`

- [ ] **Step 1: Append failing test**

```ts
it("rowToInsightWire reconstructs the wire shape including JSONB fields", async () => {
  const req = validRequest();
  const inserted = await store.insertInsight(makeInput(req));
  const { rowToInsightWire } = await import("../insightsStore.js");

  const wire = rowToInsightWire(inserted.row);

  expect(wire).toEqual({
    schemaVersion: req.schemaVersion,
    pair: req.pair,
    asOf: req.asOf,
    source: req.source,
    runId: req.runId,
    marketRegime: req.marketRegime,
    fundamentalRegime: req.fundamentalRegime,
    recommendedAction: req.recommendedAction,
    confidence: req.confidence,
    riskLevel: req.riskLevel,
    dataQuality: req.dataQuality,
    clmmPolicy: req.clmmPolicy,
    levels: req.levels,
    reasoning: req.reasoning,
    sourceRefs: req.sourceRefs,
    expiresAt: req.expiresAt
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `pnpm run test:pg`
Expected: failure — `rowToInsightWire` is not exported.

- [ ] **Step 3: Implement `rowToInsightWire`**

In `src/ledger/insightsStore.ts`, add at module scope (outside the class):

```ts
import type { InsightIngestRequest } from "../contract/v1/insights.js";
// (add this import alongside the existing one if not already present)

export const rowToInsightWire = (row: ClmmInsightRow): InsightIngestRequest => {
  return {
    schemaVersion: row.schemaVersion as InsightIngestRequest["schemaVersion"],
    pair: row.pair as InsightIngestRequest["pair"],
    asOf: new Date(row.asOfUnixMs).toISOString(),
    source: row.source as InsightIngestRequest["source"],
    runId: row.runId,
    marketRegime: row.marketRegime,
    fundamentalRegime: row.fundamentalRegime,
    recommendedAction: row.recommendedAction as InsightIngestRequest["recommendedAction"],
    confidence: row.confidence as InsightIngestRequest["confidence"],
    riskLevel: row.riskLevel as InsightIngestRequest["riskLevel"],
    dataQuality: row.dataQuality as InsightIngestRequest["dataQuality"],
    clmmPolicy: row.clmmPolicyJson as InsightIngestRequest["clmmPolicy"],
    levels: row.levelsJson as InsightIngestRequest["levels"],
    reasoning: row.reasoningJson as InsightIngestRequest["reasoning"],
    sourceRefs: row.sourceRefsJson as InsightIngestRequest["sourceRefs"],
    expiresAt: new Date(row.expiresAtUnixMs).toISOString()
  };
};
```

The `as` casts are deliberate: PG returns the values as plain `string` / `unknown`, and we trust the Zod-validated write path to have stored conforming values. JSONB columns come back as `unknown` from Drizzle and need a cast to the typed shape.

- [ ] **Step 4: Run test, see it pass**

Run: `pnpm run test:pg`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ledger/insightsStore.ts src/ledger/__tests__/insightsStore.test.ts
git commit -m "m25: rowToInsightWire reconstructs wire shape from typed columns"
```

---

## Task 13: Wire `insightsStore.test.ts` into `pnpm run test:pg`

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Edit the `test:pg` script**

Open `package.json` and locate the `test:pg` script. Append `src/ledger/__tests__/insightsStore.test.ts` to the list of paths:

Before:

```
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false vitest run src/ledger/pg/__tests__/ src/__tests__/pgStartup.test.ts src/http/__tests__/storeContext.e2e.test.ts src/ledger/__tests__/candleStore.test.ts",
```

After:

```
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false vitest run src/ledger/pg/__tests__/ src/__tests__/pgStartup.test.ts src/http/__tests__/storeContext.e2e.test.ts src/ledger/__tests__/candleStore.test.ts src/ledger/__tests__/insightsStore.test.ts",
```

- [ ] **Step 2: Run the script**

Run: `pnpm run test:pg`
Expected: `insightsStore.test.ts` is now included and all tests pass.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "m25: include insightsStore tests in test:pg script"
```

---

## Task 14: `POST /v1/insights/sol-usdc` handler

**Files:**

- Create: `src/http/handlers/insightsResponses.ts`
- Create: `src/http/handlers/insightsIngest.ts`
- Test: `src/http/__tests__/insightsIngest.e2e.test.ts`

- [ ] **Step 1: Add the shared 503 helper**

Create `src/http/handlers/insightsResponses.ts`:

```ts
import type { FastifyReply } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";

export const respondPostgresUnavailable = (reply: FastifyReply) => {
  return reply.code(503).send({
    schemaVersion: SCHEMA_VERSION,
    error: {
      code: "POSTGRES_UNAVAILABLE",
      message: "Postgres is required for CLMM insights and is not available.",
      details: []
    }
  });
};
```

- [ ] **Step 2: Write the failing e2e test**

Create `src/http/__tests__/insightsIngest.e2e.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  pair: "SOL/USDC",
  asOf: "2026-04-27T13:00:00Z",
  source: "openclaw",
  runId: "run-001",
  marketRegime: "high_volatility_uptrend",
  fundamentalRegime: "constructive",
  recommendedAction: "widen_range",
  confidence: "medium",
  riskLevel: "elevated",
  dataQuality: "complete",
  clmmPolicy: {
    posture: "defensive",
    rangeBias: "wide",
    rebalanceSensitivity: "high",
    maxCapitalDeploymentPercent: 50
  },
  levels: { support: [138.5], resistance: [154.0] },
  reasoning: ["expanded vol"],
  sourceRefs: ["openclaw:run-001"],
  expiresAt: "2026-04-28T13:00:00Z",
  ...overrides
});

describe("POST /v1/insights/sol-usdc", () => {
  let savedDatabaseUrl: string | undefined;

  beforeEach(() => {
    savedDatabaseUrl = process.env.DATABASE_URL;
    process.env.LEDGER_DB_PATH = ":memory:";
  });

  afterEach(() => {
    if (savedDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedDatabaseUrl;
    }
    delete process.env.INSIGHT_INGEST_TOKEN;
  });

  it("returns 503 POSTGRES_UNAVAILABLE when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: validPayload()
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      schemaVersion: "1.0",
      error: expect.objectContaining({ code: "POSTGRES_UNAVAILABLE" })
    });

    await app.close();
  });

  it("returns 500 SERVER_MISCONFIGURATION when INSIGHT_INGEST_TOKEN is unset (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    delete process.env.INSIGHT_INGEST_TOKEN;
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "any" },
      payload: validPayload()
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("SERVER_MISCONFIGURATION");
    await app.close();
  });

  it("returns 401 UNAUTHORIZED on missing token (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      payload: validPayload()
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 401 UNAUTHORIZED on wrong token (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "wrong" },
      payload: validPayload()
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 400 VALIDATION_ERROR on malformed payload (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: { garbage: true }
    });

    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("201 created on first ingest, 200 already_ingested on byte-identical replay (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;

    const app = buildApp();
    const headers = { "X-Insight-Ingest-Token": "test-token" };
    const payload = validPayload();

    const first = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers,
      payload
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({
      schemaVersion: "1.0",
      status: "created",
      runId: "run-001",
      payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      receivedAtIso: expect.any(String)
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers,
      payload
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({
      schemaVersion: "1.0",
      status: "already_ingested",
      runId: "run-001",
      payloadHash: first.json().payloadHash
    });

    await app.close();
  });

  it("409 INSIGHT_RUN_CONFLICT on same (source, runId) with different payload (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;

    const app = buildApp();
    const headers = { "X-Insight-Ingest-Token": "test-token" };

    const first = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers,
      payload: validPayload()
    });
    expect(first.statusCode).toBe(201);

    const conflict = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers,
      payload: validPayload({ confidence: "high" })
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("INSIGHT_RUN_CONFLICT");

    await app.close();
  });

  it("re-ingest with semantically identical payload but different key order returns 200 already_ingested (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;

    const app = buildApp();
    const headers = { "X-Insight-Ingest-Token": "test-token" };

    const first = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers,
      payload: validPayload()
    });
    expect(first.statusCode).toBe(201);
    const expectedHash = first.json().payloadHash;

    // Same fields, different key order on the wire
    const reordered = {
      expiresAt: "2026-04-28T13:00:00Z",
      sourceRefs: ["openclaw:run-001"],
      reasoning: ["expanded vol"],
      levels: { resistance: [154.0], support: [138.5] },
      clmmPolicy: {
        rebalanceSensitivity: "high",
        rangeBias: "wide",
        posture: "defensive",
        maxCapitalDeploymentPercent: 50
      },
      dataQuality: "complete",
      riskLevel: "elevated",
      confidence: "medium",
      recommendedAction: "widen_range",
      fundamentalRegime: "constructive",
      marketRegime: "high_volatility_uptrend",
      runId: "run-001",
      source: "openclaw",
      asOf: "2026-04-27T13:00:00Z",
      pair: "SOL/USDC",
      schemaVersion: "1.0"
    };

    const second = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers,
      payload: reordered
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("already_ingested");
    expect(second.json().payloadHash).toBe(expectedHash);

    await app.close();
  });
});
```

Note on the `if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;` pattern: PG-backed tests are gated to no-op when `DATABASE_URL` is not provided, just like `candleStore.test.ts`. They run for real under `pnpm run test:pg` and are skipped (returning early) under plain `pnpm run test`. The 503 test is the exception — it explicitly clears `DATABASE_URL` so it always runs.

- [ ] **Step 3: Run tests, see them fail**

Run: `pnpm run test src/http/__tests__/insightsIngest.e2e.test.ts`
Expected: route is not registered yet — every test fails with 404.

- [ ] **Step 4: Implement the handler**

Create `src/http/handlers/insightsIngest.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import {
  computeInsightCanonicalAndHash,
  parseInsightIngestRequest
} from "../../contract/v1/insights.js";
import {
  InsightConflictError,
  INSIGHT_ERROR_CODES,
  type InsightsStore
} from "../../ledger/insightsStore.js";
import { AuthError, requireSharedSecret } from "../auth.js";
import { ContractValidationError } from "../errors.js";
import { respondPostgresUnavailable } from "./insightsResponses.js";

export const createInsightsIngestHandler = (store: InsightsStore | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!store) {
      return respondPostgresUnavailable(reply);
    }

    try {
      requireSharedSecret(request.headers, "X-Insight-Ingest-Token", "INSIGHT_INGEST_TOKEN");

      const body = parseInsightIngestRequest(request.body);
      const { canonical, hash } = computeInsightCanonicalAndHash(body);
      const receivedAtUnixMs = Date.now();

      const result = await store.insertInsight({
        request: body,
        payloadCanonical: canonical,
        payloadHash: hash,
        receivedAtUnixMs
      });

      if (result.status === "already_ingested") {
        return reply.code(200).send({
          schemaVersion: SCHEMA_VERSION,
          status: "already_ingested",
          runId: result.row.runId,
          payloadHash: result.row.payloadHash
        });
      }

      return reply.code(201).send({
        schemaVersion: SCHEMA_VERSION,
        status: "created",
        runId: result.row.runId,
        payloadHash: result.row.payloadHash,
        receivedAtIso: new Date(result.row.receivedAtUnixMs).toISOString()
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof InsightConflictError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: INSIGHT_ERROR_CODES.RUN_CONFLICT,
            message: `Different payload already ingested for runId="${error.runId}"`,
            details: []
          }
        });
      }
      throw error;
    }
  };
};
```

- [ ] **Step 5: Wire route registration (interim)**

The handler isn't routable yet. Open `src/http/routes.ts` and add the import + route registration. After the existing imports, add:

```ts
import { InsightsStore } from "../ledger/insightsStore.js";
import { createInsightsIngestHandler } from "./handlers/insightsIngest.js";
```

After the existing `app.get(...)` calls (just before `return storeContext;`), add:

```ts
const insightsStore = storeContext ? new InsightsStore(storeContext.pg) : null;
app.post("/v1/insights/sol-usdc", createInsightsIngestHandler(insightsStore));
```

Tasks 16, 18, and 20 will add the other two routes and centralize wiring.

- [ ] **Step 6: Run tests**

Run: `pnpm run test src/http/__tests__/insightsIngest.e2e.test.ts`
Expected: the 503 test passes; the PG-gated tests skip cleanly when `DATABASE_URL` is not set.

If you have a local PG running, also run:

```bash
pnpm run test:pg
```

Expected: PG-gated tests pass (you may need to add this file to `test:pg` later — see Task 22). For now, run the file directly:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/http/__tests__/insightsIngest.e2e.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/http/handlers/insightsResponses.ts src/http/handlers/insightsIngest.ts src/http/routes.ts src/http/__tests__/insightsIngest.e2e.test.ts
git commit -m "m25: POST /v1/insights/sol-usdc handler with auth, idempotency, conflict"
```

---

## Task 15: `GET /v1/insights/sol-usdc/current` handler

**Files:**

- Create: `src/http/handlers/insightsCurrent.ts`
- Test: `src/http/__tests__/insightsCurrent.e2e.test.ts`
- Modify: `src/http/routes.ts`

- [ ] **Step 1: Write the failing e2e test**

Create `src/http/__tests__/insightsCurrent.e2e.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  pair: "SOL/USDC",
  asOf: "2026-04-27T13:00:00Z",
  source: "openclaw",
  runId: "run-001",
  marketRegime: "high_volatility_uptrend",
  fundamentalRegime: "constructive",
  recommendedAction: "widen_range",
  confidence: "medium",
  riskLevel: "elevated",
  dataQuality: "complete",
  clmmPolicy: {
    posture: "defensive",
    rangeBias: "wide",
    rebalanceSensitivity: "high",
    maxCapitalDeploymentPercent: 50
  },
  levels: { support: [138.5], resistance: [154.0] },
  reasoning: ["expanded vol"],
  sourceRefs: ["openclaw:run-001"],
  expiresAt: "2026-04-28T13:00:00Z",
  ...overrides
});

describe("GET /v1/insights/sol-usdc/current", () => {
  let savedDatabaseUrl: string | undefined;

  beforeEach(() => {
    savedDatabaseUrl = process.env.DATABASE_URL;
    process.env.LEDGER_DB_PATH = ":memory:";
  });

  afterEach(() => {
    if (savedDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedDatabaseUrl;
    }
    delete process.env.INSIGHT_INGEST_TOKEN;
  });

  it("returns 503 POSTGRES_UNAVAILABLE when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/insights/sol-usdc/current" });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("POSTGRES_UNAVAILABLE");
    await app.close();
  });

  it("returns 404 NOT_FOUND when no insight exists for SOL/USDC (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;

    const app = buildApp();
    // Clean any existing rows before asserting empty.
    const { createDb } = await import("../../ledger/pg/db.js");
    const { clmmInsights } = await import("../../ledger/pg/schema/index.js");
    const { db, client } = createDb(process.env.DATABASE_URL!);
    await db.delete(clmmInsights).execute();
    await client.end();

    const res = await app.inject({ method: "GET", url: "/v1/insights/sol-usdc/current" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");

    await app.close();
  });

  it("returns 200 FRESH when expiresAt > now (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";

    const app = buildApp();

    // Clean
    const { createDb } = await import("../../ledger/pg/db.js");
    const { clmmInsights } = await import("../../ledger/pg/schema/index.js");
    const { db, client } = createDb(process.env.DATABASE_URL!);
    await db.delete(clmmInsights).execute();
    await client.end();

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: validPayload({ asOf: past, expiresAt: future })
    });
    expect(ingest.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: "/v1/insights/sol-usdc/current" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("FRESH");
    expect(body.pair).toBe("SOL/USDC");
    expect(body.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.receivedAtIso).toEqual(expect.any(String));
    expect(body.freshness.stale).toBe(false);
    expect(body.freshness.generatedAtIso).toBe(past);
    expect(body.freshness.expiresAtIso).toBe(future);
    expect(typeof body.freshness.ageSeconds).toBe("number");
    expect(body.freshness.ageSeconds).toBeGreaterThanOrEqual(0);

    await app.close();
  });

  it("returns 200 STALE when expiresAt <= now (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";

    const app = buildApp();

    const { createDb } = await import("../../ledger/pg/db.js");
    const { clmmInsights } = await import("../../ledger/pg/schema/index.js");
    const { db, client } = createDb(process.env.DATABASE_URL!);
    await db.delete(clmmInsights).execute();
    await client.end();

    const longPast = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();

    const ingest = await app.inject({
      method: "POST",
      url: "/v1/insights/sol-usdc",
      headers: { "X-Insight-Ingest-Token": "test-token" },
      payload: validPayload({ asOf: longPast, expiresAt: past })
    });
    expect(ingest.statusCode).toBe(201);

    const res = await app.inject({ method: "GET", url: "/v1/insights/sol-usdc/current" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("STALE");
    expect(body.freshness.stale).toBe(true);
    expect(body.freshness.expiresAtIso).toBe(past);

    await app.close();
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `pnpm run test src/http/__tests__/insightsCurrent.e2e.test.ts`
Expected: 503 test passes (no route registered yet → Fastify returns 404, which fails the test). Need to implement handler + route.

Actually under the current state (route not registered), the 503 test will receive a 404 and fail. Implement next.

- [ ] **Step 3: Implement the handler**

Create `src/http/handlers/insightsCurrent.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { rowToInsightWire, type InsightsStore } from "../../ledger/insightsStore.js";
import { respondPostgresUnavailable } from "./insightsResponses.js";

export const createInsightsCurrentHandler = (store: InsightsStore | null) => {
  return async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!store) {
      return respondPostgresUnavailable(reply);
    }

    const row = await store.getCurrent("SOL/USDC");
    if (!row) {
      return reply.code(404).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "NOT_FOUND",
          message: "No insight available for SOL/USDC.",
          details: []
        }
      });
    }

    const now = Date.now();
    const stale = now > row.expiresAtUnixMs;
    const wire = rowToInsightWire(row);

    return reply.code(200).send({
      ...wire,
      status: stale ? "STALE" : "FRESH",
      payloadHash: row.payloadHash,
      receivedAtIso: new Date(row.receivedAtUnixMs).toISOString(),
      freshness: {
        generatedAtIso: wire.asOf,
        expiresAtIso: wire.expiresAt,
        ageSeconds: Math.floor((now - row.asOfUnixMs) / 1000),
        stale
      }
    });
  };
};
```

- [ ] **Step 4: Register the route**

In `src/http/routes.ts`, after the existing `app.post("/v1/insights/sol-usdc", ...)` line added in Task 14, add the import and registration:

```ts
import { createInsightsCurrentHandler } from "./handlers/insightsCurrent.js";
```

```ts
app.get("/v1/insights/sol-usdc/current", createInsightsCurrentHandler(insightsStore));
```

- [ ] **Step 5: Run tests, see them pass**

Run: `pnpm run test src/http/__tests__/insightsCurrent.e2e.test.ts`
Expected: 503 test passes; PG tests skip when `DATABASE_URL` not set. With PG running:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/http/__tests__/insightsCurrent.e2e.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/http/handlers/insightsCurrent.ts src/http/routes.ts src/http/__tests__/insightsCurrent.e2e.test.ts
git commit -m "m25: GET /v1/insights/sol-usdc/current with FRESH/STALE envelope"
```

---

## Task 16: `GET /v1/insights/sol-usdc/history` handler

**Files:**

- Create: `src/http/handlers/insightsHistory.ts`
- Test: `src/http/__tests__/insightsHistory.e2e.test.ts`
- Modify: `src/http/routes.ts`

- [ ] **Step 1: Write the failing e2e test**

Create `src/http/__tests__/insightsHistory.e2e.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

const validPayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  pair: "SOL/USDC",
  asOf: "2026-04-27T13:00:00Z",
  source: "openclaw",
  runId: "run-001",
  marketRegime: "high_volatility_uptrend",
  fundamentalRegime: "constructive",
  recommendedAction: "widen_range",
  confidence: "medium",
  riskLevel: "elevated",
  dataQuality: "complete",
  clmmPolicy: {
    posture: "defensive",
    rangeBias: "wide",
    rebalanceSensitivity: "high",
    maxCapitalDeploymentPercent: 50
  },
  levels: { support: [138.5], resistance: [154.0] },
  reasoning: ["expanded vol"],
  sourceRefs: ["openclaw:run-001"],
  expiresAt: "2026-04-28T13:00:00Z",
  ...overrides
});

const cleanInsights = async () => {
  const { createDb } = await import("../../ledger/pg/db.js");
  const { clmmInsights } = await import("../../ledger/pg/schema/index.js");
  const { db, client } = createDb(process.env.DATABASE_URL!);
  await db.delete(clmmInsights).execute();
  await client.end();
};

describe("GET /v1/insights/sol-usdc/history", () => {
  let savedDatabaseUrl: string | undefined;

  beforeEach(() => {
    savedDatabaseUrl = process.env.DATABASE_URL;
    process.env.LEDGER_DB_PATH = ":memory:";
  });

  afterEach(() => {
    if (savedDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedDatabaseUrl;
    }
    delete process.env.INSIGHT_INGEST_TOKEN;
  });

  it("returns 503 POSTGRES_UNAVAILABLE when DATABASE_URL is unset", async () => {
    delete process.env.DATABASE_URL;

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/insights/sol-usdc/history" });

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("POSTGRES_UNAVAILABLE");
    await app.close();
  });

  it("returns 200 with empty items when table is empty (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;
    await cleanInsights();

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/insights/sol-usdc/history" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      schemaVersion: "1.0",
      pair: "SOL/USDC",
      limit: 30,
      items: []
    });
    await app.close();
  });

  it("returns rows newest-first by receivedAt with full payload + payloadHash + receivedAtIso (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    await cleanInsights();

    const app = buildApp();
    const headers = { "X-Insight-Ingest-Token": "test-token" };

    for (const runId of ["a", "b", "c"]) {
      const ingest = await app.inject({
        method: "POST",
        url: "/v1/insights/sol-usdc",
        headers,
        payload: validPayload({ runId })
      });
      expect(ingest.statusCode).toBe(201);
    }

    const res = await app.inject({ method: "GET", url: "/v1/insights/sol-usdc/history" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pair).toBe("SOL/USDC");
    expect(body.limit).toBe(30);
    expect(body.items.map((i: { runId: string }) => i.runId)).toEqual(["c", "b", "a"]);
    for (const item of body.items) {
      expect(item.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(item.receivedAtIso).toEqual(expect.any(String));
      expect(item.clmmPolicy).toBeDefined();
      expect(item.levels).toBeDefined();
      expect(item.reasoning).toBeDefined();
      expect(item.sourceRefs).toBeDefined();
    }
    await app.close();
  });

  it("respects ?limit=2 (PG present)", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;
    process.env.INSIGHT_INGEST_TOKEN = "test-token";
    await cleanInsights();

    const app = buildApp();
    const headers = { "X-Insight-Ingest-Token": "test-token" };

    for (const runId of ["a", "b", "c"]) {
      await app.inject({
        method: "POST",
        url: "/v1/insights/sol-usdc",
        headers,
        payload: validPayload({ runId })
      });
    }

    const res = await app.inject({ method: "GET", url: "/v1/insights/sol-usdc/history?limit=2" });
    expect(res.statusCode).toBe(200);
    expect(res.json().limit).toBe(2);
    expect(res.json().items).toHaveLength(2);
    await app.close();
  });

  it("rejects limit out of [1,100] with 400", async () => {
    delete process.env.DATABASE_URL;
    const app = buildApp();
    // The 503 short-circuit happens BEFORE limit parsing, so to test limit rejection we need a store.
    // Use the PG-present path:
    if (!savedDatabaseUrl) {
      await app.close();
      return;
    }
    process.env.DATABASE_URL = savedDatabaseUrl;
    const app2 = buildApp();

    for (const limit of ["0", "-1", "foo", "101", ""]) {
      const res = await app2.inject({
        method: "GET",
        url: `/v1/insights/sol-usdc/history?limit=${encodeURIComponent(limit)}`
      });
      expect(res.statusCode).toBe(400);
    }
    await app2.close();
    await app.close();
  });

  it("accepts limit=100", async () => {
    if (!process.env.DATABASE_URL && !savedDatabaseUrl) return;
    process.env.DATABASE_URL = savedDatabaseUrl ?? process.env.DATABASE_URL;
    await cleanInsights();

    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/insights/sol-usdc/history?limit=100" });
    expect(res.statusCode).toBe(200);
    expect(res.json().limit).toBe(100);
    expect(res.json().items).toEqual([]);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `pnpm run test src/http/__tests__/insightsHistory.e2e.test.ts`
Expected: 503 test fails (route not registered → 404). Implement next.

- [ ] **Step 3: Implement the handler**

Create `src/http/handlers/insightsHistory.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { rowToInsightWire, type InsightsStore } from "../../ledger/insightsStore.js";
import { respondPostgresUnavailable } from "./insightsResponses.js";
import { ContractValidationError } from "../errors.js";

const HISTORY_DEFAULT_LIMIT = 30;
const HISTORY_MAX_LIMIT = 100;

const limitOutOfRangeError = (): ContractValidationError =>
  new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: {
      code: "VALIDATION_ERROR",
      message: `limit must be an integer in [1, ${HISTORY_MAX_LIMIT}]`,
      details: [
        {
          path: "$.limit",
          code: "OUT_OF_RANGE",
          message: "limit must be an integer in [1, 100]"
        }
      ]
    }
  });

const parseLimit = (raw: unknown): number => {
  if (raw === undefined) {
    return HISTORY_DEFAULT_LIMIT;
  }
  const candidate = typeof raw === "string" ? raw.trim() : "";
  if (candidate === "") {
    throw limitOutOfRangeError();
  }
  const n = Number(candidate);
  if (!Number.isInteger(n) || n < 1 || n > HISTORY_MAX_LIMIT) {
    throw limitOutOfRangeError();
  }
  return n;
};

export const createInsightsHistoryHandler = (store: InsightsStore | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!store) {
      return respondPostgresUnavailable(reply);
    }

    let limit: number;
    try {
      const rawLimit = (request.query as Record<string, unknown> | undefined)?.limit;
      limit = parseLimit(rawLimit);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      throw error;
    }

    const rows = await store.getHistory("SOL/USDC", limit);
    return reply.code(200).send({
      schemaVersion: SCHEMA_VERSION,
      pair: "SOL/USDC",
      limit,
      items: rows.map((r) => ({
        ...rowToInsightWire(r),
        payloadHash: r.payloadHash,
        receivedAtIso: new Date(r.receivedAtUnixMs).toISOString()
      }))
    });
  };
};
```

- [ ] **Step 4: Register the route**

In `src/http/routes.ts`, add:

```ts
import { createInsightsHistoryHandler } from "./handlers/insightsHistory.js";
```

```ts
app.get("/v1/insights/sol-usdc/history", createInsightsHistoryHandler(insightsStore));
```

- [ ] **Step 5: Run tests, see them pass**

Run: `pnpm run test src/http/__tests__/insightsHistory.e2e.test.ts`
Expected: 503 test passes. With PG running:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec vitest run src/http/__tests__/insightsHistory.e2e.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/http/handlers/insightsHistory.ts src/http/routes.ts src/http/__tests__/insightsHistory.e2e.test.ts
git commit -m "m25: GET /v1/insights/sol-usdc/history with limit validation"
```

---

## Task 17: Add insights e2e tests to `pnpm run test:pg`

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Edit `test:pg` to include the three e2e files**

Update the `test:pg` script to include the three new e2e files. After Task 13 it reads:

```
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false vitest run src/ledger/pg/__tests__/ src/__tests__/pgStartup.test.ts src/http/__tests__/storeContext.e2e.test.ts src/ledger/__tests__/candleStore.test.ts src/ledger/__tests__/insightsStore.test.ts",
```

Replace with:

```
"test:pg": "DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false vitest run src/ledger/pg/__tests__/ src/__tests__/pgStartup.test.ts src/http/__tests__/storeContext.e2e.test.ts src/ledger/__tests__/candleStore.test.ts src/ledger/__tests__/insightsStore.test.ts src/http/__tests__/insightsIngest.e2e.test.ts src/http/__tests__/insightsCurrent.e2e.test.ts src/http/__tests__/insightsHistory.e2e.test.ts",
```

- [ ] **Step 2: Run the script (with a PG instance available)**

Run: `pnpm run test:pg`
Expected: all PG-gated tests run and pass.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "m25: include insights e2e tests in test:pg script"
```

---

## Task 18: Add insights operations to OpenAPI

**Files:**

- Modify: `src/http/openapi.ts`
- Create: `src/http/__tests__/insightsOpenapi.test.ts`

- [ ] **Step 1: Write the failing OpenAPI test**

Create `src/http/__tests__/insightsOpenapi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../openapi.js";

describe("OpenAPI document — insights paths", () => {
  it("includes POST /v1/insights/sol-usdc with 201/200/400/401/409/500/503", () => {
    const doc = buildOpenApiDocument();
    const op = (doc.paths as Record<string, unknown>)["/v1/insights/sol-usdc"] as
      | { post?: { operationId?: string; responses?: Record<string, unknown> } }
      | undefined;

    expect(op?.post?.operationId).toBe("ingestClmmInsight");
    const codes = Object.keys(op?.post?.responses ?? {}).sort();
    expect(codes).toEqual(["200", "201", "400", "401", "409", "500", "503"]);
  });

  it("includes GET /v1/insights/sol-usdc/current with 200/404/503", () => {
    const doc = buildOpenApiDocument();
    const op = (doc.paths as Record<string, unknown>)["/v1/insights/sol-usdc/current"] as
      | { get?: { operationId?: string; responses?: Record<string, unknown> } }
      | undefined;

    expect(op?.get?.operationId).toBe("getCurrentClmmInsight");
    const codes = Object.keys(op?.get?.responses ?? {}).sort();
    expect(codes).toEqual(["200", "404", "503"]);
  });

  it("includes GET /v1/insights/sol-usdc/history with 200/400/503", () => {
    const doc = buildOpenApiDocument();
    const op = (doc.paths as Record<string, unknown>)["/v1/insights/sol-usdc/history"] as
      | { get?: { operationId?: string; responses?: Record<string, unknown> } }
      | undefined;

    expect(op?.get?.operationId).toBe("getClmmInsightHistory");
    const codes = Object.keys(op?.get?.responses ?? {}).sort();
    expect(codes).toEqual(["200", "400", "503"]);
  });
});
```

- [ ] **Step 2: Run test, see it fail**

Run: `pnpm run test src/http/__tests__/insightsOpenapi.test.ts`
Expected: each test fails — the paths are not yet in `buildOpenApiDocument`.

- [ ] **Step 3: Add the three operations to `openapi.ts`**

Open `src/http/openapi.ts`. Inside the `paths` object, after the existing `"/v1/regime/current"` entry, add:

```ts
,
"/v1/insights/sol-usdc": {
  post: {
    operationId: "ingestClmmInsight",
    summary: "Ingest a SOL/USDC CLMM insight from OpenClaw",
    responses: {
      "201": { description: "Insight created" },
      "200": { description: "Idempotent replay of an already-ingested insight" },
      "400": { description: "Validation error (VALIDATION_ERROR or UNSUPPORTED_SCHEMA_VERSION)" },
      "401": { description: "Missing or invalid X-Insight-Ingest-Token" },
      "409": { description: "Different payload already ingested for runId (INSIGHT_RUN_CONFLICT)" },
      "500": { description: "INSIGHT_INGEST_TOKEN env var not set (SERVER_MISCONFIGURATION)" },
      "503": { description: "Postgres is required and unavailable (POSTGRES_UNAVAILABLE)" }
    }
  }
},
"/v1/insights/sol-usdc/current": {
  get: {
    operationId: "getCurrentClmmInsight",
    summary: "Get the most recent SOL/USDC CLMM insight (FRESH or STALE)",
    responses: {
      "200": { description: "Current insight envelope with status FRESH or STALE" },
      "404": { description: "No insight available for SOL/USDC" },
      "503": { description: "Postgres is required and unavailable (POSTGRES_UNAVAILABLE)" }
    }
  }
},
"/v1/insights/sol-usdc/history": {
  get: {
    operationId: "getClmmInsightHistory",
    summary: "Get recent SOL/USDC CLMM insights newest-first",
    parameters: [
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 100, default: 30 }
      }
    ],
    responses: {
      "200": { description: "History payload with items[] newest-first" },
      "400": { description: "Validation error on ?limit (VALIDATION_ERROR)" },
      "503": { description: "Postgres is required and unavailable (POSTGRES_UNAVAILABLE)" }
    }
  }
}
```

Note: the trailing comma after the existing `"/v1/regime/current"` entry must be added (it isn't there now). When you paste the new entries in, make sure the inserted block sits inside the existing `paths: { ... }` object literal with the right comma placement.

- [ ] **Step 4: Run tests, see them pass**

Run: `pnpm run test src/http/__tests__/insightsOpenapi.test.ts`
Expected: all three OpenAPI tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/http/openapi.ts src/http/__tests__/insightsOpenapi.test.ts
git commit -m "m25: add insights operations to OpenAPI document"
```

---

## Task 19: Surface `INSIGHT_INGEST_TOKEN` in `.env.example`

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Read the current line**

Run: `grep -n INSIGHT_INGEST_TOKEN .env.example`
Expected: a single line like `# INSIGHT_INGEST_TOKEN=` (commented).

- [ ] **Step 2: Uncomment the variable**

Edit `.env.example`. Change:

```
# INSIGHT_INGEST_TOKEN=
```

to:

```
# Shared secret required by POST /v1/insights/sol-usdc.
# Set this to a strong random value in production.
INSIGHT_INGEST_TOKEN=
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "m25: surface INSIGHT_INGEST_TOKEN in .env.example with usage note"
```

---

## Task 20: Final gates and PR readiness

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `pnpm run lint`
Expected: clean (zero warnings).

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: clean.

- [ ] **Step 3: Unit + non-PG e2e**

Run: `pnpm run test`
Expected: all tests pass. The PG-gated e2e tests should be skipped (early `return` inside the `it`) since `DATABASE_URL` is unset.

- [ ] **Step 4: PG-backed integration + e2e**

Ensure a Postgres test instance is running and migrations are applied. Typical local setup:

```bash
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm run db:migrate
pnpm run test:pg
```

Expected: all PG-gated tests pass. If `db:migrate` is missing, run:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false pnpm exec drizzle-kit migrate
```

- [ ] **Step 5: Build**

Run: `pnpm run build`
Expected: clean exit; `dist/` contains the new modules.

- [ ] **Step 6: Smoke-test the dev server (optional but recommended)**

In one terminal:

```bash
DATABASE_URL=postgres://test:test@localhost:5432/regime_engine_test PG_SSL=false INSIGHT_INGEST_TOKEN=dev-token pnpm run dev
```

In another:

```bash
curl -sS http://localhost:8787/v1/insights/sol-usdc/current | jq .
```

Expected: `{"schemaVersion":"1.0","error":{"code":"NOT_FOUND",...}}` with HTTP 404 (table empty).

```bash
curl -sS -X POST http://localhost:8787/v1/insights/sol-usdc \
  -H 'X-Insight-Ingest-Token: dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"schemaVersion":"1.0","pair":"SOL/USDC","asOf":"2026-04-27T13:00:00Z","source":"openclaw","runId":"smoke-1","marketRegime":"high_volatility_uptrend","fundamentalRegime":"constructive","recommendedAction":"widen_range","confidence":"medium","riskLevel":"elevated","dataQuality":"complete","clmmPolicy":{"posture":"defensive","rangeBias":"wide","rebalanceSensitivity":"high","maxCapitalDeploymentPercent":50},"levels":{"support":[138.5],"resistance":[154.0]},"reasoning":["expanded vol"],"sourceRefs":["openclaw:smoke-1"],"expiresAt":"2026-04-28T13:00:00Z"}' | jq .
```

Expected: `{"schemaVersion":"1.0","status":"created","runId":"smoke-1","payloadHash":"<sha256>","receivedAtIso":"<now>"}` with HTTP 201.

```bash
curl -sS http://localhost:8787/v1/insights/sol-usdc/current | jq .status
```

Expected: `"FRESH"` (or `"STALE"` if `expiresAt` is in the past).

Stop the dev server with `Ctrl-C`.

- [ ] **Step 7: Push branch and open PR**

```bash
git push -u origin feat/m25-clmm-insight-ingestion
gh pr create --title "m25: SOL/USDC CLMM insight ingestion + serving (#20)" --body "$(cat <<'EOF'
## Summary

Adds POST /v1/insights/sol-usdc, GET /v1/insights/sol-usdc/current, and GET /v1/insights/sol-usdc/history backed by a new clmm_insights Drizzle table in the regime_engine schema. Implements idempotent ingest via INSERT … ON CONFLICT DO NOTHING RETURNING, FRESH/STALE current envelope, and full-payload history with id tie-breaker.

Closes #20.

## Test plan

- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run test`
- [ ] `pnpm run test:pg` (requires local Postgres)
- [ ] `pnpm run build`
- [ ] Smoke test against dev server (curl POST + GET current/history)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

### 1. Spec coverage

| Spec section                                                         | Implementing task                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| §3 Locked-in decisions — table in `regime_engine`, JSONB             | Task 1                                                       |
| §3 Pair-in-path routes                                               | Tasks 14, 15, 16                                             |
| §3 Idempotency via `ON CONFLICT DO NOTHING RETURNING`                | Tasks 8, 9                                                   |
| §3 Hash from validated canonical only                                | Task 5 (`computeInsightCanonicalAndHash`), Task 7 (snapshot) |
| §3 Source allowlist `["openclaw"]`                                   | Task 5, Task 6                                               |
| §3 `marketRegime`/`fundamentalRegime` snake_case                     | Task 5, Task 6                                               |
| §3 Levels cross-field refine                                         | Task 5, Task 6                                               |
| §3 Routes always register; 503 short-circuit                         | Tasks 14–16, helper in Task 14                               |
| §4 New / touched files                                               | All file-creation tasks                                      |
| §5 Drizzle table, indexes, conventions                               | Task 1, Task 2                                               |
| §5.4 Migration + startup verification                                | Tasks 2, 3, 4                                                |
| §6 Wire vs storage; canonical hash                                   | Task 5, Task 7                                               |
| §6.4 Response types                                                  | Task 5                                                       |
| §7.1 InsightsStore                                                   | Tasks 8–12                                                   |
| §7.2 Ingest handler                                                  | Task 14                                                      |
| §7.3 Current handler                                                 | Task 15                                                      |
| §7.4 History handler                                                 | Task 16                                                      |
| §7.5 Route registration                                              | Tasks 14–16                                                  |
| §8.1 Error codes (incl. INSIGHT_RUN_CONFLICT)                        | Tasks 8, 14                                                  |
| §8.2 OpenAPI ops                                                     | Task 18                                                      |
| §8.3 `INSIGHT_INGEST_TOKEN` in `.env.example`                        | Task 19                                                      |
| §8.4 OpenAPI test                                                    | Task 18                                                      |
| §9.1 Validation matrix                                               | Task 6                                                       |
| §9.2 Canonical/hash snapshot                                         | Task 7                                                       |
| §9.3 Store tests (incl. concurrent + tie-breaker + JSONB round-trip) | Tasks 8–12                                                   |
| §9.4 Ingest e2e (incl. canonical determinism through API)            | Task 14                                                      |
| §9.5 Current e2e                                                     | Task 15                                                      |
| §9.6 History e2e (incl. limit cap)                                   | Task 16                                                      |
| §9.7 OpenAPI assertion                                               | Task 18                                                      |
| §9.8 Required gates                                                  | Task 20                                                      |
| §10 Acceptance criteria                                              | Task 20 verification                                         |

### 2. Placeholder scan

No `TBD`/`TODO`/`fill in details`/`add appropriate validation` in the plan. Code blocks contain real Zod schemas, real Drizzle queries, real Fastify handlers, and real assertions.

One conditional path in Task 4: if `verifyCandleRevisionsTable` is not yet wired into app startup, the task instructs leaving a single-line `// TODO(m25-followup)` in `src/server.ts`. This is intentional scope-shedding, not a placeholder for the current task — m25 should not invent startup-verification infrastructure if it doesn't already exist. The follow-up TODO is concrete and grep-able.

### 3. Type/method consistency

- `InsightsStore` exposes `insertInsight`, `getCurrent`, `getHistory` consistently across Tasks 8–11 and used by Tasks 14–16.
- `rowToInsightWire` (module export) is used identically in Tasks 12, 15, 16.
- `InsightConflictError` and `INSIGHT_ERROR_CODES.RUN_CONFLICT` are introduced in Task 8 and used in Tasks 9, 14.
- `respondPostgresUnavailable` is created in Task 14 and re-used in Tasks 15, 16.
- `computeInsightCanonicalAndHash` and `parseInsightIngestRequest` come from `src/contract/v1/insights.ts` (Task 5) and are used by Tasks 7, 14.
- Field naming on the wire (`asOf`, `expiresAt`, `runId`, `payloadHash`, `receivedAtIso`) matches between contract (Task 5), store (Task 12), and handler responses (Tasks 14–16).

No drift detected.
