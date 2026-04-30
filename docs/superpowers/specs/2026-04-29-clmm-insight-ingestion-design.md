# SOL/USDC CLMM Insight Ingestion and Serving — Design Spec

- **Issue:** [#20](https://github.com/opsclawd/regime-engine/issues/20)
- **Date:** 2026-04-29
- **Status:** Approved (pre-plan)

## 1. Problem

The CLMM Autopilot app needs to display daily/periodic SOL/USDC insight produced by the OpenClaw analysis pipeline: market regime narrative, CLMM posture, range-policy bias, risk/confidence, support/resistance levels, and recommendation context. Today Regime Engine has deterministic policy/planning and a market-regime read surface, but no durable API for ingesting and serving OpenClaw-generated CLMM insight artifacts.

This work adds an additive ingest + read surface on the production persistence path (Postgres). It does not change `/v1/plan`, `/v1/regime/current`, `/v1/execution-result`, or `/v1/report/weekly`.

## 2. Non-goals (boundary preservation)

This feature must not:

- Call Solana RPC.
- Call Orca/Jupiter directly.
- Prepare or submit transactions.
- Manage CLMM positions.
- Alter `/v1/plan` behavior.
- Write to the execution-result ledger.
- Treat insight `recommendedAction` as executable truth.

The `recommendedAction` field is interpretation, not authority. Tick math, liquidity sizing, swap construction, slippage checks, and approval flow stay outside this service.

## 3. Locked-in decisions

| Topic                                | Decision                                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Persistence                          | Postgres via Drizzle. Table `clmm_insights` in `regime_engine` schema. JSONB for structured payload fields.                                                                       |
| Routes                               | `POST /v1/insights/sol-usdc`, `GET /v1/insights/sol-usdc/current`, `GET /v1/insights/sol-usdc/history`. Pair-in-path.                                                             |
| Auth (ingest)                        | `X-Insight-Ingest-Token` header, validated via existing `requireSharedSecret`. Env var `INSIGHT_INGEST_TOKEN`.                                                                    |
| `/current` shape                     | 200 with same envelope for fresh and stale; top-level `status: "FRESH"                                                                                                            | "STALE"`plus a`freshness` block. 404 only when no row exists for the pair. |
| `/history` shape                     | `{ schemaVersion, pair, limit, items[] }` with full payload per row, default `limit=30`, max `limit=100`, newest-first by `received_at_unix_ms DESC, id DESC`.                    |
| Idempotency                          | Unique `(source, run_id)`. Insertion via `INSERT ... ON CONFLICT DO NOTHING RETURNING`, then SELECT-and-compare. 201 created / 200 already_ingested / 409 `INSIGHT_RUN_CONFLICT`. |
| Hashing                              | `payloadHash` is `sha256Hex(canonicalJson(validatedRequest))`. `receivedAt`/`id`/server fields are not in the hash.                                                               |
| Source allowlist                     | `["openclaw"]` only for MVP. `manual` deferred.                                                                                                                                   |
| `marketRegime` / `fundamentalRegime` | Bounded lowercase snake*case strings (`/^[a-z]a-z0-9*]\*$/`, max 64). Not enums — these are evolving generated labels.                                                            |
| App-safe enums                       | `recommendedAction`, `confidence`, `riskLevel`, `dataQuality`, and all `clmmPolicy.*` fields are strict enums and safe for app branching.                                         |
| Levels                               | Allow empty `support` or empty `resistance`, but **not both** (`support.length + resistance.length >= 1`).                                                                        |
| Route registration                   | Routes always register. Handlers return 503 `POSTGRES_UNAVAILABLE` when the store is null. 500 `SERVER_MISCONFIGURATION` is reserved for missing `INSIGHT_INGEST_TOKEN`.          |
| PG CHECK constraints                 | None on enum-ish fields. Validation lives at the Zod boundary.                                                                                                                    |

## 4. Architecture & module layout

The feature is a self-contained slice that mirrors the SR-levels feature, but on Postgres. It plugs into existing primitives (`StoreContext`, `requireSharedSecret`, `toCanonicalJson`, `sha256Hex`, contract error envelope).

### 4.1 New files

```
src/ledger/pg/schema/
  clmmInsights.ts                 # Drizzle table on regime_engine schema

drizzle/
  0002_create_clmm_insights.sql   # generated by `pnpm run db:generate`

src/ledger/
  insightsStore.ts                # InsightsStore class: insertInsight,
                                  # getCurrent, getHistory, rowToInsightWire,
                                  # InsightConflictError, INSIGHT_ERROR_CODES.

src/contract/v1/
  insights.ts                     # Zod schema, request/response types,
                                  # parseInsightIngestRequest,
                                  # computeInsightCanonicalAndHash.
  __tests__/
    insights.validation.test.ts
    insights.canonicalHash.snapshot.test.ts

src/http/handlers/
  insightsIngest.ts               # POST /v1/insights/sol-usdc
  insightsCurrent.ts              # GET  /v1/insights/sol-usdc/current
  insightsHistory.ts              # GET  /v1/insights/sol-usdc/history

src/http/handlers/__tests__/      # or src/http/__tests__/, per repo convention
  insightsIngest.e2e.test.ts
  insightsCurrent.e2e.test.ts
  insightsHistory.e2e.test.ts

src/ledger/__tests__/
  insightsStore.test.ts           # PG integration; added to test:pg script
```

### 4.2 Touched files

- `src/ledger/pg/schema/index.ts` — re-export `clmmInsights`.
- `src/ledger/pg/db.ts` — add `verifyClmmInsightsTable(db)` mirroring `verifyCandleRevisionsTable`. Wire it into the same startup verification path.
- `src/http/routes.ts` — register the three new routes. Build `InsightsStore` once if `storeContext` is non-null. Pass `(store: InsightsStore | null)` to each factory.
- `src/http/openapi.ts` — add the three operations and their schemas.
- `src/http/__tests__/` — add a lightweight OpenAPI assertion (see §8.4).
- `.env.example` — uncomment / surface the `INSIGHT_INGEST_TOKEN=` line that currently exists as `# INSIGHT_INGEST_TOKEN=`.
- `package.json` — append `src/ledger/__tests__/insightsStore.test.ts` to the `test:pg` script paths.

### 4.3 Boundary

The new module imports nothing from `src/engine/`, no Solana/Orca/Jupiter SDKs, no wallet/RPC code. It is pure ingest → store → serve. The closest existing pattern is `srLevelsWriter` + `srLevelsIngest`/`srLevelsCurrent`; the structural difference is the persistence backend (PG vs SQLite) and the addition of a history endpoint with bounded limit.

## 5. Database schema

### 5.1 Drizzle table — `src/ledger/pg/schema/clmmInsights.ts`

```ts
import { varchar, bigint, jsonb, text, serial, index, uniqueIndex } from "drizzle-orm/pg-core";
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
```

### 5.2 Conventions

- **Time storage** is `bigint unix_ms` only, mirroring `candle_revisions`. ISO 8601 strings are accepted on the wire and re-emitted on read via `new Date(ms).toISOString()`. One source of truth.
- **Enum-ish columns** are plain `varchar(64)`. Validation lives in Zod. No `pgEnum`. No PG `CHECK` constraints. This keeps the migration story flat as the insight vocabulary evolves.
- **JSONB** for the four structured payload columns. Future filtering/containment queries are available without a re-migration.
- **`payload_canonical` (TEXT) + `payload_hash` (varchar(64))** are the audit pair. Hash is computed once at ingest from the canonical JSON of the validated wire object and never recomputed on read.
- **Append-only.** No `UPDATE` statements anywhere in `insightsStore.ts`. Newer runs become newer rows; idempotent replay returns the existing row unchanged.

### 5.3 Indexes — usage

- `uniq_clmm_insights_source_run` — supports the `(source, runId)` conflict check on every ingest, and is also the unique constraint backing `ON CONFLICT DO NOTHING`.
- `idx_clmm_insights_pair_as_of` — supports `/current`'s `WHERE pair = ? ORDER BY as_of_unix_ms DESC, id DESC LIMIT 1`.
- `idx_clmm_insights_pair_received` — supports `/history`'s `WHERE pair = ? ORDER BY received_at_unix_ms DESC, id DESC LIMIT N`.

### 5.4 Migration & startup verification

- Migration is generated by `pnpm run db:generate` after the schema file lands; produces `drizzle/0002_create_clmm_insights.sql`.
- Migration is applied by `pnpm run db:migrate`, which is already wired as Railway's `preDeployCommand`.
- `verifyClmmInsightsTable(db)` is called from app startup (alongside `verifyCandleRevisionsTable`) so a missing migration fails loudly at boot, not at first request.

## 6. Contract layer

### 6.1 Wire format vs storage format

- The wire format keeps ISO 8601 strings for `asOf` and `expiresAt`.
- The canonical JSON used for hashing is the validated request as the client sent it (with ISO strings), normalized through `toCanonicalJson()`.
- ISO → `unix_ms` conversion happens only when writing the non-canonical columns. The hash is therefore stable across ingest and read — same wire payload always hashes to the same value, regardless of key ordering on the wire.

### 6.2 Zod schema (sketch)

```ts
const ISO = z.string().datetime({ offset: true });
const finitePositive = z.number().finite().positive();
const snakeCaseLabel = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64);

export const insightIngestRequestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    pair: z.literal("SOL/USDC"),
    asOf: ISO,
    source: z.enum(["openclaw"]),
    runId: z.string().min(1).max(256),
    marketRegime: snakeCaseLabel,
    fundamentalRegime: snakeCaseLabel,
    recommendedAction: z.enum([
      "hold",
      "watch",
      "tighten_range",
      "widen_range",
      "exit_range",
      "pause_rebalances"
    ]),
    confidence: z.enum(["low", "medium", "high"]),
    riskLevel: z.enum(["normal", "elevated", "critical"]),
    dataQuality: z.enum(["complete", "partial", "stale"]),
    clmmPolicy: z
      .object({
        posture: z.enum(["aggressive", "moderately_aggressive", "neutral", "defensive", "paused"]),
        rangeBias: z.enum(["tight", "medium", "wide", "passive"]),
        rebalanceSensitivity: z.enum(["low", "normal", "high", "paused"]),
        maxCapitalDeploymentPercent: z.number().min(0).max(100)
      })
      .strict(),
    levels: z
      .object({
        support: z.array(finitePositive).max(16),
        resistance: z.array(finitePositive).max(16)
      })
      .strict()
      .refine((v) => v.support.length + v.resistance.length >= 1, {
        message: "at least one support or resistance level is required"
      }),
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
```

`parseInsightIngestRequest(body)` runs Zod and converts errors to the repo's `ContractValidationError` (same approach as `parseSrLevelBriefRequest`).

### 6.3 Canonical JSON & hash helper

```ts
import { toCanonicalJson } from "./canonical.js";
import { sha256Hex } from "./hash.js";

export const computeInsightCanonicalAndHash = (req: InsightIngestRequest) => {
  const canonical = toCanonicalJson(req);
  const hash = sha256Hex(canonical);
  return { canonical, hash };
};
```

Called once in the ingest handler after Zod parse, then handed to `InsightsStore.insertInsight()`. The store never recomputes the hash.

### 6.4 Response types

```ts
type InsightIngestCreated = {
  schemaVersion: "1.0";
  status: "created";
  runId: string;
  payloadHash: string;
  receivedAtIso: string;
};

type InsightIngestAlreadyIngested = {
  schemaVersion: "1.0";
  status: "already_ingested";
  runId: string;
  payloadHash: string;
};

type InsightCurrentResponse = InsightIngestRequest & {
  status: "FRESH" | "STALE";
  payloadHash: string;
  receivedAtIso: string;
  freshness: {
    generatedAtIso: string; // = asOf
    expiresAtIso: string; // = expiresAt
    ageSeconds: number; // floor((now - asOf) / 1000)
    stale: boolean;
  };
};

type InsightHistoryResponse = {
  schemaVersion: "1.0";
  pair: "SOL/USDC";
  limit: number;
  items: Array<
    InsightIngestRequest & {
      payloadHash: string;
      receivedAtIso: string;
    }
  >;
};
```

`schemaVersion` and `pair` are top-level on every response and inside each history item (self-describing if items are split out by the consumer).

## 7. HTTP handlers and store API

### 7.1 Store — `src/ledger/insightsStore.ts`

`InsightsStore` is a class wrapping a Drizzle `Db`, matching `CandleStore`'s convention.

```ts
export const INSIGHT_ERROR_CODES = {
  RUN_CONFLICT: "INSIGHT_RUN_CONFLICT"
} as const;

export class InsightConflictError extends Error {
  public readonly code = INSIGHT_ERROR_CODES.RUN_CONFLICT;
  public constructor(
    public source: string,
    public runId: string
  ) {
    super(`Insight conflict for source="${source}", runId="${runId}"`);
  }
}

export interface InsightInsertInput {
  request: InsightIngestRequest; // validated wire object
  payloadCanonical: string;
  payloadHash: string;
  receivedAtUnixMs: number;
}

export type InsightInsertResult =
  | { status: "created"; row: InsightRow }
  | { status: "already_ingested"; row: InsightRow };

export class InsightsStore {
  public constructor(private db: Db) {}

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

    const [existing] = await this.db
      .select()
      .from(clmmInsights)
      .where(
        and(
          eq(clmmInsights.source, input.request.source),
          eq(clmmInsights.runId, input.request.runId)
        )
      )
      .limit(1);

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

  public async getCurrent(pair: string): Promise<InsightRow | null> {
    /* ... */
  }
  public async getHistory(pair: string, limit: number): Promise<InsightRow[]> {
    /* ... */
  }
}
```

`rowToInsightWire(row)` is a pure module function that maps a row back to the wire shape (ISO strings, JSONB → structured fields). Used by both `/current` and `/history`. It does **not** parse `payload_canonical`; it reads typed columns. The response is reconstructed from the typed columns; `payloadHash` is a server-attested attribute of the row, not re-derived on read.

**Concurrent ingest race.** Two simultaneous POSTs of the same `(source, runId)` are both serialized at the unique index. Exactly one INSERT succeeds; the other is `DO NOTHING`. Both then re-evaluate via the SELECT branch and return the appropriate result (one `created`, one `already_ingested` or `INSIGHT_RUN_CONFLICT`). No transaction wrapper is needed because the INSERT is atomic and the table is append-only.

### 7.2 Handler — `insightsIngest.ts`

```ts
export const createInsightsIngestHandler = (store: InsightsStore | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!store) return respondPostgresUnavailable(reply);
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
      if (error instanceof AuthError) return reply.code(error.statusCode).send(error.response);
      if (error instanceof ContractValidationError)
        return reply.code(error.statusCode).send(error.response);
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

### 7.3 Handler — `insightsCurrent.ts`

```ts
export const createInsightsCurrentHandler =
  (store: InsightsStore | null) => async (_req, reply) => {
    if (!store) return respondPostgresUnavailable(reply);
    const row = await store.getCurrent("SOL/USDC");
    if (!row) {
      return reply.code(404).send({
        schemaVersion: SCHEMA_VERSION,
        error: { code: "NOT_FOUND", message: "No insight available for SOL/USDC.", details: [] }
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
```

### 7.4 Handler — `insightsHistory.ts`

```ts
const HISTORY_DEFAULT_LIMIT = 30;
const HISTORY_MAX_LIMIT = 100;

export const createInsightsHistoryHandler =
  (store: InsightsStore | null) => async (request, reply) => {
    if (!store) return respondPostgresUnavailable(reply);
    const raw = (request.query as Record<string, unknown>).limit;
    const parsed = parseHistoryLimit(raw);
    if (parsed instanceof ContractValidationError) {
      return reply.code(parsed.statusCode).send(parsed.response);
    }
    const rows = await store.getHistory("SOL/USDC", parsed);
    return reply.code(200).send({
      schemaVersion: SCHEMA_VERSION,
      pair: "SOL/USDC",
      limit: parsed,
      items: rows.map((r) => ({
        ...rowToInsightWire(r),
        payloadHash: r.payloadHash,
        receivedAtIso: new Date(r.receivedAtUnixMs).toISOString()
      }))
    });
  };

const parseHistoryLimit = (raw: unknown): number | ContractValidationError => {
  if (raw === undefined) return HISTORY_DEFAULT_LIMIT;
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > HISTORY_MAX_LIMIT) {
    return validationError(`limit must be an integer in [1, ${HISTORY_MAX_LIMIT}]`);
  }
  return n;
};
```

### 7.5 Route registration — `src/http/routes.ts`

```ts
const insightsStore = storeContext ? new InsightsStore(storeContext.pg) : null;

app.post("/v1/insights/sol-usdc", createInsightsIngestHandler(insightsStore));
app.get("/v1/insights/sol-usdc/current", createInsightsCurrentHandler(insightsStore));
app.get("/v1/insights/sol-usdc/history", createInsightsHistoryHandler(insightsStore));
```

`respondPostgresUnavailable(reply)` is a small shared helper in `insightsIngest.ts` (or a peer module) that emits `503 POSTGRES_UNAVAILABLE` with the standard error envelope. Routes always register. Handlers short-circuit to that response when `store` is `null` — whether `DATABASE_URL` is unset or whether store construction failed.

## 8. Errors, OpenAPI, configuration

### 8.1 Error codes

The standard envelope is unchanged: `{ schemaVersion, error: { code, message, details: [] } }`.

| Code                      | HTTP | When                                                                                              |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `UNAUTHORIZED`            | 401  | Missing/bad `X-Insight-Ingest-Token`.                                                             |
| `SERVER_MISCONFIGURATION` | 500  | `INSIGHT_INGEST_TOKEN` env not set on POST.                                                       |
| `POSTGRES_UNAVAILABLE`    | 503  | The insights `InsightsStore` is null (whether `DATABASE_URL` unset or store construction failed). |
| `VALIDATION_ERROR`        | 400  | Zod parse failure on POST body or `?limit` query.                                                 |
| `INSIGHT_RUN_CONFLICT`    | 409  | Same `(source, runId)` posted with a different canonical payload.                                 |
| `NOT_FOUND`               | 404  | `/current` with no row for the pair.                                                              |

`INSIGHT_RUN_CONFLICT` is the only new code. It is surfaced as `INSIGHT_ERROR_CODES.RUN_CONFLICT` from `src/ledger/insightsStore.ts` (mirrors `LEDGER_ERROR_CODES` from `srLevelsWriter`).

### 8.2 OpenAPI — `src/http/openapi.ts`

| Operation ID            | Method/path                         | Request                | 2xx response                                                    | Error responses         |
| ----------------------- | ----------------------------------- | ---------------------- | --------------------------------------------------------------- | ----------------------- |
| `ingestClmmInsight`     | POST `/v1/insights/sol-usdc`        | `InsightIngestRequest` | 201 `InsightIngestCreated` / 200 `InsightIngestAlreadyIngested` | 400, 401, 409, 500, 503 |
| `getCurrentClmmInsight` | GET `/v1/insights/sol-usdc/current` | —                      | 200 `InsightCurrentResponse`                                    | 404, 503                |
| `getClmmInsightHistory` | GET `/v1/insights/sol-usdc/history` | `?limit`               | 200 `InsightHistoryResponse`                                    | 400, 503                |

Schemas added under `components.schemas`:

- `InsightIngestRequest`
- `InsightClmmPolicy`, `InsightLevels`, `InsightFreshness` (sub-schemas)
- `InsightIngestCreated`, `InsightIngestAlreadyIngested`
- `InsightCurrentResponse`, `InsightHistoryResponse`

### 8.3 Configuration

- **`INSIGHT_INGEST_TOKEN`** — required for POST. Currently present as the commented line `# INSIGHT_INGEST_TOKEN=` in `.env.example`. Implementation will surface (uncomment) the line in `.env.example`. `OPENCLAW_INGEST_TOKEN` (used by SR-levels) is _not_ reused — separate authorities, independent rotation.
- **`DATABASE_URL`** — required. No new addition; already used by `StoreContext`.
- **`PG_SSL`, `PG_MAX_CONNECTIONS`** — unchanged. Already handled by `createDb`.

### 8.4 OpenAPI test

A snapshot test of `/v1/openapi.json` does not currently exist in the repo (`src/http/__tests__/routes.contract.test.ts` is a route-shape contract test, not OpenAPI). Therefore, this work adds a lightweight assertion in `src/http/__tests__/openapi.test.ts` (or alongside `routes.contract.test.ts`) that:

- `buildOpenApiDocument().paths` contains exactly:
  - `/v1/insights/sol-usdc`
  - `/v1/insights/sol-usdc/current`
  - `/v1/insights/sol-usdc/history`
- For each, the expected operation ID and 2xx response schemas are present.

This is intentionally lightweight — not a full snapshot of the entire document — to avoid coupling unrelated route changes to this work.

## 9. Test plan

The tests split into contract / store / e2e, mirroring existing repo conventions. Each test file is colocated with the code it covers (`__tests__` folders). The store-layer test goes into the `test:pg` script's path list.

### 9.1 Contract layer — `src/contract/v1/__tests__/insights.validation.test.ts`

A canonical fixture passes. One rejection per Zod rule:

- `schemaVersion !== "1.0"`.
- `pair !== "SOL/USDC"`.
- `source` not in `["openclaw"]`.
- `runId` empty / over 256 chars.
- `asOf` not ISO 8601.
- `expiresAt` not ISO 8601.
- `expiresAt <= asOf` (cross-field refine).
- `marketRegime` regex violation (uppercase, leading digit, special chars).
- `fundamentalRegime` regex violation.
- `recommendedAction` not in enum.
- `confidence`, `riskLevel`, `dataQuality` not in enum.
- Each `clmmPolicy.*` enum violation.
- `maxCapitalDeploymentPercent` outside `[0, 100]`.
- `support.length === 0 && resistance.length === 0` (cross-field refine).
- A negative or zero level price.
- `reasoning` over 16 entries; an entry over 1024 chars; an empty-string entry.
- `sourceRefs` over 16 entries; an entry over 512 chars.
- Any unknown top-level field (Zod `.strict()` rejection).

### 9.2 Contract layer — `insights.canonicalHash.snapshot.test.ts`

Snapshots the canonical JSON string and `sha256Hex(canonical)` for one pinned fixture. Catches accidental key-order changes, schema drift, or hash-function changes — any of which would silently break replay idempotency.

### 9.3 Store layer — `src/ledger/__tests__/insightsStore.test.ts` (PG, runs via `test:pg`)

- Insert new row → returns `{ status: "created", row }`.
- Re-insert byte-identical canonical/hash → returns `{ status: "already_ingested" }`, row count unchanged.
- Re-insert same `(source, runId)` with different `payloadHash` → throws `InsightConflictError`.
- Concurrent `Promise.all` of two identical inserts → both resolve, exactly one is `created`, one is `already_ingested`.
- Concurrent `Promise.all` of one new + one different-payload-same-runId → exactly one is `created` and one throws `InsightConflictError`.
- `getCurrent("SOL/USDC")` returns the newest row by `(as_of_unix_ms DESC, id DESC)` — write three with shuffled `asOf`, assert.
- `getCurrent` returns `null` for an empty table.
- `getHistory("SOL/USDC", 5)` returns rows ordered by `(received_at_unix_ms DESC, id DESC)`.
- **Tie-breaker test:** insert two rows with identical `received_at_unix_ms` and assert they are ordered by `id DESC`.
- `getHistory` returns up to `limit` rows; caller is responsible for the upper bound.
- JSONB columns round-trip — `clmm_policy_json`, `levels_json`, `reasoning_json`, `source_refs_json` come back deeply equal to what was inserted.

### 9.4 Handler — `insightsIngest.e2e.test.ts`

- 503 `POSTGRES_UNAVAILABLE` when route is registered with a `null` store.
- 500 `SERVER_MISCONFIGURATION` when `INSIGHT_INGEST_TOKEN` env is unset.
- 401 `UNAUTHORIZED` on missing `X-Insight-Ingest-Token`.
- 401 on a header value that doesn't match the env.
- 400 `VALIDATION_ERROR` on a representative malformed payload (matrix is covered by 9.1).
- 201 `created` with `runId`, `payloadHash`, `receivedAtIso` on first ingest.
- 200 `already_ingested` on byte-identical replay.
- 409 `INSIGHT_RUN_CONFLICT` on same `(source, runId)` with different payload.
- **Canonical determinism through the API:** ingest a payload, then re-ingest a semantically identical payload with different key ordering on the wire → returns 200 `already_ingested` with the same `payloadHash`. Proves canonical determinism is enforced at the API boundary, not just in the helper snapshot.

### 9.5 Handler — `insightsCurrent.e2e.test.ts`

- 503 `POSTGRES_UNAVAILABLE` with null store.
- 404 `NOT_FOUND` when the table has no row for `SOL/USDC`.
- 200 `status: "FRESH"` when the newest row's `expiresAtUnixMs > now`.
- 200 `status: "STALE"` when the newest row's `expiresAtUnixMs <= now`.
- `freshness.ageSeconds` is `floor((now - asOf) / 1000)`.
- `freshness.generatedAtIso === asOf` and `freshness.expiresAtIso === expiresAt`.
- `payloadHash` and `receivedAtIso` are present.

### 9.6 Handler — `insightsHistory.e2e.test.ts`

- 503 `POSTGRES_UNAVAILABLE` with null store.
- 200 with `items: []` when table empty.
- 200 newest-first by `receivedAt` with three pre-seeded rows.
- Default `limit=30` when query param absent.
- `limit=100` accepted; `limit=101` → 400.
- `limit=0`, `limit=-1`, `limit=foo`, `limit=` (empty) → 400.
- Each item has the full insight shape plus `payloadHash` and `receivedAtIso`.

### 9.7 OpenAPI

Lightweight assertion (see §8.4) confirming the three paths and their operation IDs / 2xx schemas are present in `buildOpenApiDocument()`.

### 9.8 Required gates before PR (from AGENTS.md)

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:pg
pnpm run build
```

`package.json`'s `test:pg` script must be updated to include the new `src/ledger/__tests__/insightsStore.test.ts`.

## 10. Acceptance criteria

- OpenClaw pipeline can `POST /v1/insights/sol-usdc` an insight payload with `X-Insight-Ingest-Token` and have it persisted to `regime_engine.clmm_insights`.
- The same payload re-posted with the same `(source, runId)` returns 200 `already_ingested` with the same `payloadHash`. A different payload with the same `(source, runId)` returns 409 `INSIGHT_RUN_CONFLICT`.
- `GET /v1/insights/sol-usdc/current` returns the newest non-deleted row for SOL/USDC. Fresh and stale rows both return 200 with the same envelope, distinguished by `status: "FRESH" | "STALE"` and `freshness.stale`.
- `GET /v1/insights/sol-usdc/history?limit=N` returns the last N rows (default 30, max 100) newest-first by ingest time, with the full insight payload per item.
- All three routes return 503 `POSTGRES_UNAVAILABLE` when `DATABASE_URL` is missing or the PG store is unavailable. Routes are registered regardless.
- Canonical hash is deterministic across key ordering on the wire — replay-by-runId works regardless of the client's serialization.
- No execution, wallet, RPC, Orca, or Jupiter logic is introduced.
- Existing `/v1/plan`, `/v1/regime/current`, `/v1/execution-result`, `/v1/report/weekly` behavior is unchanged.
- All tests in §9 pass; all gates in §9.8 pass.

## 11. Out of scope (explicit deferrals)

- `manual` source. Until a real manual-entry workflow exists, accepting it would create an untested authority path for generated market guidance.
- Multi-pair support. MVP allowlists `SOL/USDC` only; adding `/v1/insights/{pairSlug}/...` later is a mechanical change and the table is already keyed on `pair`.
- Fundamental data ingestion endpoints. This spec only covers the structured insight artifact; fundamental sources are read by the OpenClaw pipeline upstream.
- Server-side filtering of history (by date range, regime, etc.). Add when a consumer asks for it.
- Pagination cursors. `limit` alone is sufficient for the MVP timeline view.
