# Gecko 15m Candle Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch canonical provider candle ingestion and the temporary regime read path from `1h` to `15m` end-to-end (contract types, validation, market-regime config, GeckoTerminal URL, normalization, OpenAPI/docs), as a breaking consumer contract change tracked alongside follow-up #42.

**Architecture:** Introduce two domain-specific timeframe types (`CandleIngestTimeframe`, `RegimeReadTimeframe`) — both literally `"15m"` in #41 — and retire the shared `SupportedTimeframe`. Validate ingest payloads against a 15-minute alignment map; retune `MARKET_REGIME_CONFIG` for 15m bars (fresh-window roughly preserved); rewrite the GeckoTerminal URL to `/ohlcv/minute?aggregate=15&include_empty_intervals=true`. The candle store schema is unchanged (timeframe is part of the feed identity string). `buildRegimeCurrent` stays source-agnostic; the handler tells it which timeframe identity to report.

**Tech Stack:** TypeScript (Node 22, ESM, NodeNext resolution), Fastify, Zod, vitest, Drizzle (Postgres), better-sqlite3 (SQLite). pnpm workspace; tests run via `pnpm test`.

---

## Pre-flight

- [ ] **Step 0: Confirm a clean working tree on `main` (or working branch)**

Run:

```bash
git status
git log -1 --oneline
```

Expected: working tree clean (or only this plan file unstaged), HEAD on a sensible base. The most recent design commit on this branch is `bac5941 m41: design 15m candle ingestion migration`; this plan implements that design.

- [ ] **Step 1: Run the existing test suite to confirm a green baseline**

Run:

```bash
pnpm test
```

Expected: all tests pass on the current `1h` codebase. If any are red, stop and surface the failure before changing anything.

---

## File Map

Existing files modified:

- `src/contract/v1/types.ts` — add new timeframe types, retire `SupportedTimeframe` from candle/regime types.
- `src/contract/v1/validation.ts` — split allowlists, 15m alignment map, reject `1h` on ingest and regime-current query.
- `src/engine/marketRegime/config.ts` — replace 1h config with 15m config (retuned thresholds, freshness windows).
- `src/engine/marketRegime/buildRegimeCurrent.ts` — `feed.timeframe` typed `"15m"`.
- `src/http/handlers/regimeCurrent.ts` — uses validated 15m timeframe (no behavior change beyond type).
- `src/workers/gecko/config.ts` — accept/default `GECKO_TIMEFRAME=15m`, default `GECKO_POLL_INTERVAL_MS=60000`, reject other timeframes.
- `src/workers/gecko/geckoClient.ts` — request `/ohlcv/minute?aggregate=15&include_empty_intervals=true&limit={lookback}`; throw before request for unsupported timeframes.
- `src/workers/gecko/normalize.ts` — `15m`-only timeframe map; `ProtocolError` for unsupported timeframes; no 1h fallback.
- `src/http/openapi.ts` — `/v1/regime/current` `timeframe` enum becomes `["15m"]`; `/v1/candles` description note.
- `README.md` — collector + endpoint docs reference `15m`; mark #41 as breaking until #42.
- `.env.example` — `GECKO_TIMEFRAME=15m`, `GECKO_POLL_INTERVAL_MS=60000`.
- `docs/runbooks/railway-deploy.md` — `15m` env table values + preflight curl uses `/ohlcv/minute?aggregate=15`.

Existing tests modified:

- `src/contract/v1/__tests__/candles.validation.test.ts` — fixture uses `15m`; new failing-then-passing cases for 15m alignment and `1h` rejection.
- `src/contract/v1/__tests__/regimeCurrent.validation.test.ts` — accept `15m`, reject `1h`.
- `src/workers/gecko/__tests__/config.test.ts` — defaults updated; reject `1h`; assert `60000` poll default.
- `src/workers/gecko/__tests__/geckoClient.test.ts` — assert `/ohlcv/minute`, `aggregate=15`, `include_empty_intervals=true`, `limit=200`; expect throw for unsupported timeframe before fetch.
- `src/workers/gecko/__tests__/normalize.test.ts` — accept 15m-aligned timestamps, drop misaligned, throw `ProtocolError` for unsupported timeframe; remove implicit 1h fallback.
- `src/workers/gecko/__tests__/ingestClient.test.ts` — fixture switches `geckoTimeframe` to `"15m"`.
- `src/workers/__tests__/geckoCollector.test.ts` — fixture switches `geckoTimeframe` to `"15m"`.
- `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts` — fixture builds 15m candles, asserts 15m identity, freshness windows updated to 15m thresholds.
- `src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts` — `feed.timeframe = "15m"`, snapshot regenerated.
- `src/http/__tests__/candles.e2e.test.ts` — payloads use `timeframe: "15m"`, candle `unixMs` aligned to 15-minute boundary.
- `src/http/__tests__/regimeCurrent.e2e.test.ts` — payloads + query string use `timeframe=15m`; reject test uses a different unsupported timeframe (e.g. `1h`).
- `src/http/__tests__/candleFallback.e2e.test.ts` — payload + query use `timeframe=15m`.
- `src/ledger/__tests__/candlesWriter.test.ts` — `CandleIngestRequest` fixtures use `"15m"`.
- `src/ledger/__tests__/candleStore.test.ts` — `CandleIngestRequest` fixtures use `"15m"`.

Files **not** changed:

- `src/contract/v1/__tests__/validation.test.ts` (the `PlanRequest.market.timeframe` field is typed `string`, not `SupportedTimeframe`).
- `src/ledger/store.ts`, `src/ledger/candlesWriter.ts`, `src/ledger/candleStore.ts`, Drizzle/SQLite schemas — feed identity already includes timeframe as a string; no migration.
- `src/engine/marketRegime/closedCandleCutoff.ts`, `src/engine/marketRegime/freshness.ts` — pure functions of input config, unchanged.

---

## Task Sequencing

The handler types and the market-regime config are coupled: changing `feed.timeframe` to `"15m"` in `buildRegimeCurrent` requires `MARKET_REGIME_CONFIG["15m"]` to exist. Run tasks in order; do not start Task 4 before Task 3 lands.

---

### Task 1: Add `CandleIngestTimeframe` and `RegimeReadTimeframe` types; retire `SupportedTimeframe`

**Files:**

- Modify: `src/contract/v1/types.ts:222-332`

- [ ] **Step 1: Edit `src/contract/v1/types.ts` to add new timeframe types**

Replace the existing `SupportedTimeframe` declaration and its three usages.

Find the existing block:

```ts
export type SupportedTimeframe = "1h";
```

Replace with:

```ts
export type CandleIngestTimeframe = "15m";
export type RegimeReadTimeframe = "15m";
```

