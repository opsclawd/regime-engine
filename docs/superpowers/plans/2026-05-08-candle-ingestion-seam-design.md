# Candle Ingestion Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a Clean-Architecture seam for candle ingestion behind the existing HTTP, SQLite, and Postgres behavior — pure domain rules under `src/domain/candle`, ports under `src/application/ports`, an `IngestCandlesUseCase` under `src/application/use-cases`, and SQLite/Postgres adapters under `src/adapters/{sqlite,postgres}` — with zero behavior change.

**Architecture:** A storage-owned unit of work (`CandleWritePort.withIngestLock(feed, unixMsValues, fn)`) wraps the read/classify/write loop in either a SQLite `BEGIN IMMEDIATE` transaction or a Postgres transaction with `pg_advisory_xact_lock`. The use case owns ingestion policy inside that callback; it depends only on ports and pure domain helpers. A `CandleReadPort` symmetrically handles latest-candle reads. `candlesWriter.ts` and `CandleStore` become thin compatibility wrappers that delegate to the new adapters so existing tests keep their assertions.

**Tech Stack:** Node 22, pnpm 10, TypeScript (NodeNext, strict), Fastify 5, `node:sqlite`, Drizzle ORM + `postgres` driver, Vitest. Existing boundary rules in `.dependency-cruiser.cjs` already prohibit `src/domain/**` and `src/application/**` from importing outer layers, framework npm packages, or `process.env` — the new code must respect those rules.

---

## File Map

**Create — domain (pure):**

- `src/domain/candle/candleRevision.ts` — re-exports `computeOhlcv`, `classifyCandle`, and the `ExistingLatest` / `CandleDecision` types as pure domain symbols.
- `src/domain/candle/__tests__/candleRevision.test.ts` — pure tests for OHLCV hashing determinism and `classifyCandle` behavior.

**Create — application (orchestration, no I/O):**

- `src/application/ports/clock.ts` — `ClockPort` interface.
- `src/application/ports/candlePorts.ts` — `CandleFeed`, `ExistingLatestCandleRevision`, `CandleRevisionInsert`, `CandleIngestSession`, `CandleWritePort`, `CandleReadPort`.
- `src/application/use-cases/IngestCandlesUseCase.ts` — `createIngestCandlesUseCase(deps)` factory returning the policy function.
- `src/application/use-cases/__tests__/IngestCandlesUseCase.test.ts` — uses an in-memory fake `CandleWritePort` with a real `CandleIngestSession` Map.

**Create — adapters (storage mechanics):**

- `src/adapters/sqlite/SqliteCandleRevisionUnitOfWork.ts` — implements `CandleWritePort` over `LedgerStore` with `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` and the existing latest-row SQL.
- `src/adapters/sqlite/SqliteCandleReadAdapter.ts` — implements `CandleReadPort.getLatestCandlesForFeed` over `LedgerStore`.
- `src/adapters/postgres/PostgresCandleRevisionUnitOfWork.ts` — implements `CandleWritePort` over Drizzle `Db` with `pg_advisory_xact_lock` and bulk insert.
- `src/adapters/postgres/PostgresCandleReadAdapter.ts` — implements `CandleReadPort.getLatestCandlesForFeed` over Drizzle `Db`.

**Modify — wire-up + compatibility:**

- `src/ledger/candlesWriter.ts` — `writeCandles` becomes a thin wrapper: build SQLite UoW + use case, run, return result. `getLatestCandlesForFeed` becomes a thin wrapper around the SQLite read adapter. Internal SQL details move to the adapter.
- `src/ledger/candleStore.ts` — `CandleStore` becomes a thin wrapper: methods build the PG adapters + use case, run, return result. Internal SQL details move to the adapters.
- `src/http/handlers/candlesIngest.ts` — handler thins out to: auth, parse, build use case via composition, call, attach `schemaVersion`, return.
- `src/http/routes.ts` — composition picks SQLite or Postgres adapters based on `DATABASE_URL`, passes use case + read port to handlers.
- `src/http/handlers/regimeCurrent.ts` — switch from `(LedgerStore, CandleStore?)` to a single `CandleReadPort` injected by the composition; keep planning/aggregation/freshness/classification untouched.

No new SQL migrations. No contract changes. No changes under `src/engine/**` aside from no-op typecheck-only changes if the regime-current handler dependency injection requires touching downstream call sites (it should not — all engine modules are pure and don't know about stores).

---

## Pre-flight

- [ ] **Step 0: Confirm clean working tree on a fresh branch from `main`**

Run:

```bash
git status
git log -1 --oneline
git checkout -b m38-candle-ingestion-seam
```

Expected: working tree clean (or only this plan file unstaged), HEAD on the design commit `d508ae6 m38: add candle ingestion seam design`.

- [ ] **Step 1: Confirm baseline is green**

Run:

```bash
npm run typecheck && npm run lint && npm run test && npm run build && npm run boundaries
```

Expected: all five succeed. If any fail, stop and surface the failure — every refactor task below assumes a green baseline so a new red is unambiguously caused by #38.

- [ ] **Step 2: Confirm baseline `test:pg` status**

Run:

```bash
npm run test:pg || echo "PG suite is unavailable in this environment"
```

Expected: either the PG suite runs and is green, or it fails because `DATABASE_URL` is unreachable. **Record which** in the PR description. If `test:pg` cannot run locally, the implementer must note that the PG adapter behavior is locally unvalidated and rely on CI for proof.

---

## Task 1: Move pure candle revision logic into `src/domain/candle`

The domain layer must depend only on pure contract helpers (`canonical.ts`, `hash.ts`). It must not import HTTP, ledger, adapters, database packages, workers, `process`, or `process.env`. We move the _file_ into `src/domain/candle/candleRevision.ts` but keep `src/ledger/candleRevisionLogic.ts` as a re-export shim so existing imports from `candlesWriter.ts` and `candleStore.ts` keep compiling until they're rewritten in later tasks.

**Files:**

- Create: `src/domain/candle/candleRevision.ts`
- Create: `src/domain/candle/__tests__/candleRevision.test.ts`
- Modify: `src/ledger/candleRevisionLogic.ts` (becomes a one-line re-export)

- [ ] **Step 1: Write failing tests at the new domain location**

Create `src/domain/candle/__tests__/candleRevision.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeOhlcv, classifyCandle, type ExistingLatest } from "../candleRevision.js";

describe("computeOhlcv", () => {
  it("produces the same hash for byte-equal OHLCV", () => {
    const a = computeOhlcv({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
    const b = computeOhlcv({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
    expect(a.ohlcvHash).toBe(b.ohlcvHash);
    expect(a.ohlcvCanonical).toBe(b.ohlcvCanonical);
  });

  it("produces a different hash when any field changes", () => {
    const base = computeOhlcv({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
    const changed = computeOhlcv({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 11 });
    expect(base.ohlcvHash).not.toBe(changed.ohlcvHash);
  });
});

describe("classifyCandle", () => {
  const incomingHash = "incoming-hash";
  const incomingTs = 2_000_000;

  it("returns insert when no latest revision exists", () => {
    expect(classifyCandle(undefined, incomingHash, incomingTs)).toEqual({ kind: "insert" });
  });

  it("returns idempotent on equal OHLCV hash regardless of timestamp", () => {
    const existing: ExistingLatest = {
      ohlcvHash: incomingHash,
      sourceRecordedAtUnixMs: incomingTs + 1, // newer existing
      sourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
    };
    expect(classifyCandle(existing, incomingHash, incomingTs)).toEqual({ kind: "idempotent" });
  });

  it("returns revise on changed OHLCV with strictly newer incoming timestamp", () => {
    const existing: ExistingLatest = {
      ohlcvHash: "old-hash",
      sourceRecordedAtUnixMs: incomingTs - 1,
      sourceRecordedAtIso: "2026-04-26T11:00:00.000Z"
    };
    expect(classifyCandle(existing, incomingHash, incomingTs)).toEqual({ kind: "revise" });
  });

  it("returns stale on changed OHLCV with older incoming timestamp", () => {
    const existing: ExistingLatest = {
      ohlcvHash: "old-hash",
      sourceRecordedAtUnixMs: incomingTs + 1,
      sourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
    };
    expect(classifyCandle(existing, incomingHash, incomingTs)).toEqual({
      kind: "stale",
      existingSourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
    });
  });

  it("returns stale on changed OHLCV with equal incoming timestamp", () => {
    const existing: ExistingLatest = {
      ohlcvHash: "old-hash",
      sourceRecordedAtUnixMs: incomingTs,
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z"
    };
    expect(classifyCandle(existing, incomingHash, incomingTs)).toEqual({
      kind: "stale",
      existingSourceRecordedAtIso: "2026-04-26T12:00:00.000Z"
    });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail with the expected import error**

Run:

```bash
npx vitest run src/domain/candle/__tests__/candleRevision.test.ts
```

Expected: FAIL — module `../candleRevision.js` cannot be resolved.

- [ ] **Step 3: Create the domain module by moving the file**

Create `src/domain/candle/candleRevision.ts` with the exact content currently in `src/ledger/candleRevisionLogic.ts`:

```ts
import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { sha256Hex } from "../../contract/v1/hash.js";

export const computeOhlcv = (candle: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}) => {
  const ohlcvCanonical = toCanonicalJson({
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  });
  const ohlcvHash = sha256Hex(ohlcvCanonical);
  return { ohlcvCanonical, ohlcvHash };
};

