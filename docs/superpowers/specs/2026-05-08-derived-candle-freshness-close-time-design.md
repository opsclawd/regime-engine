# Derived Candle Freshness Close-Time Contract Design

**Issue:** #52
**Date:** 2026-05-08
**Status:** Approved

## Problem

`GET /v1/regime/current?timeframe=1h` derives complete 1h candles from stored 15m
candles. The derived candle `unixMs` is the 1h bucket open timestamp, which matches
standard OHLCV semantics and the existing aggregation design.

Freshness currently treats the latest candle `unixMs` as the freshness timestamp.
For a derived `[01:00, 02:00)` candle evaluated at `02:48`, the API reports the
candle as `108m` old because it measures from `01:00`. Operationally, the latest
closed 1h candle is only `48m` old because it closed at `02:00`.

This makes healthy derived 1h reads look stale and makes the Regime card imply a
source ingestion problem when the issue is timestamp semantics.

## Goals

- Make freshness age measure from candle close/effective completion time.
- Apply the rule uniformly to direct `15m` and derived `1h` regime reads.
- Cleanly break the freshness response contract before production launch.
- Remove ambiguous `lastCandleUnixMs` and `lastCandleIso` fields entirely.
- Centralize open-to-close conversion inside `computeFreshness`.
- Document freshness open/close semantics in TypeScript types and OpenAPI/schema docs.
- Keep derived candle aggregation unchanged: derived candle `unixMs` remains bucket open.

## Non-Goals

