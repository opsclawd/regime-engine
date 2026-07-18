import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../../../ledger/pg/db.js";
import { createPostgresEvidenceBundleRepository } from "../postgresEvidenceBundleRepository.js";
import { sql } from "drizzle-orm";
import type { EvidenceBundleV1, Scope } from "../../../contract/evidence/v1/types.generated.js";

const TEST_PAIR = "SOL/USDC";
const TEST_PUBLISHER = "sol-usdc-clmm-intelligence";

const createTestBundle = (overrides: Partial<EvidenceBundleV1> = {}): EvidenceBundleV1 => {
  const base: EvidenceBundleV1 = {
    schemaVersion: "evidence-bundle.v1",
    pair: TEST_PAIR,
    scope: { kind: "pair" },
    source: {
      publisher: TEST_PUBLISHER,
      sourceId: "test-source-001",
      sourceVersion: "1.0.0"
    },
    runId: "test-run-001",
    correlationId: "test-corr-001",
    createdAt: "2024-01-15T10:00:00.000Z",
    asOf: "2024-01-15T10:00:00.000Z",
    freshUntil: "2024-01-15T11:00:00.000Z",
    expiresAt: "2024-01-15T12:00:00.000Z",
    deterministicFeatures: [
      {
        featureId: "feat-price-001",
        family: "market_state",
        featureKind: "number",
        status: "available",
        value: 150.25,
        unit: "usd",
        observedAt: "2024-01-15T10:00:00.000Z",
        freshUntil: "2024-01-15T11:00:00.000Z",
        confidenceBps: 9500,
        calculator: { name: "price-aggregator", version: "1.0.0" },
        inputLineage: ["ref-price-source"],
        warnings: []
      }
    ],
    contextualEvidence: {
      supportResistance: [],
      flows: [],
      derivatives: [],
      events: [],
      newsRegulatory: []
    },
    researchBrief: null,
    sourceReferences: [
      {
        referenceId: "ref-price-source",
        sourceType: "api",
        locator: "https://api.example.com/price",
        observedAt: "2024-01-15T09:59:00.000Z"
      }
    ],
    assessment: {
      overallConfidenceBps: 9500,
      quality: "degraded",
      coverage: {
        deterministic: "available",
        supportResistance: "unavailable",
        flows: "unavailable",
        derivatives: "unavailable",
        events: "unavailable",
        newsRegulatory: "unavailable",
        researchBrief: "unavailable"
      },
      warnings: [
        {
          code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
          message: "All contextual evidence families are unavailable",
          affectedFamilies: [
            "supportResistance",
            "flows",
            "derivatives",
            "events",
            "newsRegulatory"
          ]
        },
        {
          code: "RESEARCH_BRIEF_UNAVAILABLE",
          message: "Research brief is null",
          affectedFamilies: ["researchBrief"]
        }
      ]
    },
    provenance: {
      pipelineVersion: "1.0.0",
      gitCommit: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
      environment: "test",
      upstreamRunIds: []
    }
  };
  return { ...base, ...overrides };
};

const CANONICAL_PAYLOAD = JSON.stringify({ price: 150.25 });
const PAYLOAD_HASH = "a".repeat(64);