Then update three downstream interface fields in the same file:

- `CandleIngestRequest.timeframe`: `SupportedTimeframe` → `CandleIngestTimeframe`
- `RegimeCurrentResponse.timeframe`: `SupportedTimeframe` → `RegimeReadTimeframe`
- `RegimeCurrentQuery.timeframe`: `SupportedTimeframe` → `RegimeReadTimeframe`

After this edit, `SupportedTimeframe` should not exist anywhere in `src/`.

- [ ] **Step 2: Verify no references remain**

Run:

```bash
grep -rn "SupportedTimeframe" src/
```

Expected: no output (zero matches). If any consumer still imports it, switch the import to whichever of the new types matches its usage:

- ingest contract path → `CandleIngestTimeframe`
- regime-current query/response path → `RegimeReadTimeframe`

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS. Type errors at this point will come from validation.ts (still says `SUPPORTED_TIMEFRAMES = ["1h"]` and casts to `"1h"`). Those will be fixed in Task 2 — if typecheck fails _only_ on `src/contract/v1/validation.ts` and the regime-current handler (`src/http/handlers/regimeCurrent.ts`), that is expected. Anywhere else, fix the import before continuing.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/contract/v1/types.ts
git commit -m "refactor(contract): split timeframe types for ingest vs regime read"
```

---

### Task 2: Update contract validation — separate allowlists, 15m alignment, reject `1h`

**Files:**

- Modify: `src/contract/v1/validation.ts:279-432`
- Test: `src/contract/v1/__tests__/candles.validation.test.ts`
- Test: `src/contract/v1/__tests__/regimeCurrent.validation.test.ts`

- [ ] **Step 1: Update the candle ingest test fixture to use `15m`**

Edit `src/contract/v1/__tests__/candles.validation.test.ts`. Replace the file's header constants and `makeBody` so that:

- `ONE_HOUR_MS` is replaced by `FIFTEEN_MIN_MS = 15 * 60 * 1000`.
- `makeBody` defaults `timeframe: "15m"` and the candle `unixMs` to `FIFTEEN_MIN_MS`.

Resulting top-of-file (replace lines 1–26):

```ts
import { describe, expect, it } from "vitest";
import { parseCandleIngestRequest } from "../validation.js";
import { ContractValidationError } from "../../../http/errors.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const makeBody = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool1111111111111111111111111111111111111111",
  symbol: "SOL/USDC",
  timeframe: "15m",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [
    {
      unixMs: FIFTEEN_MIN_MS,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000
    }
  ],
  ...overrides
});
```

Also rewrite the existing test cases:

1. `"accepts a minimal valid 1-candle batch"` → assert `result.timeframe === "15m"`.
2. `"rejects unsupported timeframe with VALIDATION_ERROR"` → keep the `5m` example.
3. `"rejects unixMs not aligned to timeframeMs with MALFORMED_CANDLE"` → use `unixMs: FIFTEEN_MIN_MS + 1`.
4. The `"rejects 1001-candle batch"` and `"rejects duplicate unixMs"` cases must walk by `FIFTEEN_MIN_MS` (replace `(i + 1) * ONE_HOUR_MS` with `(i + 1) * FIFTEEN_MIN_MS`, and `ONE_HOUR_MS` with `FIFTEEN_MIN_MS`).
5. The OHLCV malformed cases keep their structure, but change `unixMs: ONE_HOUR_MS` to `unixMs: FIFTEEN_MIN_MS`.

Add two **new** test cases at the end of the `describe` block:

```ts
it("rejects timeframe: '1h' until #42", () => {
  expect.assertions(1);
  try {
    parseCandleIngestRequest(makeBody({ timeframe: "1h" }));
  } catch (error) {
    expect((error as ContractValidationError).response.error.code).toBe("VALIDATION_ERROR");
  }
});

it("rejects 15m candle whose unixMs is aligned to the hour but not to the 15m boundary", () => {
  expect.assertions(1);
  try {
    parseCandleIngestRequest(
      makeBody({
        candles: [
          {
            unixMs: FIFTEEN_MIN_MS + 5 * 60 * 1000,
            open: 100,
            high: 110,
            low: 95,
            close: 105,
            volume: 1
          }
        ]
      })
    );
  } catch (error) {
    expect((error as ContractValidationError).response.error.code).toBe("MALFORMED_CANDLE");
  }
});
```

- [ ] **Step 2: Run candle validation tests to verify they fail**

Run:

```bash
pnpm vitest run src/contract/v1/__tests__/candles.validation.test.ts
```

Expected: FAIL. The accept-valid case fails because `SUPPORTED_TIMEFRAMES = ["1h"]` rejects `"15m"`; the reject-`1h` case fails because the parser still accepts `"1h"`.

- [ ] **Step 3: Update the regime-current query test fixture**

Edit `src/contract/v1/__tests__/regimeCurrent.validation.test.ts`. Replace lines 5–11 and the assertions on lines 16, 33–40 so:

- `baseQuery.timeframe = "15m"`.
- `expect(result.timeframe).toBe("15m")`.
- The `"rejects timeframe outside allowlist"` test passes `timeframe: "1h"` (instead of `"4h"`) and expects `"VALIDATION_ERROR"`.

Final shape of the file:

```ts
import { describe, expect, it } from "vitest";
import { parseRegimeCurrentQuery } from "../validation.js";
import { ContractValidationError } from "../../../http/errors.js";

const baseQuery = {
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool11111111111111111111111111111111111111",
  timeframe: "15m"
};