export type ExistingLatest = {
  sourceRecordedAtUnixMs: number;
  sourceRecordedAtIso: string;
  ohlcvHash: string;
};

export type CandleDecision =
  | { kind: "insert" }
  | { kind: "idempotent" }
  | { kind: "revise" }
  | { kind: "stale"; existingSourceRecordedAtIso: string };

export const classifyCandle = (
  existing: ExistingLatest | undefined,
  ohlcvHash: string,
  incomingSourceRecordedAtUnixMs: number
): CandleDecision => {
  if (!existing) {
    return { kind: "insert" };
  }
  if (existing.ohlcvHash === ohlcvHash) {
    return { kind: "idempotent" };
  }
  if (existing.sourceRecordedAtUnixMs < incomingSourceRecordedAtUnixMs) {
    return { kind: "revise" };
  }
  return { kind: "stale", existingSourceRecordedAtIso: existing.sourceRecordedAtIso };
};
```

- [ ] **Step 4: Replace `src/ledger/candleRevisionLogic.ts` with a re-export shim**

Open `src/ledger/candleRevisionLogic.ts` and replace the entire file contents with:

```ts
export { computeOhlcv, classifyCandle } from "../domain/candle/candleRevision.js";
export type { ExistingLatest, CandleDecision } from "../domain/candle/candleRevision.js";
```

This preserves the existing `import { computeOhlcv, classifyCandle, type ExistingLatest } from "./candleRevisionLogic.js"` lines in `candlesWriter.ts` and `candleStore.ts` until those files are rewritten in Tasks 4 and 5.

- [ ] **Step 5: Run the new tests and the full vitest suite**

Run:

```bash
npx vitest run src/domain/candle/__tests__/candleRevision.test.ts
npm run test
```

Expected: domain tests PASS. Full suite PASS — old `ledger/__tests__/candlesWriter.test.ts` and friends still pass because the shim preserves the public surface.

- [ ] **Step 6: Run boundaries to confirm the new domain folder satisfies the boundary rules**

Run:

```bash
npm run boundaries
```

Expected: PASS. The new file imports only `src/contract/v1/canonical.ts` and `src/contract/v1/hash.ts`, both pure helpers; it imports no outer layers, no framework npm packages, and no `node:sqlite`/`process`. The boundary scanner scripts already cover `src/domain` (verified in `scripts/check-boundary-env.sh`).

- [ ] **Step 7: Commit**

```bash
git add src/domain/candle/candleRevision.ts \
        src/domain/candle/__tests__/candleRevision.test.ts \
        src/ledger/candleRevisionLogic.ts
git commit -m "refactor(domain): move candle revision logic to src/domain/candle"
```

---

## Task 2: Define application ports (`ClockPort`, `CandleReadPort`, `CandleWritePort`)

Ports live under `src/application/ports/` and are pure type definitions (interfaces and supporting types). They must not import HTTP, ledger, adapters, database packages, workers, `process`, or `process.env`. They may import contract types (`CandleRow`, `GetLatestCandlesParams`) and domain types (`ExistingLatest`).

**Files:**

- Create: `src/application/ports/clock.ts`
- Create: `src/application/ports/candlePorts.ts`

- [ ] **Step 1: Create `ClockPort`**

Create `src/application/ports/clock.ts`:

```ts
export interface ClockPort {
  nowUnixMs(): number;
}
```

- [ ] **Step 2: Create candle ports**

Create `src/application/ports/candlePorts.ts`:

```ts
import type { CandleRow, GetLatestCandlesParams } from "../../contract/v1/types.js";

export interface CandleFeed {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: string;
}

export interface ExistingLatestCandleRevision {
  sourceRecordedAtUnixMs: number;
  sourceRecordedAtIso: string;
  ohlcvHash: string;
}

export interface CandleRevisionInsert {
  feed: CandleFeed;
  unixMs: number;
  sourceRecordedAtIso: string;
  sourceRecordedAtUnixMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ohlcvCanonical: string;
  ohlcvHash: string;
  receivedAtUnixMs: number;
}

export interface CandleIngestSession {
  readLatestRevisions(unixMsValues: number[]): Promise<Map<number, ExistingLatestCandleRevision>>;
  insertRevisions(revisions: CandleRevisionInsert[]): Promise<void>;
}

export interface CandleWritePort {
  withIngestLock<T>(
    feed: CandleFeed,
    unixMsValues: number[],
    fn: (session: CandleIngestSession) => Promise<T>
  ): Promise<T>;
}

export interface CandleReadPort {
  getLatestCandlesForFeed(params: GetLatestCandlesParams): Promise<CandleRow[]>;
}
```

- [ ] **Step 3: Typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Boundaries check**

Run:

```bash
npm run boundaries
```

Expected: PASS. The ports import only contract types; no outer-layer or framework imports.

- [ ] **Step 5: Commit**

```bash
git add src/application/ports/clock.ts src/application/ports/candlePorts.ts
git commit -m "feat(application): add candle and clock ports"
```

---

## Task 3: Add `IngestCandlesUseCase` with fake-session tests

The use case orchestrates ingestion policy. It is async because the unit-of-work is async, and it returns the same `Omit<CandleIngestResponse, "schemaVersion">` shape that `writeCandles` and `CandleStore.writeCandles` return today. We unit-test it with a fake `CandleWritePort` backed by a JS `Map` to prove the policy without touching SQLite or Postgres.

**Files:**

- Create: `src/application/use-cases/IngestCandlesUseCase.ts`
- Create: `src/application/use-cases/__tests__/IngestCandlesUseCase.test.ts`
- Create: `src/application/use-cases/__tests__/fakes/FakeCandleWritePort.ts`

- [ ] **Step 1: Write failing tests using a fake `CandleWritePort`**

Create `src/application/use-cases/__tests__/fakes/FakeCandleWritePort.ts`:

```ts
import type {
  CandleFeed,
  CandleIngestSession,
  CandleRevisionInsert,
  CandleWritePort,
  ExistingLatestCandleRevision
} from "../../../ports/candlePorts.js";

