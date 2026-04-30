import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../pg/db.js";
import { srThesesV2 } from "../pg/schema/index.js";
import { SrThesesV2Store, SrThesisV2ConflictError } from "../srThesesV2Store.js";
import type { SrLevelsV2IngestRequest, SrThesisV2 } from "../../contract/v2/srLevels.js";

const validThesis = (overrides: Partial<SrThesisV2> = {}): SrThesisV2 => ({
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: "breakout",
  supportLevels: ["140.50", "135.00"],
  resistanceLevels: ["160.00"],
  entryZone: "145-148",
  targets: ["170"],
  invalidation: "<135",
  trigger: "close above 160",
  chartReference: null,
  sourceHandle: "@trader",
  sourceChannel: "twitter",
  sourceKind: "post",
  sourceReliability: "medium",
  rawThesisText: null,
  collectedAt: "2026-04-29T13:00:00Z",
  publishedAt: "2026-04-29T12:00:00Z",
  sourceUrl: null,
  notes: null,
  ...overrides
});

const validRequest = (overrides: Partial<SrLevelsV2IngestRequest> = {}): SrLevelsV2IngestRequest =>
  ({
    schemaVersion: "2.0",
    source: "macro-charts",
    symbol: "SOL",
    brief: {
      briefId: "mco-sol-2026-04-29",
      sourceRecordedAtIso: "2026-04-29T11:00:00Z",
      summary: "summary"
    },
    theses: [validThesis()],
    ...overrides
  }) as SrLevelsV2IngestRequest;