describe("parseRegimeCurrentQuery", () => {
  it("accepts the five required selectors", () => {
    const result = parseRegimeCurrentQuery(baseQuery);
    expect(result.timeframe).toBe("15m");
  });

  it.each([["symbol"], ["source"], ["network"], ["poolAddress"], ["timeframe"]])(
    "rejects missing %s with VALIDATION_ERROR",
    (key) => {
      const query = { ...baseQuery } as Record<string, string>;
      delete query[key];
      expect.assertions(1);
      try {
        parseRegimeCurrentQuery(query);
      } catch (error) {
        expect((error as ContractValidationError).response.error.code).toBe("VALIDATION_ERROR");
      }
    }
  );

  it("rejects timeframe=1h until #42", () => {
    expect.assertions(1);
    try {
      parseRegimeCurrentQuery({ ...baseQuery, timeframe: "1h" });
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects array values from query parsers with VALIDATION_ERROR", () => {
    expect.assertions(1);
    try {
      parseRegimeCurrentQuery({ ...baseQuery, symbol: ["SOL/USDC", "x"] });
    } catch (error) {
      expect((error as ContractValidationError).response.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
```

- [ ] **Step 4: Run regime-current validation tests to verify they fail**

Run:

```bash
pnpm vitest run src/contract/v1/__tests__/regimeCurrent.validation.test.ts
```

Expected: FAIL on the accept and reject-`1h` cases (parser still allows only `"1h"`).

- [ ] **Step 5: Implement the validation changes**

Edit `src/contract/v1/validation.ts`. Update three regions.

a) Imports (top of file): add `CandleIngestTimeframe` to the type-import list:

```ts
import {
  SCHEMA_VERSION,
  type CandleIngestRequest,
  type CandleIngestTimeframe,
  type ClmmExecutionEventRequest,
  type ExecutionResultRequest,
  type PlanRequest,
  type SrLevelBriefRequest
} from "./types.js";
```

b) Replace the existing block (lines 279–306):

```ts
const SUPPORTED_TIMEFRAMES = ["1h"] as const;
const TIMEFRAME_TO_MS: Record<(typeof SUPPORTED_TIMEFRAMES)[number], number> = {
  "1h": 60 * 60 * 1000
};

const candleIngestCandleSchema = z
  .object({
    unixMs: z.number().int().nonnegative(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number()
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
```

with:

```ts
const CANDLE_INGEST_TIMEFRAMES = ["15m"] as const;
const REGIME_READ_TIMEFRAMES = ["15m"] as const;

const CANDLE_INGEST_TIMEFRAME_TO_MS: Record<CandleIngestTimeframe, number> = {
  "15m": 15 * 60 * 1000
};

const candleIngestCandleSchema = z
  .object({
    unixMs: z.number().int().nonnegative(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number()
  })
  .strict();

const candleIngestRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    source: z.string().min(1),
    network: z.string().min(1),
    poolAddress: z.string().min(1),
    symbol: z.string().min(1),
    timeframe: z.enum(CANDLE_INGEST_TIMEFRAMES),
    sourceRecordedAtIso: z.string().datetime(),
    candles: z.array(candleIngestCandleSchema).min(1)
  })
  .strict();
```

c) Update the `validateOhlcvInvariants` call inside `parseCandleIngestRequest` (line 400) to use the new map:

```ts
validateOhlcvInvariants(parsed.candles, CANDLE_INGEST_TIMEFRAME_TO_MS[parsed.timeframe]);
```

d) Replace the regime-current query block (lines 405–432):

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

export const parseRegimeCurrentQuery = (
  raw: unknown
): {
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

with:

```ts
const regimeCurrentQuerySchema = z
  .object({
    symbol: z.string().min(1),
    source: z.string().min(1),
    network: z.string().min(1),
    poolAddress: z.string().min(1),
    timeframe: z.enum(REGIME_READ_TIMEFRAMES)
  })
  .strict();

export const parseRegimeCurrentQuery = (
  raw: unknown
): {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: "15m";
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

- [ ] **Step 6: Run both validation suites to verify they pass**

Run:

```bash
pnpm vitest run src/contract/v1/__tests__/candles.validation.test.ts src/contract/v1/__tests__/regimeCurrent.validation.test.ts
```

Expected: PASS for both files. If any other validation test elsewhere fails, that's expected from coupling — leave it for the dedicated tasks below.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/contract/v1/validation.ts src/contract/v1/__tests__/candles.validation.test.ts src/contract/v1/__tests__/regimeCurrent.validation.test.ts
git commit -m "feat(contract): require 15m for /v1/candles and /v1/regime/current"
```

---

### Task 3: Retune `MARKET_REGIME_CONFIG` to 15m

**Files:**

- Modify: `src/engine/marketRegime/config.ts`

- [ ] **Step 1: Replace the entire contents of `src/engine/marketRegime/config.ts`**

```ts
export const MARKET_REGIME_CONFIG_VERSION = "market-regime-1.0.0" as const;

export interface MarketTimeframeConfig {
  timeframe: "15m";
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

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const MARKET_REGIME_CONFIG: Record<"15m", MarketTimeframeConfig> = {
  "15m": {
    timeframe: "15m",
    timeframeMs: FIFTEEN_MINUTES_MS,
    indicators: {
      volShortWindow: 32,
      volLongWindow: 84,
      trendWindow: 56,
      compressionWindow: 80
    },
    regime: {
      confirmBars: 2,
      minHoldBars: 0,
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },
    suitability: {
      allowedVolRatioMax: 1.3,
      extremeVolRatio: 1.6,
      extremeCompression: 0.18,
      minCandles: 120
    },
    freshness: {
      closedCandleDelayMs: 2 * 60 * 1000,
      softStaleMs: 25 * 60 * 1000,
      hardStaleMs: 35 * 60 * 1000
    }
  }
};
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS for `config.ts`. The handler (`src/http/handlers/regimeCurrent.ts`) and `buildRegimeCurrent` indices into `MARKET_REGIME_CONFIG[query.timeframe]` — `query.timeframe` is now `"15m"` (Task 2), so this should typecheck. If it fails, the failure must be in `buildRegimeCurrent.ts` because `feed.timeframe` is still typed `"1h"` — that's Task 4. Other type errors must be resolved before continuing.

- [ ] **Step 3: Commit**

Run:

```bash
git add src/engine/marketRegime/config.ts
git commit -m "feat(market-regime): retune config for 15m bars"
```

---

### Task 4: Update `buildRegimeCurrent` for 15m + regenerate snapshot

**Files:**

- Modify: `src/engine/marketRegime/buildRegimeCurrent.ts:9-22`
- Modify: `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`
- Modify: `src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts`
- Modify: `src/engine/marketRegime/__tests__/__snapshots__/buildRegimeCurrent.snapshot.test.ts.snap` (auto-regenerated)

- [ ] **Step 1: Update `buildRegimeCurrent.ts` feed type**

In `src/engine/marketRegime/buildRegimeCurrent.ts`, change:

```ts
feed: {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: "1h";
}
```

to:

```ts
feed: {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: "15m";
}
```

No other changes in this file — the function body is timeframe-agnostic.

- [ ] **Step 2: Rewrite the unit test fixture for 15m**

Edit `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`. Three things change: bar size, count (must be ≥ `minCandles=120`), staleness window, and feed timeframe.

Replace the file's contents with:

```ts
import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
import { MARKET_REGIME_CONFIG } from "../config.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const flatCandles = Array.from({ length: 130 }, (_, i) => ({
  unixMs: (i + 1) * FIFTEEN_MIN_MS,
  open: 100,
  high: 100.5,
  low: 99.5,
  close: 100,
  volume: 1
}));

const feed = {
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  timeframe: "15m" as const
};

describe("buildRegimeCurrent", () => {
  it("classifies CHOP and emits ALLOWED for flat candles + fresh data", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const nowUnixMs = lastCandleUnixMs + 5 * 60 * 1000;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });

    expect(response.regime).toBe("CHOP");
    expect(response.clmmSuitability.status).toBe("ALLOWED");
    expect(response.metadata.candleCount).toBe(130);
    expect(response.metadata.engineVersion).toBe("0.1.0");
    expect(response.metadata.configVersion).toBe("market-regime-1.0.0");
    expect(response.symbol).toBe("SOL/USDC");
    expect(response.timeframe).toBe("15m");
  });

  it("returns UNKNOWN when candleCount < minCandles even for fresh data", () => {
    const fewCandles = flatCandles.slice(0, 5);
    const lastCandleUnixMs = fewCandles[fewCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed,
      candles: fewCandles,
      nowUnixMs: lastCandleUnixMs + 5 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });
    expect(response.clmmSuitability.status).toBe("UNKNOWN");
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_INSUFFICIENT_SAMPLES");
  });

  it("returns UNKNOWN when freshness is hardStale", () => {
    const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs: lastCandleUnixMs + 36 * 60 * 1000,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-1.0.0",
      engineVersion: "0.1.0"
    });
    expect(response.clmmSuitability.status).toBe("UNKNOWN");
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_HARD_STALE");
  });
});
```

The `36 * 60 * 1000` mark just exceeds the new `hardStaleMs = 35 * 60 * 1000`. The `5 * 60 * 1000` mark is well below `softStaleMs = 25 * 60 * 1000`.

- [ ] **Step 3: Rewrite the snapshot test for 15m**

Edit `src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRegimeCurrent } from "../buildRegimeCurrent.js";
import { MARKET_REGIME_CONFIG, MARKET_REGIME_CONFIG_VERSION } from "../config.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const goldenCandles = Array.from({ length: 130 }, (_, i) => ({
  unixMs: (i + 1) * FIFTEEN_MIN_MS,
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
        timeframe: "15m"
      },
      candles: goldenCandles,
      nowUnixMs: 200 * FIFTEEN_MIN_MS,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: MARKET_REGIME_CONFIG_VERSION,
      engineVersion: "0.1.0"
    });

    expect(response).toMatchSnapshot();
  });
});
```

- [ ] **Step 4: Delete the stale snapshot file so vitest regenerates it**

Run:

```bash
rm src/engine/marketRegime/__tests__/__snapshots__/buildRegimeCurrent.snapshot.test.ts.snap
```

This is intentional — the previous snapshot encodes 1h timeframe values and 1h freshness windows. Regenerating from the 15m fixture is the goal.

- [ ] **Step 5: Run the marketRegime tests to verify and write a fresh snapshot**

Run:

```bash
pnpm vitest run src/engine/marketRegime/__tests__/
```

Expected: PASS, with one snapshot written. Inspect the new snapshot file briefly with `git diff -- src/engine/marketRegime/__tests__/__snapshots__/` and confirm `"timeframe": "15m"` and the `freshness` numbers reflect 15m thresholds (`softStaleSeconds: 1500`, `hardStaleSeconds: 2100`).

- [ ] **Step 6: Commit**

Run:

```bash
git add src/engine/marketRegime/buildRegimeCurrent.ts src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts src/engine/marketRegime/__tests__/__snapshots__/buildRegimeCurrent.snapshot.test.ts.snap
git commit -m "feat(market-regime): switch buildRegimeCurrent feed identity to 15m"
```

---

### Task 5: Update HTTP handler e2e tests for 15m

**Files:**

- Modify: `src/http/__tests__/regimeCurrent.e2e.test.ts`
- Modify: `src/http/__tests__/candleFallback.e2e.test.ts`
- Modify: `src/http/__tests__/candles.e2e.test.ts`

The handler `src/http/handlers/regimeCurrent.ts` does not need code changes — it derives everything from the validated query and `MARKET_REGIME_CONFIG[query.timeframe]`, both of which are now `"15m"`-typed.

- [ ] **Step 1: Update `regimeCurrent.e2e.test.ts`**

Replace constants and payloads:

- `const ONE_HOUR_MS = 60 * 60 * 1000;` → `const FIFTEEN_MIN_MS = 15 * 60 * 1000;`
- In `buildRecentCandles`: anchor on `Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - 2 * FIFTEEN_MIN_MS`, step by `FIFTEEN_MIN_MS`.
- In `ingestPayload`: `timeframe: "15m"`.
- The shared `queryString` becomes `"?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=15m"`.
- The "outside the allowlist" test passes `timeframe=1h` (instead of `4h`) and still expects 400.
- Bump the happy-path candle count to 130 (≥ `minCandles=120`).

Final replacement for the file (one place; copy verbatim):

```ts
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { createLedgerStore, getLedgerCounts } from "../../ledger/store.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const createdDbPaths: string[] = [];

const tempDb = (): string => {
  const path = join(
    tmpdir(),
    `regime-engine-regime-current-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sqlite`
  );
  createdDbPaths.push(path);
  return path;
};

const buildRecentCandles = (count: number) => {
  const anchor = Math.floor(Date.now() / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS - 2 * FIFTEEN_MIN_MS;
  return Array.from({ length: count }, (_, i) => ({
    unixMs: anchor - (count - 1 - i) * FIFTEEN_MIN_MS,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 1
  }));
};

const ingestPayload = (count: number, recordedIso: string) => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "15m",
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
  "?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=15m";

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
      url: "/v1/regime/current?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=1h"
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

  it("returns 200 with regime and suitability fields for sufficient CHOP candles", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    const recordedIso = new Date().toISOString();
    await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: ingestPayload(130, recordedIso)
    });

    const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.schemaVersion).toBe("1.0");
    expect(body.symbol).toBe("SOL/USDC");
    expect(body.timeframe).toBe("15m");
    expect(["UP", "DOWN", "CHOP"]).toContain(body.regime);
    expect(body.metadata.candleCount).toBeGreaterThan(0);
    expect(["ALLOWED", "CAUTION", "BLOCKED", "UNKNOWN"]).toContain(body.clmmSuitability.status);
    expect(Array.isArray(body.clmmSuitability.reasons)).toBe(true);
    expect(Array.isArray(body.marketReasons)).toBe(true);
    expect(body.freshness).toBeDefined();
    expect(body.telemetry).toBeDefined();
  });

  it("does not write to the plan ledger when called repeatedly", async () => {
    process.env.LEDGER_DB_PATH = tempDb();
    process.env.CANDLES_INGEST_TOKEN = "test-token";
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/candles",
      headers: { "X-Candles-Ingest-Token": "test-token" },
      payload: ingestPayload(130, new Date().toISOString())
    });

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

- [ ] **Step 2: Update `candleFallback.e2e.test.ts`**

Apply three substitutions in this file:

- `const ONE_HOUR_MS = 60 * 60 * 1000;` → `const FIFTEEN_MIN_MS = 15 * 60 * 1000;`
- `timeframe: "1h"` → `timeframe: "15m"` (in `makePayload`).
- `unixMs: ONE_HOUR_MS` → `unixMs: FIFTEEN_MIN_MS` (in the candle entry).
- The query string `?...&timeframe=1h` → `?...&timeframe=15m`.

- [ ] **Step 3: Update `candles.e2e.test.ts`**

Apply substitutions in this file:

- `const ONE_HOUR_MS = 60 * 60 * 1000;` → `const FIFTEEN_MIN_MS = 15 * 60 * 1000;`
- `timeframe: "1h"` → `timeframe: "15m"` (in `makePayload` defaults).
- `unixMs: ONE_HOUR_MS` → `unixMs: FIFTEEN_MIN_MS` (in candle entries).
- In the `BATCH_TOO_LARGE` test, change `(i + 1) * ONE_HOUR_MS` → `(i + 1) * FIFTEEN_MIN_MS`.
- In the stale-revision test, the second request uses `unixMs: ONE_HOUR_MS` → `unixMs: FIFTEEN_MIN_MS`.

- [ ] **Step 4: Run the affected e2e suites**

Run:

```bash
pnpm vitest run src/http/__tests__/regimeCurrent.e2e.test.ts src/http/__tests__/candleFallback.e2e.test.ts src/http/__tests__/candles.e2e.test.ts
```

Expected: PASS for all three. The handlers are timeframe-agnostic; only the test fixtures changed.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/http/__tests__/regimeCurrent.e2e.test.ts src/http/__tests__/candleFallback.e2e.test.ts src/http/__tests__/candles.e2e.test.ts
git commit -m "test(http): switch candle and regime-current e2e fixtures to 15m"
```

---

### Task 6: Update Gecko collector config — defaults and rejections

**Files:**

- Modify: `src/workers/gecko/config.ts:115-117`
- Modify: `src/workers/gecko/__tests__/config.test.ts`

- [ ] **Step 1: Update the config tests to assert 15m default + 60000 poll default + reject `1h`**

Edit `src/workers/gecko/__tests__/config.test.ts`. Three changes:

a) The `"returns MVP defaults for minimal env"` test: assert `geckoTimeframe === "15m"` and `geckoPollIntervalMs === 60000` (line 19 + line 21):

```ts
expect(config.geckoTimeframe).toBe("15m");
expect(config.geckoLookback).toBe(200);
expect(config.geckoPollIntervalMs).toBe(60000);
```

b) The `"uses explicit values when provided"` test (around line 32): change the explicit `GECKO_TIMEFRAME: "1h"` to `GECKO_TIMEFRAME: "15m"`. Update `GECKO_POLL_INTERVAL_MS: "60000"` if it's not already; if the test wants to verify override behavior, set the override to `"30000"` and assert `expect(config.geckoPollIntervalMs).toBe(30000)`. (Use 30000 to differentiate from the new default of 60000.)

c) The `"throws for unsupported GECKO_TIMEFRAME"` test (line 112–115): keep `5m` as the unsupported value but additionally add a new test:

```ts
it("throws for GECKO_TIMEFRAME=1h (rejected until #42)", () => {
  const env = { ...MINIMAL_ENV, GECKO_TIMEFRAME: "1h" };
  expect(() => parseGeckoCollectorConfig(env)).toThrow("Unsupported GECKO_TIMEFRAME");
});

it("accepts explicit GECKO_TIMEFRAME=15m", () => {
  const env = { ...MINIMAL_ENV, GECKO_TIMEFRAME: "15m" };
  const config = parseGeckoCollectorConfig(env);
  expect(config.geckoTimeframe).toBe("15m");
});
```

- [ ] **Step 2: Run config tests to verify they fail**

Run:

```bash
pnpm vitest run src/workers/gecko/__tests__/config.test.ts
```

Expected: FAIL on the new and updated cases (`geckoTimeframe` still defaults to `"1h"`, `geckoPollIntervalMs` still defaults to `300000`).

- [ ] **Step 3: Implement the config change**

Edit `src/workers/gecko/config.ts`. Two lines change inside `parseGeckoCollectorConfig`:

```ts
    geckoTimeframe: readLiteral(env, "GECKO_TIMEFRAME", ["1h"] as const, "1h"),
    geckoLookback: readLookback(env, "GECKO_LOOKBACK", 200, 1000),
    geckoPollIntervalMs: readPositiveInteger(env, "GECKO_POLL_INTERVAL_MS", 300000),
```

become:

```ts
    geckoTimeframe: readLiteral(env, "GECKO_TIMEFRAME", ["15m"] as const, "15m"),
    geckoLookback: readLookback(env, "GECKO_LOOKBACK", 200, 1000),
    geckoPollIntervalMs: readPositiveInteger(env, "GECKO_POLL_INTERVAL_MS", 60000),
```

- [ ] **Step 4: Run config tests to verify they pass**

Run:

```bash
pnpm vitest run src/workers/gecko/__tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/workers/gecko/config.ts src/workers/gecko/__tests__/config.test.ts
git commit -m "feat(gecko-collector): default GECKO_TIMEFRAME=15m and 60s poll"
```

---

### Task 7: Rewrite GeckoTerminal URL construction for 15m

**Files:**

- Modify: `src/workers/gecko/geckoClient.ts:12-19`
- Modify: `src/workers/gecko/__tests__/geckoClient.test.ts`

- [ ] **Step 1: Update the geckoClient tests for the new URL contract**

Edit `src/workers/gecko/__tests__/geckoClient.test.ts`. Three changes:

a) Update the shared `BASE_CONFIG` to use `geckoTimeframe: "15m"`.

b) Replace the `"builds encoded URL with network and poolAddress"` test with a tighter assertion against the new path and query parameters:

```ts
it("builds encoded URL with network, pool, and 15m query params", async () => {
  const config = { ...BASE_CONFIG, geckoNetwork: "solana", geckoPoolAddress: "pool with spaces" };
  const fetch = mockFetch(jsonResponse(VALID_RESPONSE));
  await fetchGeckoOhlcv(config, { fetch });
  expect(fetch).toHaveBeenCalledTimes(1);
  const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
  expect(calledUrl).toContain("/api/v2/networks/solana/pools/pool%20with%20spaces/ohlcv/minute");
  const u = new URL(calledUrl);
  expect(u.searchParams.get("aggregate")).toBe("15");
  expect(u.searchParams.get("include_empty_intervals")).toBe("true");
  expect(u.searchParams.get("limit")).toBe("200");
});
```

c) Add a new test that requesting an unsupported timeframe throws **before** any fetch call:

```ts
it("throws ProtocolError for unsupported geckoTimeframe before calling fetch", async () => {
  const config = { ...BASE_CONFIG, geckoTimeframe: "1h" } as unknown as GeckoCollectorConfig;
  const fetch = vi.fn(async () => jsonResponse(VALID_RESPONSE));
  await expect(fetchGeckoOhlcv(config, { fetch })).rejects.toThrow(ProtocolError);
  expect(fetch).not.toHaveBeenCalled();
});
```

(Cast through `unknown` because `geckoTimeframe` is typed `string` in `GeckoCollectorConfig` today; the runtime check is what we are exercising.)

- [ ] **Step 2: Run geckoClient tests to verify they fail**

Run:

```bash
pnpm vitest run src/workers/gecko/__tests__/geckoClient.test.ts
```

Expected: FAIL on the URL-shape and unsupported-timeframe cases (current code builds `/ohlcv/hour?aggregate=1&limit=...` and never throws on unsupported timeframes).

- [ ] **Step 3: Implement the URL change in `geckoClient.ts`**

Edit `src/workers/gecko/geckoClient.ts`. Replace:

```ts
import type { GeckoCollectorConfig } from "./config.js";
import { HttpError, RequestTimeoutError, RequestTransportError } from "./retry.js";
import { readTextWithLimit, parseJson, readErrorBody } from "./httpUtils.js";

export type GeckoClientDeps = {
  waitForProviderPermit?: () => Promise<void>;
  fetch?: typeof globalThis.fetch;
  AbortSignal?: typeof globalThis.AbortSignal;
  shutdownSignal?: AbortSignal;
};

function buildGeckoUrl(config: GeckoCollectorConfig): URL {
  const base = "https://api.geckoterminal.com";
  const path = `/api/v2/networks/${encodeURIComponent(config.geckoNetwork)}/pools/${encodeURIComponent(config.geckoPoolAddress)}/ohlcv/hour`;
  const url = new URL(path, base);
  url.searchParams.set("aggregate", "1");
  url.searchParams.set("limit", String(config.geckoLookback));
  return url;
}
```

with:

```ts
import type { GeckoCollectorConfig } from "./config.js";
import { HttpError, ProtocolError, RequestTimeoutError, RequestTransportError } from "./retry.js";
import { readTextWithLimit, parseJson, readErrorBody } from "./httpUtils.js";

export type GeckoClientDeps = {
  waitForProviderPermit?: () => Promise<void>;
  fetch?: typeof globalThis.fetch;
  AbortSignal?: typeof globalThis.AbortSignal;
  shutdownSignal?: AbortSignal;
};

const TIMEFRAME_TO_GECKO_PATH_PARAMS: Record<string, { path: string; aggregate: string }> = {
  "15m": { path: "minute", aggregate: "15" }
};

function buildGeckoUrl(config: GeckoCollectorConfig): URL {
  const params = TIMEFRAME_TO_GECKO_PATH_PARAMS[config.geckoTimeframe];
  if (!params) {
    throw new ProtocolError(
      `Unsupported geckoTimeframe for URL construction: ${config.geckoTimeframe}`
    );
  }
  const base = "https://api.geckoterminal.com";
  const path = `/api/v2/networks/${encodeURIComponent(config.geckoNetwork)}/pools/${encodeURIComponent(config.geckoPoolAddress)}/ohlcv/${params.path}`;
  const url = new URL(path, base);
  url.searchParams.set("aggregate", params.aggregate);
  url.searchParams.set("include_empty_intervals", "true");
  url.searchParams.set("limit", String(config.geckoLookback));
  return url;
}
```

The body of `fetchGeckoOhlcv` is unchanged. `buildGeckoUrl` runs synchronously before `await waitForPermit()`, so the throw fires before any network or rate-limit work — that's what the new test asserts.

- [ ] **Step 4: Run geckoClient tests to verify they pass**

Run:

```bash
pnpm vitest run src/workers/gecko/__tests__/geckoClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/workers/gecko/geckoClient.ts src/workers/gecko/__tests__/geckoClient.test.ts
git commit -m "feat(gecko-collector): request /ohlcv/minute with aggregate=15 and include_empty_intervals"
```

---

### Task 8: Update Gecko normalization to be 15m-only

**Files:**

- Modify: `src/workers/gecko/normalize.ts`
- Modify: `src/workers/gecko/__tests__/normalize.test.ts`
- Modify: `src/workers/gecko/__tests__/ingestClient.test.ts` (fixture only)
- Modify: `src/workers/__tests__/geckoCollector.test.ts` (fixture only)

- [ ] **Step 1: Update normalize tests for 15m alignment + ProtocolError on unsupported timeframe**

Edit `src/workers/gecko/__tests__/normalize.test.ts`. Make these changes:

a) Update `BASE_CONFIG` to `geckoTimeframe: "15m"`.

b) Update `VALID_PAYLOAD` so the timestamps are 15m-aligned. Choose `1714536000` (already aligned to 60s and divisible by 900: `1714536000 / 900 = 1905040` exactly) and `1714536900` (one 15m later — `1714536000 + 900 = 1714536900`).

```ts
const VALID_PAYLOAD = {
  data: {
    attributes: {
      ohlcv_list: [
        [1714536000, 100, 105, 98, 102, 1000],
        [1714536900, 102, 108, 100, 106, 1200]
      ]
    }
  }
};
```

c) Update the `"converts Unix seconds to milliseconds"` assertions:

```ts
expect(candles[0].unixMs).toBe(1714536000000);
expect(candles[1].unixMs).toBe(1714536900000);
```

d) Update the `"drops misaligned timestamps"` test to use a 15m-misaligned timestamp (`1714536060` is 1 minute past a 15m boundary: still divisible by 60 but not by 900):

```ts
it("drops 15m-misaligned timestamps but still returns them for counting", () => {
  const payload = {
    data: { attributes: { ohlcv_list: [[1714536060, 1, 2, 3, 4, 5]] } }
  };
  const { stats } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
  expect(stats.misalignedRowCount).toBe(1);
  expect(stats.validCount).toBe(0);
});
```

e) The dedupe and conflict tests use `[1714536000, …]` — already 15m-aligned, no change.