describe.skipIf(!process.env.DATABASE_URL)("postgresEvidenceBundleRepository.getHistory", () => {
  let db: ReturnType<typeof createDb>["db"];
  let repository: ReturnType<typeof createPostgresEvidenceBundleRepository>;

  beforeAll(async () => {
    const result = createDb(process.env.DATABASE_URL!);
    db = result.db;
    repository = createPostgresEvidenceBundleRepository(db);
  });

  afterEach(async () => {
    await db.execute(sql`
      DELETE FROM regime_engine.evidence_bundles
      WHERE source_publisher = ${TEST_PUBLISHER}
        AND source_id LIKE 'test-source-%'
    `);
  });

  const appendBundle = async (
    sourceId: string,
    scope: Scope,
    overrides: Partial<EvidenceBundleV1> = {},
    receivedAtUnixMs?: number
  ): Promise<number> => {
    const bundle = createTestBundle({
      source: { publisher: TEST_PUBLISHER, sourceId, sourceVersion: "1.0.0" },
      scope,
      ...overrides
    });
    const result = await repository.append({
      bundle,
      payloadCanonical: CANONICAL_PAYLOAD,
      payloadHash: PAYLOAD_HASH,
      receivedAtUnixMs: receivedAtUnixMs ?? Date.now()
    });
    return result.receipt.id;
  };

  describe("paginates history without duplicates across intervening inserts", () => {
    it("does not duplicate records when new head row arrives between pages", async () => {
      const base = Date.now();
      const receivedAt1 = base;
      const receivedAt2 = base + 100;
      const receivedAt3 = base + 200;
      const receivedAt4 = base + 300;
      const receivedAt5 = base + 400;

      await appendBundle("test-source-page-dup", { kind: "pair" }, { runId: "run-1" }, receivedAt1);
      const id2 = await appendBundle(
        "test-source-page-dup",
        { kind: "pair" },
        { runId: "run-2" },
        receivedAt2
      );
      const id3 = await appendBundle(
        "test-source-page-dup",
        { kind: "pair" },
        { runId: "run-3" },
        receivedAt3
      );

      const page1 = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 2,
        cursor: null,
        nowUnixMs: base + 500
      });

      expect(page1.records).toHaveLength(2);
      expect(page1.records[0].id).toBe(id3);
      expect(page1.records[1].id).toBe(id2);
      expect(page1.nextCursor).not.toBeNull();

      const id4 = await appendBundle(
        "test-source-page-dup",
        { kind: "pair" },
        { runId: "run-4" },
        receivedAt4
      );
      const id5 = await appendBundle(
        "test-source-page-dup",
        { kind: "pair" },
        { runId: "run-5" },
        receivedAt5
      );

      const page2 = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 2,
        cursor: page1.nextCursor,
        nowUnixMs: base + 600
      });

      const allIds = [id5, id4, ...page2.records.map((r) => r.id)];
      const uniqueIds = new Set(allIds);
      expect(allIds.length).toBe(uniqueIds.size);

      const page2Ids = page2.records.map((r) => r.id);
      expect(page2Ids).not.toContain(id3);
      expect(page2Ids).not.toContain(id2);
    });

    it("cursor exclusivity prevents duplicate record on repeated pagination", async () => {
      const base = Date.now();

      for (let i = 0; i < 5; i++) {
        await appendBundle(
          "test-source-excl",
          { kind: "pair" },
          { runId: `run-${i}` },
          base + i * 100
        );
      }

      const page1 = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 2,
        cursor: null,
        nowUnixMs: base + 1000
      });

      const page1Again = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 2,
        cursor: null,
        nowUnixMs: base + 1000
      });

      const page2 = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 2,
        cursor: page1.nextCursor,
        nowUnixMs: base + 1000
      });

      const allPage1Ids = new Set(page1.records.map((r) => r.id));
      const allPage2Ids = new Set(page2.records.map((r) => r.id));
      for (const id of allPage1Ids) {
        expect(allPage2Ids).not.toContain(id);
      }

      const firstPageIds = page1Again.records.map((r) => r.id);
      const secondPageIds = page2.records.map((r) => r.id);
      for (const id of firstPageIds) {
        expect(secondPageIds).not.toContain(id);
      }
    });
  });

  describe("rejects history limits outside one through one hundred", () => {
    it("throws for limit 0", async () => {
      const base = Date.now();
      await appendBundle("test-source-limit-0", { kind: "pair" }, {}, base);

      await expect(
        repository.getHistory({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          limit: 0,
          cursor: null,
          nowUnixMs: base + 100
        })
      ).rejects.toThrow();
    });

    it("throws for limit -1", async () => {
      const base = Date.now();
      await appendBundle("test-source-limit-neg", { kind: "pair" }, {}, base);

      await expect(
        repository.getHistory({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          limit: -1,
          cursor: null,
          nowUnixMs: base + 100
        })
      ).rejects.toThrow();
    });

    it("throws for limit 101", async () => {
      const base = Date.now();
      await appendBundle("test-source-limit-101", { kind: "pair" }, {}, base);

      await expect(
        repository.getHistory({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          limit: 101,
          cursor: null,
          nowUnixMs: base + 100
        })
      ).rejects.toThrow();
    });

    it("throws for limit 1000", async () => {
      const base = Date.now();
      await appendBundle("test-source-limit-big", { kind: "pair" }, {}, base);

      await expect(
        repository.getHistory({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          limit: 1000,
          cursor: null,
          nowUnixMs: base + 100
        })
      ).rejects.toThrow();
    });

    it("accepts default limit (30)", async () => {
      const base = Date.now();
      await appendBundle("test-source-default-limit", { kind: "pair" }, {}, base);

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        cursor: null,
        nowUnixMs: base + 100
      });

      expect(result.records).toBeDefined();
    });

    it("accepts explicit limit 1", async () => {
      const base = Date.now();
      await appendBundle("test-source-limit-1", { kind: "pair" }, { runId: "run-a" }, base);
      await appendBundle("test-source-limit-1", { kind: "pair" }, { runId: "run-b" }, base + 100);

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 1,
        cursor: null,
        nowUnixMs: base + 200
      });

      expect(result.records).toHaveLength(1);
    });

    it("accepts explicit limit 100", async () => {
      const base = Date.now();
      for (let i = 0; i < 100; i++) {
        await appendBundle(
          "test-source-limit-100",
          { kind: "pair" },
          { runId: `run-${i}` },
          base + i
        );
      }

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 200
      });

      expect(result.records).toHaveLength(100);
    });
  });

  describe("never mixes exact evidence scopes in history", () => {
    it("pair scope does not return whirlpool evidence", async () => {
      const base = Date.now();

      await appendBundle("test-source-scope-pw-001", { kind: "pair" }, { runId: "pair-run" }, base);
      await appendBundle(
        "test-source-scope-pw-002",
        {
          kind: "whirlpool",
          network: "solana-mainnet",
          whirlpoolAddress: "WhirlpoolABC123"
        },
        { runId: "whirlpool-run" },
        base + 100
      );

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 200
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].bundle.scope.kind).toBe("pair");
    });

    it("whirlpool scope does not return pair evidence", async () => {
      const base = Date.now();
      const whirlpoolAddress = "WhirlpoolXYZ789";

      await appendBundle(
        "test-source-whirlpool-pair",
        { kind: "pair" },
        { runId: "pair-run" },
        base
      );
      await appendBundle(
        "test-source-whirlpool-target",
        {
          kind: "whirlpool",
          network: "solana-mainnet",
          whirlpoolAddress
        },
        { runId: "whirlpool-run" },
        base + 100
      );

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "whirlpool", network: "solana-mainnet", whirlpoolAddress },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 200
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].bundle.scope.kind).toBe("whirlpool");
    });

    it("wallet scope does not return pair evidence", async () => {
      const base = Date.now();
      const walletAddress = "WalletABC123";

      await appendBundle("test-source-wallet-pair", { kind: "pair" }, { runId: "pair-run" }, base);
      await appendBundle(
        "test-source-wallet-target",
        {
          kind: "wallet",
          network: "solana-mainnet",
          walletAddress
        },
        { runId: "wallet-run" },
        base + 100
      );

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "wallet", network: "solana-mainnet", walletAddress },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 200
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].bundle.scope.kind).toBe("wallet");
    });

    it("position scope does not return wallet evidence", async () => {
      const base = Date.now();
      const walletAddress = "PositionWallet123";
      const whirlpoolAddress = "PositionWhirlpool456";
      const positionId = "PositionID789";

      await appendBundle(
        "test-source-position-base",
        {
          kind: "wallet",
          network: "solana-mainnet",
          walletAddress
        },
        { runId: "wallet-run" },
        base
      );
      await appendBundle(
        "test-source-position-target",
        {
          kind: "position",
          network: "solana-mainnet",
          walletAddress,
          whirlpoolAddress,
          positionId
        },
        { runId: "position-run" },
        base + 100
      );

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: {
          kind: "position",
          network: "solana-mainnet",
          walletAddress,
          whirlpoolAddress,
          positionId
        },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 200
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].bundle.scope.kind).toBe("position");
    });

    it("returns empty when no evidence matches the scope", async () => {
      const base = Date.now();

      await appendBundle("test-source-no-match", { kind: "pair" }, { runId: "pair-run" }, base);

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: {
          kind: "whirlpool",
          network: "solana-mainnet",
          whirlpoolAddress: "NonExistentWhirlpool"
        },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 100
      });

      expect(result.records).toHaveLength(0);
    });
  });

  describe("orders evidence history by receipt time and id descending", () => {
    it("orders by receivedAt DESC, id DESC", async () => {
      const base = Date.now();

      await appendBundle("test-source-order-1", { kind: "pair" }, { runId: "run-1" }, base + 100);
      await appendBundle("test-source-order-2", { kind: "pair" }, { runId: "run-2" }, base + 200);
      await appendBundle("test-source-order-3", { kind: "pair" }, { runId: "run-3" }, base + 200);

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 300
      });

      expect(result.records).toHaveLength(3);
      expect(result.records[0].bundle.runId).toBe("run-3");
      expect(result.records[1].bundle.runId).toBe("run-2");
      expect(result.records[2].bundle.runId).toBe("run-1");
    });

    it("uses id DESC tie-breaker when receivedAt is equal", async () => {
      const base = Date.now();
      const sameTime = base + 100;

      await appendBundle("test-source-tie-1", { kind: "pair" }, { runId: "run-tie-1" }, sameTime);
      await appendBundle("test-source-tie-2", { kind: "pair" }, { runId: "run-tie-2" }, sameTime);
      await appendBundle("test-source-tie-3", { kind: "pair" }, { runId: "run-tie-3" }, sameTime);

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 200
      });

      expect(result.records).toHaveLength(3);
      const ids = result.records.map((r) => r.id);
      expect(ids[0]).toBeGreaterThan(ids[1]);
      expect(ids[1]).toBeGreaterThan(ids[2]);
    });

    it("returns empty list when no history exists", async () => {
      const base = Date.now();

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base
      });

      expect(result.records).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it("returns nextCursor only when extra row exists", async () => {
      const base = Date.now();

      await appendBundle("test-source-next-cursor-1", { kind: "pair" }, { runId: "run-1" }, base);
      await appendBundle(
        "test-source-next-cursor-2",
        { kind: "pair" },
        { runId: "run-2" },
        base + 100
      );

      const page1 = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 1,
        cursor: null,
        nowUnixMs: base + 200
      });

      expect(page1.records).toHaveLength(1);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 1,
        cursor: page1.nextCursor,
        nowUnixMs: base + 200
      });

      expect(page2.records).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
    });
  });

  describe("source filtering in history", () => {
    it("filters by source publisher and sourceId", async () => {
      const base = Date.now();

      await appendBundle("test-source-filter-a", { kind: "pair" }, { runId: "run-a" }, base);
      await appendBundle("test-source-filter-b", { kind: "pair" }, { runId: "run-b" }, base + 100);

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: { publisher: TEST_PUBLISHER, sourceId: "test-source-filter-a" },
        limit: 100,
        cursor: null,
        nowUnixMs: base + 200
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].bundle.runId).toBe("run-a");
    });

    it("returns empty when no source matches filter", async () => {
      const base = Date.now();

      await appendBundle("test-source-actual", { kind: "pair" }, { runId: "run-actual" }, base);

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: { publisher: TEST_PUBLISHER, sourceId: "non-existent-source" },
        limit: 100,
        cursor: null,
        nowUnixMs: base + 100
      });

      expect(result.records).toHaveLength(0);
    });
  });

  describe("lifecycle derivation in history", () => {
    it("derives FRESH lifecycle for recent evidence", async () => {
      const base = Date.now();

      await appendBundle(
        "test-source-lifecycle-fresh",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        },
        base
      );

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 100
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].lifecycle).toBe("FRESH");
    });

    it("derives STALE lifecycle when past freshUntil", async () => {
      const base = Date.now();

      await appendBundle(
        "test-source-lifecycle-stale",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        },
        base
      );

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 3_600_001
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].lifecycle).toBe("STALE");
    });

    it("derives EXPIRED lifecycle when past expiresAt", async () => {
      const base = Date.now();

      await appendBundle(
        "test-source-lifecycle-expired",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        },
        base
      );

      const result = await repository.getHistory({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        limit: 100,
        cursor: null,
        nowUnixMs: base + 7_200_001
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].lifecycle).toBe("EXPIRED");
    });
  });

  describe("corrupt stored payload rejection in history", () => {
    it("throws when evidence_json is corrupt", async () => {
      const base = Date.now();

      await db.execute(sql`
        INSERT INTO regime_engine.evidence_bundles (
          schema_version, source_publisher, source_id, run_id, pair, scope_key,
          correlation_id, as_of_unix_ms, created_at_unix_ms, received_at_unix_ms,
          fresh_until_unix_ms, expires_at_unix_ms, evidence_json, evidence_canonical,
          evidence_hash, ingested_at_unix_ms, processed_at_unix_ms
        ) VALUES (
          'evidence-bundle.v1', ${TEST_PUBLISHER}, 'test-source-history-corrupt',
          'run-history-corrupt', ${TEST_PAIR}, 'pair',
          'corr-hist', ${base}, ${base}, ${base},
          ${base + 3_600_000}, ${base + 7_200_000},
          '{"schemaVersion": "evidence-bundle.v1", "INVALID": "CORRUPT"}',
          ${CANONICAL_PAYLOAD}, ${PAYLOAD_HASH}, ${Date.now()}, 0
        )
      `);

      await expect(
        repository.getHistory({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          limit: 100,
          cursor: null,
          nowUnixMs: base + 100
        })
      ).rejects.toThrow();
    });
  });
});
