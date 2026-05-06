---
title: 15m Candle Timeframe Migration Pattern
date: 2026-05-06
last_updated: 2026-05-06
category: best-practices
module: engine
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - migrating candle timeframe granularity across contract, engine, and worker layers
  - changing data ingestion interval in a TypeScript pipeline service
related_components:
  - service_object
  - background_job
  - documentation
tags:
  - 15m-timeframe
  - candle-ingestion
  - migration
  - breaking-change
  - gecko-collector
  - regime-engine
  - config-change
  - openapi
---

# 15m Candle Timeframe Migration Pattern

## Context

The regime-engine originally used 1-hour (`"1h"`) candle granularity for regime detection. This coarseness meant regime transitions were detected 4x slower than necessary — a regime shift that manifested across four 15-minute intervals would not surface until the full hour closed. The project planned a migration to 15-minute (`"15m"`) candles (milestone m41), but `"1h"` was deeply embedded across contract types, validation allowlists, engine inputs, worker config, GeckoTerminal URL construction, normalization constants, OpenAPI specs, ledger fixtures, runbooks, and environment files. A manual search-and-replace would inevitably miss references; the migration needed a systematic approach that let the type checker enforce completeness.

## Guidance

### 1. Split types by purpose, not by value

When a domain value appears in multiple contexts with different semantics (ingestion vs. read), create separate type aliases even if they hold the same literal. This lets the compiler find every call site when you migrate:

```ts
// Before: single type used everywhere
type SupportedTimeframe = "1h";

// After: purpose-specific types that the compiler can track independently
export type CandleIngestTimeframe = "15m";
export type RegimeReadTimeframe = "15m";
```

Then constrain each interface to its own type:

```ts
export interface CandleIngestRequest {
  timeframe: CandleIngestTimeframe; // only accepts "15m" for ingest
}

export interface RegimeCurrentResponse {
  timeframe: RegimeReadTimeframe; // only accepts "15m" for read
}
```

When you change `CandleIngestTimeframe`, the type checker flags every file that references it. If `CandleIngestTimeframe` and `RegimeReadTimeframe` ever diverge (e.g., ingest at 5m but read at 15m), you can change one without touching the other.

### 2. Validation allowlists enforce the contract at runtime

Separate the validation allowlists so the API rejects unsupported timeframes explicitly rather than falling back:

```ts
// Before: single allowlist
const SUPPORTED_TIMEFRAMES = ["1h"] as const;

// After: separate allowlists per endpoint
const CANDLE_INGEST_TIMEFRAMES = ["15m"] as const;
const REGIME_READ_TIMEFRAMES = ["15m"] as const;

const CANDLE_INGEST_TIMEFRAME_TO_MS: Record<CandleIngestTimeframe, number> = {
  "15m": 15 * 60 * 1000
};
```

Wire them into zod schemas:

```ts
const candleIngestRequestSchema = z.object({
  timeframe: z.enum(CANDLE_INGEST_TIMEFRAMES) // rejects "1h" with VALIDATION_ERROR
});

const regimeCurrentQuerySchema = z.object({
  timeframe: z.enum(REGIME_READ_TIMEFRAMES) // rejects "1h" with VALIDATION_ERROR
});
```

Add a comment like `// until #42` at rejection points so future maintainers know the value is intentionally excluded, not accidentally omitted.

### 3. Hard-reject unsupported timeframes in workers (no silent fallbacks)

In the gecko worker, replace silent fallbacks with explicit `ProtocolError` throws so misconfigurations surface immediately rather than producing subtly wrong data:

```ts
// Before: silent fallback — "1h" unknown? default to 3600000
const TIMEFRAME_MS: Record<string, number> = { "1h": 3600000 };
const ms = TIMEFRAME_MS[timeframe] ?? 3600000;

// After: explicit rejection — use the type alias as the Record key so the
// compiler flags the map as incomplete when a new timeframe is added
const TIMEFRAME_MS: Record<CandleIngestTimeframe, number> = {
  "15m": 15 * 60 * 1000
};

const timeframeMs = TIMEFRAME_MS[config.geckoTimeframe];
if (timeframeMs === undefined) {
  throw new ProtocolError(`Unsupported geckoTimeframe: ${config.geckoTimeframe}`);
}
```

Same pattern in URL construction — the mapping doubles as an allowlist:

```ts
const TIMEFRAME_TO_GECKO_PATH_PARAMS: Record<
  CandleIngestTimeframe,
  { path: string; aggregate: string }
> = {
  "15m": { path: "minute", aggregate: "15" }
};

function buildGeckoUrl(config: GeckoCollectorConfig): URL {
  const params = TIMEFRAME_TO_GECKO_PATH_PARAMS[config.geckoTimeframe];
  if (!params) {
    throw new ProtocolError(
      `Unsupported geckoTimeframe for URL construction: ${config.geckoTimeframe}`
    );
  }
  // ...
}
```

An unsupported timeframe fails fast with a clear error rather than constructing a URL that returns wrong-granularity data.

### 4. Switch the GeckoTerminal API endpoint

15m candles require the minute API with aggregation, not the hour API:

```ts
// Before: 1h candles via the hour endpoint
// /ohlcv/hour?aggregate=1

// After: 15m candles via the minute endpoint with 15-minute aggregation
// /ohlcv/minute?aggregate=15&include_empty_intervals=true
```

The `include_empty_intervals=true` parameter ensures gaps (periods with no trades) still produce candle rows, which prevents the normalization layer from silently skipping intervals and creating misaligned timestamps.

### 5. Adjust poll interval for the new granularity

When you move from 1h to 15m candles, data arrives 4x more frequently. Adjust the default poll interval accordingly:

```ts
// Before: check every 5 minutes for hourly candles
geckoPollIntervalMs: readPositiveInteger(env, "GECKO_POLL_INTERVAL_MS", 300000);

// After: check every 1 minute for 15-minute candles
geckoPollIntervalMs: readPositiveInteger(env, "GECKO_POLL_INTERVAL_MS", 60000);
```

### 6. Update all fixtures and constants

Ledger test fixtures change their time-unit constants to match:

```ts
// Before
const ONE_HOUR_MS = 3600000;

// After
const FIFTEEN_MIN_MS = 900000;
```

### 7. Watch for value-level errors that type narrowing cannot catch

Type aliases enforce structural correctness, but they cannot catch value errors when a constant name conveys the wrong semantics. During this migration, `MARKET_REGIME_CONFIG["15m"].timeframeMs` was accidentally set to `ONE_HOUR_MS` (3,600,000) instead of the new `FIFTEEN_MIN_MS` constant (900,000). The type system accepted both values because `timeframeMs` is typed as `number`, not as a branded 15m-specific millisecond literal.

Mitigation strategies:

```ts
// Option A: Derive timeframeMs from the timeframe literal, so it cannot diverge
const FIFTEEN_MIN_MS = 15 * 60 * 1000; // only one source of truth
export const MARKET_REGIME_CONFIG: Record<"15m", MarketTimeframeConfig> = {
  "15m": {
    timeframe: "15m",
    timeframeMs: FIFTEEN_MIN_MS
    // ...
  }
};

// Option B: Add a config sanity test so regressions are caught immediately
import { MARKET_REGIME_CONFIG } from "./config.js";
expect(MARKET_REGIME_CONFIG["15m"].timeframeMs).toBe(15 * 60 * 1000);
```

Option B (a config sanity test) caught the bug during code review. Both options are complementary.

### 8. Some timeframe fields remain intentionally loose