f) The `"sorts candles by unixMs ascending"` test: change the second timestamp from `1714539600` (1h offset) to `1714536900` (15m offset), and update the milliseconds expected value to `1714536900000`.

g) Add a new test asserting unsupported timeframe → ProtocolError:

```ts
it("throws ProtocolError when geckoTimeframe is unsupported", () => {
  const config = { ...BASE_CONFIG, geckoTimeframe: "1h" };
  expect(() =>
    normalizeGeckoOhlcv(VALID_PAYLOAD, config as unknown as GeckoCollectorConfig)
  ).toThrow("Unsupported geckoTimeframe");
});
```

(`GeckoCollectorConfig.geckoTimeframe` is currently typed `string`, so the cast is a defensive measure — easy to drop later.)

- [ ] **Step 2: Run normalize tests to verify they fail**

Run:

```bash
pnpm vitest run src/workers/gecko/__tests__/normalize.test.ts
```

Expected: FAIL on the unsupported-timeframe test (current code silently falls back to 3600000ms when the map key is missing).

- [ ] **Step 3: Update normalize.ts to be 15m-only and to throw on unsupported timeframes**

Edit `src/workers/gecko/normalize.ts`. Replace the timeframe map and the resolution of `timeframeMs`:

Old:

```ts
const TIMEFRAME_MS: Record<string, number> = {
  "1h": 3600000
};
```

