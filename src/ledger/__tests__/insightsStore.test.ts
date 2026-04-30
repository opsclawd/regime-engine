import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../pg/db.js";
import { clmmInsights } from "../pg/schema/index.js";
import {
  InsightsStore,
  InsightConflictError,
  rowToInsightWire,
  type InsightInsertInput
} from "../insightsStore.js";
import { computeInsightCanonicalAndHash } from "../../contract/v1/insights.js";
import type { InsightIngestRequest } from "../../contract/v1/insights.js";

const validRequest = (overrides: Partial<InsightIngestRequest> = {}): InsightIngestRequest =>
  ({
    schemaVersion: "1.0",
    pair: "SOL/USDC",
    asOf: "2026-04-27T13:00:00Z",
    source: "openclaw",
    runId: "run-001",
    marketRegime: "high_volatility_uptrend",
    fundamentalRegime: "constructive",
    recommendedAction: "widen_range",
    confidence: "medium",
    riskLevel: "elevated",
    dataQuality: "complete",
    clmmPolicy: {
      posture: "defensive",
      rangeBias: "wide",
      rebalanceSensitivity: "high",
      maxCapitalDeploymentPercent: 50
    },
    levels: { support: [138.5], resistance: [154.0] },
    reasoning: ["expanded vol"],
    sourceRefs: ["openclaw:run-001"],
    expiresAt: "2026-04-28T13:00:00Z",
    ...overrides
  }) as InsightIngestRequest;

const makeInput = (
  req: InsightIngestRequest,
  receivedAtUnixMs = 1_700_000_000_000
): InsightInsertInput => {
  const { canonical, hash } = computeInsightCanonicalAndHash(req);
  return { request: req, payloadCanonical: canonical, payloadHash: hash, receivedAtUnixMs };
};