Not every `timeframe` field should be narrowed to a literal type. When a field is consumed by timeframe-agnostic logic (e.g., plan computation that trusts the caller's candle data regardless of granularity), keeping it as `string` preserves forward compatibility without sacrificing safety:

```ts
export interface PlanRequest {
  market: {
    // Deliberately loose — plan computation is timeframe-agnostic;
    // only the candle ingestion and regime-read endpoints enforce
    // CandleIngestTimeframe / RegimeReadTimeframe.
    timeframe: string;
    candles: Candle[];
  };
}
```

Document the rationale inline so future contributors don't "fix" it without understanding the tradeoff.

## Why This Matters

Coarser timeframes caused the regime engine to detect transitions late — a regime shift visible in 15-minute OHLCV data wouldn't appear until the hourly candle closed, delaying rebalancing by up to 45 minutes. With 15m granularity, the engine gets 4x more data points per hour, enabling faster regime detection.

The type-safe migration pattern prevents partial updates. If you change `CandleIngestTimeframe` from `"1h"` to `"15m"` but forget to update a consumer, the type checker flags it at compile time. The `ProtocolError` rejection pattern prevents runtime fallbacks to stale values. Together, they ensure the migration is all-or-nothing: no code path can still reference `"1h"` without either a type error or a runtime validation rejection.

However, type narrowing cannot catch value-level errors where a constant name conveys the wrong semantics (see Section 7). Pair type-level enforcement with config sanity tests that assert specific millisecond values, especially when the unit of measurement changes.

## When to Apply

- Any timeframe or granularity change in a data pipeline where the old value appears in types, validation, URL construction, normalization, and documentation.
- Any cross-cutting configuration migration where a magic string or magic number appears in multiple modules — create purpose-specific types first, then let the compiler enumerate every call site.
- Any external API migration where the endpoint path or query parameters change based on a config value (e.g., `/ohlcv/hour` → `/ohlcv/minute`) — use the config-to-param mapping as an allowlist, not just a lookup.

## Examples

### Type split

```ts
// types.ts — Before
export type SupportedTimeframe = "1h";

// types.ts — After
export type CandleIngestTimeframe = "15m";
export type RegimeReadTimeframe = "15m";
```

### Validation allowlists

```ts
// validation.ts — Before
const SUPPORTED_TIMEFRAMES = ["1h"] as const;

// validation.ts — After
const CANDLE_INGEST_TIMEFRAMES = ["15m"] as const;
const REGIME_READ_TIMEFRAMES = ["15m"] as const;

const CANDLE_INGEST_TIMEFRAME_TO_MS: Record<CandleIngestTimeframe, number> = {
  "15m": 15 * 60 * 1000
};
```

### URL construction

```ts
// geckoClient.ts — Before (untyped config, no validation)
function buildGeckoUrl(config: any): URL {
  const url = new URL(`/ohlcv/hour?aggregate=1`, base);
}

// geckoClient.ts — After (allowlist-driven, explicit rejection)
const TIMEFRAME_TO_GECKO_PATH_PARAMS: Record<
  CandleIngestTimeframe,
  { path: string; aggregate: string }
> = {
  "15m": { path: "minute", aggregate: "15" }
};

function buildGeckoUrl(config: GeckoCollectorConfig): URL {
  const params = TIMEFRAME_TO_GECKO_PATH_PARAMS[config.geckoTimeframe];
  if (!params) {
    throw new ProtocolError(
      `Unsupported geckoTimeframe for URL construction: ${config.geckoTimeframe}`
    );
  }
  const path = `/api/v2/networks/${config.geckoNetwork}/pools/${config.geckoPoolAddress}/ohlcv/${params.path}`;
  const url = new URL(path, base);
  url.searchParams.set("aggregate", params.aggregate);
  url.searchParams.set("include_empty_intervals", "true");
  // ...
}
```

### Normalization: fallback → hard reject

```ts
// normalize.ts — Before (silent fallback)
const TIMEFRAME_MS = { "1h": 3600000 };
const ms = TIMEFRAME_MS[timeframe] ?? 3600000;

// normalize.ts — After (explicit rejection)
const TIMEFRAME_MS: Record<CandleIngestTimeframe, number> = {
  "15m": 15 * 60 * 1000
};
const timeframeMs = TIMEFRAME_MS[config.geckoTimeframe];
if (timeframeMs === undefined) {
  throw new ProtocolError(`Unsupported geckoTimeframe: ${config.geckoTimeframe}`);
}
```

## Related

- [Market Regime Endpoint Patterns](../best-practices/market-regime-endpoint-patterns-2026-04-27.md) — per-slot candle batch ingestion, timeframe-aware cutoff logic. The canonical timeframe reference has shifted from 1h MVP to 15m primary.
- [Fastify SQLite Ingestion Endpoint Patterns](../best-practices/fastify-sqlite-ingestion-endpoint-patterns-2026-04-18.md) — auth, idempotency, and error taxonomy for ingestion endpoints. The timeframe allowlist pattern extends these validation patterns.
- [TypeScript Strict Tooling Friction Patterns](../developer-experience/typescript-strict-tooling-friction-patterns-2026-05-01.md) — type guards for GeckoTerminal API payloads and test fixture alignment. Shares the gecko worker module.
- GitHub #41 — "Switch Gecko candle ingestion and regime pipeline to 15m candles" (the milestone this migration completed)
- GitHub #42 — "Add derived 1h candle aggregation from canonical 15m candles" (future work, referenced by `// until #42` comments)