interface StoredRevision {
  feed: CandleFeed;
  unixMs: number;
  sourceRecordedAtUnixMs: number;
  sourceRecordedAtIso: string;
  ohlcvHash: string;
  insertSeq: number;
}

const feedKey = (feed: CandleFeed): string =>
  `${feed.symbol}|${feed.source}|${feed.network}|${feed.poolAddress}|${feed.timeframe}`;

export class FakeCandleWritePort implements CandleWritePort {
  private readonly revisions: StoredRevision[] = [];
  private seq = 0;
  public lockCalls: Array<{ feed: CandleFeed; unixMsValues: number[] }> = [];

  async withIngestLock<T>(
    feed: CandleFeed,
    unixMsValues: number[],
    fn: (session: CandleIngestSession) => Promise<T>
  ): Promise<T> {
    this.lockCalls.push({ feed, unixMsValues: [...unixMsValues] });

    const session: CandleIngestSession = {
      readLatestRevisions: async (slots) => {
        const result = new Map<number, ExistingLatestCandleRevision>();
        const fk = feedKey(feed);
        for (const slot of slots) {
          const candidates = this.revisions
            .filter((r) => feedKey(r.feed) === fk && r.unixMs === slot)
            .sort(
              (a, b) =>
                b.sourceRecordedAtUnixMs - a.sourceRecordedAtUnixMs || b.insertSeq - a.insertSeq
            );
          if (candidates.length > 0) {
            const top = candidates[0];
            result.set(slot, {
              sourceRecordedAtUnixMs: top.sourceRecordedAtUnixMs,
              sourceRecordedAtIso: top.sourceRecordedAtIso,
              ohlcvHash: top.ohlcvHash
            });
          }
        }
        return result;
      },
      insertRevisions: async (revisions: CandleRevisionInsert[]) => {
        for (const r of revisions) {
          this.seq += 1;
          this.revisions.push({
            feed: r.feed,
            unixMs: r.unixMs,
            sourceRecordedAtUnixMs: r.sourceRecordedAtUnixMs,
            sourceRecordedAtIso: r.sourceRecordedAtIso,
            ohlcvHash: r.ohlcvHash,
            insertSeq: this.seq
          });
        }
      }
    };

    return fn(session);
  }

  totalRevisions(): number {
    return this.revisions.length;
  }
}
```

Create `src/application/use-cases/__tests__/IngestCandlesUseCase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createIngestCandlesUseCase } from "../IngestCandlesUseCase.js";
import { FakeCandleWritePort } from "./fakes/FakeCandleWritePort.js";
import type { CandleIngestRequest } from "../../../contract/v1/types.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