New:

```ts
const TIMEFRAME_MS: Record<string, number> = {
  "15m": 15 * 60 * 1000
};
```

Old (inside `normalizeGeckoOhlcv`):

```ts
const timeframeMs = TIMEFRAME_MS[config.geckoTimeframe] ?? 3600000;
```

New:

```ts
const timeframeMs = TIMEFRAME_MS[config.geckoTimeframe];
if (timeframeMs === undefined) {
  throw new ProtocolError(`Unsupported geckoTimeframe: ${config.geckoTimeframe}`);
}
```

`ProtocolError` is already imported at the top of the file (line 3).

- [ ] **Step 4: Run normalize tests to verify they pass**

Run:

```bash
pnpm vitest run src/workers/gecko/__tests__/normalize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update worker test fixtures that hardcode `geckoTimeframe: "1h"`**

Two test files build a `BASE_CONFIG` with `geckoTimeframe: "1h"`. Switch both to `"15m"`:

- `src/workers/gecko/__tests__/ingestClient.test.ts:14` — change `geckoTimeframe: "1h"` to `geckoTimeframe: "15m"`.
- `src/workers/__tests__/geckoCollector.test.ts:17` — change `geckoTimeframe: "1h"` to `geckoTimeframe: "15m"`.

The tests in those files do not assert on the timeframe value itself — they care about request shape and ingest plumbing — so the switch is mechanical.

- [ ] **Step 6: Run the full worker suite**

Run:

```bash
pnpm vitest run src/workers/
```

Expected: PASS for all worker tests (config, geckoClient, normalize, ingestClient, geckoCollector).

- [ ] **Step 7: Commit**

Run:

```bash
git add src/workers/gecko/normalize.ts src/workers/gecko/__tests__/normalize.test.ts src/workers/gecko/__tests__/ingestClient.test.ts src/workers/__tests__/geckoCollector.test.ts
git commit -m "feat(gecko-collector): normalize 15m only and reject unsupported timeframes"
```

---

### Task 9: Update ledger candle test fixtures to `15m`

**Files:**

- Modify: `src/ledger/__tests__/candlesWriter.test.ts`
- Modify: `src/ledger/__tests__/candleStore.test.ts`

The ledger code itself does not change — feed identity already includes `timeframe` as a string. These tests construct `CandleIngestRequest` fixtures, whose `timeframe` is now typed `CandleIngestTimeframe = "15m"`. The fixtures must match.

- [ ] **Step 1: Update `candlesWriter.test.ts`**

Edit `src/ledger/__tests__/candlesWriter.test.ts`:

- `const ONE_HOUR_MS = 60 * 60 * 1000;` → `const FIFTEEN_MIN_MS = 15 * 60 * 1000;`
- `timeframe: "1h"` → `timeframe: "15m"` (in the `makeRequest` defaults; the second `timeframe: "1h"` near line 90 also).
- All occurrences of `ONE_HOUR_MS` in candle `unixMs` values → `FIFTEEN_MIN_MS`.

- [ ] **Step 2: Update `candleStore.test.ts`**

Apply the same substitutions in `src/ledger/__tests__/candleStore.test.ts`. There are six `timeframe: "1h"` occurrences (lines 15, 98, 166, 190, 219, 249); replace each with `"15m"`. Likewise switch `ONE_HOUR_MS` → `FIFTEEN_MIN_MS`.

- [ ] **Step 3: Run the ledger candle tests**

Run:

```bash
pnpm vitest run src/ledger/__tests__/candlesWriter.test.ts
```

Expected: PASS.

The Postgres CandleStore tests are gated by `DATABASE_URL` (`describe.skipIf(!process.env.DATABASE_URL)`). If `DATABASE_URL` is not set locally, this file is a no-op. To verify against Postgres locally, run:

```bash
pnpm test:pg
```

Expected: PASS, including `src/ledger/__tests__/candleStore.test.ts`. If a Postgres instance is unavailable, document this in the PR description and rely on CI.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/ledger/__tests__/candlesWriter.test.ts src/ledger/__tests__/candleStore.test.ts
git commit -m "test(ledger): switch candle store fixtures to 15m"
```

