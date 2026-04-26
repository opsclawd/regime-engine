# Design: Market-Data-Backed Current Regime Endpoint

**Date:** 2026-04-26
**Status:** Draft (pending spec-document-reviewer pass)
**Origin:** GitHub issue [#17](https://github.com/opsclawd/regime-engine/issues/17) — _Add market-data-backed current regime endpoint for CLMM Regime page_
**Target repo:** `regime-engine`

---

## 1. Problem

The CLMM frontend's Regime page needs to render market intelligence — _what kind of SOL/USDC market are we in right now, and is this environment generally suitable for CLMM exposure?_ — without abusing `POST /v1/plan` or fabricating user-specific portfolio/autopilot inputs.

`POST /v1/plan` already computes regime, telemetry, suitability, and actions, but its contract demands caller-supplied `market.candles[]`, `portfolio`, `autopilotState`, and `config`. Using it for the Regime page would force the CLMM backend to either supply fake portfolio state, pollute the plan ledger with non-user plans, duplicate market-intelligence ownership outside `regime-engine`, or blur the boundary between market diagnosis and user-specific prescription. None of those are correct.

Regime page = **weather report**. `POST /v1/plan` = **flight plan**. They are distinct surfaces.

## 2. Goals

- Add `GET /v1/regime/current` — a market-only read returning regime, telemetry, CLMM market-suitability, freshness, and metadata for an explicit `(symbol, source, network, poolAddress, timeframe)` feed.
- Add `POST /v1/candles` — append-only candle ingestion keyed by the same logical-feed identity, with a per-slot revision policy.
- Preserve the architecture's append-only ledger invariant.
- Preserve `POST /v1/plan`'s sole ownership of personalized prescription.
- Keep classification deterministic given `(closed candles, committed config)`.

## 3. Non-Goals

This issue intentionally does **not**:

1. **Tune classification thresholds.** Values are cribbed from existing fixtures/tests; calibration is a separate later milestone after live candle ingestion (Gecko/Birdeye) is producing data.
2. **Add more timeframes.** `4h`, `15m`, `5m` are deferred. MVP allowlist is `["1h"]`. Adding a timeframe is a config + fixtures + allowlist PR, not a contract change.
3. **Build the candle collector.** Collector lives outside `regime-engine`; this slice owns the ingestion endpoint and the classification surface only.
4. **Add `GET /v1/candles`** read endpoint.
5. **Add a discovery endpoint** (e.g. `GET /v1/candles/sources`).
6. **Persist `RegimeState`** for the market read. Stateless by design; hysteresis remains exclusive to `POST /v1/plan`.
7. **Compute or expose user-specific fields** on `GET /v1/regime/current` — no `targets`, `actions`, `constraints`, `nextRegimeState`, cooldowns, stand-down windows, stopouts, redeploys, NAV, balances. Asserted by route test.
8. **Write to the plan ledger** from the GET path. Asserted by route test.
9. **Default pool address** when `poolAddress` is omitted. Required selector. A canonical-default config layer can be added later without contract change.
10. **Env-var overrides for classification thresholds.** PR + deploy is the right friction.

## 4. Architecture

```
External market collector
  -> POST /v1/candles  (X-Candles-Ingest-Token)
  -> regime-engine appends candle revisions
  -> GET /v1/regime/current  (unauthenticated)
  -> CLMM backend/BFF -> CLMM Regime page
```

Two new endpoints. One new ingest token. One new persistence surface. One classifier split.

### 4.1 Classifier split

`src/engine/regime/classifier.ts` (existing) is the **policy classifier**. It consumes `RegimeState` for hysteresis (`minHoldBars`, `confirmBars`) and is used by `buildPlan` only.

`src/engine/marketRegime/classifyMarketRegime.ts` (new) is the **market-only classifier**. It is a stateless wrapper that calls `classifyRegime` with `state: undefined` and `confirmBars: 1, minHoldBars: 0`, then returns `{ regime, reasons }` discarding `nextState`. With these settings the existing classifier degenerates to "look at latest telemetry, no carry-over," which is what the market read requires.

`src/engine/marketRegime/evaluateMarketClmmSuitability.ts` (new) is a separate pure function that maps `(regime, telemetry, freshness, candleCount, config)` → `{ status, reasons }` for the four-band CLMM suitability surface. It does **not** reuse `evaluateChopGate` (binary; only knows regime + standDown). The Regime page needs the yellow band.

### 4.2 What stays untouched

`buildPlan`, `evaluateChopGate`, `applyChurnGovernor`, the entire plan / execution-result / SR-levels surface. Issue #17 is purely additive.

### 4.3 Hard rules carried forward

- Append-only ledger invariant preserved (revisions, not updates).
- No on-chain code, no Solana RPC.
- Classification deterministic from `(closed candles, committed config)`.
- `GET /v1/regime/current` writes nothing. No `RegimeState` persisted anywhere.

## 5. HTTP contracts

### 5.1 `POST /v1/candles`

**Auth:** `X-Candles-Ingest-Token` compared via `requireSharedSecret` against `CANDLES_INGEST_TOKEN`. Missing env → 500 `SERVER_MISCONFIGURATION` (only on this route, not at boot or on read routes). Missing/bad header → 401 `UNAUTHORIZED`. Comparison uses `timingSafeEqual` per existing helper.

**Request:**

```ts
type CandleIngestRequest = {
  schemaVersion: "1.0";
  source: string;                 // e.g. "birdeye", "pyth_aggregated"
  network: string;                // e.g. "solana-mainnet"
  poolAddress: string;            // base58 pool identity
  symbol: string;                 // exact match, case-sensitive (e.g. "SOL/USDC")
  timeframe: "1h";                // MVP allowlist
  sourceRecordedAtIso: string;    // ISO-8601, ordering key for revisions
  candles: Array<{
    unixMs: number;               // integer, aligned to timeframeMs
    open: number; high: number; low: number; close: number;
    volume: number;
  }>;                             // length 1..1000
};
```

One batch represents one logical feed (one `(source, network, poolAddress, symbol, timeframe)` tuple at one collector recording instant). No mixed-feed batches.

**Response (200):**

```ts
type CandleIngestResponse = {
  schemaVersion: "1.0";
  insertedCount: number;     // brand-new logical slots
  revisedCount: number;      // existing slots, newer revision appended
  idempotentCount: number;   // existing slots, byte-identical canonical OHLCV
  rejectedCount: number;     // existing slots, older sourceRecordedAtIso w/ different OHLCV
  rejections: Array<{        // always present; empty array when rejectedCount === 0
    unixMs: number;
    reason: "STALE_REVISION";
    existingSourceRecordedAtIso: string;
  }>;
};
```

`rejections` is always serialized — empty array when `rejectedCount === 0`, populated array otherwise. Tests, logs, and collectors can rely on the field being present without an existence check.

Stale-revision rejections are **per-slot** within an otherwise-valid batch: 200 with rejection details; accepted slots still commit. Whole-batch errors remain HTTP 4xx.

**Errors:**

| HTTP | Code | When |
|---|---|---|
| 400 | `SCHEMA_VERSION_UNSUPPORTED` | `schemaVersion` ≠ `"1.0"` |
| 400 | `VALIDATION_ERROR` | Missing/wrong-typed fields, unsupported timeframe, malformed `sourceRecordedAtIso` |
| 400 | `BATCH_TOO_LARGE` | `candles.length > 1000` |
| 400 | `MALFORMED_CANDLE` | OHLCV invariant violation; payload identifies offending index |
| 400 | `DUPLICATE_CANDLE_IN_BATCH` | Two entries share `unixMs` within the same request |
| 401 | `UNAUTHORIZED` | Missing/bad ingest token |
| 500 | `SERVER_MISCONFIGURATION` | `CANDLES_INGEST_TOKEN` env unset (route-level only) |

OHLCV invariants enforced at validation:
- `open`, `high`, `low`, `close` finite and `> 0`.
- `volume` finite and `>= 0`.
- `high >= max(open, close, low)`.
- `low <= min(open, close, high)`.
- `unixMs` is an integer and `unixMs % timeframeMs === 0`.
- `sourceRecordedAtIso` is a valid ISO-8601 string.

`source` is a free-form string in MVP (no allowlist, no regex). Future hardening can introduce a pattern check; not in scope here.

`CANDLE_STALE_REVISION` is **not** an HTTP error code. It lives in `rejections[].reason`. Adding it to the error registry would imply HTTP semantics it doesn't have.

### 5.2 `GET /v1/regime/current`

**Auth:** unauthenticated, matching existing read-route posture (`GET /v1/sr-levels/current`, `GET /v1/report/weekly`).

**Required query parameters** (any missing → 400 `VALIDATION_ERROR`):

| Param | Notes |
|---|---|
| `symbol` | Exact match, case-sensitive |
| `source` | Matches a `source` previously written via `POST /v1/candles` |
| `network` | e.g. `solana-mainnet` |
| `poolAddress` | base58 pool identity |
| `timeframe` | Must be `"1h"` for MVP |

**Response (200):**

```ts
type RegimeCurrentResponse = {
  schemaVersion: "1.0";
  symbol: string; source: string; network: string;
  poolAddress: string; timeframe: "1h";

  regime: "UP" | "DOWN" | "CHOP";

  telemetry: {
    realizedVolShort: number; realizedVolLong: number;
    volRatio: number; trendStrength: number; compression: number;
  };

  clmmSuitability: {
    status: "ALLOWED" | "CAUTION" | "BLOCKED" | "UNKNOWN";
    reasons: Array<{ code: string; severity: "INFO"|"WARN"|"ERROR"; message: string }>;
  };

  marketReasons: Array<{ code: string; severity: "INFO"|"WARN"|"ERROR"; message: string }>;

  freshness: {
    generatedAtIso: string;
    lastCandleUnixMs: number;
    lastCandleIso: string;
    ageSeconds: number;
    softStale: boolean;
    hardStale: boolean;
    softStaleSeconds: number;
    hardStaleSeconds: number;
  };

  metadata: {
    engineVersion: string;
    configVersion: string;
    candleCount: number;        // closed candles considered
  };
};
```

`metadata.engineVersion` is sourced from `process.env.npm_package_version` (matching `/version`). `metadata.configVersion` is the literal exported from `src/engine/marketRegime/config.ts`.

**Errors:**

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Missing selector, unsupported timeframe, malformed value |
| 404 | `CANDLES_NOT_FOUND` | Zero closed candles for the logical slot |

`clmmSuitability.status = "UNKNOWN"` returns 200 — not an error — when at least one closed candle exists but data quality is insufficient (hard-stale or below `minCandles`). The frontend renders "we have a feed but not enough data yet" without a separate code path.

## 6. Persistence

New table appended to `src/ledger/schema.sql`:

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

`ux_candle_revisions_slot_hash` makes byte-equal idempotency a database-enforced invariant: the same logical slot + identical content hash cannot be inserted twice even under racing writers. The application's idempotency check still runs first (returning `idempotentCount++` without an INSERT), but the unique index is the floor against application bugs or concurrent collectors. All three indexes ship with the table. Schema rollout is purely additive — `CREATE ... IF NOT EXISTS` is idempotent against the existing boot-time `schema.sql` exec. No migration script.

`received_at_unix_ms` is audit-only; it never breaks ordering ties, since that would let stale collector runs win on receive-clock skew.

`ohlcv_canonical` is the canonical-JSON serialization of `{open, high, low, close, volume}` produced via the existing `src/contract/v1/canonical.ts` `toCanonicalJson` helper (lexicographic key sort, stable number formatting). `ohlcv_hash` is `sha256Hex(ohlcv_canonical)` from the existing `src/contract/v1/hash.ts`. Idempotency lookups compare on `ohlcv_hash`, never on raw OHLCV equality.

### 6.1 Per-slot write decision tree

For each candle in the batch:

```
let incomingUnixMs   = parsed sourceRecordedAtIso (UTC) -> unix ms
let existing         = latest revision for
                       (symbol, source, network, pool_address, timeframe, unix_ms)
                       (selected via idx_candle_revisions_slot_latest)

  existing is null                                              -> INSERT, insertedCount++
  existing.ohlcv_hash == incoming.ohlcv_hash                    -> no-op, idempotentCount++
  existing.source_recorded_at_unix_ms < incomingUnixMs          -> INSERT, revisedCount++
  existing.source_recorded_at_unix_ms >= incomingUnixMs
    AND existing.ohlcv_hash != incoming.ohlcv_hash              -> reject, rejectedCount++,
                                                                   emit { unixMs, reason: STALE_REVISION,
                                                                          existingSourceRecordedAtIso }
```

Ordering is **always numeric** against the parsed `source_recorded_at_unix_ms` column. ISO strings are stored for audit and response serialization; they are never compared lexicographically in the writer.

The whole batch executes under one `BEGIN IMMEDIATE` transaction. Structural validation failures (e.g., constraint violation) roll back the entire batch. Per-slot stale-revision rejections do **not** roll back accepted slots; they commit alongside accepted writes with `rejections[]` in the response.

### 6.2 Read query

```sql
WITH latest_per_slot AS (
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
 ORDER BY unix_ms ASC;
```

`LIMIT` is applied to deduped slots, not pre-dedup rows. The handler picks `LIMIT = max(volLongWindow, minCandles) + buffer`.

The closed-candle cutoff `unix_ms <= ?` is computed by the handler:

```
closedCandleCutoffUnixMs = floor((now - closedCandleDelayMs) / timeframeMs) * timeframeMs - timeframeMs
```

The `floor(...) * timeframeMs` snaps to a bar boundary; subtracting one additional `timeframeMs` is intentional — it excludes the bar that *just* closed within `closedCandleDelayMs`, leaving a grace window for late revisions before the slot becomes eligible for classification. So "closed" here means "closed for at least `closedCandleDelayMs`," not "closed at all."

## 7. Configuration

New file: `src/engine/marketRegime/config.ts`. Single committed source of truth, keyed by timeframe. No env-var overrides for classification thresholds in this slice.

```ts
export const MARKET_REGIME_CONFIG_VERSION = "market-regime-1.0.0";

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
      confirmBars: 1,                 // stateless market read
      minHoldBars: 0,                 // stateless market read
      enterUpTrend: 0.6,
      exitUpTrend: 0.35,
      enterDownTrend: -0.6,
      exitDownTrend: -0.35,
      chopVolRatioMax: 1.4
    },

    suitability: {
      allowedVolRatioMax: 1.30,       // placeholder, calibrated later
      extremeVolRatio: 1.60,          // placeholder, calibrated later
      extremeCompression: 0.18,       // placeholder, calibrated later
      minCandles: 30
    },

    freshness: {
      closedCandleDelayMs: 5 * 60 * 1000,    // 5 min
      softStaleMs: 75 * 60 * 1000,           // 75 min
      hardStaleMs: 90 * 60 * 1000            // 90 min
    }
  }
};
```

Regime thresholds are cribbed from existing classifier fixtures/tests (`enterUpTrend: 0.6`, `chopVolRatioMax: 1.4`, etc.). Suitability thresholds are placeholders deferred to a calibration milestone (§3 non-goal #1).

`MARKET_REGIME_CONFIG_VERSION` bumps require a code PR. Bumping it changes `metadata.configVersion` in the response and is the observability signal for "what policy produced this classification."

## 8. Market CLMM suitability evaluation

New module: `src/engine/marketRegime/evaluateMarketClmmSuitability.ts`. Pure function, no I/O.

**Signature:**

```ts
type MarketClmmSuitabilityInput = {
  regime: "UP" | "DOWN" | "CHOP";
  telemetry: IndicatorTelemetry;
  freshness: { hardStale: boolean; softStale: boolean };
  candleCount: number;
  config: MarketTimeframeConfig["suitability"];
};

type MarketClmmSuitability = {
  status: "ALLOWED" | "CAUTION" | "BLOCKED" | "UNKNOWN";
  reasons: Array<{ code: string; severity: "INFO"|"WARN"|"ERROR"; message: string }>;
};
```

### 8.1 Decision tree (data quality → blocked → caution → allowed)

```
1. UNKNOWN gate (first match wins for status; reasons accumulate):
   - candleCount < config.minCandles      -> UNKNOWN, CLMM_UNKNOWN_INSUFFICIENT_SAMPLES (ERROR)
   - freshness.hardStale                   -> UNKNOWN, CLMM_UNKNOWN_HARD_STALE_DATA   (ERROR)

2. BLOCKED gate:
   - regime == "UP"                        -> BLOCKED, CLMM_BLOCKED_TRENDING_UP        (WARN)
   - regime == "DOWN"                      -> BLOCKED, CLMM_BLOCKED_TRENDING_DOWN      (WARN)
   - volRatio >= extremeVolRatio           -> BLOCKED, CLMM_BLOCKED_EXTREME_VOLATILITY (WARN)
   - compression >= extremeCompression     -> BLOCKED, CLMM_BLOCKED_EXTREME_COMPRESSION(WARN)

3. CAUTION gate (status starts ALLOWED, demoted to CAUTION on any of these;
   all matching reasons appended):
   - freshness.softStale                   -> CLMM_CAUTION_SOFT_STALE_DATA            (WARN)
   - volRatio > config.allowedVolRatioMax  -> CLMM_CAUTION_ELEVATED_VOLATILITY        (WARN)

4. ALLOWED:
   - regime == "CHOP" and none of the above
                                           -> CLMM_ALLOWED_CHOP_FRESH                 (INFO)
```

**Status precedence and reason accumulation:**

```
Status precedence: UNKNOWN > BLOCKED > CAUTION > ALLOWED.
Within the winning band, append every matching reason for that band.
Do not append reasons from a lower band once a higher band has won.
```

Example: regime is `UP` AND `volRatio >= extremeVolRatio` AND `freshness.softStale === true`. The winning status is BLOCKED. The response carries:

```
clmmSuitability.reasons = [
  { code: CLMM_BLOCKED_TRENDING_UP,        severity: WARN, ... },
  { code: CLMM_BLOCKED_EXTREME_VOLATILITY, severity: WARN, ... }
]
```

`CLMM_CAUTION_SOFT_STALE_DATA` is **not** appended — soft-stale is a CAUTION-band reason and BLOCKED has already won. The freshness fact still surfaces in `marketReasons` as `DATA_SOFT_STALE`; the suitability array is scoped to "why this suitability decision."

Notes on `volRatio` thresholds:

- `regime.chopVolRatioMax` (1.4) — input to **regime classification**. Decides whether the market is CHOP at all.
- `suitability.allowedVolRatioMax` (1.30) — input to **suitability**. Once classified CHOP, decides whether vol is calm enough for ALLOWED or merits CAUTION.
- `suitability.extremeVolRatio` (1.60) — input to **suitability**. Vol so high that CLMM is BLOCKED even if regime is technically CHOP.

The two knobs are deliberately distinct: regime classification and CLMM suitability answer different questions and may diverge in calibration.

### 8.2 Reason code allowlist

**`clmmSuitability.reasons` (all `CLMM_*` prefixed; exhaustive for MVP — extending requires PR + test):**

```
CLMM_UNKNOWN_INSUFFICIENT_SAMPLES
CLMM_UNKNOWN_HARD_STALE_DATA
CLMM_BLOCKED_TRENDING_UP
CLMM_BLOCKED_TRENDING_DOWN
CLMM_BLOCKED_EXTREME_VOLATILITY
CLMM_BLOCKED_EXTREME_COMPRESSION
CLMM_CAUTION_SOFT_STALE_DATA
CLMM_CAUTION_ELEVATED_VOLATILITY
CLMM_ALLOWED_CHOP_FRESH
```

**`marketReasons` (separate scope, regime + data):**

```
REGIME_STABLE | REGIME_SWITCH_CONFIRMED
DATA_FRESH | DATA_SOFT_STALE | DATA_HARD_STALE
DATA_SUFFICIENT_SAMPLES | DATA_INSUFFICIENT_SAMPLES
```

`REGIME_CONFIRM_PENDING` and `REGIME_MIN_HOLD_ACTIVE` are intentionally excluded from the market-read allowlist. They are emitted by `classifyRegime` only when hysteresis state is being carried forward (`confirmBars > 1` or `minHoldBars > 0`). The market-only wrapper calls `classifyRegime` with `confirmBars: 1, minHoldBars: 0` and `state: undefined`, so these codes are unreachable. Tests must not assert them on `GET /v1/regime/current`. They remain valid in `POST /v1/plan` responses where hysteresis applies.

The market-only wrapper rephrases the surviving regime codes into market-read language before returning them in `marketReasons`. The user-facing Regime page should not see policy-classifier phrasing like "Switched CHOP -> UP after 1 confirmation bars." The wrapper produces:

```
REGIME_STABLE             -> "Current telemetry holds <regime> regime."
REGIME_SWITCH_CONFIRMED   -> "Current telemetry supports <regime> regime."
```

Only the message field is rewritten. The `code` and `severity` fields are preserved verbatim from `classifyRegime` so downstream code paths that key on `code` continue to work.

`REGIME_*` codes are passed through (with rewritten messages) from `classifyRegime`. Duplication between `marketReasons` and `clmmSuitability.reasons` (e.g., insufficient samples surfaced in both) is acceptable: they render in different sections of the page and answer different questions.

## 9. Module layout

New files (mirrors existing `src/engine/<area>/` and `src/http/handlers/` patterns):

```
src/engine/marketRegime/
  config.ts                              MARKET_REGIME_CONFIG, MARKET_REGIME_CONFIG_VERSION
  classifyMarketRegime.ts                stateless wrapper around classifyRegime
  evaluateMarketClmmSuitability.ts       suitability decision tree
  freshness.ts                           computeFreshness(now, lastCandleUnixMs, config)
  closedCandleCutoff.ts                  closedCandleCutoffUnixMs(now, timeframeMs, delayMs)
  buildRegimeCurrent.ts                  orchestrator: candles + nowUnixMs -> response
  __tests__/
    classifyMarketRegime.test.ts
    evaluateMarketClmmSuitability.test.ts
    freshness.test.ts
    buildRegimeCurrent.test.ts
    buildRegimeCurrent.snapshot.test.ts

src/contract/v1/
  types.ts                               + CandleIngestRequest/Response, RegimeCurrentResponse
  validation.ts                          + parseCandleIngestRequest, parseRegimeCurrentQuery
  __tests__/
    candles.validation.test.ts
    regimeCurrent.validation.test.ts

src/ledger/
  schema.sql                             + candle_revisions table + indexes
  candlesWriter.ts                       writeCandles, getLatestCandlesForFeed
  __tests__/
    candlesWriter.test.ts

src/http/
  handlers/
    candlesIngest.ts                     POST /v1/candles handler
    regimeCurrent.ts                     GET /v1/regime/current handler
  __tests__/
    candlesIngest.route.test.ts
    regimeCurrent.route.test.ts
  routes.ts                              + 2 route registrations
  openapi.ts                             + 2 paths, + new schemas, + new error codes
  errors.ts                              + new code constants
```

### 9.1 Separation rules carried from AGENTS.md

- `src/engine/marketRegime/` is **pure**: no DB, no HTTP, no `Date.now()`. The orchestrator takes `nowUnixMs` as a parameter. The handler injects `Date.now()` at the boundary.
- `src/ledger/candlesWriter.ts` owns the SQL and the per-slot decision tree. It returns `{ insertedCount, revisedCount, idempotentCount, rejectedCount, rejections[] }`.
- `src/http/handlers/regimeCurrent.ts` is the only place `Date.now()` is read for this feature.

### 9.2 GET wiring

```
handler reads now once
  -> read latest revisions from candlesWriter (closed-candle cutoff applied in SQL)
  -> if zero rows: 404 CANDLES_NOT_FOUND
  -> indicators.computeIndicators(candles, config.indicators)
  -> classifyMarketRegime(telemetry, config.regime) -> { regime, reasons }
  -> freshness.computeFreshness(now, lastCandleUnixMs, config)
  -> evaluateMarketClmmSuitability({ regime, telemetry, freshness, candleCount, config.suitability })
  -> assemble RegimeCurrentResponse (deterministic object construction)
  -> 200
```

No manual `toCanonicalJson` on the GET response — match existing handler practice (e.g., `getCurrentSrLevels`). Determinism is guaranteed by deterministic object construction + Vitest snapshot tests, not by canonical-JSON byte serialization.

### 9.3 POST wiring

```
auth -> requireSharedSecret(X-Candles-Ingest-Token, CANDLES_INGEST_TOKEN)
  -> parseCandleIngestRequest (schema, allowlist, OHLCV invariants, batch cap, dup unixMs)
  -> candlesWriter.writeCandles under BEGIN IMMEDIATE
  -> 200 with counts and rejections[]
```

## 10. Testing strategy

Following AGENTS.md "required coverage" — contract validation, determinism snapshots, fixture-driven engine tests.

### 10.1 Contract validation (`src/contract/v1/__tests__/`)

`candles.validation.test.ts`:
- Happy path: minimal valid 1-candle batch.
- `schemaVersion` missing/wrong → `SCHEMA_VERSION_UNSUPPORTED`.
- Timeframe not in allowlist → `VALIDATION_ERROR`.
- Missing `source` / `network` / `poolAddress` / `symbol` → `VALIDATION_ERROR`.
- Malformed `sourceRecordedAtIso` → `VALIDATION_ERROR`.
- `candles.length === 0` → `VALIDATION_ERROR`.
- `candles.length === 1001` → `BATCH_TOO_LARGE`.
- OHLCV invariants: each violation produces `MALFORMED_CANDLE` with offending index.
- `unixMs` not aligned to `timeframeMs` → `MALFORMED_CANDLE`.
- Duplicate `unixMs` in batch → `DUPLICATE_CANDLE_IN_BATCH`.

`regimeCurrent.validation.test.ts`:
- Missing each of the 5 selectors → `VALIDATION_ERROR`.
- Timeframe outside `["1h"]` → `VALIDATION_ERROR`.

### 10.2 Engine pure-core (`src/engine/marketRegime/__tests__/`)

- `classifyMarketRegime.test.ts` — UP/DOWN/CHOP fixtures produce expected regime; reasons emitted match expected codes; identical telemetry → identical output.
- `evaluateMarketClmmSuitability.test.ts` — full decision-tree truth table:
  - Insufficient samples → UNKNOWN regardless of regime.
  - Hard-stale → UNKNOWN regardless of regime.
  - UP fresh sufficient → BLOCKED (`CLMM_BLOCKED_TRENDING_UP`).
  - DOWN → BLOCKED.
  - CHOP + extreme volRatio → BLOCKED (`CLMM_BLOCKED_EXTREME_VOLATILITY`).
  - CHOP + extreme compression → BLOCKED (`CLMM_BLOCKED_EXTREME_COMPRESSION`).
  - CHOP + soft-stale → CAUTION (`CLMM_CAUTION_SOFT_STALE_DATA`).
  - CHOP + elevated non-extreme vol → CAUTION (`CLMM_CAUTION_ELEVATED_VOLATILITY`).
  - CHOP + soft-stale + elevated vol → CAUTION with both reason codes.
  - CHOP + fresh + sufficient + low vol → ALLOWED (`CLMM_ALLOWED_CHOP_FRESH`).
- `freshness.test.ts` — boundary cases on `softStaleMs` / `hardStaleMs` exactly at the threshold.
- `buildRegimeCurrent.test.ts` — given candles + `nowUnixMs`, returns expected regime/telemetry/suitability/freshness/metadata.
- `buildRegimeCurrent.snapshot.test.ts` — golden fixture inputs produce byte-identical response objects across runs (Vitest object snapshot, not canonical-JSON byte snapshot).

### 10.3 Ledger (`src/ledger/__tests__/candlesWriter.test.ts`)

- Happy path: 3 fresh slots → `insertedCount=3`, no rejections.
- Byte-equal replay → `idempotentCount=3`, no inserts.
- Newer `sourceRecordedAtIso` + different OHLCV → `revisedCount=3`; new row appended; latest read returns new bytes.
- Older `sourceRecordedAtIso` + different OHLCV → `rejectedCount=3`; rejection details include existing `sourceRecordedAtIso`.
- Mixed batch (1 insert + 1 revise + 1 idempotent + 1 reject) → counts split correctly; accepted rows committed; rejected row not written.
- Structural failure mid-batch → whole transaction rolled back; no rows visible.
- Read query returns latest revision per slot, ASC by `unixMs`, with closed-candle cutoff applied.

### 10.4 HTTP route tests (`src/http/__tests__/`)

`candlesIngest.route.test.ts`:
- 401 missing/bad token; 500 missing env; 200 happy path; 400 each validation code.
- Stale subset → 200 with `rejectedCount > 0` and `rejections.length === rejectedCount`. Empty-rejections case → 200 with `rejectedCount === 0` and `rejections === []`.

`regimeCurrent.route.test.ts`:
- 200 fresh CHOP → ALLOWED.
- 200 trending UP → BLOCKED.
- 200 hard-stale, `candleCount >= minCandles` → UNKNOWN (covers UNKNOWN-by-staleness path independently of insufficient-samples).
- 200 insufficient samples, `freshness.hardStale === false` → UNKNOWN (covers UNKNOWN-by-samples path independently of staleness).
- 200 soft-stale CHOP → CAUTION.
- 404 zero closed candles → `CANDLES_NOT_FOUND` (404 check happens before suitability evaluation; hard-stale + zero candles is 404).
- 400 missing selector.
- **No plan-ledger writes** — assert `plans` table row count is unchanged after repeated GETs.

## 11. OpenAPI and error registry

### 11.1 OpenAPI updates (`src/http/openapi.ts`)

Two new paths added to `/v1/openapi.json`:

- `POST /v1/candles` — request schema `CandleIngestRequest`, response schema `CandleIngestResponse`, 200/400/401/500 entries; error responses reference the existing error envelope schema.
- `GET /v1/regime/current` — query parameter schema for the 5 selectors, response schema `RegimeCurrentResponse`, 200/400/404 entries.

Both schemas added to `components.schemas`. `schemaVersion` continues to be a string literal `"1.0"`.

Existing smoke test (`src/__tests__/smoke.test.ts`) extended to assert both paths appear and reference correct schema names.

### 11.2 Error code constants (`src/http/errors.ts`)

New entries appended to the existing constant block (no renames, no removals):

```ts
SCHEMA_VERSION_UNSUPPORTED  // already exists
VALIDATION_ERROR            // already exists
BATCH_TOO_LARGE             // new
MALFORMED_CANDLE            // new
DUPLICATE_CANDLE_IN_BATCH   // new
CANDLES_NOT_FOUND           // new
UNAUTHORIZED                // already exists
SERVER_MISCONFIGURATION     // already exists
```

`CANDLE_STALE_REVISION` is **not** registered as an HTTP error code; it appears only in `rejections[].reason`.

## 12. Migration / rollout

Schema change is purely additive (`CREATE TABLE IF NOT EXISTS candle_revisions` + two `CREATE INDEX IF NOT EXISTS`). No migration script needed for the existing SQLite store — boot-time `schema.sql` exec is idempotent.

New env var `CANDLES_INGEST_TOKEN` must be set on Railway before deploy. Missing env returns 500 only on `POST /v1/candles` (route-level check); it does not block service boot or read routes. `requireSharedSecret` fails closed before any write is attempted.

## 13. Acceptance criteria mapping

Walking issue #17's checklist:

| Issue criterion | Section |
|---|---|
| Contract types and validation for candle ingestion | §5.1, §9 |
| SQLite persistence keyed by symbol+source+timeframe+unixMs (extended with network+poolAddress) | §6 |
| Idempotent candle upsert behavior | §5.1, §6.1 |
| `POST /v1/candles` with validation errors using existing taxonomy | §5.1, §11.2 |
| `GET /v1/regime/current` | §5.2 |
| GET computes/reads latest regime without portfolio/autopilot state | §4, §9 |
| Response includes regime, telemetry, reasons, suitability, freshness, metadata | §5.2 |
| Response marks stale data | §5.2 (`softStale` + `hardStale`) |
| 404 when no candles exist for slot | §5.2, §9 |
| 400 for missing/invalid params | §5.2, §10 |
| OpenAPI includes both endpoints | §11.1 |
| Tests cover happy/stale/missing/invalid/idempotent/deterministic | §10 |
| No plan-ledger entry on GET | §9, §10.4 (route test asserts) |
