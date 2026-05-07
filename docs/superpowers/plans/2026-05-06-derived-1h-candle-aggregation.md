# Derived 1h Candle Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `GET /v1/regime/current?timeframe=1h` to return a market regime classified on derived `1h` candles aggregated on-the-fly from stored `15m` candles, while keeping `POST /v1/candles` restricted to `15m` provider candles. The direct `15m` regime read remains for diagnostics.

**Architecture:** Add a pure aggregation utility (`aggregateCandles`) and a small read-policy helper (`regimeCandleReadPlan`). The handler orchestrates: select `MARKET_REGIME_CONFIG[requested]`, build a read plan, read latest-revision `15m` rows from the existing store, and either (a) classify the `15m` rows directly, or (b) aggregate them into complete `1h` buckets, filter by the `1h` derived cutoff, and classify those. `buildRegimeCurrent` stays source-agnostic — the handler injects metadata fields (`sourceTimeframe`, `sourceCandleCount`, optional `derivedTimeframe`, `aggregationVersion`). No new database storage; no provider `1h` ingestion.

**Tech Stack:** TypeScript (Node 22, ESM, NodeNext resolution), Fastify, Zod, vitest, Drizzle (Postgres), better-sqlite3 (SQLite). pnpm workspace; tests run via `pnpm test`.

---

## Pre-flight

- [ ] **Step 0: Confirm a clean working tree on a fresh branch from `main`**

Run:

```bash
git status
git log -1 --oneline
git checkout -b m42-derived-1h-aggregation
```

Expected: working tree clean (or only this plan file unstaged), HEAD on `d391880 m42: add derived 1h aggregation design`. The design commit on `main` is what this plan implements.

- [ ] **Step 1: Run the existing test suite to confirm a green baseline**

Run:

```bash
pnpm test
```

Expected: all tests pass on the current `15m`-only codebase. If any are red, stop and surface the failure before changing anything.

- [ ] **Step 2: Run typecheck and lint to confirm a green baseline**

Run:

```bash
pnpm typecheck && pnpm lint
```

Expected: both succeed with zero errors / zero warnings.

---

## File Map

Files created:

- `src/engine/candles/aggregateCandles.ts` — pure aggregation utility; aggregates `15m` source candles into complete `1h` derived candles.
- `src/engine/candles/__tests__/aggregateCandles.test.ts` — unit tests for the aggregation utility.
- `src/engine/marketRegime/regimeCandleReadPlan.ts` — pure helper that returns source timeframe, source/derived cutoffs, source limit, and direct/derived metadata hints for a regime-read timeframe.
- `src/engine/marketRegime/__tests__/regimeCandleReadPlan.test.ts` — unit tests for the read-plan helper.

Files modified:

- `src/contract/v1/types.ts` — widen `RegimeReadTimeframe` to `"15m" | "1h"`; extend `RegimeCurrentMetadata` with `sourceTimeframe`, `sourceCandleCount`, optional `derivedTimeframe`, optional `aggregationVersion`.
- `src/contract/v1/validation.ts` — add `"1h"` to `REGIME_READ_TIMEFRAMES`; widen the return type of `parseRegimeCurrentQuery`. `CANDLE_INGEST_TIMEFRAMES` is unchanged.
- `src/contract/v1/__tests__/regimeCurrent.validation.test.ts` — replace the "rejects timeframe=1h until #42" test with one that accepts `"1h"`; keep an unsupported-timeframe rejection test.
- `src/engine/marketRegime/config.ts` — change `MarketTimeframeConfig.timeframe` to `RegimeReadTimeframe`; change `MARKET_REGIME_CONFIG` to `Record<RegimeReadTimeframe, MarketTimeframeConfig>`; restore the `"1h"` entry alongside the existing `"15m"` entry.
- `src/engine/marketRegime/__tests__/config.test.ts` — add coverage for the restored `"1h"` entry.
- `src/engine/marketRegime/buildRegimeCurrent.ts` — accept optional caller-supplied metadata fields and merge them into `metadata`. No source/derived decisions inside.
- `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts` — add a test asserting that supplied metadata fields are reflected in the response.
- `src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts` — pass new `sourceTimeframe`/`sourceCandleCount` from caller; regenerate snapshot.
- `src/http/handlers/regimeCurrent.ts` — orchestrate direct vs derived flow using `regimeCandleReadPlan` and `aggregateCandles`; supply metadata fields to `buildRegimeCurrent`.
- `src/http/__tests__/regimeCurrent.e2e.test.ts` — keep existing direct `15m` tests; add direct `15m` metadata assertions; add derived `1h` end-to-end tests (success, incomplete-current-bucket exclusion, zero-candles-after-filter, insufficient-samples passthrough).
- `src/http/openapi.ts` — `/v1/regime/current` `timeframe` enum becomes `["15m", "1h"]`; refresh summary text.
- `README.md` — refresh the `#41/#42` note: `1h` regime read is restored as a derived read.

Files **not** changed:

- `src/contract/v1/__tests__/candles.validation.test.ts` (still rejects `1h` ingestion — no change needed; the existing test is correct on its own terms).
- `src/contract/v1/__tests__/validation.test.ts` (the `PlanRequest.market.timeframe` is typed `string`, unrelated to regime-read).
- `src/ledger/store.ts`, `src/ledger/candlesWriter.ts`, `src/ledger/candleStore.ts`, Drizzle/SQLite schemas — no derived candle storage.
- `src/engine/marketRegime/closedCandleCutoff.ts`, `src/engine/marketRegime/freshness.ts` — pure functions of input config, unchanged.
- `src/workers/gecko/*` — provider ingestion remains `15m` only; out of scope.

---

## Task Sequencing

The aggregation utility and the read-plan helper are independent of each other (they can land in parallel). The handler refactor depends on both, on the widened types (`RegimeReadTimeframe`), on the validator change, on the config change (`MARKET_REGIME_CONFIG["1h"]`), and on the `buildRegimeCurrent` metadata extension. Land tasks in the order below; do not jump ahead.

1. Widen types (`RegimeReadTimeframe`, `RegimeCurrentMetadata`).
2. Widen the validator allowlist for regime read.
3. Restore the `1h` entry in `MARKET_REGIME_CONFIG`.
4. Add `aggregateCandles` (TDD).
5. Add `regimeCandleReadPlan` (TDD).
6. Extend `buildRegimeCurrent` with caller-supplied metadata.
7. Rewrite the regime-current handler.
8. Add/update e2e tests.
9. Update OpenAPI and README.
10. Run the quality gate.

---

### Task 1: Widen `RegimeReadTimeframe` and extend `RegimeCurrentMetadata`

**Files:**

- Modify: `src/contract/v1/types.ts:225-310`

- [ ] **Step 1: Edit `src/contract/v1/types.ts` to widen `RegimeReadTimeframe`**

Find:

```ts
export type CandleIngestTimeframe = "15m";
export type RegimeReadTimeframe = "15m";
```

Replace with:

```ts
export type CandleIngestTimeframe = "15m";
export type RegimeReadTimeframe = "15m" | "1h";
```

`CandleIngestTimeframe` stays narrow.

- [ ] **Step 2: Extend `RegimeCurrentMetadata` with source/derived fields**

Find:

```ts
export interface RegimeCurrentMetadata {
  engineVersion: string;
  configVersion: string;
  candleCount: number;
}
```

Replace with:

```ts
export interface RegimeCurrentMetadata {
  engineVersion: string;
  configVersion: string;
  candleCount: number;
  sourceTimeframe: "15m";
  sourceCandleCount: number;
  derivedTimeframe?: "1h";
  aggregationVersion?: "ohlcv-agg-v1";
}
```

The four new fields are mandatory in shape: `sourceTimeframe` and `sourceCandleCount` are always present; `derivedTimeframe` and `aggregationVersion` are present only on derived reads.

- [ ] **Step 3: Run typecheck to surface every call site that constructs metadata**

Run:

```bash
pnpm typecheck
```

Expected: typecheck FAILS with errors in `src/engine/marketRegime/buildRegimeCurrent.ts` (missing `sourceTimeframe` / `sourceCandleCount`) and possibly in tests that build a full `RegimeCurrentResponse` literal. This is the intended state — those will be fixed in later tasks. Note the failing files; you'll revisit them.

- [ ] **Step 4: Commit the type changes**

```bash
git add src/contract/v1/types.ts
git commit -m "m42: widen RegimeReadTimeframe and extend RegimeCurrentMetadata"
```

---

### Task 2: Accept `1h` in `parseRegimeCurrentQuery`

**Files:**

- Modify: `src/contract/v1/validation.ts:280-435`
- Test: `src/contract/v1/__tests__/regimeCurrent.validation.test.ts`

- [ ] **Step 1: Update the regime-read validation test (replace the 1h-rejection case)**

Open `src/contract/v1/__tests__/regimeCurrent.validation.test.ts`.

Find:

```ts
it("rejects timeframe=1h until #42", () => {
  expect.assertions(1);
  try {
    parseRegimeCurrentQuery({ ...baseQuery, timeframe: "1h" });
  } catch (error) {
    expect((error as ContractValidationError).response.error.code).toBe("VALIDATION_ERROR");
  }
});
```

Replace with:

```ts
it("accepts timeframe=15m", () => {
  const result = parseRegimeCurrentQuery({ ...baseQuery, timeframe: "15m" });
  expect(result.timeframe).toBe("15m");
});

it("accepts timeframe=1h", () => {
  const result = parseRegimeCurrentQuery({ ...baseQuery, timeframe: "1h" });
  expect(result.timeframe).toBe("1h");
});

it("rejects unsupported regime-read timeframe (e.g. 4h) with VALIDATION_ERROR", () => {
  expect.assertions(1);
  try {
    parseRegimeCurrentQuery({ ...baseQuery, timeframe: "4h" });
  } catch (error) {
    expect((error as ContractValidationError).response.error.code).toBe("VALIDATION_ERROR");
  }
});
```

- [ ] **Step 2: Run the test to confirm `"1h"` is currently rejected**

Run:

```bash
pnpm test -- src/contract/v1/__tests__/regimeCurrent.validation.test.ts
```

Expected: the new "accepts timeframe=1h" test FAILS because the current `REGIME_READ_TIMEFRAMES` allowlist excludes `"1h"`.

- [ ] **Step 3: Widen `REGIME_READ_TIMEFRAMES` and the validator return type**

Open `src/contract/v1/validation.ts`.

Find:

```ts
const CANDLE_INGEST_TIMEFRAMES = ["15m"] as const;
const REGIME_READ_TIMEFRAMES = ["15m"] as const;
```

Replace with:

```ts
const CANDLE_INGEST_TIMEFRAMES = ["15m"] as const;
const REGIME_READ_TIMEFRAMES = ["15m", "1h"] as const;
```

Then find:

```ts
export const parseRegimeCurrentQuery = (
  raw: unknown
): {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: "15m";
} => {
```

Replace with:

```ts
import type { RegimeReadTimeframe } from "./types.js";

// (Keep this import grouped with the other type imports at the top of the file.)

export const parseRegimeCurrentQuery = (
  raw: unknown
): {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: RegimeReadTimeframe;
} => {
```

(If `RegimeReadTimeframe` is not already imported in this file, add it to the existing import-from-`./types.js` block at the top rather than introducing a duplicate import.)

- [ ] **Step 4: Run the validation test to confirm it passes**

Run:

```bash
pnpm test -- src/contract/v1/__tests__/regimeCurrent.validation.test.ts
```

Expected: PASS for the three new assertions plus the existing "accepts the five required selectors" test.

- [ ] **Step 5: Commit**

```bash
git add src/contract/v1/validation.ts src/contract/v1/__tests__/regimeCurrent.validation.test.ts
git commit -m "m42: accept timeframe=1h on /v1/regime/current"
```

---

### Task 3: Restore the `1h` entry in `MARKET_REGIME_CONFIG`

**Files:**

- Modify: `src/engine/marketRegime/config.ts`
- Test: `src/engine/marketRegime/__tests__/config.test.ts`

- [ ] **Step 1: Add a failing test for the restored 1h config**

Open `src/engine/marketRegime/__tests__/config.test.ts`.

Append a new `describe` block at the end of the file:

```ts
describe("MARKET_REGIME_CONFIG[1h]", () => {
  it("has timeframeMs equal to 1 hour", () => {
    expect(MARKET_REGIME_CONFIG["1h"].timeframeMs).toBe(60 * 60 * 1000);
  });

  it("has the original 1h indicator and regime windows", () => {
    const config = MARKET_REGIME_CONFIG["1h"];
    expect(config.indicators.volShortWindow).toBe(8);
    expect(config.indicators.volLongWindow).toBe(21);
    expect(config.indicators.trendWindow).toBe(14);
    expect(config.indicators.compressionWindow).toBe(20);
    expect(config.regime.confirmBars).toBe(1);
    expect(config.suitability.minCandles).toBe(30);
  });

  it("has the original 1h freshness thresholds", () => {
    const config = MARKET_REGIME_CONFIG["1h"];
    expect(config.freshness.closedCandleDelayMs).toBe(5 * 60 * 1000);
    expect(config.freshness.softStaleMs).toBe(75 * 60 * 1000);
    expect(config.freshness.hardStaleMs).toBe(90 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
pnpm test -- src/engine/marketRegime/__tests__/config.test.ts
```

Expected: the new tests FAIL because `MARKET_REGIME_CONFIG["1h"]` does not exist.

- [ ] **Step 3: Update `MarketTimeframeConfig.timeframe` and add the `1h` entry**

Open `src/engine/marketRegime/config.ts`.

Replace the entire file contents with:

```ts
import type { RegimeReadTimeframe } from "../../contract/v1/types.js";

export const MARKET_REGIME_CONFIG_VERSION = "market-regime-2.0.0" as const;

export interface MarketTimeframeConfig {
  timeframe: RegimeReadTimeframe;
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

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

export const MARKET_REGIME_CONFIG: Record<RegimeReadTimeframe, MarketTimeframeConfig> = {
  "15m": {
    timeframe: "15m",
    timeframeMs: FIFTEEN_MIN_MS,
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
  },
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
      allowedVolRatioMax: 1.3,
      extremeVolRatio: 1.6,
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

The `15m` entry's values are unchanged from the post-#41 file. The `1h` entry restores the pre-#41 values byte-for-byte (verified against `git show 3775905^:src/engine/marketRegime/config.ts`).

- [ ] **Step 4: Run the config tests**

Run:

```bash
pnpm test -- src/engine/marketRegime/__tests__/config.test.ts
```

Expected: PASS for all three new `1h` tests plus the three existing `15m` tests.

- [ ] **Step 5: Commit**

```bash
git add src/engine/marketRegime/config.ts src/engine/marketRegime/__tests__/config.test.ts
git commit -m "m42: restore 1h MARKET_REGIME_CONFIG entry alongside 15m"
```

---

### Task 4: Implement `aggregateCandles` (TDD)

**Files:**

- Create: `src/engine/candles/aggregateCandles.ts`
- Test: `src/engine/candles/__tests__/aggregateCandles.test.ts`

The utility is dumb candle math. It must not import from `marketRegime/`, must not read the store, and must not log.

- [ ] **Step 1: Write the full failing test file**

Create `src/engine/candles/__tests__/aggregateCandles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Candle } from "../../../contract/v1/types.js";
import { aggregateCandles } from "../aggregateCandles.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