---

### Task 10: Update OpenAPI, README, .env.example, and runbook

**Files:**

- Modify: `src/http/openapi.ts:170-237`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/runbooks/railway-deploy.md`

- [ ] **Step 1: Update `src/http/openapi.ts`**

In the `/v1/regime/current` `parameters` block (around line 217–223), change:

```ts
            {
              name: "timeframe",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["1h"] }
            }
```

to:

```ts
            {
              name: "timeframe",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["15m"] }
            }
```

In the `/v1/candles` block (line 170–189), update the `summary` to make the breaking change explicit and the `400` description to mention 15m alignment:

```ts
      "/v1/candles": {
        post: {
          summary:
            "Ingest candle revisions for a logical feed (timeframe must be 15m; 1h removed in #41 until #42 derives 1h from 15m)",
          responses: {
            "200": {
              description: "Per-slot insert/revise/idempotent/reject counts"
            },
            "400": {
              description:
                "Validation error (BATCH_TOO_LARGE, MALFORMED_CANDLE, DUPLICATE_CANDLE_IN_BATCH, VALIDATION_ERROR, UNSUPPORTED_SCHEMA_VERSION). Candle unixMs must be aligned to 15-minute boundaries."
            },
            "401": {
              description: "Missing or invalid X-Candles-Ingest-Token"
            },
            "500": {
              description: "CANDLES_INGEST_TOKEN environment variable not set"
            }
          }
        }
      },