- Do not add compatibility aliases or deprecated legacy freshness fields.
- Do not change the `Candle` model to carry explicit close timestamps.
- Do not change candle ingestion, storage, or latest-revision behavior.
- Do not change derived 1h aggregation math or no-lookahead filtering.
- Do not change stale threshold durations.
- Do not fold the `clmm-v2` threshold-duration formatting issue (#86) into this work.
- Do not implement the coordinated `clmm-v2` migration in this repo.

## Public Contract

`FreshnessResult` and `RegimeCurrentFreshness` become:

```ts
type FreshnessResult = {
  generatedAtIso: string;

  lastCandleOpenUnixMs: number;
  lastCandleOpenIso: string;
  lastCandleCloseUnixMs: number;
  lastCandleCloseIso: string;

  // Measured from close/effective completion time.
  ageSeconds: number;
  softStale: boolean;
  hardStale: boolean;
  softStaleSeconds: number;
  hardStaleSeconds: number;
};
```

Remove these fields from TypeScript types, generated/hand-authored OpenAPI or schema
documentation, and tests:

- `lastCandleUnixMs`
- `lastCandleIso`

There are no aliases and no deprecated compatibility fields.

## Freshness Semantics

The rule is uniform for direct `15m` and derived `1h` regime reads:

- Candle `unixMs` means candle open time.
- Candle close time is computed from candle open plus timeframe.
- Freshness age is measured from candle close/effective completion time.

The invariants are:

```ts
lastCandleOpenUnixMs = candle.unixMs;
lastCandleCloseUnixMs = lastCandleOpenUnixMs + timeframeMs;
lastCandleCloseUnixMs >= lastCandleOpenUnixMs;
ageSeconds = Math.floor(Math.max(0, nowUnixMs - lastCandleCloseUnixMs) / 1000);
```

`lastCandleCloseIso` is the candle interval end / effective completion time, not a
separate trade timestamp. For a `[01:00, 02:00)` candle, the close ISO is `02:00`.

Future-close candles can happen because of clock skew or provider edge cases. They
should produce `ageSeconds: 0`, not a negative age.

## Component Design

### `src/engine/marketRegime/freshness.ts`

`computeFreshness` owns timestamp semantics:

```ts
computeFreshness(
  nowUnixMs: number,
  lastCandleOpenUnixMs: number,
  timeframeMs: number,
  config: FreshnessConfig
): FreshnessResult
```

It must reject invalid timeframe configuration:

```ts
if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
  throw new Error("timeframeMs must be a positive finite number");
}
```

Then it computes:

- `lastCandleCloseUnixMs = lastCandleOpenUnixMs + timeframeMs`
- ISO fields from the open and close timestamps
- `ageSeconds` from close age, clamped at zero
- `softStale` and `hardStale` from the same close age
- threshold seconds from the configured stale windows

`computeFreshness` should not accept precomputed close time from callers. Passing
open time plus timeframe keeps the critical semantic rule centralized and avoids
reintroducing call sites that must remember to pass close time.

### `src/engine/marketRegime/buildRegimeCurrent.ts`

`buildRegimeCurrent` continues to select the latest already-filtered candle:

```ts
const lastCandleOpenUnixMs = candles[candles.length - 1].unixMs;
const freshness = computeFreshness(nowUnixMs, lastCandleOpenUnixMs, config.timeframeMs, {
  softStaleMs: config.freshness.softStaleMs,
  hardStaleMs: config.freshness.hardStaleMs
});
```

It does not compute close timestamps itself. It only passes the latest candle open
timestamp and `config.timeframeMs`.

For direct `15m`, `config.timeframeMs` is 15 minutes, so a candle open at `02:30`
closes at `02:45`.

For derived `1h`, `config.timeframeMs` is 1 hour, so a candle open at `01:00`
closes at `02:00`.

### Contract Types And OpenAPI

`src/contract/v1/types.ts` must expose only the explicit open/close freshness fields.

OpenAPI/schema docs for `/v1/regime/current` should document that:

- `freshness.lastCandleOpenUnixMs` and `lastCandleOpenIso` identify the latest
  selected candle interval start.
- `freshness.lastCandleCloseUnixMs` and `lastCandleCloseIso` identify the candle
  interval end / effective completion time.
- `freshness.ageSeconds`, `softStale`, and `hardStale` are measured from close time.
- legacy `lastCandleUnixMs` and `lastCandleIso` are not response fields.

## Coordinated Downstream Work

Because this is a clean breaking contract, `clmm-v2` needs a separate coordinated
task/PR. That work should update:

- regime adapter
- application DTO
- app response validator
- `RegimeViewModel`
- Regime card copy

The UI should render copy along these lines:

- `Latest closed candle: 48m old`
- optionally `Window: 01:00-02:00`

Do not overload `clmm-v2` #86 with this contract migration. #86 remains only the
threshold-duration formatting issue.

## Error Handling

HTTP error envelopes do not change. Candle-not-found behavior, derived aggregation
errors, and stale reason codes remain unchanged.

The only new runtime error is invalid `timeframeMs` inside `computeFreshness`.
That is a programmer/configuration error, not user input in this flow, so failing
fast is correct. If a bad config is wired into HTTP handling, it should surface as
the existing unexpected internal error path.

## Testing Plan

### Freshness Unit Tests

Update `src/engine/marketRegime/__tests__/freshness.test.ts` to cover:

- Direct `15m`: candle open `02:30`, now `02:48`, age is about `3m`.
- Derived `1h`: candle open `01:00`, now `02:48`, age is about `48m`, not `108m`.
- Derived `1h`: candle open `01:00`, now `03:31`, hard stale when hard threshold is
  `90m`.
- Future-close behavior returns `ageSeconds: 0`.
- Invalid `timeframeMs` throws for `0`, negative, `NaN`, `Infinity`, and
  `-Infinity`.
- Explicit open/close fields are present.
- Legacy `lastCandleUnixMs` and `lastCandleIso` fields are absent.

### Regime Builder Tests

Update `src/engine/marketRegime/__tests__/buildRegimeCurrent.test.ts` to cover:

- Direct `15m` freshness passes `config.timeframeMs` behavior through to
  `computeFreshness`.
- Derived `1h` freshness measures close age from the derived candle window.
- A `[01:00, 02:00)` derived candle evaluated at `02:48` reports about `48m`, not
  `108m`.
- Stale threshold classification uses close age, including hard-stale boundary
  behavior.

### Contract And HTTP Tests

Update contract/openAPI-adjacent tests and existing HTTP/e2e assertions to cover:

- Response freshness contains `lastCandleOpenUnixMs`, `lastCandleOpenIso`,
  `lastCandleCloseUnixMs`, and `lastCandleCloseIso`.
- Response freshness does not contain `lastCandleUnixMs` or `lastCandleIso`.
- `/v1/regime/current?timeframe=15m` preserves direct 15m behavior except for the
  explicit freshness field names and close-age semantics.
- `/v1/regime/current?timeframe=1h` preserves derived 1h behavior except for the
  corrected freshness field names and close-age semantics.

## Acceptance Criteria

- Derived `1h` freshness age is measured from candle close/effective completion
  time, not bucket open.
- Direct `15m` freshness age is also measured from candle close/effective completion
  time.
- A latest complete `[01:00, 02:00)` derived candle evaluated at `02:48` reports
  about `48m` old, not `108m`.
- `softStale` and `hardStale` use close-age freshness.
- `lastCandleUnixMs` and `lastCandleIso` are removed from TypeScript types, OpenAPI
  or schema docs, and tests.
- `computeFreshness` throws for non-positive or non-finite `timeframeMs`.
- Future-close candles produce `ageSeconds: 0`.
- `buildRegimeCurrent` passes `config.timeframeMs` into `computeFreshness`.
- The `Candle` model and aggregation output keep `unixMs` as candle open time.
- `clmm-v2` migration work is tracked separately from #86.

## Validation

The implementation PR should run:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

If any command is not run, the PR should say why.
