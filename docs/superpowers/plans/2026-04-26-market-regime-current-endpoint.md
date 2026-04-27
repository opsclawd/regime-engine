# Market-Data-Backed Current Regime Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /v1/candles` (append-only revision ingestion) and `GET /v1/regime/current` (stateless market-only read) to `regime-engine` so the CLMM Regime page can render market intelligence without abusing `POST /v1/plan`.

**Architecture:** Two new endpoints sit alongside existing surfaces. `POST /v1/candles` writes per-slot revisions to a new `candle_revisions` table under one `BEGIN IMMEDIATE` transaction per batch, with database-enforced byte-equal idempotency. `GET /v1/regime/current` is config-less from the caller's perspective: it reads latest revisions per logical slot for an explicit `(symbol, source, network, poolAddress, timeframe)` feed, runs the existing indicator + regime classifier under degenerate stateless settings (`confirmBars: 1, minHoldBars: 0, state: undefined`), evaluates a four-band CLMM suitability decision tree, and returns the result. The market-only classifier is a thin wrapper over `classifyRegime` that rewrites user-facing messages and filters policy-only reason codes. No `RegimeState` is ever persisted; no plan-ledger writes happen on the GET path.

**Tech Stack:** TypeScript, Fastify 5, Zod 3, `node:sqlite` (native), Vitest 3, ESLint, Prettier.