const makeRequest = (overrides: Partial<CandleIngestRequest> = {}): CandleIngestRequest => ({
  schemaVersion: "1.0",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  symbol: "SOL/USDC",
  timeframe: "15m",
  sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
  candles: [
    { unixMs: 1 * FIFTEEN_MIN_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
    { unixMs: 2 * FIFTEEN_MIN_MS, open: 105, high: 115, low: 100, close: 110, volume: 2 },
    { unixMs: 3 * FIFTEEN_MIN_MS, open: 110, high: 120, low: 105, close: 115, volume: 3 }
  ],
  ...overrides
});

describe("IngestCandlesUseCase", () => {
  it("inserts brand-new slots", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    const result = await useCase(makeRequest(), 1_700_000_000_000);

    expect(result).toEqual({
      insertedCount: 3,
      revisedCount: 0,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });
    expect(port.totalRevisions()).toBe(3);
    expect(port.lockCalls).toHaveLength(1);
    expect(port.lockCalls[0].unixMsValues).toEqual([
      1 * FIFTEEN_MIN_MS,
      2 * FIFTEEN_MIN_MS,
      3 * FIFTEEN_MIN_MS
    ]);
  });

  it("byte-equal replay is idempotent without new rows", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await useCase(makeRequest(), 1_700_000_000_000);
    const result = await useCase(makeRequest(), 1_700_000_001_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 0,
      idempotentCount: 3,
      rejectedCount: 0,
      rejections: []
    });
    expect(port.totalRevisions()).toBe(3);
  });

  it("appends a revision when sourceRecordedAtIso advances and OHLCV differs", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await useCase(makeRequest(), 1_700_000_000_000);

    const newer = makeRequest({
      sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
      candles: [
        { unixMs: 1 * FIFTEEN_MIN_MS, open: 101, high: 111, low: 91, close: 106, volume: 11 },
        { unixMs: 2 * FIFTEEN_MIN_MS, open: 106, high: 116, low: 101, close: 111, volume: 22 },
        { unixMs: 3 * FIFTEEN_MIN_MS, open: 111, high: 121, low: 106, close: 116, volume: 33 }
      ]
    });
    const result = await useCase(newer, 1_700_000_002_000);

    expect(result).toEqual({
      insertedCount: 0,
      revisedCount: 3,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    });
    expect(port.totalRevisions()).toBe(6);
  });

  it("rejects per-slot when sourceRecordedAtIso is older with different OHLCV", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await useCase(
      makeRequest({ sourceRecordedAtIso: "2026-04-26T13:00:00.000Z" }),
      1_700_000_000_000
    );

    const stale = makeRequest({
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
      candles: [
        { unixMs: 1 * FIFTEEN_MIN_MS, open: 200, high: 210, low: 190, close: 205, volume: 1 }
      ]
    });
    const result = await useCase(stale, 1_700_000_001_000);

    expect(result.insertedCount).toBe(0);
    expect(result.rejectedCount).toBe(1);
    expect(result.rejections).toEqual([
      {
        unixMs: 1 * FIFTEEN_MIN_MS,
        reason: "STALE_REVISION",
        existingSourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
      }
    ]);
  });

  it("mixes inserted/revised/idempotent/rejected and sorts rejections by unixMs", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await useCase(
      makeRequest({
        sourceRecordedAtIso: "2026-04-26T13:00:00.000Z",
        candles: [
          { unixMs: 1 * FIFTEEN_MIN_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
          { unixMs: 2 * FIFTEEN_MIN_MS, open: 105, high: 115, low: 100, close: 110, volume: 2 },
          { unixMs: 5 * FIFTEEN_MIN_MS, open: 130, high: 140, low: 125, close: 135, volume: 5 }
        ]
      }),
      1_700_000_000_000
    );

    const mixed = makeRequest({
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z",
      candles: [
        { unixMs: 5 * FIFTEEN_MIN_MS, open: 999, high: 999, low: 999, close: 999, volume: 9 },
        { unixMs: 1 * FIFTEEN_MIN_MS, open: 100, high: 110, low: 90, close: 105, volume: 1 },
        { unixMs: 2 * FIFTEEN_MIN_MS, open: 999, high: 999, low: 999, close: 999, volume: 9 },
        { unixMs: 3 * FIFTEEN_MIN_MS, open: 110, high: 120, low: 105, close: 115, volume: 3 }
      ]
    });
    const result = await useCase(mixed, 1_700_000_002_000);

    expect(result.idempotentCount).toBe(1);
    expect(result.insertedCount).toBe(1);
    expect(result.revisedCount).toBe(0);
    expect(result.rejectedCount).toBe(2);
    expect(result.rejections.map((r) => r.unixMs)).toEqual([
      2 * FIFTEEN_MIN_MS,
      5 * FIFTEEN_MIN_MS
    ]);
    expect(result.rejections[0].reason).toBe("STALE_REVISION");
    expect(result.rejections[0].existingSourceRecordedAtIso).toBe("2026-04-26T13:00:00.000Z");
  });

  it("throws on unparsable sourceRecordedAtIso", async () => {
    const port = new FakeCandleWritePort();
    const useCase = createIngestCandlesUseCase({ candleWritePort: port });
    await expect(
      useCase(makeRequest({ sourceRecordedAtIso: "not-a-date" }), 1_700_000_000_000)
    ).rejects.toThrow(/Invalid sourceRecordedAtIso/);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail with module-not-found**

Run:

```bash
npx vitest run src/application/use-cases/__tests__/IngestCandlesUseCase.test.ts
```

Expected: FAIL — `../IngestCandlesUseCase.js` cannot be resolved.

- [ ] **Step 3: Implement the use case**

Create `src/application/use-cases/IngestCandlesUseCase.ts`:

```ts
import {
  computeOhlcv,
  classifyCandle,
  type ExistingLatest
} from "../../domain/candle/candleRevision.js";
import type {
  CandleIngestRejection,
  CandleIngestRequest,
  CandleIngestResponse
} from "../../contract/v1/types.js";
import type { CandleFeed, CandleRevisionInsert, CandleWritePort } from "../ports/candlePorts.js";

export type IngestCandlesUseCase = (
  input: CandleIngestRequest,
  receivedAtUnixMs: number
) => Promise<Omit<CandleIngestResponse, "schemaVersion">>;

export interface IngestCandlesUseCaseDeps {
  candleWritePort: CandleWritePort;
}

export const createIngestCandlesUseCase = (
  deps: IngestCandlesUseCaseDeps
): IngestCandlesUseCase => {
  return async (input, receivedAtUnixMs) => {
    const incomingSourceRecordedAtUnixMs = Date.parse(input.sourceRecordedAtIso);
    if (!Number.isFinite(incomingSourceRecordedAtUnixMs)) {
      throw new Error(`Invalid sourceRecordedAtIso: ${input.sourceRecordedAtIso}`);
    }

    const feed: CandleFeed = {
      symbol: input.symbol,
      source: input.source,
      network: input.network,
      poolAddress: input.poolAddress,
      timeframe: input.timeframe
    };

    const unixMsValues = input.candles.map((c) => c.unixMs);

    let insertedCount = 0;
    let revisedCount = 0;
    let idempotentCount = 0;
    let rejectedCount = 0;
    const rejections: CandleIngestRejection[] = [];

    await deps.candleWritePort.withIngestLock(feed, unixMsValues, async (session) => {
      const existingBySlot = await session.readLatestRevisions(unixMsValues);
      const accepted: CandleRevisionInsert[] = [];

      for (const candle of input.candles) {
        const { ohlcvCanonical, ohlcvHash } = computeOhlcv(candle);
        const existing: ExistingLatest | undefined = existingBySlot.get(candle.unixMs);
        const decision = classifyCandle(existing, ohlcvHash, incomingSourceRecordedAtUnixMs);

        switch (decision.kind) {
          case "insert":
          case "revise":
            accepted.push({
              feed,
              unixMs: candle.unixMs,
              sourceRecordedAtIso: input.sourceRecordedAtIso,
              sourceRecordedAtUnixMs: incomingSourceRecordedAtUnixMs,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              ohlcvCanonical,
              ohlcvHash,
              receivedAtUnixMs
            });
            if (decision.kind === "insert") insertedCount += 1;
            else revisedCount += 1;
            break;
          case "idempotent":
            idempotentCount += 1;
            break;
          case "stale":
            rejectedCount += 1;
            rejections.push({
              unixMs: candle.unixMs,
              reason: "STALE_REVISION",
              existingSourceRecordedAtIso: decision.existingSourceRecordedAtIso
            });
            break;
        }
      }

      if (accepted.length > 0) {
        await session.insertRevisions(accepted);
      }
    });

    rejections.sort((a, b) => a.unixMs - b.unixMs);

    return { insertedCount, revisedCount, idempotentCount, rejectedCount, rejections };
  };
};
```

- [ ] **Step 4: Run the use case tests and confirm green**

Run:

```bash
npx vitest run src/application/use-cases/__tests__/IngestCandlesUseCase.test.ts
```

Expected: PASS — all six tests.

- [ ] **Step 5: Boundaries check**

Run:

```bash
npm run boundaries
```

Expected: PASS. The use case imports only `src/contract/**`, `src/domain/candle/**`, and `src/application/ports/**`; no outer-layer or framework imports.

- [ ] **Step 6: Commit**

```bash
git add src/application/use-cases/IngestCandlesUseCase.ts \
        src/application/use-cases/__tests__/IngestCandlesUseCase.test.ts \
        src/application/use-cases/__tests__/fakes/FakeCandleWritePort.ts
git commit -m "feat(application): add IngestCandlesUseCase with fake-session tests"
```

---

## Task 4: SQLite adapters (read + revision unit-of-work)

The SQLite adapters preserve the exact SQL and transaction shape currently in `candlesWriter.ts`. The unit-of-work owns `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` and the per-slot latest-row SELECT. The read adapter owns the latest-per-slot CTE.

**Important:** `node:sqlite` is synchronous. To match the async `CandleIngestSession` interface, wrap synchronous calls in `Promise.resolve()` / immediate `async` functions. Run the entire callback synchronously inside the SQLite transaction — do not introduce `await` boundaries between `BEGIN IMMEDIATE` and `COMMIT/ROLLBACK` that could let other ticks interleave SQLite calls. Concretely: the unit-of-work calls `BEGIN IMMEDIATE`, then `await fn(session)` synchronously resolves because the use case awaits only the session methods (which themselves resolve synchronously here), then commits.

**Files:**

- Create: `src/adapters/sqlite/SqliteCandleRevisionUnitOfWork.ts`
- Create: `src/adapters/sqlite/SqliteCandleReadAdapter.ts`
- Modify: `src/ledger/candlesWriter.ts` (becomes a thin wrapper; remove inlined logic)

- [ ] **Step 1: Create the SQLite unit-of-work adapter**

Create `src/adapters/sqlite/SqliteCandleRevisionUnitOfWork.ts`:

```ts
import type { LedgerStore } from "../../ledger/store.js";
import type {
  CandleFeed,
  CandleIngestSession,
  CandleRevisionInsert,
  CandleWritePort,
  ExistingLatestCandleRevision
} from "../../application/ports/candlePorts.js";

interface ExistingRow {
  source_recorded_at_unix_ms: number;
  source_recorded_at_iso: string;
  ohlcv_hash: string;
}

const buildSession = (store: LedgerStore, feed: CandleFeed): CandleIngestSession => {
  return {
    readLatestRevisions: async (unixMsValues: number[]) => {
      const stmt = store.db.prepare(
        `SELECT source_recorded_at_unix_ms, source_recorded_at_iso, ohlcv_hash
           FROM candle_revisions
          WHERE symbol = ? AND source = ? AND network = ?
            AND pool_address = ? AND timeframe = ? AND unix_ms = ?
          ORDER BY source_recorded_at_unix_ms DESC, id DESC
          LIMIT 1`
      );
      const result = new Map<number, ExistingLatestCandleRevision>();
      for (const unixMs of unixMsValues) {
        const row = stmt.get(
          feed.symbol,
          feed.source,
          feed.network,
          feed.poolAddress,
          feed.timeframe,
          unixMs
        ) as ExistingRow | undefined;
        if (row) {
          result.set(unixMs, {
            sourceRecordedAtUnixMs: row.source_recorded_at_unix_ms,
            sourceRecordedAtIso: row.source_recorded_at_iso,
            ohlcvHash: row.ohlcv_hash
          });
        }
      }
      return result;
    },
    insertRevisions: async (revisions: CandleRevisionInsert[]) => {
      const stmt = store.db.prepare(
        `INSERT INTO candle_revisions (
           symbol, source, network, pool_address, timeframe, unix_ms,
           source_recorded_at_iso, source_recorded_at_unix_ms,
           open, high, low, close, volume,
           ohlcv_canonical, ohlcv_hash, received_at_unix_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of revisions) {
        stmt.run(
          r.feed.symbol,
          r.feed.source,
          r.feed.network,
          r.feed.poolAddress,
          r.feed.timeframe,
          r.unixMs,
          r.sourceRecordedAtIso,
          r.sourceRecordedAtUnixMs,
          r.open,
          r.high,
          r.low,
          r.close,
          r.volume,
          r.ohlcvCanonical,
          r.ohlcvHash,
          r.receivedAtUnixMs
        );
      }
    }
  };
};