describe.skipIf(!process.env.DATABASE_URL)("SrThesesV2Store (PG)", () => {
  let db: Db;
  let client: { end: () => Promise<void> };
  let store: SrThesesV2Store;

  beforeAll(() => {
    const result = createDb(process.env.DATABASE_URL!);
    db = result.db;
    client = result.client;
    store = new SrThesesV2Store(db);
  });

  afterAll(async () => {
    await client.end();
  });

  afterEach(async () => {
    await db.delete(srThesesV2).execute();
  });

  it("inserts one row per thesis and returns 'created'", async () => {
    const req = validRequest({
      theses: [
        validThesis({ asset: "SOL", sourceHandle: "@a" }),
        validThesis({ asset: "BTC", sourceHandle: "@b" })
      ]
    });

    const result = await store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 });

    expect(result).toEqual({ status: "created", insertedCount: 2, idempotentCount: 0 });
    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(2);
  });

  it("byte-identical replay returns 'already_ingested'", async () => {
    const req = validRequest();
    await store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 });

    const second = await store.insertBrief({
      request: req,
      capturedAtUnixMs: 1_777_000_001_000
    });
    expect(second).toEqual({ status: "already_ingested", insertedCount: 0, idempotentCount: 1 });
    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1);
  });

  it("mixed created/idempotent batch returns 'created' with both counts", async () => {
    const reqA = validRequest({
      theses: [validThesis({ asset: "SOL", sourceHandle: "@a" })]
    });
    await store.insertBrief({ request: reqA, capturedAtUnixMs: 1_777_000_000_000 });

    const reqB = validRequest({
      theses: [
        validThesis({ asset: "SOL", sourceHandle: "@a" }),
        validThesis({ asset: "BTC", sourceHandle: "@b" })
      ]
    });
    const result = await store.insertBrief({
      request: reqB,
      capturedAtUnixMs: 1_777_000_001_000
    });
    expect(result).toEqual({ status: "created", insertedCount: 1, idempotentCount: 1 });
  });

  it("different-payload same identity throws SrThesisV2ConflictError", async () => {
    const original = validRequest();
    await store.insertBrief({ request: original, capturedAtUnixMs: 1_777_000_000_000 });

    const conflicting = validRequest({
      theses: [validThesis({ bias: "bearish" })]
    });
    await expect(
      store.insertBrief({ request: conflicting, capturedAtUnixMs: 1_777_000_001_000 })
    ).rejects.toBeInstanceOf(SrThesisV2ConflictError);

    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1);
    expect(all[0].bias).toBe("bullish");
  });

  it("rolls back partial inserts on conflict (transactional)", async () => {
    const baseline = validRequest({
      theses: [validThesis({ asset: "BTC", sourceHandle: "@b", bias: "bullish" })]
    });
    await store.insertBrief({ request: baseline, capturedAtUnixMs: 1_777_000_000_000 });

    const mixed = validRequest({
      theses: [
        validThesis({ asset: "SOL", sourceHandle: "@new" }),
        validThesis({ asset: "BTC", sourceHandle: "@b", bias: "bearish" })
      ]
    });
    await expect(
      store.insertBrief({ request: mixed, capturedAtUnixMs: 1_777_000_001_000 })
    ).rejects.toBeInstanceOf(SrThesisV2ConflictError);

    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1);
    expect(all[0].sourceHandle).toBe("@b");
  });

  it("concurrent identical inserts: exactly one row, the other is 'already_ingested'", async () => {
    const req = validRequest();
    const settled = await Promise.allSettled([
      store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 }),
      store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_500 })
    ]);
    const fulfilled = settled.filter((s) => s.status === "fulfilled") as PromiseFulfilledResult<{
      status: string;
    }>[];
    expect(fulfilled).toHaveLength(2);
    const statuses = fulfilled.map((r) => r.value.status).sort();
    expect(statuses).toEqual(["already_ingested", "created"]);
    const all = await db.select().from(srThesesV2).execute();
    expect(all).toHaveLength(1);
  });

  it("getCurrent returns null when no rows match", async () => {
    expect(await store.getCurrent("SOL", "macro-charts")).toBeNull();
  });

  it("getCurrent selects the latest brief by capturedAtUnixMs DESC, id DESC", async () => {
    await store.insertBrief({
      request: validRequest({
        brief: { briefId: "old", sourceRecordedAtIso: null, summary: null }
      }),
      capturedAtUnixMs: 1_777_000_000_000
    });
    await store.insertBrief({
      request: validRequest({
        brief: { briefId: "new", sourceRecordedAtIso: null, summary: null }
      }),
      capturedAtUnixMs: 1_777_000_001_000
    });

    const current = await store.getCurrent("SOL", "macro-charts");
    expect(current?.brief.briefId).toBe("new");
  });

  it("getCurrent returns all theses for the selected brief ordered by id ASC", async () => {
    const req = validRequest({
      theses: [
        validThesis({ asset: "SOL", sourceHandle: "@a" }),
        validThesis({ asset: "BTC", sourceHandle: "@b" }),
        validThesis({ asset: "ETH", sourceHandle: "@c" })
      ]
    });
    await store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 });
    const current = await store.getCurrent("SOL", "macro-charts");
    expect(current?.theses.map((t) => t.asset)).toEqual(["SOL", "BTC", "ETH"]);
  });

  it("preserves arrays, nullable fields, exact non-null timestamp strings, and null timestamps round-trip", async () => {
    const req = validRequest({
      brief: {
        briefId: "rt-1",
        sourceRecordedAtIso: "2026-04-29T11:00:00.000Z",
        summary: null
      },
      theses: [
        validThesis({
          supportLevels: ["140.50", "135.00"],
          resistanceLevels: [],
          targets: ["170"],
          collectedAt: null,
          publishedAt: "2026-04-29T12:00:00+00:00",
          notes: null,
          chartReference: null
        })
      ]
    });
    await store.insertBrief({ request: req, capturedAtUnixMs: 1_777_000_000_000 });

    const current = await store.getCurrent("SOL", "macro-charts");
    expect(current?.brief.sourceRecordedAtIso).toBe("2026-04-29T11:00:00.000Z");
    const t = current!.theses[0];
    expect(t.supportLevels).toEqual(["140.50", "135.00"]);
    expect(t.resistanceLevels).toEqual([]);
    expect(t.targets).toEqual(["170"]);
    expect(t.collectedAt).toBeNull();
    expect(t.publishedAt).toBe("2026-04-29T12:00:00+00:00");
    expect(t.notes).toBeNull();
  });
});