```

Update the `/v1/regime/current` summary to the same effect:

```ts
          summary:
            "Market-only regime classification + CLMM suitability for a 15m feed (timeframe=1h returns until #42)",
```

- [ ] **Step 2: Update `README.md`**

Around line 33 (the `GET /v1/regime/current` line), change the inline timeframe to `15m`. Around line 41 (the GeckoTerminal collector paragraph), change the `1h` reference to `15m`. Around line 61, update the env table row:

```
| `GECKO_TIMEFRAME`            | `15m`           | Must equal `15m`. (`1h` is removed in #41 until #42.)                     |
```

Update the `GECKO_POLL_INTERVAL_MS` row to match the new default of `60000`:

```
| `GECKO_POLL_INTERVAL_MS`     | `60000`         | Sleep after each completed cycle.                                         |
```

Add a short note immediately after the API list (right after line 35) that explicitly flags the breaking change:

```markdown
> **#41 contract change:** `POST /v1/candles` and `GET /v1/regime/current` accept `timeframe=15m` only. `timeframe=1h` is removed and is restored as a derived read in #42 (1h derived from stored 15m candles). Coordinate consumers before deploying.
```

- [ ] **Step 3: Update `.env.example`**

Edit `.env.example`. Two lines change:

```
GECKO_TIMEFRAME=1h
```

becomes:

```
GECKO_TIMEFRAME=15m
```

and:

```
GECKO_POLL_INTERVAL_MS=300000
```

becomes:

```
GECKO_POLL_INTERVAL_MS=60000
```

- [ ] **Step 4: Update `docs/runbooks/railway-deploy.md`**

Two updates in this file:

a) The `GECKO_TIMEFRAME` row in the env table (around line 227) becomes:

```
| `GECKO_TIMEFRAME`            | `15m`                                                 |
```

And `GECKO_POLL_INTERVAL_MS` becomes:

```
| `GECKO_POLL_INTERVAL_MS`     | `60000`                                               |
```

b) The pool preflight curl (around line 245) currently calls `/ohlcv/hour?aggregate=1&limit=1`. Replace with the 15m equivalent:

```bash
curl -fsS "https://api.geckoterminal.com/api/v2/networks/solana/pools/$GECKO_POOL_ADDRESS/ohlcv/minute?aggregate=15&include_empty_intervals=true&limit=1"
```

- [ ] **Step 5: Run the openapi-related tests (if any) plus full suite**

Run:

```bash
pnpm vitest run src/http/__tests__/routes.contract.test.ts
```

Expected: PASS. (This file exercises route registration; if it asserts on OpenAPI shape, the new enum should not break it.)

- [ ] **Step 6: Commit**

Run:

```bash
git add src/http/openapi.ts README.md .env.example docs/runbooks/railway-deploy.md
git commit -m "docs: update openapi, readme, env, and runbook for 15m"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run typecheck, lint, and the full test suite**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all three pass with zero warnings. If any fail:

- typecheck: usually a missed `SupportedTimeframe` import; grep `src/` again, route to `CandleIngestTimeframe` or `RegimeReadTimeframe`.
- lint: usually unused imports left over from the validation refactor; remove them.
- vitest: re-read the failing test's expected timeframe — it should be `"15m"` everywhere except where a test deliberately exercises the rejection of `"1h"`.

- [ ] **Step 2: Optional Postgres run**

If Postgres is available locally (Docker or Railway), run:

```bash
pnpm test:pg
```

Expected: PASS, including `candleStore.test.ts` and `insights.e2e.pg.test.ts`. If unavailable, note in the PR description that Postgres tests will be exercised in CI.

- [ ] **Step 3: Manually exercise the gecko collector against the live provider (skip if you only have CI)**

If a real `REGIME_ENGINE_URL`, `CANDLES_INGEST_TOKEN`, and `GECKO_POOL_ADDRESS` are available in a development environment, set `GECKO_TIMEFRAME=15m` and run:

```bash
pnpm dev:gecko
```

Expected: a single cycle logs `fetch_succeeded`, `normalized` (with `validCount` ≈ 200), and `ingest_succeeded` with `insertedCount` matching the rolling lookback. If the provider returns 404, re-check `GECKO_POOL_ADDRESS` and the URL in the runbook curl example. If the test environment only has CI, document that this manual exercise is deferred.

- [ ] **Step 4: Push and open a PR (only if instructed)**

Push only when the user requests it. The PR description should reference issue #41 (this work) and follow-up #42 (derived 1h read), and should explicitly say:

> Breaking consumer change for `POST /v1/candles` and `GET /v1/regime/current`: `timeframe=1h` is removed until #42 lands. Update the GeckoTerminal collector service to `GECKO_TIMEFRAME=15m`, `GECKO_LOOKBACK=200`, `GECKO_POLL_INTERVAL_MS=60000` before promoting this PR.

Do not auto-push or auto-open.

---

## Acceptance Criteria Coverage Map

- `POST /v1/candles` accepts `timeframe: "15m"` — Task 2 (validation) + Task 5 (e2e fixture).
- `POST /v1/candles` rejects `timeframe: "1h"` — Task 2 (new test + validation enum).
- `POST /v1/candles` rejects 15m candles whose `unixMs` is not aligned to `15 * 60 * 1000` — Task 2 (new alignment test).
- `GET /v1/regime/current` accepts `timeframe=15m` — Task 2 (validation) + Task 5 (e2e).
- `GET /v1/regime/current` rejects `timeframe=1h` — Task 2 + Task 5.
- `GET /v1/regime/current` uses `MARKET_REGIME_CONFIG["15m"]` — Task 3 + handler is unchanged because it indexes by `query.timeframe`.
- `buildRegimeCurrent` remains source-agnostic — Task 4 changes type only; body untouched.
- Gecko collector defaults `GECKO_TIMEFRAME=15m` — Task 6.
- Gecko collector rejects `GECKO_TIMEFRAME=1h` — Task 6 (new test).
- Gecko collector requests `/ohlcv/minute?aggregate=15&include_empty_intervals=true&limit=200` — Task 7.
- Gecko normalization validates 15m alignment with no hidden 1h fallback — Task 8.
- Candle stores continue using timeframe in feed identity without schema changes — confirmed in File Map (`src/ledger/*` not modified); Task 9 only updates fixtures.
- No database migration is added — verified by absence of any change under `drizzle/` in the File Map.
- Docs/env examples updated `1h` → `15m` and #41 marked as breaking, #42 as the restorer — Task 10.
- Tests cover contract validation, collector config, Gecko URL construction, normalization, and regime-current query validation — Tasks 2, 6, 7, 8.