describe.skipIf(!process.env.DATABASE_URL)("InsightsStore (PG)", () => {
  let db: Db;
  let client: { end: () => Promise<void> };
  let store: InsightsStore;

  beforeAll(() => {
    const result = createDb(process.env.DATABASE_URL!);
    db = result.db;
    client = result.client;
    store = new InsightsStore(db);
  });

  afterAll(async () => {
    await client.end();
  });

  afterEach(async () => {
    await db.delete(clmmInsights).execute();
  });

  it("inserts a new row and returns status 'created'", async () => {
    const result = await store.insertInsight(makeInput(validRequest()));

    expect(result.status).toBe("created");
    expect(result.row.runId).toBe("run-001");
    expect(result.row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.row.pair).toBe("SOL/USDC");
    expect(result.row.asOfUnixMs).toBe(Date.parse("2026-04-27T13:00:00Z"));
    expect(result.row.expiresAtUnixMs).toBe(Date.parse("2026-04-28T13:00:00Z"));

    const all = await db.select().from(clmmInsights).execute();
    expect(all).toHaveLength(1);
  });

  it("returns 'already_ingested' for byte-identical replay without inserting a new row", async () => {
    await store.insertInsight(makeInput(validRequest()));

    const second = await store.insertInsight(makeInput(validRequest(), 1_700_000_001_000));
    expect(second.status).toBe("already_ingested");

    const all = await db.select().from(clmmInsights).execute();
    expect(all).toHaveLength(1);
  });

  it("throws InsightConflictError when same (source, runId) has different payload", async () => {
    await store.insertInsight(makeInput(validRequest()));

    const different = validRequest({ confidence: "high" });
    await expect(store.insertInsight(makeInput(different))).rejects.toBeInstanceOf(
      InsightConflictError
    );

    const all = await db.select().from(clmmInsights).execute();
    expect(all).toHaveLength(1);
  });

  it("concurrent identical inserts: exactly one is 'created', one is 'already_ingested'", async () => {
    const inputA = makeInput(validRequest(), 1_700_000_000_000);
    const inputB = makeInput(validRequest(), 1_700_000_000_500);

    const results = await Promise.all([store.insertInsight(inputA), store.insertInsight(inputB)]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(["already_ingested", "created"]);

    const all = await db.select().from(clmmInsights).execute();
    expect(all).toHaveLength(1);
  });

  it("concurrent different-payload-same-runId: one created, one InsightConflictError", async () => {
    const inputA = makeInput(validRequest());
    const inputB = makeInput(validRequest({ confidence: "high" }));

    const settled = await Promise.allSettled([
      store.insertInsight(inputA),
      store.insertInsight(inputB)
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const fulfilledValue = (fulfilled[0] as PromiseFulfilledResult<{ status: string }>).value;
    expect(fulfilledValue.status).toBe("created");
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsightConflictError);
  });

  it("getCurrent returns null when the table is empty for the pair", async () => {
    expect(await store.getCurrent("SOL/USDC")).toBeNull();
  });

  it("getCurrent returns the newest row by (asOfUnixMs DESC, id DESC)", async () => {
    await store.insertInsight(
      makeInput(
        validRequest({
          runId: "run-A",
          asOf: "2026-04-25T00:00:00Z",
          expiresAt: "2026-04-26T00:00:00Z"
        })
      )
    );
    await store.insertInsight(
      makeInput(
        validRequest({
          runId: "run-C",
          asOf: "2026-04-27T00:00:00Z",
          expiresAt: "2026-04-28T00:00:00Z"
        })
      )
    );
    await store.insertInsight(
      makeInput(
        validRequest({
          runId: "run-B",
          asOf: "2026-04-26T00:00:00Z",
          expiresAt: "2026-04-27T00:00:00Z"
        })
      )
    );

    const latest = await store.getCurrent("SOL/USDC");
    expect(latest).not.toBeNull();
    expect(latest?.runId).toBe("run-C");
  });

  it("getHistory returns rows newest-first by receivedAtUnixMs", async () => {
    await store.insertInsight(makeInput(validRequest({ runId: "old" }), 1_700_000_000_000));
    await store.insertInsight(makeInput(validRequest({ runId: "newer" }), 1_700_000_001_000));
    await store.insertInsight(makeInput(validRequest({ runId: "newest" }), 1_700_000_002_000));

    const rows = await store.getHistory("SOL/USDC", 30);
    expect(rows.map((r) => r.runId)).toEqual(["newest", "newer", "old"]);
  });

  it("getHistory respects the limit argument", async () => {
    await store.insertInsight(makeInput(validRequest({ runId: "a" }), 1_700_000_000_000));
    await store.insertInsight(makeInput(validRequest({ runId: "b" }), 1_700_000_001_000));
    await store.insertInsight(makeInput(validRequest({ runId: "c" }), 1_700_000_002_000));

    const rows = await store.getHistory("SOL/USDC", 2);
    expect(rows.map((r) => r.runId)).toEqual(["c", "b"]);
  });

  it("getHistory tie-breaks by id DESC when receivedAtUnixMs is equal", async () => {
    await store.insertInsight(makeInput(validRequest({ runId: "first" }), 1_700_000_000_000));
    await store.insertInsight(makeInput(validRequest({ runId: "second" }), 1_700_000_000_000));

    const rows = await store.getHistory("SOL/USDC", 30);
    expect(rows.map((r) => r.runId)).toEqual(["second", "first"]);
  });

  it("getHistory returns empty array when table empty", async () => {
    expect(await store.getHistory("SOL/USDC", 30)).toEqual([]);
  });

  it("rowToInsightWire reconstructs the wire shape including JSONB fields", async () => {
    const req = validRequest();
    const inserted = await store.insertInsight(makeInput(req));

    const wire = rowToInsightWire(inserted.row);

    expect(wire).toEqual({
      schemaVersion: req.schemaVersion,
      pair: req.pair,
      asOf: new Date(req.asOf).toISOString(),
      source: req.source,
      runId: req.runId,
      marketRegime: req.marketRegime,
      fundamentalRegime: req.fundamentalRegime,
      recommendedAction: req.recommendedAction,
      confidence: req.confidence,
      riskLevel: req.riskLevel,
      dataQuality: req.dataQuality,
      clmmPolicy: req.clmmPolicy,
      levels: req.levels,
      reasoning: req.reasoning,
      sourceRefs: req.sourceRefs,
      expiresAt: new Date(req.expiresAt).toISOString()
    });
  });
});