const makeCandle = (unixMs: number, overrides: Partial<Candle> = {}): Candle => ({
  unixMs,
  open: 100,
  high: 101,
  low: 99,
  close: 100.5,
  volume: 1,
  ...overrides
});

const fourAlignedCandles = (hourOpenUnixMs: number): Candle[] => [
  makeCandle(hourOpenUnixMs, { open: 100, high: 102, low: 98, close: 101, volume: 5 }),
  makeCandle(hourOpenUnixMs + FIFTEEN_MIN_MS, {
    open: 101,
    high: 105,
    low: 100,
    close: 104,
    volume: 7
  }),
  makeCandle(hourOpenUnixMs + 2 * FIFTEEN_MIN_MS, {
    open: 104,
    high: 106,
    low: 103,
    close: 105,
    volume: 4
  }),
  makeCandle(hourOpenUnixMs + 3 * FIFTEEN_MIN_MS, {
    open: 105,
    high: 107,
    low: 102,
    close: 103,
    volume: 6
  })
];

describe("aggregateCandles 1h", () => {
  it("aggregates four aligned 15m candles into one 1h candle", () => {
    const hourOpen = 12 * ONE_HOUR_MS;
    const result = aggregateCandles(fourAlignedCandles(hourOpen), "1h");
    expect(result).toHaveLength(1);
    expect(result[0].unixMs).toBe(hourOpen);
    expect(result[0].open).toBe(100);
    expect(result[0].high).toBe(107);
    expect(result[0].low).toBe(98);
    expect(result[0].close).toBe(103);
    expect(result[0].volume).toBe(22);
  });

  it("emits the 1h bucket open timestamp", () => {
    const hourOpen = 100 * ONE_HOUR_MS;
    const result = aggregateCandles(fourAlignedCandles(hourOpen), "1h");
    expect(result[0].unixMs).toBe(hourOpen);
  });

  it("treats input order as irrelevant and emits sorted output", () => {
    const a = fourAlignedCandles(2 * ONE_HOUR_MS);
    const b = fourAlignedCandles(1 * ONE_HOUR_MS);
    const shuffled = [a[2], b[3], a[0], b[1], a[3], b[0], a[1], b[2]];
    const result = aggregateCandles(shuffled, "1h");
    expect(result).toHaveLength(2);
    expect(result[0].unixMs).toBe(1 * ONE_HOUR_MS);
    expect(result[1].unixMs).toBe(2 * ONE_HOUR_MS);
  });

  it("skips an incomplete current-hour bucket (only 3 candles present)", () => {
    const hourOpen = 5 * ONE_HOUR_MS;
    const partial = fourAlignedCandles(hourOpen).slice(0, 3);
    const result = aggregateCandles(partial, "1h");
    expect(result).toHaveLength(0);
  });

  it("skips a bucket missing a middle candle", () => {
    const hourOpen = 5 * ONE_HOUR_MS;
    const four = fourAlignedCandles(hourOpen);
    const missingMiddle = [four[0], four[1], four[3]];
    const result = aggregateCandles(missingMiddle, "1h");
    expect(result).toHaveLength(0);
  });

  it("ignores misaligned source timestamps", () => {
    const hourOpen = 5 * ONE_HOUR_MS;
    const four = fourAlignedCandles(hourOpen);
    const misaligned = [four[0], makeCandle(hourOpen + FIFTEEN_MIN_MS + 60_000), four[2], four[3]];
    const result = aggregateCandles(misaligned, "1h");
    expect(result).toHaveLength(0);
  });

  it("does not aggregate across hour boundaries", () => {
    const hourOpenA = 5 * ONE_HOUR_MS;
    const hourOpenB = 6 * ONE_HOUR_MS;
    const incompleteA = fourAlignedCandles(hourOpenA).slice(0, 2);
    const incompleteB = fourAlignedCandles(hourOpenB).slice(2, 4);
    const result = aggregateCandles([...incompleteA, ...incompleteB], "1h");
    expect(result).toHaveLength(0);
  });

  it("emits multiple complete buckets independently", () => {
    const result = aggregateCandles(
      [...fourAlignedCandles(0), ...fourAlignedCandles(ONE_HOUR_MS)],
      "1h"
    );
    expect(result).toHaveLength(2);
    expect(result[0].unixMs).toBe(0);
    expect(result[1].unixMs).toBe(ONE_HOUR_MS);
  });

  it("returns an empty array for an empty input", () => {
    expect(aggregateCandles([], "1h")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (file does not exist yet)**

Run:

```bash
pnpm test -- src/engine/candles/__tests__/aggregateCandles.test.ts
```

Expected: FAIL with module-not-found for `../aggregateCandles.js`.

- [ ] **Step 3: Implement `aggregateCandles`**

Create `src/engine/candles/aggregateCandles.ts`:

```ts
import type { Candle } from "../../contract/v1/types.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_PER_HOUR = 4;

type AggregationTargetTimeframe = "1h";

const targetBucketMs: Record<AggregationTargetTimeframe, number> = {
  "1h": ONE_HOUR_MS
};

const sourceTimeframeMs: Record<AggregationTargetTimeframe, number> = {
  "1h": FIFTEEN_MIN_MS
};

const sourceCountPerBucket: Record<AggregationTargetTimeframe, number> = {
  "1h": FIFTEEN_MINUTES_PER_HOUR
};

export const aggregateCandles = (
  candles: Candle[],
  target: AggregationTargetTimeframe
): Candle[] => {
  const bucketMs = targetBucketMs[target];
  const srcMs = sourceTimeframeMs[target];
  const required = sourceCountPerBucket[target];

  // Group source candles by their target bucket open, dropping misaligned rows.
  const buckets = new Map<number, Candle[]>();
  for (const candle of candles) {
    if (!Number.isInteger(candle.unixMs)) continue;
    if (candle.unixMs % srcMs !== 0) continue;

    const bucketOpen = Math.floor(candle.unixMs / bucketMs) * bucketMs;
    const list = buckets.get(bucketOpen);
    if (list) {
      list.push(candle);
    } else {
      buckets.set(bucketOpen, [candle]);
    }
  }

  const out: Candle[] = [];
  for (const [bucketOpen, sources] of buckets) {
    if (sources.length !== required) continue;

    sources.sort((a, b) => a.unixMs - b.unixMs);

    // Verify that the bucket is complete: each source slot exactly once,
    // covering bucketOpen, bucketOpen + srcMs, ..., bucketOpen + (required-1)*srcMs.
    let complete = true;
    for (let i = 0; i < required; i += 1) {
      if (sources[i].unixMs !== bucketOpen + i * srcMs) {
        complete = false;
        break;
      }
    }
    if (!complete) continue;

    let high = sources[0].high;
    let low = sources[0].low;
    let volume = 0;
    for (const src of sources) {
      if (src.high > high) high = src.high;
      if (src.low < low) low = src.low;
      volume += src.volume;
    }

    out.push({
      unixMs: bucketOpen,
      open: sources[0].open,
      high,
      low,
      close: sources[required - 1].close,
      volume
    });
  }

  out.sort((a, b) => a.unixMs - b.unixMs);
  return out;
};
```

- [ ] **Step 4: Run the test to confirm it passes**

Run:

```bash
pnpm test -- src/engine/candles/__tests__/aggregateCandles.test.ts
```

Expected: PASS for all 9 cases.

- [ ] **Step 5: Commit**

```bash
git add src/engine/candles/aggregateCandles.ts src/engine/candles/__tests__/aggregateCandles.test.ts
git commit -m "m42: add pure aggregateCandles utility for 15m -> 1h derivation"
```

---

### Task 5: Implement `regimeCandleReadPlan` (TDD)

**Files:**

- Create: `src/engine/marketRegime/regimeCandleReadPlan.ts`
- Test: `src/engine/marketRegime/__tests__/regimeCandleReadPlan.test.ts`

This helper centralizes the source-timeframe / read-limit / cutoff math, so the handler stays simple.

- [ ] **Step 1: Write the full failing test file**

Create `src/engine/marketRegime/__tests__/regimeCandleReadPlan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MARKET_REGIME_CONFIG } from "../config.js";
import { closedCandleCutoffUnixMs } from "../closedCandleCutoff.js";
import { buildRegimeCandleReadPlan } from "../regimeCandleReadPlan.js";

const NOW = 1_777_000_000_000; // arbitrary fixed instant for deterministic math

describe("buildRegimeCandleReadPlan(15m)", () => {
  const plan = buildRegimeCandleReadPlan({
    requestedTimeframe: "15m",
    nowUnixMs: NOW
  });

  it("uses 15m as the stored source timeframe", () => {
    expect(plan.sourceTimeframe).toBe("15m");
  });

  it("computes sourceCutoffUnixMs from the 15m freshness config", () => {
    const cfg = MARKET_REGIME_CONFIG["15m"];
    expect(plan.sourceCutoffUnixMs).toBe(
      closedCandleCutoffUnixMs(NOW, cfg.timeframeMs, cfg.freshness.closedCandleDelayMs)
    );
  });

  it("does not produce a derived cutoff", () => {
    expect(plan.derivedCutoffUnixMs).toBeUndefined();
  });

  it("uses sourceLimit = max(volLongWindow, minCandles) + READ_BUFFER", () => {
    const cfg = MARKET_REGIME_CONFIG["15m"];
    const expected = Math.max(cfg.indicators.volLongWindow, cfg.suitability.minCandles) + 50;
    expect(plan.sourceLimit).toBe(expected);
  });

  it("returns direct metadata hints", () => {
    expect(plan.metadataHints).toEqual({ sourceTimeframe: "15m" });
  });
});

describe("buildRegimeCandleReadPlan(1h)", () => {
  const plan = buildRegimeCandleReadPlan({
    requestedTimeframe: "1h",
    nowUnixMs: NOW
  });

  it("uses 15m as the stored source timeframe", () => {
    expect(plan.sourceTimeframe).toBe("15m");
  });

  it("computes sourceCutoffUnixMs from the 15m freshness config", () => {
    const cfg = MARKET_REGIME_CONFIG["15m"];
    expect(plan.sourceCutoffUnixMs).toBe(
      closedCandleCutoffUnixMs(NOW, cfg.timeframeMs, cfg.freshness.closedCandleDelayMs)
    );
  });

  it("computes derivedCutoffUnixMs from the 1h freshness config", () => {
    const cfg = MARKET_REGIME_CONFIG["1h"];
    expect(plan.derivedCutoffUnixMs).toBe(
      closedCandleCutoffUnixMs(NOW, cfg.timeframeMs, cfg.freshness.closedCandleDelayMs)
    );
  });

  it("uses sourceLimit = requiredDerivedBars * 4 + DERIVED_SOURCE_READ_BUFFER_15M", () => {
    const cfg = MARKET_REGIME_CONFIG["1h"];
    const requiredDerivedBars =
      Math.max(cfg.indicators.volLongWindow, cfg.suitability.minCandles) + 50;
    const expected = requiredDerivedBars * 4 + 32;
    expect(plan.sourceLimit).toBe(expected);
  });

  it("returns derived metadata hints", () => {
    expect(plan.metadataHints).toEqual({
      sourceTimeframe: "15m",
      derivedTimeframe: "1h",
      aggregationVersion: "ohlcv-agg-v1"
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
pnpm test -- src/engine/marketRegime/__tests__/regimeCandleReadPlan.test.ts
```

Expected: FAIL with module-not-found for `../regimeCandleReadPlan.js`.

- [ ] **Step 3: Implement the helper**

Create `src/engine/marketRegime/regimeCandleReadPlan.ts`:

```ts
import type { RegimeReadTimeframe } from "../../contract/v1/types.js";
import { MARKET_REGIME_CONFIG } from "./config.js";
import { closedCandleCutoffUnixMs } from "./closedCandleCutoff.js";

const READ_BUFFER = 50;
const FIFTEEN_MINUTES_PER_HOUR = 4;
const DERIVED_SOURCE_READ_BUFFER_15M = 32;

export interface DirectMetadataHints {
  sourceTimeframe: "15m";
}

export interface DerivedMetadataHints {
  sourceTimeframe: "15m";
  derivedTimeframe: "1h";
  aggregationVersion: "ohlcv-agg-v1";
}

export interface RegimeCandleReadPlan {
  sourceTimeframe: "15m";
  sourceCutoffUnixMs: number;
  sourceLimit: number;
  derivedCutoffUnixMs?: number;
  metadataHints: DirectMetadataHints | DerivedMetadataHints;
}

export interface BuildRegimeCandleReadPlanInput {
  requestedTimeframe: RegimeReadTimeframe;
  nowUnixMs: number;
}

export const buildRegimeCandleReadPlan = (
  input: BuildRegimeCandleReadPlanInput
): RegimeCandleReadPlan => {
  const sourceConfig = MARKET_REGIME_CONFIG["15m"];
  const sourceCutoffUnixMs = closedCandleCutoffUnixMs(
    input.nowUnixMs,
    sourceConfig.timeframeMs,
    sourceConfig.freshness.closedCandleDelayMs
  );

  if (input.requestedTimeframe === "15m") {
    const requestedConfig = MARKET_REGIME_CONFIG["15m"];
    const sourceLimit =
      Math.max(requestedConfig.indicators.volLongWindow, requestedConfig.suitability.minCandles) +
      READ_BUFFER;

    return {
      sourceTimeframe: "15m",
      sourceCutoffUnixMs,
      sourceLimit,
      metadataHints: { sourceTimeframe: "15m" }
    };
  }

  const derivedConfig = MARKET_REGIME_CONFIG["1h"];
  const derivedCutoffUnixMs = closedCandleCutoffUnixMs(
    input.nowUnixMs,
    derivedConfig.timeframeMs,
    derivedConfig.freshness.closedCandleDelayMs
  );
  const requiredDerivedBars =
    Math.max(derivedConfig.indicators.volLongWindow, derivedConfig.suitability.minCandles) +
    READ_BUFFER;
  const sourceLimit =
    requiredDerivedBars * FIFTEEN_MINUTES_PER_HOUR + DERIVED_SOURCE_READ_BUFFER_15M;

  return {
    sourceTimeframe: "15m",
    sourceCutoffUnixMs,
    sourceLimit,
    derivedCutoffUnixMs,
    metadataHints: {
      sourceTimeframe: "15m",
      derivedTimeframe: "1h",
      aggregationVersion: "ohlcv-agg-v1"
    }
  };
};
```

- [ ] **Step 4: Run the read-plan tests**

Run:

```bash
pnpm test -- src/engine/marketRegime/__tests__/regimeCandleReadPlan.test.ts
```

Expected: PASS for all 10 cases.

- [ ] **Step 5: Commit**

```bash
git add src/engine/marketRegime/regimeCandleReadPlan.ts src/engine/marketRegime/__tests__/regimeCandleReadPlan.test.ts
git commit -m "m42: add regimeCandleReadPlan helper for direct vs derived reads"
```

---

### Task 6: Extend `buildRegimeCurrent` with caller-supplied metadata

`buildRegimeCurrent` must remain source-agnostic; it just merges fields the handler supplies.

**Files:**

- Modify: `src/engine/marketRegime/buildRegimeCurrent.ts`
- Test: `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`
- Test: `src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts`

- [ ] **Step 1: Add a failing test asserting the new metadata fields are reflected**

Open `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`.

Append this test to the existing `describe` block:

```ts
it("merges caller-supplied source/derived metadata fields into the response", () => {
  const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
  const response = buildRegimeCurrent({
    feed: { ...feed, timeframe: "1h" as const },
    candles: flatCandles,
    nowUnixMs: lastCandleUnixMs + 20 * 60 * 1000,
    config: MARKET_REGIME_CONFIG["1h"],
    configVersion: "market-regime-2.0.0",
    engineVersion: "0.1.0",
    metadata: {
      sourceTimeframe: "15m",
      sourceCandleCount: 520,
      derivedTimeframe: "1h",
      aggregationVersion: "ohlcv-agg-v1"
    }
  });
  expect(response.timeframe).toBe("1h");
  expect(response.metadata.sourceTimeframe).toBe("15m");
  expect(response.metadata.sourceCandleCount).toBe(520);
  expect(response.metadata.derivedTimeframe).toBe("1h");
  expect(response.metadata.aggregationVersion).toBe("ohlcv-agg-v1");
  expect(response.metadata.candleCount).toBe(130);
});

it("omits derived metadata fields when caller provides only source fields", () => {
  const lastCandleUnixMs = flatCandles[flatCandles.length - 1].unixMs;
  const response = buildRegimeCurrent({
    feed,
    candles: flatCandles,
    nowUnixMs: lastCandleUnixMs + 20 * 60 * 1000,
    config: MARKET_REGIME_CONFIG["15m"],
    configVersion: "market-regime-2.0.0",
    engineVersion: "0.1.0",
    metadata: {
      sourceTimeframe: "15m",
      sourceCandleCount: 130
    }
  });
  expect(response.metadata.sourceTimeframe).toBe("15m");
  expect(response.metadata.sourceCandleCount).toBe(130);
  expect(response.metadata.derivedTimeframe).toBeUndefined();
  expect(response.metadata.aggregationVersion).toBeUndefined();
});
```

Also, in the same file, update each existing call to `buildRegimeCurrent` so that the call type-checks against the new mandatory metadata shape. For each existing call (the three currently in this file), add a `metadata` field:

```ts
      metadata: { sourceTimeframe: "15m", sourceCandleCount: flatCandles.length }
```

(or `fewCandles.length` for the few-candles case). The exact insertion point is after `engineVersion: "0.1.0"`.

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
pnpm test -- src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts
```

Expected: FAIL — `BuildRegimeCurrentInput` does not yet accept `metadata`, so the test will fail to type-check.

- [ ] **Step 3: Extend `buildRegimeCurrent`**

Open `src/engine/marketRegime/buildRegimeCurrent.ts`. Replace the file contents with:

```ts
import { computeIndicators } from "../features/indicators.js";
import type {
  Candle,
  MarketReason,
  RegimeCurrentResponse,
  RegimeReadTimeframe
} from "../../contract/v1/types.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { classifyMarketRegime } from "./classifyMarketRegime.js";
import { computeFreshness } from "./freshness.js";
import { evaluateMarketClmmSuitability } from "./evaluateMarketClmmSuitability.js";
import type { MarketTimeframeConfig } from "./config.js";

export interface BuildRegimeCurrentMetadata {
  sourceTimeframe: "15m";
  sourceCandleCount: number;
  derivedTimeframe?: "1h";
  aggregationVersion?: "ohlcv-agg-v1";
}

export interface BuildRegimeCurrentInput {
  feed: {
    symbol: string;
    source: string;
    network: string;
    poolAddress: string;
    timeframe: RegimeReadTimeframe;
  };
  candles: Candle[];
  nowUnixMs: number;
  config: MarketTimeframeConfig;
  configVersion: string;
  engineVersion: string;
  metadata: BuildRegimeCurrentMetadata;
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
  if (input.candles.length === 0) {
    throw new Error("buildRegimeCurrent requires at least one candle");
  }
  const { feed, candles, nowUnixMs, config, configVersion, engineVersion, metadata } = input;

  const telemetry = computeIndicators(candles, config.indicators);
  const { regime, reasons: regimeReasons } = classifyMarketRegime(telemetry, config.regime);

  const lastCandleUnixMs = candles[candles.length - 1].unixMs;
  const freshness = computeFreshness(nowUnixMs, lastCandleUnixMs, {
    softStaleMs: config.freshness.softStaleMs,
    hardStaleMs: config.freshness.hardStaleMs
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
      candleCount: candles.length,
      sourceTimeframe: metadata.sourceTimeframe,
      sourceCandleCount: metadata.sourceCandleCount,
      ...(metadata.derivedTimeframe !== undefined
        ? { derivedTimeframe: metadata.derivedTimeframe }
        : {}),
      ...(metadata.aggregationVersion !== undefined
        ? { aggregationVersion: metadata.aggregationVersion }
        : {})
    }
  };
};
```

`metadata` is required from the caller. Direct callers pass `sourceTimeframe: "15m", sourceCandleCount: candles.length`. Derived callers pass all four fields.

- [ ] **Step 4: Update the snapshot test to pass new metadata**

Open `src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts`.

Find:

```ts
      configVersion: MARKET_REGIME_CONFIG_VERSION,
      engineVersion: "0.1.0"
    });
```

Replace with:

```ts
      configVersion: MARKET_REGIME_CONFIG_VERSION,
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: goldenCandles.length
      }
    });