export const createSqliteCandleRevisionUnitOfWork = (store: LedgerStore): CandleWritePort => {
  return {
    withIngestLock: async (feed, _unixMsValues, fn) => {
      store.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(buildSession(store, feed));
        store.db.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          store.db.exec("ROLLBACK");
        } catch (rollbackError) {
          console.error("ROLLBACK failed in SQLite candle ingest unit-of-work:", rollbackError);
        }
        throw error;
      }
    }
  };
};
```

- [ ] **Step 2: Create the SQLite read adapter**

Create `src/adapters/sqlite/SqliteCandleReadAdapter.ts`:

```ts
import type { LedgerStore } from "../../ledger/store.js";
import type { CandleReadPort } from "../../application/ports/candlePorts.js";
import type { CandleRow, GetLatestCandlesParams } from "../../contract/v1/types.js";

interface RawRow {
  unix_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const createSqliteCandleReadAdapter = (store: LedgerStore): CandleReadPort => {
  return {
    getLatestCandlesForFeed: async (params: GetLatestCandlesParams): Promise<CandleRow[]> => {
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
          params.symbol,
          params.source,
          params.network,
          params.poolAddress,
          params.timeframe,
          params.closedCandleCutoffUnixMs,
          params.limit
        ) as RawRow[];

      return rows.map((row) => ({
        unixMs: row.unix_ms,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume
      }));
    }
  };
};
```

- [ ] **Step 3: Replace `src/ledger/candlesWriter.ts` with a thin compatibility wrapper**

Open `src/ledger/candlesWriter.ts` and replace the entire file contents with:

```ts
import type {
  CandleIngestRequest,
  CandleIngestResponse,
  CandleRow,
  GetLatestCandlesParams
} from "../contract/v1/types.js";
import type { LedgerStore } from "./store.js";
import { createSqliteCandleRevisionUnitOfWork } from "../adapters/sqlite/SqliteCandleRevisionUnitOfWork.js";
import { createSqliteCandleReadAdapter } from "../adapters/sqlite/SqliteCandleReadAdapter.js";
import { createIngestCandlesUseCase } from "../application/use-cases/IngestCandlesUseCase.js";

export type { GetLatestCandlesParams, CandleRow };

export const writeCandles = async (
  store: LedgerStore,
  input: CandleIngestRequest,
  receivedAtUnixMs: number
): Promise<Omit<CandleIngestResponse, "schemaVersion">> => {
  const useCase = createIngestCandlesUseCase({
    candleWritePort: createSqliteCandleRevisionUnitOfWork(store)
  });
  return useCase(input, receivedAtUnixMs);
};

