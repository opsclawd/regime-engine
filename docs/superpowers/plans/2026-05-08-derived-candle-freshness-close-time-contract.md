# Derived Candle Freshness Close-Time Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/v1/regime/current` freshness from candle-open-age semantics to candle-close-age semantics so derived `1h` reads stop reporting healthy data as `108m` stale, and rename freshness fields to make open vs close explicit.

**Architecture:** `computeFreshness` becomes the single owner of open-to-close conversion: callers pass `lastCandleOpenUnixMs` plus `timeframeMs`, and the function emits `lastCandleOpenUnixMs/Iso` and `lastCandleCloseUnixMs/Iso`, with `ageSeconds`/`softStale`/`hardStale` measured from close time. `buildRegimeCurrent` and `generatePlanUseCase` thread `config.timeframeMs` through; the legacy `lastCandleUnixMs`/`lastCandleIso` fields are removed everywhere (types, tests, snapshots, HTTP assertions). The `Candle` model and aggregation math are unchanged: stored `unixMs` remains bucket-open.

**Tech Stack:** TypeScript, Vitest 3, Fastify 5, ESLint, Prettier.

**Spec:** `docs/superpowers/specs/2026-05-08-derived-candle-freshness-close-time-design.md`
**Issue:** [#52](https://github.com/opsclawd/regime-engine/issues/52)

---

## File Structure

### Modified files

```
src/engine/marketRegime/
  freshness.ts                                       modify  rename inputs, add close fields, add timeframeMs validation
  buildRegimeCurrent.ts                              modify  pass config.timeframeMs into computeFreshness
  __tests__/
    freshness.test.ts                                modify  rewrite to cover open/close split + invalid timeframeMs
    buildRegimeCurrent.test.ts                       modify  add direct-15m and derived-1h close-age cases
    buildRegimeCurrent.snapshot.test.ts.snap         modify  regenerate (close fields, new ageSeconds)

src/contract/v1/
  types.ts                                           modify  RegimeCurrentFreshness drops legacy fields, adds open+close fields
  __tests__/
    canonicalHash.snapshot.test.ts                   modify  fixture freshness uses open/close fields
    __snapshots__/canonicalHash.snapshot.test.ts.snap regenerate

src/application/use-cases/
  generatePlanUseCase.ts                             modify  pass config.timeframeMs into computeFreshness

src/engine/plan/__tests__/
  positionPlan.policy.test.ts                        modify  baseFreshness fixture uses open/close fields
  positionPlan.snapshot.test.ts                      modify  fixture freshness uses open/close fields
  __snapshots__/positionPlan.snapshot.test.ts.snap   regenerate

src/report/__tests__/
  weeklyReport.snapshot.test.ts                      modify  fixture freshness uses open/close fields
  __snapshots__/weeklyReport.snapshot.test.ts.snap   regenerate (if any)

src/ledger/__tests__/
  ledger.test.ts                                     modify  freshness fixture uses open/close fields

src/adapters/http/__tests__/
  regimeCurrent.e2e.test.ts                          modify  assert lastCandleOpenUnixMs/Iso and lastCandleCloseUnixMs/Iso
```

No new files. No deletions.

---

## Task 1: Update `FreshnessResult` and `computeFreshness` signature/semantics

**Files:**

- Modify: `src/engine/marketRegime/freshness.ts`
- Test: `src/engine/marketRegime/__tests__/freshness.test.ts`

This is the heart of the change. `computeFreshness` becomes the single owner of open-to-close conversion. Callers pass `lastCandleOpenUnixMs` plus `timeframeMs`; the function emits both open and close fields, and ages from close.

- [ ] **Step 1: Replace the freshness unit tests with the new contract**

Overwrite `src/engine/marketRegime/__tests__/freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeFreshness } from "../freshness.js";

const ONE_MIN_MS = 60 * 1000;
const FIFTEEN_MIN_MS = 15 * ONE_MIN_MS;
const ONE_HOUR_MS = 60 * ONE_MIN_MS;

const config = {
  softStaleMs: 75 * ONE_MIN_MS,
  hardStaleMs: 90 * ONE_MIN_MS
};

describe("computeFreshness", () => {
  it("ages a direct 15m candle from its close time", () => {
    // open 02:30, close 02:45, now 02:48 -> ~3m old
    const open = Date.parse("2026-04-26T02:30:00.000Z");
    const now = Date.parse("2026-04-26T02:48:00.000Z");
    const result = computeFreshness(now, open, FIFTEEN_MIN_MS, config);

    expect(result.lastCandleOpenUnixMs).toBe(open);
    expect(result.lastCandleOpenIso).toBe("2026-04-26T02:30:00.000Z");
    expect(result.lastCandleCloseUnixMs).toBe(open + FIFTEEN_MIN_MS);
    expect(result.lastCandleCloseIso).toBe("2026-04-26T02:45:00.000Z");
    expect(result.ageSeconds).toBe(3 * 60);
    expect(result.softStale).toBe(false);
    expect(result.hardStale).toBe(false);
  });

  it("ages a derived 1h candle from its close time, not bucket open", () => {
    // open 01:00, close 02:00, now 02:48 -> 48m old (not 108m)
    const open = Date.parse("2026-04-26T01:00:00.000Z");
    const now = Date.parse("2026-04-26T02:48:00.000Z");
    const result = computeFreshness(now, open, ONE_HOUR_MS, config);

    expect(result.lastCandleCloseIso).toBe("2026-04-26T02:00:00.000Z");
    expect(result.ageSeconds).toBe(48 * 60);
    expect(result.softStale).toBe(false);
    expect(result.hardStale).toBe(false);
  });

  it("flags hardStale on the derived 1h close-age boundary", () => {
    // open 01:00, close 02:00, now 03:31 -> 91m close-age, hard threshold 90m
    const open = Date.parse("2026-04-26T01:00:00.000Z");
    const now = Date.parse("2026-04-26T03:31:00.000Z");
    const result = computeFreshness(now, open, ONE_HOUR_MS, config);

    expect(result.softStale).toBe(true);
    expect(result.hardStale).toBe(true);
  });

  it("clamps future-close candles to ageSeconds 0", () => {
    const open = Date.parse("2026-04-26T02:00:00.000Z");
    // close is 03:00, now is 02:30, so close is in the future
    const now = Date.parse("2026-04-26T02:30:00.000Z");
    const result = computeFreshness(now, open, ONE_HOUR_MS, config);

    expect(result.ageSeconds).toBe(0);
    expect(result.softStale).toBe(false);
    expect(result.hardStale).toBe(false);
  });

  it("populates generatedAtIso and threshold seconds", () => {
    const open = Date.parse("2026-04-26T12:00:00.000Z");
    const now = open + 30 * ONE_MIN_MS;
    const result = computeFreshness(now, open, FIFTEEN_MIN_MS, config);

    expect(result.generatedAtIso).toBe(new Date(now).toISOString());
    expect(result.softStaleSeconds).toBe(75 * 60);
    expect(result.hardStaleSeconds).toBe(90 * 60);
  });

  it("does not return legacy lastCandleUnixMs or lastCandleIso fields", () => {
    const open = Date.parse("2026-04-26T01:00:00.000Z");
    const now = open + 5 * ONE_MIN_MS;
    const result = computeFreshness(now, open, ONE_HOUR_MS, config) as Record<string, unknown>;

    expect(result.lastCandleUnixMs).toBeUndefined();
    expect(result.lastCandleIso).toBeUndefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws for invalid timeframeMs %p",
    (bad) => {
      const open = Date.parse("2026-04-26T01:00:00.000Z");
      expect(() => computeFreshness(open + 1000, open, bad, config)).toThrow(
        /timeframeMs must be a positive finite number/
      );
    }
  );
});
```

- [ ] **Step 2: Run the test to verify it fails (red)**

Run: `npx vitest run src/engine/marketRegime/__tests__/freshness.test.ts`
Expected: FAIL — `computeFreshness` still has the old `(now, lastCandleUnixMs, config)` signature; new fields and timeframe validation do not exist.

- [ ] **Step 3: Implement the new `computeFreshness`**

Overwrite `src/engine/marketRegime/freshness.ts`:

```ts
export interface FreshnessConfig {
  softStaleMs: number;
  hardStaleMs: number;
}

export interface FreshnessResult {
  generatedAtIso: string;
  lastCandleOpenUnixMs: number;
  lastCandleOpenIso: string;
  lastCandleCloseUnixMs: number;
  lastCandleCloseIso: string;
  ageSeconds: number;
  softStale: boolean;
  hardStale: boolean;
  softStaleSeconds: number;
  hardStaleSeconds: number;
}

export const computeFreshness = (
  nowUnixMs: number,
  lastCandleOpenUnixMs: number,
  timeframeMs: number,
  config: FreshnessConfig
): FreshnessResult => {
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    throw new Error("timeframeMs must be a positive finite number");
  }

  const lastCandleCloseUnixMs = lastCandleOpenUnixMs + timeframeMs;
  const ageMs = Math.max(0, nowUnixMs - lastCandleCloseUnixMs);

  return {
    generatedAtIso: new Date(nowUnixMs).toISOString(),
    lastCandleOpenUnixMs,
    lastCandleOpenIso: new Date(lastCandleOpenUnixMs).toISOString(),
    lastCandleCloseUnixMs,
    lastCandleCloseIso: new Date(lastCandleCloseUnixMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    softStale: ageMs >= config.softStaleMs,
    hardStale: ageMs >= config.hardStaleMs,
    softStaleSeconds: Math.floor(config.softStaleMs / 1000),
    hardStaleSeconds: Math.floor(config.hardStaleMs / 1000)
  };
};
```

- [ ] **Step 4: Run the test to verify it passes (green)**

Run: `npx vitest run src/engine/marketRegime/__tests__/freshness.test.ts`
Expected: PASS — all `computeFreshness` cases.

- [ ] **Step 5: Commit**

```bash
git add src/engine/marketRegime/freshness.ts \
        src/engine/marketRegime/__tests__/freshness.test.ts
git commit -m "m52: compute freshness from candle close time"
```

---

## Task 2: Update `RegimeCurrentFreshness` contract type

**Files:**

- Modify: `src/contract/v1/types.ts:339-348`

The HTTP/contract type must mirror the new `FreshnessResult` shape. After this task, the project will not typecheck because all call sites still construct the legacy shape — that is fixed in Tasks 3–10.

- [ ] **Step 1: Replace the `RegimeCurrentFreshness` interface**

Edit `src/contract/v1/types.ts` and replace the existing interface (currently lines 339–348):

```ts
export interface RegimeCurrentFreshness {
  generatedAtIso: string;
  lastCandleOpenUnixMs: number;
  lastCandleOpenIso: string;
  lastCandleCloseUnixMs: number;
  lastCandleCloseIso: string;
  ageSeconds: number;
  softStale: boolean;
  hardStale: boolean;
  softStaleSeconds: number;
  hardStaleSeconds: number;
}
```

There are no aliases and no deprecated compatibility fields. The legacy `lastCandleUnixMs` / `lastCandleIso` fields must not appear in the type.

- [ ] **Step 2: Verify typecheck fails at expected callsites**

Run: `npm run typecheck`
Expected: FAIL — errors at `buildRegimeCurrent.ts`, `generatePlanUseCase.ts`, the four test fixture files (`positionPlan.policy.test.ts`, `positionPlan.snapshot.test.ts`, `weeklyReport.snapshot.test.ts`, `ledger.test.ts`, `canonicalHash.snapshot.test.ts`) referencing `lastCandleUnixMs` / `lastCandleIso`.

This confirms the type change is strict (no silent compatibility) before we touch each call site.

- [ ] **Step 3: Commit**

```bash
git add src/contract/v1/types.ts
git commit -m "m52: switch RegimeCurrentFreshness to open/close fields"
```

---

## Task 3: Wire `timeframeMs` through `buildRegimeCurrent`

**Files:**

- Modify: `src/engine/marketRegime/buildRegimeCurrent.ts:89-93`
- Test: `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`

`buildRegimeCurrent` already has `config.timeframeMs` available (see `src/engine/marketRegime/config.ts:7`). It just needs to pass it to `computeFreshness` and stop computing close timestamps itself.

- [ ] **Step 1: Add direct-15m and derived-1h close-age tests to `buildRegimeCurrent.test.ts`**

Edit `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`. After the existing `describe("buildRegimeCurrent with aggregated 1h candles", ...)` block, append a new describe:

```ts
describe("buildRegimeCurrent freshness close-age semantics", () => {
  it("ages direct 15m freshness from candle close time", () => {
    // last candle open at index 129 -> opens at 130 * 15m, closes at 131 * 15m.
    const lastCandleOpenUnixMs = flatCandles[flatCandles.length - 1].unixMs;
    const closeUnixMs = lastCandleOpenUnixMs + FIFTEEN_MIN_MS;
    const nowUnixMs = closeUnixMs + 3 * 60 * 1000;
    const response = buildRegimeCurrent({
      feed,
      candles: flatCandles,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["15m"],
      configVersion: "market-regime-2.0.0",
      engineVersion: "0.1.0",
      metadata: { sourceTimeframe: "15m", sourceCandleCount: flatCandles.length }
    });

    expect(response.freshness.lastCandleOpenUnixMs).toBe(lastCandleOpenUnixMs);
    expect(response.freshness.lastCandleCloseUnixMs).toBe(closeUnixMs);
    expect(response.freshness.ageSeconds).toBe(3 * 60);
  });

  it("ages derived 1h freshness ~48m for a [01:00, 02:00) candle evaluated at 02:48", () => {
    const open0100 = Date.parse("2026-04-26T01:00:00.000Z");
    const ONE_HOUR = 60 * 60 * 1000;
    // Build 60 derived 1h candles ending at 01:00 (so the latest close is 02:00).
    const aggregated = Array.from({ length: 60 }, (_, i) => ({
      unixMs: open0100 - (59 - i) * ONE_HOUR,
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 1
    }));
    const nowUnixMs = Date.parse("2026-04-26T02:48:00.000Z");

    const response = buildRegimeCurrent({
      feed: { ...feed, timeframe: "1h" as const },
      candles: aggregated,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-2.0.0",
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: aggregated.length * 4,
        derivedTimeframe: "1h",
        aggregationVersion: "ohlcv-agg-v1"
      }
    });

    expect(response.freshness.lastCandleOpenIso).toBe("2026-04-26T01:00:00.000Z");
    expect(response.freshness.lastCandleCloseIso).toBe("2026-04-26T02:00:00.000Z");
    expect(response.freshness.ageSeconds).toBe(48 * 60);
    expect(response.freshness.softStale).toBe(false);
    expect(response.freshness.hardStale).toBe(false);
  });

  it("flags hardStale on derived 1h close-age past the 90m hard threshold", () => {
    const open0100 = Date.parse("2026-04-26T01:00:00.000Z");
    const ONE_HOUR = 60 * 60 * 1000;
    const aggregated = Array.from({ length: 60 }, (_, i) => ({
      unixMs: open0100 - (59 - i) * ONE_HOUR,
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 1
    }));
    const nowUnixMs = Date.parse("2026-04-26T03:31:00.000Z"); // 91m past 02:00 close

    const response = buildRegimeCurrent({
      feed: { ...feed, timeframe: "1h" as const },
      candles: aggregated,
      nowUnixMs,
      config: MARKET_REGIME_CONFIG["1h"],
      configVersion: "market-regime-2.0.0",
      engineVersion: "0.1.0",
      metadata: {
        sourceTimeframe: "15m",
        sourceCandleCount: aggregated.length * 4,
        derivedTimeframe: "1h",
        aggregationVersion: "ohlcv-agg-v1"
      }
    });

    expect(response.freshness.softStale).toBe(true);
    expect(response.freshness.hardStale).toBe(true);
    expect(response.marketReasons.map((r) => r.code)).toContain("DATA_HARD_STALE");
  });
});
```

Note: `MARKET_REGIME_CONFIG["1h"].suitability.minCandles` is 30 (`config.ts:92`), so 60 candles is enough to avoid `DATA_INSUFFICIENT_SAMPLES` muddying the close-age signal.

- [ ] **Step 2: Run the new tests to verify they fail (red)**

Run: `npx vitest run src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts -t "freshness close-age"`
Expected: FAIL — either typecheck blocks compilation, or the existing call to `computeFreshness(nowUnixMs, lastCandleUnixMs, { soft, hard })` does not match the new 4-arg signature.

- [ ] **Step 3: Update `buildRegimeCurrent` to pass `timeframeMs`**

Edit `src/engine/marketRegime/buildRegimeCurrent.ts`. Replace the block starting at line 89 (`const lastCandleUnixMs = ...`) through line 93 (closing brace of the freshness call) with:

```ts
const lastCandleOpenUnixMs = candles[candles.length - 1].unixMs;
const freshness = computeFreshness(nowUnixMs, lastCandleOpenUnixMs, config.timeframeMs, {
  softStaleMs: config.freshness.softStaleMs,
  hardStaleMs: config.freshness.hardStaleMs
});
```

`buildRegimeCurrent` does not compute close timestamps itself. It only passes the latest candle open timestamp and `config.timeframeMs`.

- [ ] **Step 4: Run the targeted tests to verify they pass (green)**

Run: `npx vitest run src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts`
Expected: PASS — including the existing tests, which only ever assert `freshness.softStale` / `hardStale` / `marketReasons` behavior, all of which still hold under the new (later) close time.

- [ ] **Step 5: Refresh the `buildRegimeCurrent` snapshot**

The existing snapshot in `src/engine/marketRegime/__tests__/__snapshots__/buildRegimeCurrent.snapshot.test.ts.snap` contains `lastCandleIso` / `lastCandleUnixMs` and an `ageSeconds` measured from open. Both 1h-derived and 15m-direct snapshot scenarios use `nowUnixMs: 200 * FIFTEEN_MIN_MS` and have hardStale candles, so the new close-age values are deterministic and the snapshot should be regenerated.

Run: `npx vitest run src/engine/marketRegime/__tests__/buildRegimeCurrent.snapshot.test.ts -u`
Expected: PASS, snapshot file updated.

Spot-check the regenerated snapshot file: it must contain `lastCandleOpenUnixMs`, `lastCandleOpenIso`, `lastCandleCloseUnixMs`, `lastCandleCloseIso`, and must NOT contain `lastCandleUnixMs` or `lastCandleIso`. `ageSeconds` for the 1h scenario must equal `(200 * FIFTEEN_MIN_MS) - (lastOpen + ONE_HOUR_MS)` divided by 1000; for the 15m scenario, `(200 * FIFTEEN_MIN_MS) - (lastOpen + FIFTEEN_MIN_MS)` divided by 1000.

- [ ] **Step 6: Commit**

```bash
git add src/engine/marketRegime/buildRegimeCurrent.ts \
        src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts \
        src/engine/marketRegime/__tests__/__snapshots__/buildRegimeCurrent.snapshot.test.ts.snap
git commit -m "m52: thread timeframeMs into regime-current freshness"
```

---

## Task 4: Wire `timeframeMs` through `generatePlanUseCase`

**Files:**

- Modify: `src/application/use-cases/generatePlanUseCase.ts:113-117`

`generatePlanUseCase` calls the same `computeFreshness` for plan-path market data. It must pass `config.timeframeMs` for the same reason as `buildRegimeCurrent`. The same `config: MarketTimeframeConfig` is in scope and exposes `timeframeMs`.

- [ ] **Step 1: Update the call**

Edit `src/application/use-cases/generatePlanUseCase.ts`. Replace the block at lines 113–117:

```ts
const lastCandleOpenUnixMs = candlesToClassify[candlesToClassify.length - 1].unixMs;
const freshness = computeFreshness(body.asOfUnixMs, lastCandleOpenUnixMs, config.timeframeMs, {
  softStaleMs: config.freshness.softStaleMs,
  hardStaleMs: config.freshness.hardStaleMs
});
```

- [ ] **Step 2: Verify typecheck for this file passes**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "generatePlanUseCase\\.ts" || true`
Expected: no remaining `generatePlanUseCase.ts` errors. Other files (test fixtures) still error — they're fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/application/use-cases/generatePlanUseCase.ts
git commit -m "m52: thread timeframeMs into plan freshness"
```

---

## Task 5: Update `positionPlan.policy.test.ts` freshness fixture

**Files:**

- Modify: `src/engine/plan/__tests__/positionPlan.policy.test.ts:12-21`

This is a fixture-only change. The test does not exercise freshness math; it just needs a valid `RegimeCurrentFreshness` value.

- [ ] **Step 1: Replace the `baseFreshness` factory**

Edit `src/engine/plan/__tests__/positionPlan.policy.test.ts`. Replace the existing factory:

```ts
const baseFreshness = (): RegimeCurrentFreshness => ({
  generatedAtIso: "2026-05-08T12:00:00.000Z",
  lastCandleOpenUnixMs: AS_OF - 60 * 60 * 1000,
  lastCandleOpenIso: "2026-05-08T11:00:00.000Z",
  lastCandleCloseUnixMs: AS_OF - 60_000,
  lastCandleCloseIso: "2026-05-08T11:59:00.000Z",
  ageSeconds: 60,
  softStale: false,
  hardStale: false,
  softStaleSeconds: 1500,
  hardStaleSeconds: 2100
});
```

- [ ] **Step 2: Run the targeted tests**

Run: `npx vitest run src/engine/plan/__tests__/positionPlan.policy.test.ts`
Expected: PASS — fixture-only change.

- [ ] **Step 3: Commit**

```bash
git add src/engine/plan/__tests__/positionPlan.policy.test.ts
git commit -m "m52: update positionPlan policy freshness fixture"
```

---

## Task 6: Update `positionPlan.snapshot.test.ts` freshness fixture and snapshot

**Files:**

- Modify: `src/engine/plan/__tests__/positionPlan.snapshot.test.ts:71-80`
- Modify (regenerate): `src/engine/plan/__tests__/__snapshots__/positionPlan.snapshot.test.ts.snap`

- [ ] **Step 1: Replace the `freshness` literal in the test fixture**

Edit `src/engine/plan/__tests__/positionPlan.snapshot.test.ts`. Replace the freshness block (lines 71–80) with:

```ts
    freshness: {
      generatedAtIso: "2026-05-08T12:00:00.000Z",
      lastCandleOpenUnixMs: AS_OF - 60 * 60 * 1000,
      lastCandleOpenIso: "2026-05-08T11:00:00.000Z",
      lastCandleCloseUnixMs: AS_OF - 60_000,
      lastCandleCloseIso: "2026-05-08T11:59:00.000Z",
      ageSeconds: 60,
      softStale: false,
      hardStale: false,
      softStaleSeconds: 1500,
      hardStaleSeconds: 2100
    },
```

- [ ] **Step 2: Regenerate the snapshot**

Run: `npx vitest run src/engine/plan/__tests__/positionPlan.snapshot.test.ts -u`
Expected: PASS, snapshot updated.

- [ ] **Step 3: Spot-check the snapshot file**

Read `src/engine/plan/__tests__/__snapshots__/positionPlan.snapshot.test.ts.snap`.

- It must contain `lastCandleOpenUnixMs`, `lastCandleOpenIso`, `lastCandleCloseUnixMs`, `lastCandleCloseIso`.
- It must NOT contain `lastCandleUnixMs` or `lastCandleIso`.
- The plan hash and plan id will change deterministically — that is expected, because freshness fields participate in the canonical-hash payload.

- [ ] **Step 4: Commit**

```bash
git add src/engine/plan/__tests__/positionPlan.snapshot.test.ts \
        src/engine/plan/__tests__/__snapshots__/positionPlan.snapshot.test.ts.snap
git commit -m "m52: update positionPlan snapshot for close-time freshness"
```

---

## Task 7: Update `weeklyReport.snapshot.test.ts` freshness fixture and snapshot

**Files:**

- Modify: `src/report/__tests__/weeklyReport.snapshot.test.ts:86-95`
- Modify (regenerate): any matching `.snap` files in `src/report/__tests__/__snapshots__/`

- [ ] **Step 1: Replace the freshness fixture**

Edit `src/report/__tests__/weeklyReport.snapshot.test.ts`. Replace the freshness block (lines 86–95) with:

```ts
      freshness: {
        generatedAtIso: "2026-05-08T12:00:00.000Z",
        lastCandleOpenUnixMs: asOfUnixMs - 60 * 60 * 1000,
        lastCandleOpenIso: "2026-05-08T11:00:00.000Z",
        lastCandleCloseUnixMs: asOfUnixMs - 60_000,
        lastCandleCloseIso: "2026-05-08T11:59:00.000Z",
        ageSeconds: 60,
        softStale: false,
        hardStale: false,
        softStaleSeconds: 1500,
        hardStaleSeconds: 2100
      },
```

- [ ] **Step 2: Regenerate the snapshot**

Run: `npx vitest run src/report/__tests__/weeklyReport.snapshot.test.ts -u`
Expected: PASS, snapshot updated.

- [ ] **Step 3: Commit**

```bash
git add src/report/__tests__/weeklyReport.snapshot.test.ts \
        src/report/__tests__/__snapshots__
git commit -m "m52: update weekly report fixtures for close-time freshness"
```

---

## Task 8: Update `ledger.test.ts` freshness fixture

**Files:**

- Modify: `src/ledger/__tests__/ledger.test.ts:136-145`

- [ ] **Step 1: Replace the freshness fixture**

Edit `src/ledger/__tests__/ledger.test.ts`. Replace the freshness block (lines 136–145) with:

```ts
      freshness: {
        generatedAtIso: new Date().toISOString(),
        lastCandleOpenUnixMs: asOfUnixMs - FIFTEEN_MIN_MS,
        lastCandleOpenIso: new Date(asOfUnixMs - FIFTEEN_MIN_MS).toISOString(),
        lastCandleCloseUnixMs: asOfUnixMs,
        lastCandleCloseIso: new Date(asOfUnixMs).toISOString(),
        ageSeconds: 0,
        softStale: false,
        hardStale: false,
        softStaleSeconds: 4500,
        hardStaleSeconds: 5400
      }
```

(Close = open + 15m = `asOfUnixMs`, so `ageSeconds` is 0. The tests don't depend on `ageSeconds`, but the fixture should be internally consistent.)

- [ ] **Step 2: Run the targeted tests**

Run: `npx vitest run src/ledger/__tests__/ledger.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ledger/__tests__/ledger.test.ts
git commit -m "m52: update ledger test freshness fixture"
```

---

## Task 9: Update `canonicalHash.snapshot.test.ts` freshness fixture and snapshot

**Files:**

- Modify: `src/contract/v1/__tests__/canonicalHash.snapshot.test.ts:69-78`
- Modify (regenerate): `src/contract/v1/__tests__/__snapshots__/canonicalHash.snapshot.test.ts.snap`

- [ ] **Step 1: Replace the freshness fixture**

Edit `src/contract/v1/__tests__/canonicalHash.snapshot.test.ts`. Replace the freshness block (lines 69–78) with:

```ts
    freshness: {
      generatedAtIso: "2026-05-08T12:00:00.000Z",
      lastCandleOpenUnixMs: AS_OF - 60 * 60 * 1000,
      lastCandleOpenIso: "2026-05-08T11:00:00.000Z",
      lastCandleCloseUnixMs: AS_OF - 60_000,
      lastCandleCloseIso: "2026-05-08T11:59:00.000Z",
      ageSeconds: 60,
      softStale: false,
      hardStale: false,
      softStaleSeconds: 1500,
      hardStaleSeconds: 2100
    },
```

- [ ] **Step 2: Regenerate the canonical-hash snapshot**

Run: `npx vitest run src/contract/v1/__tests__/canonicalHash.snapshot.test.ts -u`
Expected: PASS, snapshot updated. Plan hash will change deterministically.

- [ ] **Step 3: Spot-check**

Read `src/contract/v1/__tests__/__snapshots__/canonicalHash.snapshot.test.ts.snap`.

- It must contain `lastCandleOpenUnixMs`, `lastCandleOpenIso`, `lastCandleCloseUnixMs`, `lastCandleCloseIso`.
- It must NOT contain `lastCandleUnixMs` or `lastCandleIso`.

Also regenerate any sibling snapshot affected by the freshness payload:

Run: `npx vitest run src/contract/v1/__tests__/insights.canonicalHash.snapshot.test.ts -u`
(no-op if `insights` doesn't include the regime-current freshness payload; `-u` is safe).

- [ ] **Step 4: Commit**

```bash
git add src/contract/v1/__tests__/canonicalHash.snapshot.test.ts \
        src/contract/v1/__tests__/__snapshots__
git commit -m "m52: update canonical-hash fixture for close-time freshness"
```

---

## Task 10: Update HTTP e2e assertions for `/v1/regime/current`

**Files:**

- Modify: `src/adapters/http/__tests__/regimeCurrent.e2e.test.ts:189-208`

The two existing assertions use `body.freshness.lastCandleUnixMs`. Both should be expressed against the renamed fields, and we should explicitly assert that the legacy fields are absent.

- [ ] **Step 1: Replace the relevant assertions**

Edit `src/adapters/http/__tests__/regimeCurrent.e2e.test.ts`. Inside the test `derived 1h does not classify the incomplete current-hour aggregate` (around lines 189–208), replace:

```ts
expect(body.freshness.lastCandleUnixMs).toBeLessThan(Date.now());

expect(body.freshness.lastCandleUnixMs % ONE_HOUR_MS).toBe(0);
```

with:

```ts
expect(body.freshness.lastCandleOpenUnixMs).toBeLessThan(Date.now());

expect(body.freshness.lastCandleOpenUnixMs % ONE_HOUR_MS).toBe(0);

expect(body.freshness.lastCandleCloseUnixMs).toBe(
  body.freshness.lastCandleOpenUnixMs + ONE_HOUR_MS
);

expect(body.freshness).not.toHaveProperty("lastCandleUnixMs");
expect(body.freshness).not.toHaveProperty("lastCandleIso");
expect(body.freshness).toHaveProperty("lastCandleOpenIso");
expect(body.freshness).toHaveProperty("lastCandleCloseIso");
```

- [ ] **Step 2: Add a 15m freshness shape assertion**

Find the existing test that hits `/v1/regime/current` with the 15m timeframe (search for `queryString` without `1h`). After the body is parsed, add the same shape assertions for the 15m response:

```ts
expect(body.freshness).not.toHaveProperty("lastCandleUnixMs");
expect(body.freshness).not.toHaveProperty("lastCandleIso");
expect(body.freshness.lastCandleCloseUnixMs).toBe(
  body.freshness.lastCandleOpenUnixMs + FIFTEEN_MIN_MS
);
```

If the existing 15m test doesn't already assert on `body.freshness`, add the block after its first `expect(body.regime)` line.

- [ ] **Step 3: Run the e2e tests**

Run: `npx vitest run src/adapters/http/__tests__/regimeCurrent.e2e.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/http/__tests__/regimeCurrent.e2e.test.ts
git commit -m "m52: assert close-time freshness fields in regime-current e2e"
```

---

## Task 11: Full validation gate

**Files:** none (validation only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS — no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Full test suite**

Run: `npm run test`
Expected: PASS — every snapshot has been intentionally regenerated; nothing should be unexpectedly different.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Sweep for residual references**

Run: `git grep -nE "lastCandleUnixMs|lastCandleIso" -- src`
Expected: NO MATCHES under `src/`. (Matches under `docs/superpowers/specs/` and `docs/superpowers/plans/` are historical and intentional.)

If any match remains under `src/`, fix it before merging.

- [ ] **Step 6: Final commit (only if anything changed)**

If steps 1–5 produced any incidental fixups (formatter, lint), commit them:

```bash
git add -A
git commit -m "m52: validation cleanup"
```

If nothing changed, skip — do not create an empty commit.

---

## Acceptance Verification (matches spec)

After Task 11, confirm by inspection / by re-reading the diff:

- [x] `FreshnessResult` exposes `lastCandleOpenUnixMs`, `lastCandleOpenIso`, `lastCandleCloseUnixMs`, `lastCandleCloseIso`.
- [x] `FreshnessResult` does not expose `lastCandleUnixMs` or `lastCandleIso`.
- [x] `RegimeCurrentFreshness` mirrors `FreshnessResult` (no aliases).
- [x] `computeFreshness` rejects non-positive / non-finite `timeframeMs`.
- [x] Future-close candles return `ageSeconds: 0`.
- [x] `buildRegimeCurrent` passes `config.timeframeMs` into `computeFreshness`.
- [x] `generatePlanUseCase` passes `config.timeframeMs` into `computeFreshness`.
- [x] `Candle.unixMs` and aggregation output remain bucket-open (untouched).
- [x] HTTP response for `/v1/regime/current?timeframe=1h` ages from candle close.
- [x] HTTP response for `/v1/regime/current?timeframe=15m` ages from candle close.
- [x] `clmm-v2` migration is NOT touched in this PR (tracked separately from #86, per spec).