```

- [ ] **Step 5: Run the snapshot test and update the snapshot**

The snapshot output now includes new fields. Run:

```bash
pnpm test -- src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts -u
```

Expected: PASS, with the snapshot file updated to include `sourceTimeframe: "15m"` and `sourceCandleCount: 130` in `metadata`. After it passes, run without `-u` to confirm:

```bash
pnpm test -- src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts
```

Expected: PASS, no snapshot drift.

- [ ] **Step 6: Run the full marketRegime suite**

Run:

```bash
pnpm test -- src/engine/marketRegime
```

Expected: PASS for all marketRegime tests, including the two new metadata tests in `buildRegimeCurrent.test.ts`, the snapshot test, and the `1h` config tests.

- [ ] **Step 7: Commit**

```bash
git add src/engine/marketRegime/buildRegimeCurrent.ts \
        src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts \
        src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts \
        src/engine/marketRegime/__tests__/__snapshots__
git commit -m "m42: thread caller-supplied metadata fields through buildRegimeCurrent"
```

(If `__snapshots__` does not exist as a tracked path under `__tests__`, omit it from `git add`; the regenerated snapshot file will surface as a normal modification under the existing snapshots directory.)

---

### Task 7: Rewrite `regimeCurrent` handler to orchestrate direct vs derived

**Files:**

- Modify: `src/http/handlers/regimeCurrent.ts`

This rewrite removes the local `READ_BUFFER` constant and the inline cutoff math, replacing them with `buildRegimeCandleReadPlan`. The store call always reads `15m` rows, regardless of the requested regime-read timeframe.

- [ ] **Step 1: Replace the handler implementation**

Open `src/http/handlers/regimeCurrent.ts`. Replace the file contents with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { parseRegimeCurrentQuery } from "../../contract/v1/validation.js";
import { candlesNotFoundError, ContractValidationError } from "../errors.js";
import type { LedgerStore } from "../../ledger/store.js";
import { getLatestCandlesForFeed } from "../../ledger/candlesWriter.js";
import type { CandleStore } from "../../ledger/candleStore.js";
import {
  MARKET_REGIME_CONFIG,
  MARKET_REGIME_CONFIG_VERSION
} from "../../engine/marketRegime/config.js";
import { buildRegimeCurrent } from "../../engine/marketRegime/buildRegimeCurrent.js";
import { buildRegimeCandleReadPlan } from "../../engine/marketRegime/regimeCandleReadPlan.js";
import { aggregateCandles } from "../../engine/candles/aggregateCandles.js";

export const createRegimeCurrentHandler = (store: LedgerStore, candleStore?: CandleStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = parseRegimeCurrentQuery(request.query);
      const config = MARKET_REGIME_CONFIG[query.timeframe];

      const nowUnixMs = Date.now();
      const plan = buildRegimeCandleReadPlan({
        requestedTimeframe: query.timeframe,
        nowUnixMs
      });

      const sourceCandles = candleStore
        ? await candleStore.getLatestCandlesForFeed({
            symbol: query.symbol,
            source: query.source,
            network: query.network,
            poolAddress: query.poolAddress,
            timeframe: plan.sourceTimeframe,
            closedCandleCutoffUnixMs: plan.sourceCutoffUnixMs,
            limit: plan.sourceLimit
          })
        : await Promise.resolve(
            getLatestCandlesForFeed(store, {
              symbol: query.symbol,
              source: query.source,
              network: query.network,
              poolAddress: query.poolAddress,
              timeframe: plan.sourceTimeframe,
              closedCandleCutoffUnixMs: plan.sourceCutoffUnixMs,
              limit: plan.sourceLimit
            })
          );

      if (sourceCandles.length === 0) {
        throw candlesNotFoundError(
          `No closed candles found for symbol="${query.symbol}", source="${query.source}", ` +
            `network="${query.network}", poolAddress="${query.poolAddress}", ` +
            `sourceTimeframe="${plan.sourceTimeframe}", requestedTimeframe="${query.timeframe}".`
        );
      }

      let classifiedCandles = sourceCandles;
      if (query.timeframe === "1h") {
        const aggregated = aggregateCandles(sourceCandles, "1h");
        classifiedCandles = aggregated.filter(
          (candle) => candle.unixMs <= (plan.derivedCutoffUnixMs as number)
        );
        if (classifiedCandles.length === 0) {
          throw candlesNotFoundError(
            `No complete derived 1h candles available before the 1h freshness cutoff for ` +
              `symbol="${query.symbol}", source="${query.source}", network="${query.network}", ` +
              `poolAddress="${query.poolAddress}".`
          );
        }
      }

      const response = buildRegimeCurrent({
        feed: {
          symbol: query.symbol,
          source: query.source,
          network: query.network,
          poolAddress: query.poolAddress,
          timeframe: query.timeframe
        },
        candles: classifiedCandles,
        nowUnixMs,
        config,
        configVersion: MARKET_REGIME_CONFIG_VERSION,
        engineVersion: process.env.npm_package_version ?? "0.0.0",
        metadata: {
          ...plan.metadataHints,
          sourceCandleCount: sourceCandles.length
        }
      });

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      request.log.error(error, "Unhandled error in GET /v1/regime/current");
      return reply.code(500).send({
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] }
      });
    }
  };
};
```