export const getLatestCandlesForFeed = async (
  store: LedgerStore,
  params: GetLatestCandlesParams
): Promise<CandleRow[]> => {
  return createSqliteCandleReadAdapter(store).getLatestCandlesForFeed(params);
};
```

This changes both functions from synchronous to `async`. Existing callers (`candlesIngest.ts`, `regimeCurrent.ts`, the tests in `src/ledger/__tests__/candlesWriter.test.ts`) already `await`/`Promise.resolve` these — verify in the next step.

- [ ] **Step 4: Update SQLite tests to await the now-async wrappers**

Open `src/ledger/__tests__/candlesWriter.test.ts`. The current tests call `writeCandles(...)` and `getLatestCandlesForFeed(...)` synchronously. Update each call site to `await` them and mark the surrounding `it("...", () => { ... })` as `async`.

Concretely: every occurrence of `it("name", () => {` whose body calls `writeCandles` or `getLatestCandlesForFeed` becomes `it("name", async () => {`. Every `writeCandles(store, ...)` becomes `await writeCandles(store, ...)`. Every `getLatestCandlesForFeed(store, ...)` becomes `await getLatestCandlesForFeed(store, ...)`.

The assertions in the existing tests must remain unchanged: same `expect(result).toEqual({...})` shape, same `getLedgerCounts(store).candleRevisions` checks, same rejection ordering — those are the behavior-parity assertions that prove the refactor preserved semantics.

- [ ] **Step 5: Update `regimeCurrent.ts` to await `getLatestCandlesForFeed`**

In `src/http/handlers/regimeCurrent.ts`, the SQLite branch currently looks like:

```ts
: getLatestCandlesForFeed(store, {
    symbol: query.symbol,
    ...
  });
```

Change it to:

```ts
: await getLatestCandlesForFeed(store, {
    symbol: query.symbol,
    ...
  });
```

The handler is already `async`, so adding the `await` is sufficient. (Task 7 reworks this further; for now the minimum change is the await.)

- [ ] **Step 6: Update `candlesIngest.ts` to await the now-async SQLite wrapper**

In `src/http/handlers/candlesIngest.ts` the SQLite branch currently looks like:

```ts
: await Promise.resolve(writeCandles(store, body, Date.now()));
```

Replace with:

```ts
: await writeCandles(store, body, Date.now());
```

(`Promise.resolve` was only there to align the synchronous and asynchronous return types.)

- [ ] **Step 7: Run all SQLite-side tests**

Run:

```bash
npx vitest run src/ledger/__tests__/candlesWriter.test.ts \
              src/http/__tests__/candleFallback.e2e.test.ts \
              src/http/__tests__/candles.e2e.test.ts \
              src/http/__tests__/regimeCurrent.e2e.test.ts
```

Expected: PASS. Behavior parity is preserved.

- [ ] **Step 8: Run typecheck, lint, full unit suite, and boundaries**

Run:

```bash
npm run typecheck && npm run lint && npm run test && npm run boundaries
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/sqlite/SqliteCandleRevisionUnitOfWork.ts \
        src/adapters/sqlite/SqliteCandleReadAdapter.ts \
        src/ledger/candlesWriter.ts \
        src/ledger/__tests__/candlesWriter.test.ts \
        src/http/handlers/candlesIngest.ts \
        src/http/handlers/regimeCurrent.ts
git commit -m "refactor(adapters): move SQLite candle SQL into adapters under src/adapters/sqlite"
```

---

## Task 5: Postgres adapters (read + revision unit-of-work)

The Postgres adapters preserve Drizzle transaction usage, the `pg_advisory_xact_lock` keyed by the existing feed-hash function, the batched latest-row SELECT, and the bulk insert. The CTE for the read path moves verbatim.

**Files:**

- Create: `src/adapters/postgres/PostgresCandleRevisionUnitOfWork.ts`
- Create: `src/adapters/postgres/PostgresCandleReadAdapter.ts`
- Modify: `src/ledger/candleStore.ts` (becomes a thin wrapper)

- [ ] **Step 1: Create the Postgres unit-of-work adapter**

Create `src/adapters/postgres/PostgresCandleRevisionUnitOfWork.ts`:

```ts
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import { candleRevisions } from "../../ledger/pg/schema/candleRevisions.js";
import { sha256Hex } from "../../contract/v1/hash.js";
import type {
  CandleFeed,
  CandleIngestSession,
  CandleRevisionInsert,
  CandleWritePort,
  ExistingLatestCandleRevision
} from "../../application/ports/candlePorts.js";

const feedHash = (feed: CandleFeed): bigint => {
  const combined = `${feed.symbol}\0${feed.source}\0${feed.network}\0${feed.poolAddress}\0${feed.timeframe}`;
  const hex = sha256Hex(combined);
  return BigInt("0x" + hex.slice(0, 15)) || 1n;
};

export const createPostgresCandleRevisionUnitOfWork = (db: Db): CandleWritePort => {
  return {
    // The lock-arg `_unixMsValues` is intentionally unused: PG scopes the advisory
    // lock by feed and reads slots via `inArray` inside `readLatestRevisions`. The
    // port keeps the arg available so future implementations can scope tighter.
    withIngestLock: async (feed, _unixMsValues, fn) => {
      const lockKey = feedHash(feed);
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

        const session: CandleIngestSession = {
          readLatestRevisions: async (slots: number[]) => {
            const result = new Map<number, ExistingLatestCandleRevision>();
            if (slots.length === 0) {
              return result;
            }
            const rows = await tx
              .select({
                unixMs: candleRevisions.unixMs,
                sourceRecordedAtUnixMs: candleRevisions.sourceRecordedAtUnixMs,
                sourceRecordedAtIso: candleRevisions.sourceRecordedAtIso,
                ohlcvHash: candleRevisions.ohlcvHash
              })
              .from(candleRevisions)
              .where(
                and(
                  eq(candleRevisions.symbol, feed.symbol),
                  eq(candleRevisions.source, feed.source),
                  eq(candleRevisions.network, feed.network),
                  eq(candleRevisions.poolAddress, feed.poolAddress),
                  eq(candleRevisions.timeframe, feed.timeframe),
                  inArray(candleRevisions.unixMs, slots)
                )
              )
              .orderBy(desc(candleRevisions.sourceRecordedAtUnixMs), desc(candleRevisions.id));

            for (const row of rows) {
              if (!result.has(row.unixMs)) {
                result.set(row.unixMs, {
                  sourceRecordedAtUnixMs: row.sourceRecordedAtUnixMs,
                  sourceRecordedAtIso: row.sourceRecordedAtIso,
                  ohlcvHash: row.ohlcvHash
                });
              }
            }
            return result;
          },
          insertRevisions: async (revisions: CandleRevisionInsert[]) => {
            if (revisions.length === 0) {
              return;
            }
            const values = revisions.map((r) => ({
              symbol: r.feed.symbol,
              source: r.feed.source,
              network: r.feed.network,
              poolAddress: r.feed.poolAddress,
              timeframe: r.feed.timeframe,
              unixMs: r.unixMs,
              sourceRecordedAtIso: r.sourceRecordedAtIso,
              sourceRecordedAtUnixMs: r.sourceRecordedAtUnixMs,
              open: r.open,
              high: r.high,
              low: r.low,
              close: r.close,
              volume: r.volume,
              ohlcvCanonical: r.ohlcvCanonical,
              ohlcvHash: r.ohlcvHash,
              receivedAtUnixMs: r.receivedAtUnixMs
            }));
            await tx.insert(candleRevisions).values(values);
          }
        };

        return fn(session);
      });
    }
  };
};
```

- [ ] **Step 2: Create the Postgres read adapter**

Create `src/adapters/postgres/PostgresCandleReadAdapter.ts`:

```ts
import { sql } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import { PG_SCHEMA_NAME } from "../../ledger/pg/schema/candleRevisions.js";
import type { CandleReadPort } from "../../application/ports/candlePorts.js";
import type { CandleRow, GetLatestCandlesParams } from "../../contract/v1/types.js";

const QUALIFIED_TABLE = `${PG_SCHEMA_NAME}.candle_revisions`;

export const createPostgresCandleReadAdapter = (db: Db): CandleReadPort => {
  return {
    getLatestCandlesForFeed: async (params: GetLatestCandlesParams): Promise<CandleRow[]> => {
      const rows = await db.execute(sql`
        WITH latest_per_slot AS (
          SELECT unix_ms, open, high, low, close, volume,
                 row_number() OVER (
                   PARTITION BY unix_ms
                   ORDER BY source_recorded_at_unix_ms DESC, id DESC
                 ) AS rn
            FROM ${sql.raw(QUALIFIED_TABLE)}
           WHERE symbol = ${params.symbol}
             AND source = ${params.source}
             AND network = ${params.network}
             AND pool_address = ${params.poolAddress}
             AND timeframe = ${params.timeframe}
             AND unix_ms <= ${params.closedCandleCutoffUnixMs}
        )
        SELECT unix_ms, open, high, low, close, volume
          FROM (
            SELECT unix_ms, open, high, low, close, volume
              FROM latest_per_slot
             WHERE rn = 1
             ORDER BY unix_ms DESC
             LIMIT ${params.limit}
          ) AS latest
         ORDER BY unix_ms ASC
      `);

      return rows.map((row: Record<string, unknown>) => {
        const unixMs = row.unix_ms;
        const open = row.open;
        const high = row.high;
        const low = row.low;
        const close = row.close;
        const volume = row.volume;

        if (
          unixMs == null ||
          open == null ||
          high == null ||
          low == null ||
          close == null ||
          volume == null
        ) {
          throw new Error(`Unexpected null in candle_revisions row: ${JSON.stringify(row)}`);
        }

        return {
          unixMs: Number(unixMs),
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: Number(volume)
        };
      });
    }
  };
};
```

- [ ] **Step 3: Rewrite `CandleStore` as a thin wrapper**

Replace the entire contents of `src/ledger/candleStore.ts` with:

```ts
import type { Db } from "./pg/db.js";
import type {
  CandleIngestRequest,
  CandleIngestResponse,
  CandleRow,
  GetLatestCandlesParams
} from "../contract/v1/types.js";
import { createPostgresCandleRevisionUnitOfWork } from "../adapters/postgres/PostgresCandleRevisionUnitOfWork.js";
import { createPostgresCandleReadAdapter } from "../adapters/postgres/PostgresCandleReadAdapter.js";
import { createIngestCandlesUseCase } from "../application/use-cases/IngestCandlesUseCase.js";

export type { GetLatestCandlesParams, CandleRow };

export class CandleStore {
  constructor(private db: Db) {}

  async writeCandles(
    input: CandleIngestRequest,
    receivedAtUnixMs: number
  ): Promise<Omit<CandleIngestResponse, "schemaVersion">> {
    const useCase = createIngestCandlesUseCase({
      candleWritePort: createPostgresCandleRevisionUnitOfWork(this.db)
    });
    return useCase(input, receivedAtUnixMs);
  }

  async getLatestCandlesForFeed(params: GetLatestCandlesParams): Promise<CandleRow[]> {
    return createPostgresCandleReadAdapter(this.db).getLatestCandlesForFeed(params);
  }
}
```

- [ ] **Step 4: Run the SQLite-side suite to confirm the PG refactor didn't break shared imports**

Run:

```bash
npm run typecheck && npm run lint && npm run test && npm run boundaries
```

Expected: PASS. The full unit suite uses the SQLite path.

- [ ] **Step 5: Run the PG suite if `DATABASE_URL` is reachable**

Run:

```bash
npm run test:pg
```

Expected: PASS — `src/ledger/__tests__/candleStore.test.ts` (the existing PG suite) keeps its assertions and exercises the new adapters through the unchanged `CandleStore` public surface.

If `test:pg` cannot run locally, document this in the PR and flag that PG behavior is locally unvalidated; CI will catch it.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/postgres/PostgresCandleRevisionUnitOfWork.ts \
        src/adapters/postgres/PostgresCandleReadAdapter.ts \
        src/ledger/candleStore.ts
git commit -m "refactor(adapters): move PG candle SQL into adapters under src/adapters/postgres"
```

---

## Task 6: Wire `POST /v1/candles` and `GET /v1/regime/current` through ports

The HTTP handler stops constructing storage objects directly. Composition (`src/http/routes.ts`) chooses the SQLite or Postgres adapter based on `DATABASE_URL` and injects a use case + read port. The handlers receive ports / use cases as their constructor arguments.

**Files:**

- Modify: `src/http/handlers/candlesIngest.ts`
- Modify: `src/http/handlers/regimeCurrent.ts`
- Modify: `src/http/routes.ts`

- [ ] **Step 1: Thin out `candlesIngest.ts` to depend on `IngestCandlesUseCase` and `ClockPort`**

Replace the entire contents of `src/http/handlers/candlesIngest.ts` with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION, type CandleIngestResponse } from "../../contract/v1/types.js";
import { parseCandleIngestRequest } from "../../contract/v1/validation.js";
import type { IngestCandlesUseCase } from "../../application/use-cases/IngestCandlesUseCase.js";
import type { ClockPort } from "../../application/ports/clock.js";
import { AuthError, requireSharedSecret } from "../auth.js";
import { ContractValidationError } from "../errors.js";

export interface CandlesIngestHandlerDeps {
  ingestCandles: IngestCandlesUseCase;
  clock: ClockPort;
}

export const createCandlesIngestHandler = (deps: CandlesIngestHandlerDeps) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-Candles-Ingest-Token", "CANDLES_INGEST_TOKEN");

      const body = parseCandleIngestRequest(request.body);
      const result = await deps.ingestCandles(body, deps.clock.nowUnixMs());

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
      request.log.error(error, "Unhandled error in POST /v1/candles");
      return reply.code(500).send({
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] }
      });
    }
  };
};
```

- [ ] **Step 2: Switch `regimeCurrent.ts` to depend on `CandleReadPort` only**

Edit `src/http/handlers/regimeCurrent.ts`. Replace the imports and the `createRegimeCurrentHandler` signature so the handler takes a single `CandleReadPort`:

Replace these import lines:

```ts
import type { LedgerStore } from "../../ledger/store.js";
import { getLatestCandlesForFeed } from "../../ledger/candlesWriter.js";
import type { CandleStore } from "../../ledger/candleStore.js";
```

with:

```ts
import type { CandleReadPort } from "../../application/ports/candlePorts.js";
```

Replace the factory signature:

```ts
export const createRegimeCurrentHandler = (store: LedgerStore, candleStore?: CandleStore) => {
```

with:

```ts
export const createRegimeCurrentHandler = (candleReadPort: CandleReadPort) => {
```

Replace the `sourceCandles` block:

```ts
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
  : getLatestCandlesForFeed(store, {
      symbol: query.symbol,
      source: query.source,
      network: query.network,
      poolAddress: query.poolAddress,
      timeframe: plan.sourceTimeframe,
      closedCandleCutoffUnixMs: plan.sourceCutoffUnixMs,
      limit: plan.sourceLimit
    });
```

with:

```ts
const sourceCandles = await candleReadPort.getLatestCandlesForFeed({
  symbol: query.symbol,
  source: query.source,
  network: query.network,
  poolAddress: query.poolAddress,
  timeframe: plan.sourceTimeframe,
  closedCandleCutoffUnixMs: plan.sourceCutoffUnixMs,
  limit: plan.sourceLimit
});
```

Leave every other line (planning, aggregation, freshness cutoff, classification, error mapping) untouched.

- [ ] **Step 3: Update `src/http/routes.ts` composition**

Edit `src/http/routes.ts`. Add the new imports:

```ts
import { createSqliteCandleReadAdapter } from "../adapters/sqlite/SqliteCandleReadAdapter.js";
import { createSqliteCandleRevisionUnitOfWork } from "../adapters/sqlite/SqliteCandleRevisionUnitOfWork.js";
import { createPostgresCandleReadAdapter } from "../adapters/postgres/PostgresCandleReadAdapter.js";
import { createPostgresCandleRevisionUnitOfWork } from "../adapters/postgres/PostgresCandleRevisionUnitOfWork.js";
import { createIngestCandlesUseCase } from "../application/use-cases/IngestCandlesUseCase.js";
import type { ClockPort } from "../application/ports/clock.js";
```

After the `const ledger = ...` line and the `const pg = storeContext?.pg ?? null;` line, add:

```ts
const clock: ClockPort = { nowUnixMs: () => Date.now() };

const candleReadPort = pg
  ? createPostgresCandleReadAdapter(pg)
  : createSqliteCandleReadAdapter(ledger);

const candleWritePort = pg
  ? createPostgresCandleRevisionUnitOfWork(pg)
  : createSqliteCandleRevisionUnitOfWork(ledger);

const ingestCandles = createIngestCandlesUseCase({ candleWritePort });
```

Replace the route registrations for candles ingest and regime current:

```ts
app.post("/v1/candles", createCandlesIngestHandler(ledger, storeContext?.candleStore));
app.get("/v1/regime/current", createRegimeCurrentHandler(ledger, storeContext?.candleStore));
```

with:

```ts
app.post("/v1/candles", createCandlesIngestHandler({ ingestCandles, clock }));
app.get("/v1/regime/current", createRegimeCurrentHandler(candleReadPort));
```

`DATABASE_URL`-presence behavior is preserved: when set, the PG adapters are used; when unset, the SQLite adapters are used — exactly the same branching as today.

- [ ] **Step 4: Run unit tests, lint, typecheck**

Run:

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: PASS. The HTTP e2e tests under `src/http/__tests__/candles.e2e.test.ts`, `candleFallback.e2e.test.ts`, and `regimeCurrent.e2e.test.ts` exercise the new wiring through `buildApp()`.

- [ ] **Step 5: Run boundaries**

Run:

```bash
npm run boundaries
```

Expected: PASS. `src/http/**` is allowed to import `src/application/**` and `src/adapters/**`. The application and adapter folders themselves remain boundary-clean.

- [ ] **Step 6: Run the PG suite (or document why it can't run)**

Run:

```bash
npm run test:pg || echo "PG suite unavailable"
```

Expected: PASS, or the existing "unavailable" branch. If unavailable, the PR description must list what PG-side behavior is unverified locally.

- [ ] **Step 7: Smoke-test the full SQLite + PG fallback paths in a real Fastify server**

Run:

```bash
LEDGER_DB_PATH=:memory: CANDLES_INGEST_TOKEN=smoke npx tsx src/server.ts &
SERVER_PID=$!
sleep 1

curl -s -X POST http://localhost:8787/v1/candles \
  -H "Content-Type: application/json" \
  -H "X-Candles-Ingest-Token: smoke" \
  -d '{
    "schemaVersion":"1.0",
    "source":"birdeye",
    "network":"solana-mainnet",
    "poolAddress":"Pool111",
    "symbol":"SOL/USDC",
    "timeframe":"15m",
    "sourceRecordedAtIso":"2026-04-26T12:00:00.000Z",
    "candles":[{"unixMs":900000,"open":100,"high":110,"low":95,"close":105,"volume":1}]
  }'

kill "$SERVER_PID"
```

Expected: a 200 response of the form `{"schemaVersion":"1.0","insertedCount":1,"revisedCount":0,"idempotentCount":0,"rejectedCount":0,"rejections":[]}`.

- [ ] **Step 8: Commit**

```bash
git add src/http/handlers/candlesIngest.ts \
        src/http/handlers/regimeCurrent.ts \
        src/http/routes.ts
git commit -m "feat(http): wire candles ingest and regime-current through ports"
```

---

## Task 7: Final validation pass

The full validation list from the spec must pass before this PR is shippable.

- [ ] **Step 1: Run the full spec-mandated validation list**

Run each command and confirm green:

```bash
npm run typecheck
npm run lint
npm run test
npm run test:pg
npm run build
npm run boundaries
```

Expected: each succeeds. If `npm run test:pg` cannot run locally because `DATABASE_URL` is unreachable, leave a clear note in the PR description ("PG suite locally unverified — relying on CI") and identify that the PG candle adapter is the locally-unvalidated surface.

- [ ] **Step 2: Confirm no stray inlined SQL or pure-domain logic remains in `src/ledger/`**

Run:

```bash
grep -nE "BEGIN IMMEDIATE|pg_advisory_xact_lock|computeOhlcv|classifyCandle" src/ledger/candlesWriter.ts src/ledger/candleStore.ts
```

Expected: no matches. The wrappers should contain only `createIngestCandlesUseCase` / adapter factory calls. If any match remains, inline SQL or domain logic leaked back into the storage layer — fix before the PR.

- [ ] **Step 3: Confirm boundary cleanliness**

Run:

```bash
grep -rn "from ['\"].*ledger\|from ['\"].*http\|from ['\"].*adapters\|from ['\"].*workers" src/domain src/application 2>/dev/null
```

Expected: no matches. Domain and application layers are strictly inward-facing.

- [ ] **Step 4: Diff inspection**

Run:

```bash
git diff --stat main..HEAD
git log --oneline main..HEAD
```

Expected: roughly one commit per task (Tasks 1–6), each scoped. No commits touching engine internals, contract types, OpenAPI doc, or worker code (`src/workers/**`). If a worker file was touched, investigate — `geckoCollector` calls into the same `writeCandles`/`CandleStore` surface, so the change should be a no-op signature update only.

- [ ] **Step 5: Open PR**

```bash
git push -u origin m38-candle-ingestion-seam
gh pr create --title "m38: extract candle ingestion seam (domain, application, adapters)" --body "$(cat <<'EOF'
## Summary

- Move pure candle revision logic to `src/domain/candle/`.
- Add `ClockPort`, `CandleReadPort`, `CandleWritePort`, and `CandleIngestSession` under `src/application/ports/`.
- Add `IngestCandlesUseCase` with fake-session unit tests under `src/application/use-cases/`.
- Add SQLite and Postgres adapters under `src/adapters/{sqlite,postgres}` that own all candle SQL and transaction/lock mechanics.
- Thin `src/ledger/candlesWriter.ts` and `src/ledger/candleStore.ts` to compatibility wrappers that delegate to the new adapters.
- Wire `POST /v1/candles` and `GET /v1/regime/current` through ports/use case via `src/http/routes.ts`.

No contract changes, no SQL migrations, no behavior changes. Implements the seam design from #38.

## Test plan

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run test`
- [ ] `npm run test:pg` — note locally unverified branches if any
- [x] `npm run build`
- [x] `npm run boundaries`
- [x] Manual smoke: `POST /v1/candles` round-trip with `:memory:` SQLite

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opened. Replace the test-plan checkbox states to reflect the actual run.

---

## Self-Review Notes (post-write)

- **Spec coverage:** Domain extraction (Task 1), ports (Task 2), use case + tests (Task 3), SQLite adapters (Task 4), Postgres adapters (Task 5), HTTP wiring + read-port for `regimeCurrent` (Task 6), validation (Task 7). All "Migration Strategy" steps from the spec map to a task. The non-goal of _not_ redesigning regime-current is honored — Task 6 only swaps its dependency from `(LedgerStore, CandleStore?)` to a single `CandleReadPort`.
- **Behavior parity:** Each adapter task lists the SQL/transaction shapes that must be preserved; existing tests under `src/ledger/__tests__/candlesWriter.test.ts` and `src/ledger/__tests__/candleStore.test.ts` keep their behavior assertions, only changing `it(...)` callbacks to `async`. E2E tests under `src/http/__tests__/candles*.e2e.test.ts` and `regimeCurrent.e2e.test.ts` continue to gate the HTTP contract.
- **Type consistency:** `CandleFeed`, `CandleIngestSession`, `CandleWritePort`, `CandleReadPort`, `IngestCandlesUseCase` are defined in Task 2/3 and used by every later task with identical signatures. The `feed` in `CandleRevisionInsert` is intentionally a nested `CandleFeed` (not flattened) so the SQLite/Postgres insert mappers don't need to know individual feed columns.
- **Boundaries:** Task 1 keeps `src/domain/candle` pure (only `src/contract/v1/canonical.ts` and `hash.ts`). Task 2 keeps `src/application/ports` pure (only contract types). Task 3 keeps `src/application/use-cases` pure (contract + domain + ports). Adapters in Tasks 4/5 live under `src/adapters/**`, where framework imports are allowed. Re-running `npm run boundaries` after each task catches any drift.