**Spec:** `docs/superpowers/specs/2026-04-26-market-regime-current-endpoint-design.md`
**Issue:** [#17](https://github.com/opsclawd/regime-engine/issues/17)

---

## File Structure

### New files

```
src/contract/v1/
  __tests__/
    candles.validation.test.ts            new
    regimeCurrent.validation.test.ts      new

src/engine/marketRegime/
  config.ts                                new
  closedCandleCutoff.ts                    new
  freshness.ts                             new
  classifyMarketRegime.ts                  new
  evaluateMarketClmmSuitability.ts         new
  buildRegimeCurrent.ts                    new
  __tests__/
    closedCandleCutoff.test.ts             new
    freshness.test.ts                      new
    classifyMarketRegime.test.ts           new
    evaluateMarketClmmSuitability.test.ts  new
    buildRegimeCurrent.test.ts             new
    buildRegimeCurrent.snapshot.test.ts    new

src/ledger/
  candlesWriter.ts                         new
  __tests__/
    candlesWriter.test.ts                  new

src/http/handlers/
  candlesIngest.ts                         new
  regimeCurrent.ts                         new

src/http/__tests__/
  candles.e2e.test.ts                      new
  regimeCurrent.e2e.test.ts                new
```

### Modified files

```
src/contract/v1/types.ts          add CandleIngestRequest/Response, RegimeCurrentResponse, MarketReason types
src/contract/v1/validation.ts     add parseCandleIngestRequest, parseRegimeCurrentQuery
src/http/errors.ts                add new ERROR_CODES entries + helper constructors
src/ledger/schema.sql             append candle_revisions table + 3 indexes
src/ledger/store.ts               extend getLedgerCounts with candleRevisions count
src/http/routes.ts                register POST /v1/candles, GET /v1/regime/current
src/http/openapi.ts               document both new paths + schemas + response types
src/http/__tests__/routes.contract.test.ts   assert new paths appear in OpenAPI
README.md                         document new endpoints + CANDLES_INGEST_TOKEN env var
docs/runbooks/2026-04-railway-deploy.md      add CANDLES_INGEST_TOKEN to env checklist (if exists)
```

### Spec-vs-code naming drift

- The spec writes `SCHEMA_VERSION_UNSUPPORTED`. The existing `src/http/errors.ts:5-8` constant is `UNSUPPORTED_SCHEMA_VERSION`. **The plan uses the code's name**; do not rename the existing constant. Tests assert against `error.code === "UNSUPPORTED_SCHEMA_VERSION"`.

---

## Phase 1 — Contract types and validation

### Task 1.1: Extend ERROR_CODES with new top-level codes

**Files:**
- Modify: `src/http/errors.ts`

- [ ] **Step 1: Add new constants to `ERROR_CODES`**

Replace the existing `ERROR_CODES` object in `src/http/errors.ts:4-7`:

```ts
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  BATCH_TOO_LARGE: "BATCH_TOO_LARGE",
  MALFORMED_CANDLE: "MALFORMED_CANDLE",
  DUPLICATE_CANDLE_IN_BATCH: "DUPLICATE_CANDLE_IN_BATCH",
  CANDLES_NOT_FOUND: "CANDLES_NOT_FOUND"
} as const;
```

- [ ] **Step 2: Add helper constructors below `validationErrorFromZod`**

Append to `src/http/errors.ts`:

```ts
export const batchTooLargeError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.BATCH_TOO_LARGE, message, details }
  });
};

export const malformedCandleError = (
  message: string,
  details: ErrorDetail[]
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.MALFORMED_CANDLE, message, details }
  });
};

export const duplicateCandleInBatchError = (
  message: string,
  details: ErrorDetail[]
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.DUPLICATE_CANDLE_IN_BATCH, message, details }
  });
};

export const candlesNotFoundError = (message: string): ContractValidationError => {
  return new ContractValidationError(404, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.CANDLES_NOT_FOUND, message, details: [] }
  });
};
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no new files reference these yet).

- [ ] **Step 4: Commit**

```bash
git add src/http/errors.ts
git commit -m "feat(errors): add candle ingest + regime-current error codes

Adds BATCH_TOO_LARGE, MALFORMED_CANDLE, DUPLICATE_CANDLE_IN_BATCH,
CANDLES_NOT_FOUND constants and helper constructors. Used by the new
POST /v1/candles and GET /v1/regime/current handlers."
```

### Task 1.2: Add candle and regime-current types

**Files:**
- Modify: `src/contract/v1/types.ts`

- [ ] **Step 1: Append type definitions to the end of the file**

Append to `src/contract/v1/types.ts`:

```ts
export type SupportedTimeframe = "1h";

export type ClmmSuitabilityStatus = "ALLOWED" | "CAUTION" | "BLOCKED" | "UNKNOWN";

export interface CandleIngestRequest {
  schemaVersion: SchemaVersion;
  source: string;
  network: string;
  poolAddress: string;
  symbol: string;
  timeframe: SupportedTimeframe;
  sourceRecordedAtIso: string;
  candles: Array<{
    unixMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

export interface CandleIngestRejection {
  unixMs: number;
  reason: "STALE_REVISION";
  existingSourceRecordedAtIso: string;
}

export interface CandleIngestResponse {
  schemaVersion: SchemaVersion;
  insertedCount: number;
  revisedCount: number;
  idempotentCount: number;
  rejectedCount: number;
  rejections: CandleIngestRejection[];
}

export interface MarketReason {
  code: string;
  severity: ReasonSeverity;
  message: string;
}

export interface ClmmSuitabilityReason {
  code: string;
  severity: ReasonSeverity;
  message: string;
}

export interface RegimeCurrentTelemetry {
  realizedVolShort: number;
  realizedVolLong: number;
  volRatio: number;
  trendStrength: number;
  compression: number;
}

export interface RegimeCurrentFreshness {
  generatedAtIso: string;
  lastCandleUnixMs: number;
  lastCandleIso: string;
  ageSeconds: number;
  softStale: boolean;
  hardStale: boolean;
  softStaleSeconds: number;
  hardStaleSeconds: number;
}

export interface RegimeCurrentMetadata {
  engineVersion: string;
  configVersion: string;
  candleCount: number;
}

export interface RegimeCurrentResponse {
  schemaVersion: SchemaVersion;
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: SupportedTimeframe;
  regime: Regime;
  telemetry: RegimeCurrentTelemetry;
  clmmSuitability: {
    status: ClmmSuitabilityStatus;
    reasons: ClmmSuitabilityReason[];
  };
  marketReasons: MarketReason[];
  freshness: RegimeCurrentFreshness;
  metadata: RegimeCurrentMetadata;
}

export interface RegimeCurrentQuery {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: SupportedTimeframe;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/contract/v1/types.ts
git commit -m "feat(types): add candle ingest and regime-current contract types"
```

### Task 1.3: Validate `POST /v1/candles` request

**Files:**
- Test: `src/contract/v1/__tests__/candles.validation.test.ts`
- Modify: `src/contract/v1/validation.ts`

- [ ] **Step 1: Write failing tests**

Create `src/contract/v1/__tests__/candles.validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCandleIngestRequest } from "../validation.js";
import { ContractValidationError } from "../../../http/errors.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

const makeBody = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool1111111111111111111111111111111111111111",
  symbol: "SOL/USDC",
  timeframe: "1h",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [
    {
      unixMs: ONE_HOUR_MS,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000
    }
  ],
  ...overrides
});

describe("parseCandleIngestRequest", () => {
  it("accepts a minimal valid 1-candle batch", () => {
    const result = parseCandleIngestRequest(makeBody());
    expect(result.candles).toHaveLength(1);
    expect(result.timeframe).toBe("1h");
  });

  it("rejects unsupported schemaVersion with UNSUPPORTED_SCHEMA_VERSION", () => {
    expect.assertions(2);
    try {
      parseCandleIngestRequest(makeBody({ schemaVersion: "2.0" }));
    } catch (error) {
      expect(error).toBeInstanceOf(ContractValidationError);
      expect((error as ContractValidationError).response.error.code).toBe(
        "UNSUPPORTED_SCHEMA_VERSION"
      );
    }
  });

  it("rejects unsupported timeframe with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({ timeframe: "5m" }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });

  it.each([
    ["source"],
    ["network"],
    ["poolAddress"],
    ["symbol"],
    ["sourceRecordedAtIso"]
  ])("rejects missing %s with VALIDATION_ERROR", (key) => {
    const body = makeBody();
    delete (body as Record<string, unknown>)[key];
    expect(() => parseCandleIngestRequest(body)).toThrow(ContractValidationError);
  });

  it("rejects malformed sourceRecordedAtIso with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({ sourceRecordedAtIso: "not-an-iso-date" }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });

  it("rejects empty candles array with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({ candles: [] }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });

  it("rejects 1001-candle batch with BATCH_TOO_LARGE", () => {
    const oversized = Array.from({ length: 1001 }, (_, i) => ({
      unixMs: (i + 1) * ONE_HOUR_MS,
      open: 100, high: 110, low: 95, close: 105, volume: 1000
    }));
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({ candles: oversized }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "BATCH_TOO_LARGE"
      );
    }
  });

  it.each([
    ["high < open",      { open: 100, high:  90, low: 80,  close: 95,  volume: 1 }],
    ["high < close",     { open: 100, high:  90, low: 80,  close: 95,  volume: 1 }],
    ["low > open",       { open: 100, high: 120, low: 110, close: 105, volume: 1 }],
    ["low > close",      { open: 100, high: 120, low: 110, close: 105, volume: 1 }],
    ["zero open",        { open:   0, high: 100, low: 50,  close: 80,  volume: 1 }],
    ["negative volume",  { open: 100, high: 110, low: 95,  close: 105, volume: -1 }],
    ["non-finite high",  { open: 100, high: Infinity, low: 95, close: 105, volume: 1 }]
  ])("rejects malformed candle (%s) with MALFORMED_CANDLE", (_label, ohlc) => {
    expect.assertions(2);
    try {
      parseCandleIngestRequest(makeBody({ candles: [{ unixMs: ONE_HOUR_MS, ...ohlc }] }));
    } catch (error) {
      const e = error as ContractValidationError;
      expect(e.response.error.code).toBe("MALFORMED_CANDLE");
      expect(e.response.error.details[0].path).toMatch(/candles\[0\]/);
    }
  });

  it("rejects unixMs not aligned to timeframeMs with MALFORMED_CANDLE", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({
        candles: [{
          unixMs: ONE_HOUR_MS + 1,
          open: 100, high: 110, low: 95, close: 105, volume: 1000
        }]
      }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "MALFORMED_CANDLE"
      );
    }
  });

  it("rejects duplicate unixMs in batch with DUPLICATE_CANDLE_IN_BATCH", () => {
    expect.assertions(1);
    try {
      parseCandleIngestRequest(makeBody({
        candles: [
          { unixMs: ONE_HOUR_MS, open: 100, high: 110, low: 95, close: 105, volume: 1 },
          { unixMs: ONE_HOUR_MS, open: 101, high: 111, low: 96, close: 106, volume: 2 }
        ]
      }));
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "DUPLICATE_CANDLE_IN_BATCH"
      );
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/contract/v1/__tests__/candles.validation.test.ts`
Expected: FAIL with "parseCandleIngestRequest is not a function" or similar.

- [ ] **Step 3: Implement `parseCandleIngestRequest`**

Edit `src/contract/v1/validation.ts`. Add at the top, near the other imports:

```ts
import {
  batchTooLargeError,
  duplicateCandleInBatchError,
  malformedCandleError
} from "../../http/errors.js";
import type {
  CandleIngestRequest
} from "./types.js";
```

Append the new schema and parser before the existing `export const schemas`:

```ts
const SUPPORTED_TIMEFRAMES = ["1h"] as const;
const TIMEFRAME_TO_MS: Record<(typeof SUPPORTED_TIMEFRAMES)[number], number> = {
  "1h": 60 * 60 * 1000
};

const finitePositiveNumberSchema = z
  .number()
  .refine((value) => Number.isFinite(value) && value > 0, {
    message: "Expected a finite positive number"
  });

const finiteNonNegativeNumberSchema = z
  .number()
  .refine((value) => Number.isFinite(value) && value >= 0, {
    message: "Expected a finite non-negative number"
  });

const candleIngestCandleSchema = z
  .object({
    unixMs: z.number().int().nonnegative(),
    open: finitePositiveNumberSchema,
    high: finitePositiveNumberSchema,
    low: finitePositiveNumberSchema,
    close: finitePositiveNumberSchema,
    volume: finiteNonNegativeNumberSchema
  })
  .strict();

const candleIngestRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    source: z.string().min(1),
    network: z.string().min(1),
    poolAddress: z.string().min(1),
    symbol: z.string().min(1),
    timeframe: z.enum(SUPPORTED_TIMEFRAMES),
    sourceRecordedAtIso: z.string().datetime(),
    candles: z.array(candleIngestCandleSchema).min(1)
  })
  .strict();

const validateOhlcvInvariants = (
  candles: CandleIngestRequest["candles"],
  timeframeMs: number
): void => {
  for (let index = 0; index < candles.length; index += 1) {
    const c = candles[index];
    const path = `$.candles[${index}]`;

    if (c.high < Math.max(c.open, c.close, c.low)) {
      throw malformedCandleError(`Candle ${index}: high must be >= max(open, close, low)`, [
        { path: `${path}.high`, code: "INVALID_VALUE", message: "high < max(open, close, low)" }
      ]);
    }

    if (c.low > Math.min(c.open, c.close, c.high)) {
      throw malformedCandleError(`Candle ${index}: low must be <= min(open, close, high)`, [
        { path: `${path}.low`, code: "INVALID_VALUE", message: "low > min(open, close, high)" }
      ]);
    }

    if (!Number.isInteger(c.unixMs)) {
      throw malformedCandleError(`Candle ${index}: unixMs must be an integer`, [
        { path: `${path}.unixMs`, code: "INVALID_VALUE", message: "unixMs is not an integer" }
      ]);
    }

    if (c.unixMs % timeframeMs !== 0) {
      throw malformedCandleError(
        `Candle ${index}: unixMs must be aligned to timeframeMs (${timeframeMs})`,
        [{ path: `${path}.unixMs`, code: "INVALID_VALUE", message: "unixMs misaligned" }]
      );
    }
  }
};

const checkBatchSize = (count: number): void => {
  if (count > 1000) {
    throw batchTooLargeError(
      `candles.length must not exceed 1000; received ${count}`,
      [{ path: "$.candles", code: "OUT_OF_RANGE", message: `length=${count} exceeds 1000` }]
    );
  }
};

const checkDuplicateUnixMs = (candles: CandleIngestRequest["candles"]): void => {
  const seen = new Map<number, number>();
  for (let index = 0; index < candles.length; index += 1) {
    const previous = seen.get(candles[index].unixMs);
    if (previous !== undefined) {
      throw duplicateCandleInBatchError(
        `Duplicate unixMs ${candles[index].unixMs} at indexes ${previous} and ${index}`,
        [
          { path: `$.candles[${previous}].unixMs`, code: "INVALID_VALUE", message: "duplicate" },
          { path: `$.candles[${index}].unixMs`, code: "INVALID_VALUE", message: "duplicate" }
        ]
      );
    }
    seen.set(candles[index].unixMs, index);
  }
};

export const parseCandleIngestRequest = (raw: unknown): CandleIngestRequest => {
  const parsed = parseWithSchema(
    raw,
    candleIngestRequestSchema,
    "Invalid /v1/candles request body"
  );

  checkBatchSize(parsed.candles.length);
  checkDuplicateUnixMs(parsed.candles);
  validateOhlcvInvariants(parsed.candles, TIMEFRAME_TO_MS[parsed.timeframe]);

  return parsed;
};
```

Add `candleIngestRequest: candleIngestRequestSchema` to the `schemas` const at the bottom of `src/contract/v1/validation.ts` (the existing `export const schemas = { ... } as const;` block, around line 275).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/contract/v1/__tests__/candles.validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint and typecheck**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/contract/v1/validation.ts src/contract/v1/__tests__/candles.validation.test.ts
git commit -m "feat(validation): parseCandleIngestRequest with OHLCV invariants

Validates schemaVersion, timeframe allowlist, batch cap (1000), OHLCV
invariants (positive finite prices, high>=max, low<=min, alignment),
and duplicate unixMs rejection within a single batch."
```

### Task 1.4: Validate `GET /v1/regime/current` query

**Files:**
- Test: `src/contract/v1/__tests__/regimeCurrent.validation.test.ts`
- Modify: `src/contract/v1/validation.ts`

- [ ] **Step 1: Write failing tests**

Create `src/contract/v1/__tests__/regimeCurrent.validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseRegimeCurrentQuery } from "../validation.js";
import { ContractValidationError } from "../../../http/errors.js";

const baseQuery = {
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool11111111111111111111111111111111111111",
  timeframe: "1h"
};

describe("parseRegimeCurrentQuery", () => {
  it("accepts the five required selectors", () => {
    const result = parseRegimeCurrentQuery(baseQuery);
    expect(result.timeframe).toBe("1h");
  });

  it.each([
    ["symbol"],
    ["source"],
    ["network"],
    ["poolAddress"],
    ["timeframe"]
  ])("rejects missing %s with VALIDATION_ERROR", (key) => {
    const query = { ...baseQuery } as Record<string, string>;
    delete query[key];
    expect.assertions(1);
    try {
      parseRegimeCurrentQuery(query);
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });

  it("rejects timeframe outside allowlist with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseRegimeCurrentQuery({ ...baseQuery, timeframe: "4h" });
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });

  it("rejects array values from query parsers with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseRegimeCurrentQuery({ ...baseQuery, symbol: ["SOL/USDC", "x"] });
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe(
        "VALIDATION_ERROR"
      );
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/contract/v1/__tests__/regimeCurrent.validation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `parseRegimeCurrentQuery`**

Append to `src/contract/v1/validation.ts`:

```ts
const regimeCurrentQuerySchema = z
  .object({
    symbol: z.string().min(1),
    source: z.string().min(1),
    network: z.string().min(1),
    poolAddress: z.string().min(1),
    timeframe: z.enum(SUPPORTED_TIMEFRAMES)
  })
  .strict();

export const parseRegimeCurrentQuery = (raw: unknown): {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: "1h";
} => {
  const parsed = regimeCurrentQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw validationErrorFromZod(
      "Invalid /v1/regime/current query parameters",
      parsed.error.issues
    );
  }
  return parsed.data;
};
```

Note: this parser does **not** call `parseWithSchema` because the schemaVersion sniff is only meaningful for request bodies. Query strings have no `schemaVersion`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/contract/v1/__tests__/regimeCurrent.validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/contract/v1/validation.ts src/contract/v1/__tests__/regimeCurrent.validation.test.ts
git commit -m "feat(validation): parseRegimeCurrentQuery for the five required selectors"
```

---

## Phase 2 — Schema and `candlesWriter`

### Task 2.1: Append `candle_revisions` schema

**Files:**
- Modify: `src/ledger/schema.sql`

- [ ] **Step 1: Append the table and three indexes**

Append to the end of `src/ledger/schema.sql` (after the existing `clmm_execution_events` table; if the file has a trailing comment block, append above it):

```sql
CREATE TABLE IF NOT EXISTS candle_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,
  network TEXT NOT NULL,
  pool_address TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  unix_ms INTEGER NOT NULL,
  source_recorded_at_iso TEXT NOT NULL,
  source_recorded_at_unix_ms INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  ohlcv_canonical TEXT NOT NULL,
  ohlcv_hash TEXT NOT NULL,
  received_at_unix_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candle_revisions_slot_latest
  ON candle_revisions(
    symbol, source, network, pool_address, timeframe, unix_ms,
    source_recorded_at_unix_ms DESC, id DESC
  );

CREATE INDEX IF NOT EXISTS idx_candle_revisions_feed_window
  ON candle_revisions(
    symbol, source, network, pool_address, timeframe, unix_ms DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_candle_revisions_slot_hash
  ON candle_revisions(
    symbol, source, network, pool_address, timeframe, unix_ms, ohlcv_hash
  );
```

- [ ] **Step 2: Verify schema applies cleanly**

Run: `npm run test -- src/ledger/__tests__/ledger.test.ts`
Expected: PASS (existing tests still pass; new table doesn't break anything).

- [ ] **Step 3: Extend `getLedgerCounts`**

Modify `src/ledger/store.ts:45-75`. Add a `candleRevisions` count alongside the existing counts:

```ts
const candleRevisions =
  (store.db.prepare("SELECT COUNT(*) AS count FROM candle_revisions").get() as { count: number })
    .count ?? 0;
```

And include it in the returned object:

```ts
return {
  planRequests,
  plans,
  executionResults,
  srLevelBriefs,
  srLevels,
  clmmExecutionEvents,
  candleRevisions
};
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ledger/schema.sql src/ledger/store.ts
git commit -m "feat(ledger): add candle_revisions table with read + idempotency indexes

Append-only revisions keyed by symbol+source+network+poolAddress+timeframe+unixMs.
- idx_candle_revisions_slot_latest: latest revision per slot lookup
- idx_candle_revisions_feed_window: feed-window read for GET /v1/regime/current
- ux_candle_revisions_slot_hash: db-enforced byte-equal idempotency

getLedgerCounts extended with candleRevisions for route-test assertions."
```

### Task 2.2: Implement `candlesWriter` — write path

**Files:**
- Test: `src/ledger/__tests__/candlesWriter.test.ts`
- Create: `src/ledger/candlesWriter.ts`

- [ ] **Step 1: Write failing tests for the per-slot decision tree**

Create `src/ledger/__tests__/candlesWriter.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createLedgerStore, getLedgerCounts } from "../store.js";
import { writeCandles, getLatestCandlesForFeed } from "../candlesWriter.js";
import type { CandleIngestRequest } from "../../contract/v1/types.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

const makeRequest = (overrides: Partial<CandleIngestRequest> = {}): CandleIngestRequest => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "1h",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [
    { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90,  close: 105, volume: 1 },
    { unixMs: 2 * ONE_HOUR_MS, open: 105, high: 115, low: 100, close: 110, volume: 2 },
    { unixMs: 3 * ONE_HOUR_MS, open: 110, high: 120, low: 105, close: 115, volume: 3 }
  ],
  ...overrides
});

describe("writeCandles", () => {
  let store: ReturnType<typeof createLedgerStore>;

  afterEach(() => {
    store?.close();
  });

  it("inserts brand-new slots", () => {
    store = createLedgerStore(":memory:");
    const result = writeCandles(store, makeRequest(), 1_700_000_000_000);

    expect(result).toEqual({
      insertedCount: 3,
      revisedCount: 0,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });
    expect(getLedgerCounts(store).candleRevisions).toBe(3);
  });

  it("byte-equal replay is idempotent without new rows", () => {
    store = createLedgerStore(":memory:");
    writeCandles(store, makeRequest(), 1_700_000_000_000);

    const result = writeCandles(store, makeRequest(), 1_700_000_001_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 0,
      idempotentCount: 3,
      rejectedCount: 0,
      rejections: []
    });
    expect(getLedgerCounts(store).candleRevisions).toBe(3);
  });

  it("appends a revision when sourceRecordedAtIso advances and OHLCV differs", () => {
    store = createLedgerStore(":memory:");
    writeCandles(store, makeRequest(), 1_700_000_000_000);

    const newer = makeRequest({
      sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
      candles: [
        { unixMs: 1 * ONE_HOUR_MS, open: 101, high: 111, low: 91,  close: 106, volume: 11 },
        { unixMs: 2 * ONE_HOUR_MS, open: 106, high: 116, low: 101, close: 111, volume: 22 },
        { unixMs: 3 * ONE_HOUR_MS, open: 111, high: 121, low: 106, close: 116, volume: 33 }
      ]
    });

    const result = writeCandles(store, newer, 1_700_000_002_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 3,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });
    expect(getLedgerCounts(store).candleRevisions).toBe(6);

    const latest = getLatestCandlesForFeed(store, {
      symbol: "SOL/USDC", source: "birdeye", network: "solana-mainnet",
      poolAddress: "Pool111", timeframe: "1h",
      closedCandleCutoffUnixMs: 10 * ONE_HOUR_MS, limit: 100
    });
    expect(latest.map((c) => c.close)).toEqual([106, 111, 116]);
  });

  it("rejects per-slot when sourceRecordedAtIso is older with different OHLCV", () => {
    store = createLedgerStore(":memory:");
    writeCandles(
      store,
      makeRequest({ sourceRecordedAtIso: "2026-04-26T13:00:00.000Z" }),
      1_700_000_000_000
    );

    const stale = makeRequest({
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
      candles: [
        { unixMs: 1 * ONE_HOUR_MS, open: 200, high: 210, low: 190, close: 205, volume: 1 }
      ]
    });

    const result = writeCandles(store, stale, 1_700_000_001_000);

    expect(result.rejectedCount).toBe(1);
    expect(result.insertedCount).toBe(0);
    expect(result.rejections).toEqual([
      {
        unixMs: 1 * ONE_HOUR_MS,
        reason: "STALE_REVISION",
        existingSourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
      }
    ]);
  });

  it("mixes inserted/revised/idempotent/rejected in one batch", () => {
    store = createLedgerStore(":memory:");

    writeCandles(
      store,
      makeRequest({
        sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
        candles: [
          { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
          { unixMs: 2 * ONE_HOUR_MS, open: 105, high: 115, low: 100, close: 110, volume: 2 }
        ]
      }),
      1_700_000_000_000
    );

    const mixed = makeRequest({
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
      candles: [
        { unixMs: 1 * ONE_HOUR_MS, open: 100, high: 110, low: 90,  close: 105, volume: 1 },
        { unixMs: 2 * ONE_HOUR_MS, open: 999, high: 999, low: 999, close: 999, volume: 9 },
        { unixMs: 3 * ONE_HOUR_MS, open: 110, high: 120, low: 105, close: 115, volume: 3 }
      ]
    });

    const result = writeCandles(store, mixed, 1_700_000_002_000);

    expect(result.idempotentCount).toBe(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.insertedCount).toBe(1);
    expect(result.revisedCount).toBe(0);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].unixMs).toBe(2 * ONE_HOUR_MS);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/ledger/__tests__/candlesWriter.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `writeCandles`**

Create `src/ledger/candlesWriter.ts`:

```ts
import { toCanonicalJson } from "../contract/v1/canonical.js";
import { sha256Hex } from "../contract/v1/hash.js";
import type {
  CandleIngestRequest,
  CandleIngestRejection,
  CandleIngestResponse
} from "../contract/v1/types.js";
import type { LedgerStore } from "./store.js";

interface ExistingLatest {
  source_recorded_at_unix_ms: number;
  source_recorded_at_iso: string;
  ohlcv_hash: string;
}

const selectLatest = (
  store: LedgerStore,
  feed: {
    symbol: string; source: string; network: string;
    poolAddress: string; timeframe: string;
  },
  unixMs: number
): ExistingLatest | undefined => {
  return store.db
    .prepare(
      `SELECT source_recorded_at_unix_ms, source_recorded_at_iso, ohlcv_hash
         FROM candle_revisions
        WHERE symbol = ? AND source = ? AND network = ?
          AND pool_address = ? AND timeframe = ? AND unix_ms = ?
        ORDER BY source_recorded_at_unix_ms DESC, id DESC
        LIMIT 1`
    )
    .get(
      feed.symbol, feed.source, feed.network,
      feed.poolAddress, feed.timeframe, unixMs
    ) as ExistingLatest | undefined;
};

const insertRevision = (
  store: LedgerStore,
  feed: {
    symbol: string; source: string; network: string;
    poolAddress: string; timeframe: string;
  },
  candle: CandleIngestRequest["candles"][number],
  sourceRecordedAtIso: string,
  sourceRecordedAtUnixMs: number,
  ohlcvCanonical: string,
  ohlcvHash: string,
  receivedAtUnixMs: number
): void => {
  store.db
    .prepare(
      `INSERT INTO candle_revisions (
         symbol, source, network, pool_address, timeframe, unix_ms,
         source_recorded_at_iso, source_recorded_at_unix_ms,
         open, high, low, close, volume,
         ohlcv_canonical, ohlcv_hash, received_at_unix_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      feed.symbol, feed.source, feed.network,
      feed.poolAddress, feed.timeframe, candle.unixMs,
      sourceRecordedAtIso, sourceRecordedAtUnixMs,
      candle.open, candle.high, candle.low, candle.close, candle.volume,
      ohlcvCanonical, ohlcvHash, receivedAtUnixMs
    );
};

export const writeCandles = (
  store: LedgerStore,
  input: CandleIngestRequest,
  receivedAtUnixMs: number
): Omit<CandleIngestResponse, "schemaVersion"> => {
  const incomingSourceRecordedAtUnixMs = Date.parse(input.sourceRecordedAtIso);

  const feed = {
    symbol: input.symbol,
    source: input.source,
    network: input.network,
    poolAddress: input.poolAddress,
    timeframe: input.timeframe
  };

  let insertedCount = 0;
  let revisedCount = 0;
  let idempotentCount = 0;
  let rejectedCount = 0;
  const rejections: CandleIngestRejection[] = [];

  store.db.exec("BEGIN IMMEDIATE");
  try {
    for (const candle of input.candles) {
      const ohlcvCanonical = toCanonicalJson({
        open: candle.open, high: candle.high, low: candle.low,
        close: candle.close, volume: candle.volume
      });
      const ohlcvHash = sha256Hex(ohlcvCanonical);

      const existing = selectLatest(store, feed, candle.unixMs);

      if (!existing) {
        insertRevision(
          store, feed, candle,
          input.sourceRecordedAtIso, incomingSourceRecordedAtUnixMs,
          ohlcvCanonical, ohlcvHash, receivedAtUnixMs
        );
        insertedCount += 1;
        continue;
      }

      if (existing.ohlcv_hash === ohlcvHash) {
        idempotentCount += 1;
        continue;
      }

      if (existing.source_recorded_at_unix_ms < incomingSourceRecordedAtUnixMs) {
        insertRevision(
          store, feed, candle,
          input.sourceRecordedAtIso, incomingSourceRecordedAtUnixMs,
          ohlcvCanonical, ohlcvHash, receivedAtUnixMs
        );
        revisedCount += 1;
        continue;
      }

      rejectedCount += 1;
      rejections.push({
        unixMs: candle.unixMs,
        reason: "STALE_REVISION",
        existingSourceRecordedAtIso: existing.source_recorded_at_iso
      });
    }

    store.db.exec("COMMIT");
  } catch (error) {
    try {
      store.db.exec("ROLLBACK");
    } catch (_rollbackError) {
      void _rollbackError;
    }
    throw error;
  }

  rejections.sort((a, b) => a.unixMs - b.unixMs);

  return { insertedCount, revisedCount, idempotentCount, rejectedCount, rejections };
};
```

- [ ] **Step 4: Run tests to verify they pass (write path only — read tests still failing)**

Run: `npm run test -- src/ledger/__tests__/candlesWriter.test.ts -t "inserts brand-new slots"`
Expected: PASS.

Run: `npm run test -- src/ledger/__tests__/candlesWriter.test.ts -t "byte-equal replay"`
Expected: PASS.

Run: `npm run test -- src/ledger/__tests__/candlesWriter.test.ts -t "rejects per-slot"`
Expected: PASS.

Run: `npm run test -- src/ledger/__tests__/candlesWriter.test.ts -t "mixes inserted"`
Expected: PASS.

The "appends a revision" test still fails because `getLatestCandlesForFeed` is not implemented yet. That's expected — it's covered in Task 2.3.

- [ ] **Step 5: Commit (intermediate; read path lands in next task)**

```bash
git add src/ledger/candlesWriter.ts src/ledger/__tests__/candlesWriter.test.ts
git commit -m "feat(ledger): writeCandles with per-slot decision tree

INSERT new slots, idempotent on byte-equal hash, append revision when
sourceRecordedAtIso advances, reject per-slot when stale + different.
Whole batch under one BEGIN IMMEDIATE. Numeric ordering against
parsed source_recorded_at_unix_ms; ISO strings audit-only."
```

### Task 2.3: Implement `candlesWriter` — read path

**Files:**
- Modify: `src/ledger/candlesWriter.ts`

- [ ] **Step 1: Implement `getLatestCandlesForFeed`**

Append to `src/ledger/candlesWriter.ts`:

```ts
export interface GetLatestCandlesParams {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: string;
  closedCandleCutoffUnixMs: number;
  limit: number;
}

export interface CandleRow {
  unixMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const getLatestCandlesForFeed = (
  store: LedgerStore,
  params: GetLatestCandlesParams
): CandleRow[] => {
  const rows = store.db
    .prepare(
      `WITH latest_per_slot AS (
         SELECT unix_ms, open, high, low, close, volume,
                row_number() OVER (
                  PARTITION BY unix_ms
                  ORDER BY source_recorded_at_unix_ms DESC, id DESC
                ) AS rn
           FROM candle_revisions
          WHERE symbol = ? AND source = ? AND network = ?
            AND pool_address = ? AND timeframe = ?
            AND unix_ms <= ?
       )
       SELECT unix_ms, open, high, low, close, volume
         FROM (
           SELECT unix_ms, open, high, low, close, volume
             FROM latest_per_slot
            WHERE rn = 1
            ORDER BY unix_ms DESC
            LIMIT ?
         )
        ORDER BY unix_ms ASC`
    )
    .all(
      params.symbol, params.source, params.network,
      params.poolAddress, params.timeframe,
      params.closedCandleCutoffUnixMs, params.limit
    ) as Array<{
      unix_ms: number; open: number; high: number; low: number;
      close: number; volume: number;
    }>;

  return rows.map((row) => ({
    unixMs: row.unix_ms,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume
  }));
};
```

- [ ] **Step 2: Run all writer tests**

Run: `npm run test -- src/ledger/__tests__/candlesWriter.test.ts`
Expected: PASS (all tests, including the previously-failing "appends a revision" assertion against `getLatestCandlesForFeed`).

- [ ] **Step 3: Run full test suite + lint + typecheck**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ledger/candlesWriter.ts
git commit -m "feat(ledger): getLatestCandlesForFeed reads latest revision per slot

Window function dedups per slot by source_recorded_at_unix_ms DESC;
LIMIT applied to deduped slots; final ORDER BY unix_ms ASC for
indicator computation."
```

---

## Phase 3 — Pure marketRegime engine

### Task 3.1: Add `MARKET_REGIME_CONFIG`

**Files:**
- Create: `src/engine/marketRegime/config.ts`

- [ ] **Step 1: Create the config module**

Create `src/engine/marketRegime/config.ts`:

```ts
export const MARKET_REGIME_CONFIG_VERSION = "market-regime-1.0.0" as const;

export interface MarketTimeframeConfig {
  timeframe: "1h";
  timeframeMs: number;

  indicators: {
    volShortWindow: number;
    volLongWindow: number;
    trendWindow: number;
    compressionWindow: number;
  };

  regime: {
    confirmBars: number;
    minHoldBars: number;
    enterUpTrend: number;
    exitUpTrend: number;
    enterDownTrend: number;
    exitDownTrend: number;
    chopVolRatioMax: number;
  };

  suitability: {
    allowedVolRatioMax: number;
    extremeVolRatio: number;
    extremeCompression: number;
    minCandles: number;
  };

  freshness: {
    closedCandleDelayMs: number;
    softStaleMs: number;
    hardStaleMs: number;
  };
}

const ONE_HOUR_MS = 60 * 60 * 1000;

export const MARKET_REGIME_CONFIG: Record<"1h", MarketTimeframeConfig> = {
  "1h": {
    timeframe: "1h",
    timeframeMs: ONE_HOUR_MS,

    indicators: {
      volShortWindow: 8,
      volLongWindow: 21,
      trendWindow: 14,
      compressionWindow: 20
    },

    regime: {
      confirmBars: 1,
      minHoldBars: 0,
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },

    suitability: {
      allowedVolRatioMax: 1.30,
      extremeVolRatio: 1.60,
      extremeCompression: 0.18,
      minCandles: 30
    },

    freshness: {
      closedCandleDelayMs: 5 * 60 * 1000,
      softStaleMs: 75 * 60 * 1000,
      hardStaleMs: 90 * 60 * 1000
    }
  }
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engine/marketRegime/config.ts
git commit -m "feat(marketRegime): committed per-timeframe config (1h MVP)

Indicator/regime values cribbed from existing classifier fixtures.
Suitability thresholds are MVP placeholders deferred to a calibration
milestone. MARKET_REGIME_CONFIG_VERSION is the metadata.configVersion
source."
```

### Task 3.2: `closedCandleCutoffUnixMs`

**Files:**
- Test: `src/engine/marketRegime/__tests__/closedCandleCutoff.test.ts`
- Create: `src/engine/marketRegime/closedCandleCutoff.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/marketRegime/__tests__/closedCandleCutoff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { closedCandleCutoffUnixMs } from "../closedCandleCutoff.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

describe("closedCandleCutoffUnixMs", () => {
  it("returns the boundary one full bar before the just-closed bar", () => {
    // now = 13:30, delay = 5min, timeframe = 1h
    // floor((13:30 - 0:05) / 1h) * 1h = 13:00
    // 13:00 - 1h = 12:00
    const now = 13 * ONE_HOUR_MS + 30 * 60 * 1000;
    const cutoff = closedCandleCutoffUnixMs(now, ONE_HOUR_MS, FIVE_MIN_MS);
    expect(cutoff).toBe(12 * ONE_HOUR_MS);
  });

  it("does not promote the just-closed bar within the delay window", () => {
    // now = 13:03 (3 min after the 13:00 bar opened, so the 12:00 bar just closed
    // 3 min ago — within the 5 min delay).
    const now = 13 * ONE_HOUR_MS + 3 * 60 * 1000;
    const cutoff = closedCandleCutoffUnixMs(now, ONE_HOUR_MS, FIVE_MIN_MS);
    // floor((13:03 - 0:05) / 1h) * 1h = 12:00; minus 1h = 11:00
    expect(cutoff).toBe(11 * ONE_HOUR_MS);
  });

  it("promotes the just-closed bar once delay has elapsed", () => {
    // now = 13:06 (delay elapsed for the 12:00 bar)
    const now = 13 * ONE_HOUR_MS + 6 * 60 * 1000;
    const cutoff = closedCandleCutoffUnixMs(now, ONE_HOUR_MS, FIVE_MIN_MS);
    expect(cutoff).toBe(12 * ONE_HOUR_MS);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/engine/marketRegime/__tests__/closedCandleCutoff.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/engine/marketRegime/closedCandleCutoff.ts`:

```ts
export const closedCandleCutoffUnixMs = (
  nowUnixMs: number,
  timeframeMs: number,
  closedCandleDelayMs: number
): number => {
  const adjusted = nowUnixMs - closedCandleDelayMs;
  const lastEligibleBarOpen = Math.floor(adjusted / timeframeMs) * timeframeMs;
  return lastEligibleBarOpen - timeframeMs;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/engine/marketRegime/__tests__/closedCandleCutoff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/marketRegime/closedCandleCutoff.ts src/engine/marketRegime/__tests__/closedCandleCutoff.test.ts
git commit -m "feat(marketRegime): closedCandleCutoffUnixMs grace-window helper

Excludes the latest in-flight bar plus a delay window so late candle
revisions can still arrive before classification."
```

### Task 3.3: `computeFreshness`

**Files:**
- Test: `src/engine/marketRegime/__tests__/freshness.test.ts`
- Create: `src/engine/marketRegime/freshness.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/marketRegime/__tests__/freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeFreshness } from "../freshness.js";

const ONE_MIN_MS = 60 * 1000;

const config = {
  softStaleMs: 75 * ONE_MIN_MS,
  hardStaleMs: 90 * ONE_MIN_MS,
  closedCandleDelayMs: 5 * ONE_MIN_MS
};

describe("computeFreshness", () => {
  it("returns fresh status when age is below softStaleMs", () => {
    const lastCandleUnixMs = 0;
    const now = 60 * ONE_MIN_MS;
    const result = computeFreshness(now, lastCandleUnixMs, config);
    expect(result.softStale).toBe(false);
    expect(result.hardStale).toBe(false);
    expect(result.ageSeconds).toBe(60 * 60);
    expect(result.lastCandleUnixMs).toBe(0);
  });

  it("flags softStale exactly at the softStaleMs threshold", () => {
    const lastCandleUnixMs = 0;
    const now = 75 * ONE_MIN_MS;
    const result = computeFreshness(now, lastCandleUnixMs, config);
    expect(result.softStale).toBe(true);
    expect(result.hardStale).toBe(false);
  });

  it("flags hardStale exactly at the hardStaleMs threshold", () => {
    const lastCandleUnixMs = 0;
    const now = 90 * ONE_MIN_MS;
    const result = computeFreshness(now, lastCandleUnixMs, config);
    expect(result.softStale).toBe(true);
    expect(result.hardStale).toBe(true);
  });

  it("includes ISO strings and configured thresholds in the response", () => {
    const lastCandleUnixMs = Date.parse("2026-04-26T12:00:00.000Z");
    const now = lastCandleUnixMs + 30 * ONE_MIN_MS;
    const result = computeFreshness(now, lastCandleUnixMs, config);
    expect(result.lastCandleIso).toBe("2026-04-26T12:00:00.000Z");
    expect(result.generatedAtIso).toBe(new Date(now).toISOString());
    expect(result.softStaleSeconds).toBe(75 * 60);
    expect(result.hardStaleSeconds).toBe(90 * 60);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/engine/marketRegime/__tests__/freshness.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/engine/marketRegime/freshness.ts`:

```ts
export interface FreshnessConfig {
  softStaleMs: number;
  hardStaleMs: number;
  closedCandleDelayMs: number;
}

export interface FreshnessResult {
  generatedAtIso: string;
  lastCandleUnixMs: number;
  lastCandleIso: string;
  ageSeconds: number;
  softStale: boolean;
  hardStale: boolean;
  softStaleSeconds: number;
  hardStaleSeconds: number;
}

export const computeFreshness = (
  nowUnixMs: number,
  lastCandleUnixMs: number,
  config: FreshnessConfig
): FreshnessResult => {
  const ageMs = Math.max(0, nowUnixMs - lastCandleUnixMs);
  return {
    generatedAtIso: new Date(nowUnixMs).toISOString(),
    lastCandleUnixMs,
    lastCandleIso: new Date(lastCandleUnixMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    softStale: ageMs >= config.softStaleMs,
    hardStale: ageMs >= config.hardStaleMs,
    softStaleSeconds: Math.floor(config.softStaleMs / 1000),
    hardStaleSeconds: Math.floor(config.hardStaleMs / 1000)
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/engine/marketRegime/__tests__/freshness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/marketRegime/freshness.ts src/engine/marketRegime/__tests__/freshness.test.ts
git commit -m "feat(marketRegime): computeFreshness with soft/hard stale boundaries"
```

### Task 3.4: `classifyMarketRegime`

**Files:**
- Test: `src/engine/marketRegime/__tests__/classifyMarketRegime.test.ts`
- Create: `src/engine/marketRegime/classifyMarketRegime.ts`

- [ ] **Step 1: Write failing tests**

Create `src/engine/marketRegime/__tests__/classifyMarketRegime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyMarketRegime } from "../classifyMarketRegime.js";
import { MARKET_REGIME_CONFIG } from "../config.js";

const config = MARKET_REGIME_CONFIG["1h"].regime;

describe("classifyMarketRegime", () => {
  it("returns CHOP when telemetry is calm and trend is flat", () => {
    const result = classifyMarketRegime(
      { realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
        trendStrength: 0, compression: 0.05 },
      config
    );
    expect(result.regime).toBe("CHOP");
    expect(result.reasons.map((r) => r.code)).toEqual(["REGIME_STABLE"]);
  });

  it("returns UP and emits REGIME_SWITCH_CONFIRMED when trend strong + low vol", () => {
    const result = classifyMarketRegime(
      { realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
        trendStrength: 1.0, compression: 0.05 },
      config
    );
    expect(result.regime).toBe("UP");
    expect(result.reasons.map((r) => r.code)).toEqual(["REGIME_SWITCH_CONFIRMED"]);
  });

  it("returns DOWN when trend is strongly negative", () => {
    const result = classifyMarketRegime(
      { realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
        trendStrength: -1.0, compression: 0.05 },
      config
    );
    expect(result.regime).toBe("DOWN");
  });

  it("rewrites the message for REGIME_SWITCH_CONFIRMED to market-read language", () => {
    const result = classifyMarketRegime(
      { realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
        trendStrength: 1.0, compression: 0.05 },
      config
    );
    expect(result.reasons[0].message).toBe("Current telemetry supports UP regime.");
  });

  it("never emits REGIME_CONFIRM_PENDING or REGIME_MIN_HOLD_ACTIVE", () => {
    const samples = [
      { realizedVolShort: 0, realizedVolLong: 0, volRatio: 2.0, trendStrength: 0, compression: 0 },
      { realizedVolShort: 0, realizedVolLong: 0, volRatio: 0.1, trendStrength: 0.5, compression: 0 },
      { realizedVolShort: 0, realizedVolLong: 0, volRatio: 0.1, trendStrength: -0.5, compression: 0 }
    ];
    for (const telemetry of samples) {
      const codes = classifyMarketRegime(telemetry, config).reasons.map((r) => r.code);
      expect(codes).not.toContain("REGIME_CONFIRM_PENDING");
      expect(codes).not.toContain("REGIME_MIN_HOLD_ACTIVE");
    }
  });

  it("is deterministic: same telemetry produces identical output", () => {
    const telemetry = {
      realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
      trendStrength: 0, compression: 0.05
    };
    const a = classifyMarketRegime(telemetry, config);
    const b = classifyMarketRegime(telemetry, config);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/engine/marketRegime/__tests__/classifyMarketRegime.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/engine/marketRegime/classifyMarketRegime.ts`:

```ts
import { classifyRegime } from "../regime/classifier.js";
import type { IndicatorTelemetry } from "../features/indicators.js";
import type { MarketTimeframeConfig } from "./config.js";
import type { MarketReason } from "../../contract/v1/types.js";
import type { Regime } from "../../contract/v1/types.js";

const rewriteMessage = (code: string, regime: Regime): string => {
  if (code === "REGIME_STABLE") {
    return `Current telemetry holds ${regime} regime.`;
  }
  if (code === "REGIME_SWITCH_CONFIRMED") {
    return `Current telemetry supports ${regime} regime.`;
  }
  return "";
};

export const classifyMarketRegime = (
  telemetry: IndicatorTelemetry,
  config: MarketTimeframeConfig["regime"]
): { regime: Regime; reasons: MarketReason[] } => {
  const decision = classifyRegime({
    telemetry,
    config,
    state: undefined
  });

  const reasons: MarketReason[] = [];
  for (const reason of decision.reasons) {
    if (reason.code !== "REGIME_STABLE" && reason.code !== "REGIME_SWITCH_CONFIRMED") {
      // REGIME_CONFIRM_PENDING and REGIME_MIN_HOLD_ACTIVE are unreachable with
      // confirmBars=1 and minHoldBars=0; defensively drop them if classifyRegime
      // ever changes.
      continue;
    }
    reasons.push({
      code: reason.code,
      severity: reason.severity,
      message: rewriteMessage(reason.code, decision.regime)
    });
  }

  return { regime: decision.regime, reasons };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/engine/marketRegime/__tests__/classifyMarketRegime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/marketRegime/classifyMarketRegime.ts src/engine/marketRegime/__tests__/classifyMarketRegime.test.ts
git commit -m "feat(marketRegime): classifyMarketRegime stateless wrapper

Calls classifyRegime with state: undefined, confirmBars: 1, minHoldBars: 0
so policy hysteresis degenerates. Filters REGIME_CONFIRM_PENDING and
REGIME_MIN_HOLD_ACTIVE (unreachable in this configuration) and rewrites
message strings to market-read phrasing."
```

### Task 3.5: `evaluateMarketClmmSuitability`

**Files:**
- Test: `src/engine/marketRegime/__tests__/evaluateMarketClmmSuitability.test.ts`
- Create: `src/engine/marketRegime/evaluateMarketClmmSuitability.ts`

- [ ] **Step 1: Write failing tests covering the full decision tree**

Create `src/engine/marketRegime/__tests__/evaluateMarketClmmSuitability.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateMarketClmmSuitability } from "../evaluateMarketClmmSuitability.js";
import { MARKET_REGIME_CONFIG } from "../config.js";

const cfg = MARKET_REGIME_CONFIG["1h"].suitability;

const baseTelemetry = {
  realizedVolShort: 0.01, realizedVolLong: 0.01,
  volRatio: 0.5, trendStrength: 0, compression: 0.05
};

const fresh = { hardStale: false, softStale: false };
const stale = { hardStale: false, softStale: true };
const dead  = { hardStale: true,  softStale: true };
const sufficient = 30;
const insufficient = 5;

describe("evaluateMarketClmmSuitability", () => {
  it("returns UNKNOWN with CLMM_UNKNOWN_INSUFFICIENT_SAMPLES when below minCandles", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP", telemetry: baseTelemetry, freshness: fresh,
      candleCount: insufficient, config: cfg
    });
    expect(r.status).toBe("UNKNOWN");
    expect(r.reasons.map((x) => x.code)).toEqual(["CLMM_UNKNOWN_INSUFFICIENT_SAMPLES"]);
  });

  it("returns UNKNOWN with CLMM_UNKNOWN_HARD_STALE_DATA when hardStale", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP", telemetry: baseTelemetry, freshness: dead,
      candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("UNKNOWN");
    expect(r.reasons.map((x) => x.code)).toEqual(["CLMM_UNKNOWN_HARD_STALE_DATA"]);
  });

  it("returns BLOCKED CLMM_BLOCKED_TRENDING_UP for UP regime even with fresh data", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "UP", telemetry: baseTelemetry, freshness: fresh,
      candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_BLOCKED_TRENDING_UP");
  });

  it("returns BLOCKED CLMM_BLOCKED_TRENDING_DOWN for DOWN regime", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "DOWN", telemetry: baseTelemetry, freshness: fresh,
      candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_BLOCKED_TRENDING_DOWN");
  });

  it("returns BLOCKED on extreme volRatio for CHOP regime", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: { ...baseTelemetry, volRatio: cfg.extremeVolRatio + 0.01 },
      freshness: fresh, candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_BLOCKED_EXTREME_VOLATILITY");
  });

  it("returns BLOCKED on extreme compression for CHOP regime", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: { ...baseTelemetry, compression: cfg.extremeCompression + 0.01 },
      freshness: fresh, candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_BLOCKED_EXTREME_COMPRESSION");
  });

  it("appends UP + extreme vol BLOCKED reasons but no caution reasons", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "UP",
      telemetry: { ...baseTelemetry, volRatio: cfg.extremeVolRatio + 0.01 },
      freshness: stale, candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("BLOCKED");
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain("CLMM_BLOCKED_TRENDING_UP");
    expect(codes).toContain("CLMM_BLOCKED_EXTREME_VOLATILITY");
    expect(codes).not.toContain("CLMM_CAUTION_SOFT_STALE_DATA");
    expect(codes).not.toContain("CLMM_CAUTION_ELEVATED_VOLATILITY");
  });

  it("returns CAUTION CLMM_CAUTION_SOFT_STALE_DATA for CHOP + softStale", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP", telemetry: baseTelemetry, freshness: stale,
      candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("CAUTION");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_CAUTION_SOFT_STALE_DATA");
  });

  it("returns CAUTION CLMM_CAUTION_ELEVATED_VOLATILITY for CHOP + elevated non-extreme vol", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: { ...baseTelemetry, volRatio: cfg.allowedVolRatioMax + 0.01 },
      freshness: fresh, candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("CAUTION");
    expect(r.reasons.map((x) => x.code)).toContain("CLMM_CAUTION_ELEVATED_VOLATILITY");
  });

  it("appends both caution reasons when soft-stale and elevated vol are simultaneous", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP",
      telemetry: { ...baseTelemetry, volRatio: cfg.allowedVolRatioMax + 0.01 },
      freshness: stale, candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("CAUTION");
    const codes = r.reasons.map((x) => x.code);
    expect(codes).toContain("CLMM_CAUTION_SOFT_STALE_DATA");
    expect(codes).toContain("CLMM_CAUTION_ELEVATED_VOLATILITY");
  });

  it("returns ALLOWED CLMM_ALLOWED_CHOP_FRESH for fresh + sufficient + low-vol CHOP", () => {
    const r = evaluateMarketClmmSuitability({
      regime: "CHOP", telemetry: baseTelemetry, freshness: fresh,
      candleCount: sufficient, config: cfg
    });
    expect(r.status).toBe("ALLOWED");
    expect(r.reasons.map((x) => x.code)).toEqual(["CLMM_ALLOWED_CHOP_FRESH"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/engine/marketRegime/__tests__/evaluateMarketClmmSuitability.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/engine/marketRegime/evaluateMarketClmmSuitability.ts`:

```ts
import type {
  ClmmSuitabilityReason,
  ClmmSuitabilityStatus,
  Regime
} from "../../contract/v1/types.js";
import type { IndicatorTelemetry } from "../features/indicators.js";
import type { MarketTimeframeConfig } from "./config.js";

export interface MarketClmmSuitabilityInput {
  regime: Regime;
  telemetry: IndicatorTelemetry;
  freshness: { hardStale: boolean; softStale: boolean };
  candleCount: number;
  config: MarketTimeframeConfig["suitability"];
}

export interface MarketClmmSuitability {
  status: ClmmSuitabilityStatus;
  reasons: ClmmSuitabilityReason[];
}

const reason = (
  code: string,
  severity: ClmmSuitabilityReason["severity"],
  message: string
): ClmmSuitabilityReason => ({ code, severity, message });

export const evaluateMarketClmmSuitability = (
  input: MarketClmmSuitabilityInput
): MarketClmmSuitability => {
  const { regime, telemetry, freshness, candleCount, config } = input;

  // 1. UNKNOWN gate (data-quality wins).
  if (candleCount < config.minCandles) {
    return {
      status: "UNKNOWN",
      reasons: [
        reason(
          "CLMM_UNKNOWN_INSUFFICIENT_SAMPLES",
          "ERROR",
          `Need at least ${config.minCandles} closed candles; have ${candleCount}.`
        )
      ]
    };
  }

  if (freshness.hardStale) {
    return {
      status: "UNKNOWN",
      reasons: [
        reason(
          "CLMM_UNKNOWN_HARD_STALE_DATA",
          "ERROR",
          "Latest candle exceeds hard-stale window; classification is not trustworthy."
        )
      ]
    };
  }

  // 2. BLOCKED gate.
  const blockedReasons: ClmmSuitabilityReason[] = [];
  if (regime === "UP") {
    blockedReasons.push(
      reason("CLMM_BLOCKED_TRENDING_UP", "WARN",
        "CLMM positions are not appropriate while regime is trending UP.")
    );
  }
  if (regime === "DOWN") {
    blockedReasons.push(
      reason("CLMM_BLOCKED_TRENDING_DOWN", "WARN",
        "CLMM positions are not appropriate while regime is trending DOWN.")
    );
  }
  if (telemetry.volRatio >= config.extremeVolRatio) {
    blockedReasons.push(
      reason("CLMM_BLOCKED_EXTREME_VOLATILITY", "WARN",
        "Realized volatility is in the extreme band; CLMM is blocked regardless of regime.")
    );
  }
  if (telemetry.compression >= config.extremeCompression) {
    blockedReasons.push(
      reason("CLMM_BLOCKED_EXTREME_COMPRESSION", "WARN",
        "Bollinger compression is extreme; CLMM is blocked regardless of regime.")
    );
  }
  if (blockedReasons.length > 0) {
    return { status: "BLOCKED", reasons: blockedReasons };
  }

  // 3. CAUTION gate (only reached for non-blocked CHOP).
  const cautionReasons: ClmmSuitabilityReason[] = [];
  if (freshness.softStale) {
    cautionReasons.push(
      reason("CLMM_CAUTION_SOFT_STALE_DATA", "WARN",
        "Latest candle is in the soft-stale window; treat the read as borderline.")
    );
  }
  if (telemetry.volRatio > config.allowedVolRatioMax) {
    cautionReasons.push(
      reason("CLMM_CAUTION_ELEVATED_VOLATILITY", "WARN",
        "Volatility is elevated above the allowed band but not extreme.")
    );
  }
  if (cautionReasons.length > 0) {
    return { status: "CAUTION", reasons: cautionReasons };
  }

  // 4. ALLOWED.
  return {
    status: "ALLOWED",
    reasons: [
      reason("CLMM_ALLOWED_CHOP_FRESH", "INFO",
        "Market is in CHOP with fresh data and acceptable volatility for CLMM exposure.")
    ]
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/engine/marketRegime/__tests__/evaluateMarketClmmSuitability.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/marketRegime/evaluateMarketClmmSuitability.ts src/engine/marketRegime/__tests__/evaluateMarketClmmSuitability.test.ts
git commit -m "feat(marketRegime): four-band CLMM suitability decision tree

Status precedence UNKNOWN > BLOCKED > CAUTION > ALLOWED with reasons
accumulating only within the winning band."
```

### Task 3.6: `buildRegimeCurrent` orchestrator + snapshot

**Files:**
- Test: `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`
- Test: `src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts`
- Create: `src/engine/marketRegime/buildRegimeCurrent.ts`

- [ ] **Step 1: Write the orchestrator test**

Create `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
import { MARKET_REGIME_CONFIG } from "../config.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

const flatCandles = Array.from({ length: 40 }, (_, i) => ({
  unixMs: (i + 1) * ONE_HOUR_MS,
  open: 100, high: 100.5, low: 99.5, close: 100, volume: 1
}));

const feed = {
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  timeframe: "1h" as const
};

describe("buildRegimeCurrent", () => {
  it("classifies CHOP and emits ALLOWED for flat candles + fresh data", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const nowUnixMs = lastCandleUnixMs + 30 * 60 * 1000; // 30 min after last candle
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });

    expect(response.regime).toBe("CHOP");
    expect(response.clmmSuitability.status).toBe("ALLOWED");
    expect(response.metadata.candleCount).toBe(40);
    expect(response.metadata.engineVersion).toBe("0.1.0");
    expect(response.metadata.configVersion).toBe("market-regime-1.0.0");
    expect(response.symbol).toBe("SOL/USDC");
  });

  it("returns UNKNOWN when candleCount < minCandles even for fresh data", () => {
    const fewCandles = flatCandles.slice(0, 5);
    const lastCandleUnixMs = fewCandles[fewCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed, candles: fewCandles,
      nowUnixMs: lastCandleUnixMs + 30 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });
    expect(response.clmmSuitability.status).toBe("UNKNOWN");
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_INSUFFICIENT_SAMPLES");
  });

  it("returns UNKNOWN when freshness is hardStale", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed, candles: flatCandles,
      nowUnixMs: lastCandleUnixMs + 91 * 60 * 1000, // > hardStaleMs
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });
    expect(response.clmmSuitability.status).toBe("UNKNOWN");
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_HARD_STALE");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the orchestrator**

Create `src/engine/marketRegime/buildRegimeCurrent.ts`:

```ts
import { computeIndicators } from "../features/indicators.js";
import type { Candle, MarketReason, RegimeCurrentResponse } from "../../contract/v1/types.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { classifyMarketRegime } from "./classifyMarketRegime.js";
import { computeFreshness } from "./freshness.js";
import { evaluateMarketClmmSuitability } from "./evaluateMarketClmmSuitability.js";
import type { MarketTimeframeConfig } from "./config.js";

export interface BuildRegimeCurrentInput {
  feed: {
    symbol: string;
    source: string;
    network: string;
    poolAddress: string;
    timeframe: "1h";
  };
  candles: Candle[];
  nowUnixMs: number;
  config: MarketTimeframeConfig;
  configVersion: string;
  engineVersion: string;
}

const buildMarketReasons = (
  regimeReasons: MarketReason[],
  freshness: { hardStale: boolean; softStale: boolean },
  candleCount: number,
  minCandles: number
): MarketReason[] => {
  const out: MarketReason[] = [...regimeReasons];

  if (freshness.hardStale) {
    out.push({
      code: "DATA_HARD_STALE",
      severity: "ERROR",
      message: "Latest candle is older than the hard-stale window."
    });
  } else if (freshness.softStale) {
    out.push({
      code: "DATA_SOFT_STALE",
      severity: "WARN",
      message: "Latest candle is older than the soft-stale window."
    });
  } else {
    out.push({
      code: "DATA_FRESH",
      severity: "INFO",
      message: "Latest candle is within the freshness window."
    });
  }

  if (candleCount >= minCandles) {
    out.push({
      code: "DATA_SUFFICIENT_SAMPLES",
      severity: "INFO",
      message: `Have ${candleCount} closed candles (>= ${minCandles}).`
    });
  } else {
    out.push({
      code: "DATA_INSUFFICIENT_SAMPLES",
      severity: "ERROR",
      message: `Have ${candleCount} closed candles; need at least ${minCandles}.`
    });
  }

  return out;
};

export const buildRegimeCurrent = (input: BuildRegimeCurrentInput): RegimeCurrentResponse => {
  const { feed, candles, nowUnixMs, config, configVersion, engineVersion } = input;

  const telemetry = computeIndicators(candles, config.indicators);
  const { regime, reasons: regimeReasons } = classifyMarketRegime(telemetry, config.regime);

  const lastCandleUnixMs = candles[candles.length - 1].unixMs;
  const freshness = computeFreshness(nowUnixMs, lastCandleUnixMs, {
    softStaleMs: config.freshness.softStaleMs,
    hardStaleMs: config.freshness.hardStaleMs,
    closedCandleDelayMs: config.freshness.closedCandleDelayMs
  });

  const suitability = evaluateMarketClmmSuitability({
    regime,
    telemetry,
    freshness: { hardStale: freshness.hardStale, softStale: freshness.softStale },
    candleCount: candles.length,
    config: config.suitability
  });

  const marketReasons = buildMarketReasons(
    regimeReasons,
    { hardStale: freshness.hardStale, softStale: freshness.softStale },
    candles.length,
    config.suitability.minCandles
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    symbol: feed.symbol,
    source: feed.source,
    network: feed.network,
    poolAddress: feed.poolAddress,
    timeframe: feed.timeframe,
    regime,
    telemetry,
    clmmSuitability: suitability,
    marketReasons,
    freshness,
    metadata: {
      engineVersion,
      configVersion,
      candleCount: candles.length
    }
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the snapshot test**

Create `src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
import { MARKET_REGIME_CONFIG, MARKET_REGIME_CONFIG_VERSION } from "../config.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

const goldenCandles = Array.from({ length: 40 }, (_, i) => ({
  unixMs: (i + 1) * ONE_HOUR_MS,
  open: 100 + i * 0.1,
  high: 100.5 + i * 0.1,
  low: 99.5 + i * 0.1,
  close: 100 + i * 0.1 + 0.05,
  volume: 1 + i
}));

describe("buildRegimeCurrent snapshot", () => {
  it("produces identical response objects for fixed inputs", () => {
    const response = buildRegimeCurrent({
      feed: {
        symbol: "SOL/USDC",
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool111",
        timeframe: "1h"
      },
      candles: goldenCandles,
      nowUnixMs: 100 * ONE_HOUR_MS,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: MARKET_REGIME_CONFIG_VERSION,
      engineVersion: "0.1.0"
    });

    expect(response).toMatchSnapshot();
  });
});
```

- [ ] **Step 6: Run snapshot test (creates the golden file)**

Run: `npm run test -- src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts`
Expected: PASS (first run writes the snapshot).

- [ ] **Step 7: Run snapshot test again to confirm stability**

Run: `npm run test -- src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts`
Expected: PASS (matches previously written snapshot).

- [ ] **Step 8: Commit**

```bash
git add src/engine/marketRegime/buildRegimeCurrent.ts \
        src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts \
        src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts \
        src/engine/marketRegime/__tests__/__snapshots__/
git commit -m "feat(marketRegime): buildRegimeCurrent orchestrator + snapshot

Pure function: candles + nowUnixMs + config -> RegimeCurrentResponse.
Marketreasons emit DATA_FRESH/DATA_SOFT_STALE/DATA_HARD_STALE plus
DATA_SUFFICIENT_SAMPLES/DATA_INSUFFICIENT_SAMPLES alongside regime
reasons. Snapshot test pins object output for golden fixture."
```

---

## Phase 4 — HTTP handlers and routes

### Task 4.1: `POST /v1/candles` handler

**Files:**
- Test: `src/http/__tests__/candles.e2e.test.ts`
- Create: `src/http/handlers/candlesIngest.ts`

- [ ] **Step 1: Write the e2e test**

Create `src/http/__tests__/candles.e2e.test.ts`:

```ts
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getLedgerCounts } from "../../ledger/store.js";
import { createLedgerStore } from "../../ledger/store.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const createdDbPaths: string[] = [];

const makePayload = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "1h",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [
    { unixMs: ONE_HOUR_MS, open: 100, high: 110, low: 95, close: 105, volume: 1 }
  ],
  ...overrides
});

const tempDb = (): string => {
  const path = join(
    tmpdir(),
    `regime-engine-candles-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`
  );
  createdDbPaths.push(path);
  return path;
};

afterEach(() => {
  for (const p of createdDbPaths.splice(0)) {
    rmSync(p, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
  delete process.env.CANDLES_INGEST_TOKEN;
});

describe("POST /v1/candles", () => {
  it("returns 401 when token header is missing", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/candles", payload: makePayload() });
    expect(res.statusCode).toBe(401);
  });

  it("returns 500 when CANDLES_INGEST_TOKEN env is missing", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    const app = buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "anything" },
      payload: makePayload()
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe("SERVER_MISCONFIGURATION");
  });

  it("returns 200 with counts and rejections on happy path", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const res = await app.inject({
      method: "POST", url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload()
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.insertedCount).toBe(1);
    expect(body.rejections).toEqual([]);
  });

  it("returns 200 with rejectedCount > 0 when sending stale revisions", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    await app.inject({
      method: "POST", url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload({ sourceRecordedAtIso: "2026-04-26T13:00:00.000Z" })
    });

    const res = await app.inject({
      method: "POST", url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload({
        sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
        candles: [{ unixMs: ONE_HOUR_MS, open: 200, high: 210, low: 190, close: 205, volume: 1 }]
      })
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rejectedCount).toBeGreaterThan(0);
    expect(body.rejections.length).toBe(body.rejectedCount);
  });

  it("returns 400 BATCH_TOO_LARGE for >1000 candles", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const oversized = Array.from({ length: 1001 }, (_, i) => ({
      unixMs: (i + 1) * ONE_HOUR_MS,
      open: 100, high: 110, low: 90, close: 105, volume: 1
    }));

    const res = await app.inject({
      method: "POST", url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: makePayload({ candles: oversized })
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BATCH_TOO_LARGE");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/http/__tests__/candles.e2e.test.ts`
Expected: FAIL — handler not registered.

- [ ] **Step 3: Implement the handler**

Create `src/http/handlers/candlesIngest.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION, type CandleIngestResponse } from "../../contract/v1/types.js";
import { parseCandleIngestRequest } from "../../contract/v1/validation.js";
import type { LedgerStore } from "../../ledger/store.js";
import { writeCandles } from "../../ledger/candlesWriter.js";
import { AuthError, requireSharedSecret } from "../auth.js";
import { ContractValidationError } from "../errors.js";

export const createCandlesIngestHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-Candles-Ingest-Token", "CANDLES_INGEST_TOKEN");

      const body = parseCandleIngestRequest(request.body);
      const result = writeCandles(store, body, Date.now());

      const response: CandleIngestResponse = {
        schemaVersion: SCHEMA_VERSION,
        ...result
      };

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      throw error;
    }
  };
};
```

- [ ] **Step 4: Register the route**

Modify `src/http/routes.ts`. Add the import and route registration:

```ts
import { createCandlesIngestHandler } from "./handlers/candlesIngest.js";
// ...
app.post("/v1/candles", createCandlesIngestHandler(ledgerStore));
```

- [ ] **Step 5: Run e2e tests to verify they pass**

Run: `npm run test -- src/http/__tests__/candles.e2e.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, full suite**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/http/handlers/candlesIngest.ts \
        src/http/routes.ts \
        src/http/__tests__/candles.e2e.test.ts
git commit -m "feat(http): POST /v1/candles handler with token auth

Auth via X-Candles-Ingest-Token + CANDLES_INGEST_TOKEN. Validates the
payload, calls writeCandles, returns 200 with per-slot counts and
rejections. 4xx for validation, 401 for missing/bad token, 500 for
unset env."
```

### Task 4.2: `GET /v1/regime/current` handler

**Files:**
- Test: `src/http/__tests__/regimeCurrent.e2e.test.ts`
- Create: `src/http/handlers/regimeCurrent.ts`

- [ ] **Step 1: Write the e2e test**

Create `src/http/__tests__/regimeCurrent.e2e.test.ts`:

```ts
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createLedgerStore, getLedgerCounts } from "../../ledger/store.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const createdDbPaths: string[] = [];

const tempDb = (): string => {
  const path = join(
    tmpdir(),
    `regime-engine-regime-current-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`
  );
  createdDbPaths.push(path);
  return path;
};

// Anchor candles to "just before now" so freshness windows behave like prod.
// 40 hourly candles ending at the most recently aligned hour boundary.
const buildRecentCandles = (count: number) => {
  const lastClose = Math.floor(Date.now() / ONE_HOUR_MS) * ONE_HOUR_MS - ONE_HOUR_MS;
  return Array.from({ length: count }, (_, i) => ({
    unixMs: lastClose - (count - 1 - i) * ONE_HOUR_MS,
    open: 100, high: 100.5, low: 99.5, close: 100, volume: 1
  }));
};

const ingestPayload = (count: number, recordedIso: string) => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "1h",
  sourceRecordedAtIso: recordedIso,
  candles: buildRecentCandles(count)
});

afterEach(() => {
  for (const p of createdDbPaths.splice(0)) {
    rmSync(p, { force: true });
  }
  delete process.env.LEDGER_DB_PATH;
  delete process.env.CANDLES_INGEST_TOKEN;
});

const queryString =
  "?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=1h";

describe("GET /v1/regime/current", () => {
  it("returns 400 when a required selector is missing", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/regime/current?symbol=SOL%2FUSDC&source=birdeye"
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when timeframe is outside the allowlist", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    const app = buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/regime/current?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=4h"
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 CANDLES_NOT_FOUND when no candles exist for the slot", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("CANDLES_NOT_FOUND");
  });

  it("returns 200 ALLOWED for sufficient fresh CHOP candles", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const recordedIso = new Date().toISOString();
    await app.inject({
      method: "POST", url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: ingestPayload(40, recordedIso)
    });

    // Candles are anchored to the just-closed hour boundary so the GET handler's
    // `Date.now()` falls inside the freshness window. The success path (CHOP +
    // fresh + sufficient -> ALLOWED) should be reachable for the flat fixture.
    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schemaVersion).toBe("1.0");
    expect(body.symbol).toBe("SOL/USDC");
    expect(body.timeframe).toBe("1h");
    expect(body.regime).toBe("CHOP");
    expect(body.metadata.candleCount).toBeGreaterThan(0);
    expect(body.clmmSuitability.status).toBe("ALLOWED");
    expect(body.clmmSuitability.reasons.map((r: { code: string }) => r.code))
      .toEqual(["CLMM_ALLOWED_CHOP_FRESH"]);
  });

  it("does not write to the plan ledger when called repeatedly", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    await app.inject({
      method: "POST", url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: ingestPayload(40, new Date().toISOString())
    });

    // Open a separate read-only handle to the same SQLite file. SQLite
    // supports multiple concurrent connections; this avoids double-close on the
    // store buildApp() owns internally.
    const dbPath = process.env.LEDGER_DB_PATH!;
    const readStore = createLedgerStore(dbPath);
    const baseCounts = getLedgerCounts(readStore);
    readStore.close();

    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString}` });
      expect(res.statusCode).toBe(200);
    }

    const readStoreAfter = createLedgerStore(dbPath);
    const afterCounts = getLedgerCounts(readStoreAfter);
    readStoreAfter.close();

    expect(afterCounts.plans).toBe(baseCounts.plans);
    expect(afterCounts.planRequests).toBe(baseCounts.planRequests);
    expect(afterCounts.executionResults).toBe(baseCounts.executionResults);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/http/__tests__/regimeCurrent.e2e.test.ts`
Expected: FAIL — handler not registered.

- [ ] **Step 3: Implement the handler**

Create `src/http/handlers/regimeCurrent.ts`:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { parseRegimeCurrentQuery } from "../../contract/v1/validation.js";
import {
  candlesNotFoundError,
  ContractValidationError
} from "../errors.js";
import type { LedgerStore } from "../../ledger/store.js";
import { getLatestCandlesForFeed } from "../../ledger/candlesWriter.js";
import {
  MARKET_REGIME_CONFIG,
  MARKET_REGIME_CONFIG_VERSION
} from "../../engine/marketRegime/config.js";
import { closedCandleCutoffUnixMs } from "../../engine/marketRegime/closedCandleCutoff.js";
import { buildRegimeCurrent } from "../../engine/marketRegime/buildRegimeCurrent.js";

const READ_BUFFER = 50;

export const createRegimeCurrentHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = parseRegimeCurrentQuery(request.query);
      const config = MARKET_REGIME_CONFIG[query.timeframe];

      const nowUnixMs = Date.now();
      const cutoff = closedCandleCutoffUnixMs(
        nowUnixMs,
        config.timeframeMs,
        config.freshness.closedCandleDelayMs
      );
      const limit = Math.max(config.indicators.volLongWindow, config.suitability.minCandles)
        + READ_BUFFER;

      const candles = getLatestCandlesForFeed(store, {
        symbol: query.symbol,
        source: query.source,
        network: query.network,
        poolAddress: query.poolAddress,
        timeframe: query.timeframe,
        closedCandleCutoffUnixMs: cutoff,
        limit
      });

      if (candles.length === 0) {
        throw candlesNotFoundError(
          `No closed candles found for symbol="${query.symbol}", source="${query.source}", ` +
          `network="${query.network}", poolAddress="${query.poolAddress}", ` +
          `timeframe="${query.timeframe}".`
        );
      }

      const response = buildRegimeCurrent({
        feed: {
          symbol: query.symbol,
          source: query.source,
          network: query.network,
          poolAddress: query.poolAddress,
          timeframe: query.timeframe
        },
        candles,
        nowUnixMs,
        config,
        configVersion: MARKET_REGIME_CONFIG_VERSION,
        engineVersion: process.env.npm_package_version ?? "0.0.0"
      });

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      throw error;
    }
  };
};
```

- [ ] **Step 4: Register the route**

Modify `src/http/routes.ts`. Add the import and route registration:

```ts
import { createRegimeCurrentHandler } from "./handlers/regimeCurrent.js";
// ...
app.get("/v1/regime/current", createRegimeCurrentHandler(ledgerStore));
```

- [ ] **Step 5: Run e2e tests to verify they pass**

Run: `npm run test -- src/http/__tests__/regimeCurrent.e2e.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, full suite**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/http/handlers/regimeCurrent.ts \
        src/http/routes.ts \
        src/http/__tests__/regimeCurrent.e2e.test.ts
git commit -m "feat(http): GET /v1/regime/current handler

Reads now once at the boundary, computes closed-candle cutoff, queries
latest revisions per slot, runs buildRegimeCurrent. 200 on success,
404 CANDLES_NOT_FOUND when zero closed candles, 400 VALIDATION_ERROR
on missing/invalid selectors. Asserts no plan-ledger writes via
getLedgerCounts."
```

---

## Phase 5 — OpenAPI and smoke tests

### Task 5.1: Document both new paths in OpenAPI

**Files:**
- Modify: `src/http/openapi.ts`

- [ ] **Step 1: Add `POST /v1/candles` and `GET /v1/regime/current` paths**

Edit `src/http/openapi.ts`. Inside the `paths` object, after the existing entries, add:

```ts
"/v1/candles": {
  post: {
    summary: "Ingest candle revisions for a logical feed",
    responses: {
      "200": { description: "Per-slot insert/revise/idempotent/reject counts" },
      "400": { description: "Validation error (BATCH_TOO_LARGE, MALFORMED_CANDLE, DUPLICATE_CANDLE_IN_BATCH, VALIDATION_ERROR, UNSUPPORTED_SCHEMA_VERSION)" },
      "401": { description: "Missing or invalid X-Candles-Ingest-Token" },
      "500": { description: "CANDLES_INGEST_TOKEN environment variable not set" }
    }
  }
},
"/v1/regime/current": {
  get: {
    summary: "Market-only regime classification + CLMM suitability for a feed",
    parameters: [
      { name: "symbol", in: "query", required: true, schema: { type: "string" } },
      { name: "source", in: "query", required: true, schema: { type: "string" } },
      { name: "network", in: "query", required: true, schema: { type: "string" } },
      { name: "poolAddress", in: "query", required: true, schema: { type: "string" } },
      { name: "timeframe", in: "query", required: true, schema: { type: "string", enum: ["1h"] } }
    ],
    responses: {
      "200": { description: "RegimeCurrentResponse with regime, telemetry, suitability, freshness, metadata" },
      "400": { description: "VALIDATION_ERROR for missing/invalid selectors" },
      "404": { description: "CANDLES_NOT_FOUND when no closed candles exist for the feed" }
    }
  }
}
```

> **OpenAPI schema-ref consistency check:** Before writing this, run `grep -n "components" src/http/openapi.ts` and `grep -n "requestBody\|content" src/http/openapi.ts`. If the existing OpenAPI document already inlines schemas under `components.schemas` and references them via `$ref`, mirror that pattern for `CandleIngestRequest`, `CandleIngestResponse`, and `RegimeCurrentResponse`. If the existing document is description-only prose (as the spec excerpts suggest), the prose-only entries above are consistent. **Do not unilaterally introduce a new schema-ref pattern** — match what is already there.

- [ ] **Step 2: Update existing routes contract test**

Open `src/http/__tests__/routes.contract.test.ts`. Add assertions that both new paths appear:

```ts
it("OpenAPI document advertises POST /v1/candles", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
  expect(res.statusCode).toBe(200);
  const doc = res.json();
  expect(doc.paths["/v1/candles"]).toBeDefined();
  expect(doc.paths["/v1/candles"].post).toBeDefined();
});

it("OpenAPI document advertises GET /v1/regime/current", async () => {
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
  expect(res.statusCode).toBe(200);
  const doc = res.json();
  expect(doc.paths["/v1/regime/current"]).toBeDefined();
  expect(doc.paths["/v1/regime/current"].get.parameters.length).toBe(5);
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test -- src/http/__tests__/routes.contract.test.ts`
Expected: PASS.

- [ ] **Step 4: Run full test suite + lint + typecheck + build**

Run: `npm run typecheck && npm run test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/http/openapi.ts src/http/__tests__/routes.contract.test.ts
git commit -m "feat(openapi): document POST /v1/candles and GET /v1/regime/current

Includes path summaries, response codes, and the five required query
parameters for the regime read."
```

---

## Phase 6 — README and Railway env docs

### Task 6.1: Document new endpoints and env var in README

**Files:**
- Modify: `README.md`
- Modify: `docs/runbooks/2026-04-railway-deploy.md` (if it exists)

- [ ] **Step 1: Locate the env-var section in README**

Run: `grep -n "OPENCLAW_INGEST_TOKEN\|CLMM_INTERNAL_TOKEN" README.md`

- [ ] **Step 2: Add `CANDLES_INGEST_TOKEN` to the same section**

Add a row/entry mirroring the existing token documentation, e.g.:

```markdown
- `CANDLES_INGEST_TOKEN` — required for `POST /v1/candles`. Sent by the candle
  collector via `X-Candles-Ingest-Token`. Compared with `timingSafeEqual`.
  Missing env returns 500 only on the candle ingest route — service boot and
  read routes are unaffected.
```

- [ ] **Step 3: Document the new endpoints in the API surface section**

Add to the README's endpoint listing:

```markdown
- `POST /v1/candles` — ingest candle revisions for a logical feed
  (`source + network + poolAddress + symbol + timeframe`). Append-only,
  per-slot decision tree (insert / idempotent / revise / reject). Token-guarded
  by `X-Candles-Ingest-Token` / `CANDLES_INGEST_TOKEN`.
- `GET /v1/regime/current?symbol=&source=&network=&poolAddress=&timeframe=1h` —
  market-only regime classification + CLMM suitability. Stateless: no
  `RegimeState`, no portfolio/autopilot inputs, no plan-ledger writes.
```

- [ ] **Step 4: Update Railway runbook if present**

Run: `ls docs/runbooks/`. If a Railway env-vars runbook exists, append `CANDLES_INGEST_TOKEN` to its required-env-vars table or prose.

- [ ] **Step 5: Verify**

Run: `npm run format`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/runbooks/
git commit -m "docs: document /v1/candles, /v1/regime/current, CANDLES_INGEST_TOKEN

README and Railway runbook list the new endpoints and the dedicated
ingest token. Read route remains public; write route is token-guarded."
```

---

## Final verification

- [ ] **Run the full quality gate from AGENTS.md**

Run: `npm run typecheck && npm run test && npm run lint && npm run build`
Expected: PASS on all four.

- [ ] **Verify no plan-ledger writes from the GET route**

This is asserted by the test in Task 4.2 step 1, but verify manually:

Run: `npm run test -- src/http/__tests__/regimeCurrent.e2e.test.ts -t "does not write"`
Expected: PASS.

- [ ] **Verify acceptance criteria from issue #17**

Walk through the issue checklist (`gh api repos/opsclawd/regime-engine/issues/17 --jq '.body'`) and confirm each item maps to a passing test in this plan.

- [ ] **Confirm append-only invariant preserved**

The `candle_revisions` table contains no `UPDATE` statements anywhere in `src/`. Verify:

Run: `grep -rn "UPDATE candle_revisions\|DELETE FROM candle_revisions" src/`
Expected: zero matches.

---

## Notes for the implementer

- **Determinism rule:** the engine modules under `src/engine/marketRegime/` must not call `Date.now()` directly. Time enters via the `nowUnixMs` parameter in `buildRegimeCurrent` and is read once in `regimeCurrent.ts:Date.now()`. Other reads of the wall clock are bugs.
- **OHLCV canonical JSON is just `{open,high,low,close,volume}`,** not the full request envelope. We hash only the OHLCV tuple so revisions of the same logical bar from different `sourceRecordedAtIso` values can be byte-equal-detected.
- **`UNSUPPORTED_SCHEMA_VERSION`** is the existing constant name. Tests must assert that exact string. Do not rename.
- **Snapshot test stability:** `buildRegimeCurrent.snapshot.test.ts` will need a refresh whenever a config value, reason message, or response field changes. That refresh is the right friction — review snapshot diffs in PR review.
- **Frequent commits:** every task ends with a commit. Do not batch.