Notes:

- The store always reads `plan.sourceTimeframe = "15m"`, regardless of `query.timeframe`.
- For derived `1h`, we aggregate then filter by the `1h` derived cutoff. Empty post-filter returns `CANDLES_NOT_FOUND`.
- For derived `1h`, if aggregation yields some derived candles but fewer than `MARKET_REGIME_CONFIG["1h"].suitability.minCandles`, we still call `buildRegimeCurrent`, which surfaces `DATA_INSUFFICIENT_SAMPLES` via the existing path.
- `sourceCandleCount` in metadata is the actual `15m` row count returned by the store before aggregation/filtering, per the spec.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS. The handler change should now be type-clean.

- [ ] **Step 3: Run the existing handler e2e tests** (we'll add new ones in Task 8)

Run:

```bash
pnpm test -- src/http/__tests__/regimeCurrent.e2e.test.ts src/http/__tests__/candleFallback.e2e.test.ts
```

Expected: PASS for the existing direct `15m` cases — the new orchestration must not regress them. (If it does, fix before moving on.)

- [ ] **Step 4: Commit**

```bash
git add src/http/handlers/regimeCurrent.ts
git commit -m "m42: orchestrate direct 15m and derived 1h reads in regimeCurrent handler"
```

---

### Task 8: Add and update regime-current e2e tests

**Files:**

- Modify: `src/http/__tests__/regimeCurrent.e2e.test.ts`

The existing direct-`15m` e2e cases need a metadata-shape upgrade, and we add five new cases that exercise the derived `1h` flow against real ingested `15m` candles. Build all candles relative to the current real wall clock so they are within the freshness windows used by the regime engine; aligned timestamps land on `15m` boundaries in real time.

- [ ] **Step 1: Add direct-`15m` metadata assertions to the existing 200 case**

Open `src/http/__tests__/regimeCurrent.e2e.test.ts`.

Find this existing assertion block (inside the "returns 200 with regime and suitability fields for sufficient CHOP candles" test):

```ts
expect(body.metadata.candleCount).toBeGreaterThanOrEqual(
  MARKET_REGIME_CONFIG["15m"].suitability.minCandles
);
```

Insert the following lines immediately after it:

```ts
expect(body.metadata.sourceTimeframe).toBe("15m");
expect(body.metadata.sourceCandleCount).toBe(body.metadata.candleCount);
expect(body.metadata.derivedTimeframe).toBeUndefined();
expect(body.metadata.aggregationVersion).toBeUndefined();
```

- [ ] **Step 2: Add a new derived-`1h` query string constant and ingest helper**

Near the top of the file, after the existing `queryString` constant, add:

```ts
const queryString1h =
  "?symbol=SOL%2FUSDC&source=birdeye&network=solana-mainnet&poolAddress=Pool111&timeframe=1h";
```

The existing `buildRecentCandles` and `ingestPayload` helpers already build `15m`-aligned candles relative to wall-clock; reuse them.

- [ ] **Step 3: Add a derived-`1h` success test**

Append the following inside the existing `describe("GET /v1/regime/current", ...)` block (after the existing tests, before the closing `});`):

```ts
it("returns 200 with derived 1h regime classified from stored 15m candles", async () => {
  process.env.LEDGER_DB_PATH = tempDb();
  process.env.CANDLES_INGEST_TOKEN = "test-token";
  const app = buildApp();

  const recordedIso = new Date().toISOString();
  // Need at least minCandles(1h) = 30 derived bars; each 1h bar needs 4 aligned 15m bars,
  // plus headroom for the freshness cutoff filter. 200 source bars is more than enough.
  await app.inject({
    method: "POST",
    url: "/v1/candles",
    headers: { "X-Candles-Ingest-Token": "test-token" },
    payload: ingestPayload(200, recordedIso)
  });

  const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.schemaVersion).toBe("1.0");
  expect(body.timeframe).toBe("1h");
  expect(["UP", "DOWN", "CHOP"]).toContain(body.regime);
  expect(body.metadata.sourceTimeframe).toBe("15m");
  expect(body.metadata.sourceCandleCount).toBeGreaterThanOrEqual(body.metadata.candleCount * 4);
  expect(body.metadata.derivedTimeframe).toBe("1h");
  expect(body.metadata.aggregationVersion).toBe("ohlcv-agg-v1");
  expect(body.metadata.candleCount).toBeGreaterThan(0);
  expect(Array.isArray(body.marketReasons)).toBe(true);
});
```

- [ ] **Step 4: Add a derived-`1h` excludes-incomplete-current-bucket test**

Append:

```ts
it("derived 1h does not classify the incomplete current-hour aggregate", async () => {
  process.env.LEDGER_DB_PATH = tempDb();
  process.env.CANDLES_INGEST_TOKEN = "test-token";
  const app = buildApp();

  await app.inject({
    method: "POST",
    url: "/v1/candles",
    headers: { "X-Candles-Ingest-Token": "test-token" },
    payload: ingestPayload(200, new Date().toISOString())
  });

  const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
  expect(res.statusCode).toBe(200);
  const body = res.json();

  // The derived bar at the most recent classified bucket should be strictly older than now.
  expect(body.freshness.lastCandleUnixMs).toBeLessThan(Date.now());

  // It should also be older than the most recent stored 15m bucket (since 1h derived bars
  // open on hour boundaries and the most recent 15m bar may be inside the current hour).
  const ONE_HOUR_MS = 60 * 60 * 1000;
  expect(body.freshness.lastCandleUnixMs % ONE_HOUR_MS).toBe(0);
});
```

- [ ] **Step 5: Add a derived-`1h` zero-candles-after-aggregation test**

Append:

```ts
it("returns 404 CANDLES_NOT_FOUND when no derived 1h bars survive the cutoff", async () => {
  process.env.LEDGER_DB_PATH = tempDb();
  process.env.CANDLES_INGEST_TOKEN = "test-token";
  const app = buildApp();

  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const sourceConfig = MARKET_REGIME_CONFIG["15m"];

  // Build three 15m candles inside a single hour bucket so aggregation yields no
  // complete 1h candle. Anchor the bucket recently so it survives the 15m source cutoff.
  const sourceCutoffUnixMs =
    Math.floor((Date.now() - sourceConfig.freshness.closedCandleDelayMs) / FIFTEEN_MIN_MS) *
      FIFTEEN_MIN_MS -
    FIFTEEN_MIN_MS;
  const hourOpen =
    Math.floor((sourceCutoffUnixMs - 4 * FIFTEEN_MIN_MS) / ONE_HOUR_MS) * ONE_HOUR_MS;
  const partialCandles = [0, 1, 2].map((i) => ({
    unixMs: hourOpen + i * FIFTEEN_MIN_MS,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 1
  }));

  await app.inject({
    method: "POST",
    url: "/v1/candles",
    headers: { "X-Candles-Ingest-Token": "test-token" },
    payload: {
      schemaVersion: "1.0",
      source: "birdeye",
      network: "solana-mainnet",
      poolAddress: "Pool111",
      symbol: "SOL/USDC",
      timeframe: "15m",
      sourceRecordedAtIso: new Date().toISOString(),
      candles: partialCandles
    }
  });

  const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe("CANDLES_NOT_FOUND");
});
```

- [ ] **Step 6: Add an insufficient-derived-samples test (nonzero but below minCandles)**

Append:

```ts
it("derived 1h with non-zero but insufficient derived bars returns DATA_INSUFFICIENT_SAMPLES", async () => {
  process.env.LEDGER_DB_PATH = tempDb();
  process.env.CANDLES_INGEST_TOKEN = "test-token";
  const app = buildApp();

  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const sourceConfig = MARKET_REGIME_CONFIG["15m"];

  // Produce ~5 complete 1h derived bars: 5 * 4 = 20 source 15m bars,
  // anchored before the 15m source cutoff so they all read back.
  const sourceCutoffUnixMs =
    Math.floor((Date.now() - sourceConfig.freshness.closedCandleDelayMs) / FIFTEEN_MIN_MS) *
      FIFTEEN_MIN_MS -
    FIFTEEN_MIN_MS;
  const lastHourOpen = Math.floor(sourceCutoffUnixMs / ONE_HOUR_MS) * ONE_HOUR_MS - ONE_HOUR_MS;
  const startHourOpen = lastHourOpen - 4 * ONE_HOUR_MS;
  const candles: Array<{
    unixMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> = [];
  for (let h = 0; h < 5; h += 1) {
    for (let q = 0; q < 4; q += 1) {
      candles.push({
        unixMs: startHourOpen + h * ONE_HOUR_MS + q * FIFTEEN_MIN_MS,
        open: 100,
        high: 100.5,
        low: 99.5,
        close: 100,
        volume: 1
      });
    }
  }

  await app.inject({
    method: "POST",
    url: "/v1/candles",
    headers: { "X-Candles-Ingest-Token": "test-token" },
    payload: {
      schemaVersion: "1.0",
      source: "birdeye",
      network: "solana-mainnet",
      poolAddress: "Pool111",
      symbol: "SOL/USDC",
      timeframe: "15m",
      sourceRecordedAtIso: new Date().toISOString(),
      candles
    }
  });

  const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.metadata.candleCount).toBeLessThan(MARKET_REGIME_CONFIG["1h"].suitability.minCandles);
  expect(body.marketReasons.map((r: { code: string }) => r.code)).toContain(
    "DATA_INSUFFICIENT_SAMPLES"
  );
  expect(body.clmmSuitability.status).toBe("UNKNOWN");
});
```

- [ ] **Step 7: Add an empty-source test for derived 1h (separate from CANDLES_NOT_FOUND-after-aggregation)**

Append:

```ts
it("returns 404 CANDLES_NOT_FOUND for derived 1h when no 15m source candles exist at all", async () => {
  process.env.LEDGER_DB_PATH = tempDb();
  const app = buildApp();
  const res = await app.inject({ method: "GET", url: `/v1/regime/current${queryString1h}` });
  expect(res.statusCode).toBe(404);
  expect(res.json().error.code).toBe("CANDLES_NOT_FOUND");
});
```

- [ ] **Step 8: Run the full e2e suite**

Run:

```bash
pnpm test -- src/http/__tests__/regimeCurrent.e2e.test.ts
```

Expected: PASS for the existing direct-`15m` cases plus the five new derived-`1h` cases.

Also re-run the fallback test:

```bash
pnpm test -- src/http/__tests__/candleFallback.e2e.test.ts
```

Expected: PASS — the fallback test still reads `15m` and asserts `CANDLES_NOT_FOUND`.

- [ ] **Step 9: Commit**

```bash
git add src/http/__tests__/regimeCurrent.e2e.test.ts
git commit -m "m42: cover derived 1h regime reads with end-to-end tests"
```

---

### Task 9: Update OpenAPI

**Files:**

- Modify: `src/http/openapi.ts`

- [ ] **Step 1: Widen the `/v1/regime/current` `timeframe` enum and refresh summary**

Open `src/http/openapi.ts`.

Find:

```ts
      "/v1/regime/current": {
        get: {
          summary:
            "Market-only regime classification + CLMM suitability for a 15m feed (timeframe must be 15m; 1h removed, see #41/#42)",
```

Replace with:

```ts
      "/v1/regime/current": {
        get: {
          summary:
            "Market-only regime classification + CLMM suitability. timeframe=15m classifies stored 15m candles directly; timeframe=1h derives complete 1h candles from stored 15m candles on the fly.",
```

Then find:

```ts
            {
              name: "timeframe",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["15m"] }
            }
```

Replace with:

```ts
            {
              name: "timeframe",
              in: "query",
              required: true,
              schema: { type: "string", enum: ["15m", "1h"] }
            }
```

- [ ] **Step 2: Tighten the `/v1/candles` summary note (still 15m only)**

Find:

```ts
      "/v1/candles": {
        post: {
          summary:
            "Ingest candle revisions for a logical feed (timeframe must be 15m; 1h removed in #41 until #42 derives 1h from 15m)",
```

Replace with:

```ts
      "/v1/candles": {
        post: {
          summary:
            "Ingest candle revisions for a logical feed. Provider ingestion is restricted to timeframe=15m; 1h regime reads are derived from stored 15m candles by GET /v1/regime/current.",
```

- [ ] **Step 3: Run typecheck and the openapi-related tests if any exist**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

If there are openapi tests, run them; otherwise the TS shape is sufficient validation here:

```bash
pnpm test -- src/http/__tests__/routes.contract.test.ts
```

Expected: PASS (the existing contract test does not depend on the openapi text changes).

- [ ] **Step 4: Commit**

```bash
git add src/http/openapi.ts
git commit -m "m42: widen /v1/regime/current timeframe enum to [15m, 1h] in openapi"
```

---

### Task 10: Update README

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Replace the `#41` contract-change note**

Open `README.md`.

Find:

```md
- `GET /v1/regime/current?symbol=&source=&network=&poolAddress=&timeframe=15m` —
  market-only regime classification + CLMM suitability. Stateless: no
  `RegimeState`, no portfolio/autopilot inputs, no plan-ledger writes.
```

Replace with:

```md
- `GET /v1/regime/current?symbol=&source=&network=&poolAddress=&timeframe=15m|1h` —
  market-only regime classification + CLMM suitability. `timeframe=15m`
  classifies stored 15m candles directly; `timeframe=1h` derives complete 1h
  candles from stored 15m candles on the fly. Stateless: no `RegimeState`, no
  portfolio/autopilot inputs, no plan-ledger writes.
```

Then find:

```md
> **#41 contract change:** `POST /v1/candles` and `GET /v1/regime/current` accept `timeframe=15m` only. `timeframe=1h` is removed and is restored as a derived read in #42 (1h derived from stored 15m candles). Coordinate consumers before deploying.
```

Replace with:

```md
> **#41 / #42 contract:** `POST /v1/candles` accepts `timeframe=15m` only (provider ingestion is canonical at 15m). `GET /v1/regime/current` accepts `timeframe=15m | 1h`. The `1h` regime read is derived on the fly from stored 15m candles (no provider-ingested 1h candles, no derived storage). Response metadata includes `sourceTimeframe`, `sourceCandleCount`, and on derived reads `derivedTimeframe` and `aggregationVersion`.
```

- [ ] **Step 2: Update the `GECKO_TIMEFRAME` row to drop the `#41 until #42` qualifier**

Find:

```md
| `GECKO_TIMEFRAME` | `15m` | Must equal `15m`. (`1h` is removed in #41 until #42.) |
```

Replace with:

```md
| `GECKO_TIMEFRAME` | `15m` | Must equal `15m`. Provider ingestion is canonical at 15m; 1h regime reads are derived. |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "m42: refresh README to describe derived 1h regime reads"
```

---

### Task 11: Quality gate

- [ ] **Step 1: Run typecheck, lint, full test suite, and build**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four steps PASS. If any step fails, fix at the root cause (do not paper over with `-- --no-verify`-style escapes); re-run the gate.

- [ ] **Step 2: Confirm no stray `1h` regime-read rejection text remains**

Run:

```bash
grep -RIn "1h removed" src docs README.md || true
grep -RIn "until #42" src docs README.md || true
grep -RIn "rejects timeframe=1h" src/contract/v1/__tests__ || true
```

Expected: no matches in `src/` or `README.md`. (Hits in `docs/` are likely just historical specs / compounded learnings — fine.)

- [ ] **Step 3: Confirm no `1h` ingestion regression**

Run:

```bash
pnpm test -- src/http/__tests__/candles.e2e.test.ts src/contract/v1/__tests__/candles.validation.test.ts
```

Expected: PASS — `POST /v1/candles` still rejects `timeframe: "1h"`.

- [ ] **Step 4: Confirm derived metadata round-trips end to end**

Quickly sanity-check the response shape:

```bash
pnpm test -- src/http/__tests__/regimeCurrent.e2e.test.ts -t "derived 1h"
```

Expected: PASS for all four `derived 1h` cases.

- [ ] **Step 5: Final commit (only if any small fixups landed during the gate)**

```bash
git status
```

If any changes were made during the gate, commit them with a focused message such as `m42: address quality-gate findings`.

---

## Acceptance Criteria

This plan is complete when:

- `CandleIngestTimeframe` is still `"15m"` and `POST /v1/candles` still rejects `timeframe: "1h"`.
- `RegimeReadTimeframe` is `"15m" | "1h"`.
- `MARKET_REGIME_CONFIG` has both a `"15m"` and a `"1h"` entry, with the `1h` entry restoring the pre-#41 windows and freshness thresholds.
- `aggregateCandles(candles, "1h")` is pure: emits sorted complete-bucket derived candles, skips incomplete/misaligned/cross-hour cases, never synthesizes.
- `buildRegimeCandleReadPlan` correctly returns `15m` source identity, source/derived cutoffs, source limit, and metadata hints for both regime-read timeframes.
- `GET /v1/regime/current?timeframe=15m` still works, with response metadata now including `sourceTimeframe="15m"` and `sourceCandleCount === candleCount`.
- `GET /v1/regime/current?timeframe=1h` returns a regime classified on derived `1h` candles aggregated from stored `15m` rows; metadata includes `sourceTimeframe`, `sourceCandleCount`, `derivedTimeframe`, and `aggregationVersion`.
- Derived current-hour incomplete buckets are excluded; derived zero-after-filter returns `CANDLES_NOT_FOUND`; derived nonzero-but-insufficient surfaces `DATA_INSUFFICIENT_SAMPLES` via `buildRegimeCurrent`.
- No new database tables, migrations, or provider-1h ingestion paths are added.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.

---

## Self-review notes

This plan covers every section of the spec:

- Public Contract → Tasks 1, 6, 7
- `aggregateCandles.ts` → Task 4
- `regimeCandleReadPlan.ts` → Task 5
- Handler flow → Task 7
- `buildRegimeCurrent` extension → Task 6
- Cutoff and no-lookahead rules → Tasks 5 (cutoff math) + 7 (filtering after aggregation)
- Configuration → Task 3
- Validation → Task 2
- Testing plan (aggregation utility, read plan, contract validation, regime-current handler) → Tasks 4, 5, 2, 8
- Acceptance criteria → "Acceptance Criteria" section above
