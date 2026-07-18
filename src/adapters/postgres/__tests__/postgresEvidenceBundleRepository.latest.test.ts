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

describe.skipIf(!process.env.DATABASE_URL)("postgresEvidenceBundleRepository.getLatest", () => {
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
    overrides: Partial<EvidenceBundleV1> = {}
  ): Promise<void> => {
    const bundle = createTestBundle({
      source: { publisher: TEST_PUBLISHER, sourceId, sourceVersion: "1.0.0" },
      scope,
      ...overrides
    });
    await repository.append({
      bundle,
      payloadCanonical: CANONICAL_PAYLOAD,
      payloadHash: PAYLOAD_HASH,
      receivedAtUnixMs: Date.now()
    });
  };

  describe("derives lifecycle at inclusive freshness and expiry boundaries", () => {
    const makeTimestamps = (base: number, freshOffsetMs: number, expiresOffsetMs: number) => {
      const createdAt = new Date(base).toISOString();
      const asOf = new Date(base).toISOString();
      const freshUntil = new Date(base + freshOffsetMs).toISOString();
      const expiresAt = new Date(base + expiresOffsetMs).toISOString();
      return { createdAt, asOf, freshUntil, expiresAt };
    };

    it("returns FRESH when now is before freshUntil", async () => {
      const base = Date.now();
      const { createdAt, asOf, freshUntil, expiresAt } = makeTimestamps(base, 3_600_000, 7_200_000);

      await appendBundle(
        "test-source-fresh-001",
        { kind: "pair" },
        {
          createdAt,
          asOf,
          freshUntil,
          expiresAt
        }
      );

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        nowUnixMs: base + 1000
      });

      expect(results).toHaveLength(1);
      expect(results[0].lifecycle).toBe("FRESH");
    });

    it("returns FRESH when now equals freshUntil (inclusive boundary)", async () => {
      const base = Date.now();
      const freshUntilMs = base + 3_600_000;
      const { createdAt, asOf, freshUntil, expiresAt } = makeTimestamps(base, 3_600_000, 7_200_000);

      await appendBundle(
        "test-source-fresh-boundary-001",
        { kind: "pair" },
        {
          createdAt,
          asOf,
          freshUntil,
          expiresAt
        }
      );

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        nowUnixMs: freshUntilMs
      });

      expect(results).toHaveLength(1);
      expect(results[0].lifecycle).toBe("FRESH");
    });

    it("returns STALE when now is after freshUntil but before expiresAt", async () => {
      const base = Date.now();
      const { createdAt, asOf, freshUntil, expiresAt } = makeTimestamps(base, 3_600_000, 7_200_000);

      await appendBundle(
        "test-source-stale-001",
        { kind: "pair" },
        {
          createdAt,
          asOf,
          freshUntil,
          expiresAt
        }
      );

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        nowUnixMs: base + 3_600_001
      });

      expect(results).toHaveLength(1);
      expect(results[0].lifecycle).toBe("STALE");
    });

    it("returns STALE when now equals expiresAt (inclusive boundary)", async () => {
      const base = Date.now();
      const expiresMs = base + 7_200_000;
      const { createdAt, asOf, freshUntil, expiresAt } = makeTimestamps(base, 3_600_000, 7_200_000);

      await appendBundle(
        "test-source-stale-boundary-001",
        { kind: "pair" },
        {
          createdAt,
          asOf,
          freshUntil,
          expiresAt
        }
      );

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        nowUnixMs: expiresMs
      });

      expect(results).toHaveLength(1);
      expect(results[0].lifecycle).toBe("STALE");
    });

    it("returns EXPIRED when now is after expiresAt", async () => {
      const base = Date.now();
      const { createdAt, asOf, freshUntil, expiresAt } = makeTimestamps(base, 3_600_000, 7_200_000);

      await appendBundle(
        "test-source-expired-001",
        { kind: "pair" },
        {
          createdAt,
          asOf,
          freshUntil,
          expiresAt
        }
      );

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        nowUnixMs: base + 7_200_001
      });

      expect(results).toHaveLength(1);
      expect(results[0].lifecycle).toBe("EXPIRED");
    });

    it("expired rows remain observable (not filtered out)", async () => {
      const base = Date.now();
      const { createdAt, asOf, freshUntil, expiresAt } = makeTimestamps(base, 3_600_000, 7_200_000);

      await appendBundle(
        "test-source-observable-001",
        { kind: "pair" },
        {
          createdAt,
          asOf,
          freshUntil,
          expiresAt
        }
      );

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        nowUnixMs: base + 10_000_000
      });

      expect(results).toHaveLength(1);
      expect(results[0].lifecycle).toBe("EXPIRED");
    });
  });

  describe("returns latest evidence independently for each source", () => {
    it("returns one record per source on unfiltered read", async () => {
      const base = Date.now();

      await appendBundle(
        "test-source-src-a",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString(),
          runId: "run-a-first"
        }
      );

      await appendBundle(
        "test-source-src-a",
        { kind: "pair" },
        {
          createdAt: new Date(base - 1000).toISOString(),
          asOf: new Date(base - 1000).toISOString(),
          freshUntil: new Date(base + 3_600_000 - 1000).toISOString(),
          expiresAt: new Date(base + 7_200_000 - 1000).toISOString(),
          runId: "run-a-second"
        }
      );

      await appendBundle(
        "test-source-src-b",
        { kind: "pair" },
        {
          createdAt: new Date(base - 500).toISOString(),
          asOf: new Date(base - 500).toISOString(),
          freshUntil: new Date(base + 3_600_000 - 500).toISOString(),
          expiresAt: new Date(base + 7_200_000 - 500).toISOString(),
          runId: "run-b-only"
        }
      );

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        nowUnixMs: base + 1000
      });

      expect(results).toHaveLength(2);
      const sourceIds = results.map((r) => r.bundle.source.sourceId).sort();
      expect(sourceIds).toEqual(["test-source-src-a", "test-source-src-b"]);
    });

    it("returns at most one record for a source-filtered read", async () => {
      const base = Date.now();

      await appendBundle(
        "test-source-filter-a",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString(),
          runId: "run-first"
        }
      );

      await appendBundle(
        "test-source-filter-a",
        { kind: "pair" },
        {
          createdAt: new Date(base - 1000).toISOString(),
          asOf: new Date(base - 1000).toISOString(),
          freshUntil: new Date(base + 3_600_000 - 1000).toISOString(),
          expiresAt: new Date(base + 7_200_000 - 1000).toISOString(),
          runId: "run-second"
        }
      );

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: { publisher: TEST_PUBLISHER, sourceId: "test-source-filter-a" },
        nowUnixMs: base + 1000
      });

      expect(results).toHaveLength(1);
      expect(results[0].bundle.runId).toBe("run-first");
    });

    it("selects by as_of_unix_ms desc, then received_at_unix_ms desc, then id desc for ties", async () => {
      const base = Date.now();

      await appendBundle(
        "test-source-tie-breaker",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString(),
          runId: "run-same-asof"
        }
      );

      const secondReceived = base + 500;
      await db.execute(sql`
        UPDATE regime_engine.evidence_bundles
        SET received_at_unix_ms = ${secondReceived}
        WHERE source_id = 'test-source-tie-breaker'
          AND run_id = 'run-same-asof'
      `);

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: { publisher: TEST_PUBLISHER, sourceId: "test-source-tie-breaker" },
        nowUnixMs: base + 1000
      });

      expect(results).toHaveLength(1);
      expect(results[0].receivedAtUnixMs).toBe(secondReceived);
    });
  });

  describe("never mixes exact evidence scopes", () => {
    it("pair scope does not return whirlpool evidence", async () => {
      const base = Date.now();

      await appendBundle(
        "test-source-scope-pw-001",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        }
      );

      await appendBundle(
        "test-source-scope-pw-002",
        {
          kind: "whirlpool",
          network: "solana-mainnet",
          whirlpoolAddress: "WhirlpoolABC123"
        },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        }
      );

      const pairResults = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "pair" },
        source: null,
        nowUnixMs: base + 1000
      });

      expect(pairResults).toHaveLength(1);
      expect(pairResults[0].bundle.scope.kind).toBe("pair");
    });

    it("whirlpool scope does not return pair evidence", async () => {
      const base = Date.now();
      const whirlpoolAddress = "WhirlpoolXYZ789";

      await appendBundle(
        "test-source-whirlpool-only",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        }
      );

      await appendBundle(
        "test-source-whirlpool-target",
        {
          kind: "whirlpool",
          network: "solana-mainnet",
          whirlpoolAddress
        },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        }
      );

      const whirlpoolResults = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "whirlpool", network: "solana-mainnet", whirlpoolAddress },
        source: null,
        nowUnixMs: base + 1000
      });

      expect(whirlpoolResults).toHaveLength(1);
      expect(whirlpoolResults[0].bundle.scope.kind).toBe("whirlpool");
    });

    it("wallet scope does not return pair evidence", async () => {
      const base = Date.now();
      const walletAddress = "WalletABC123";

      await appendBundle(
        "test-source-wallet-pair",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        }
      );

      await appendBundle(
        "test-source-wallet-target",
        {
          kind: "wallet",
          network: "solana-mainnet",
          walletAddress
        },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        }
      );

      const walletResults = await repository.getLatest({
        pair: TEST_PAIR,
        scope: { kind: "wallet", network: "solana-mainnet", walletAddress },
        source: null,
        nowUnixMs: base + 1000
      });

      expect(walletResults).toHaveLength(1);
      expect(walletResults[0].bundle.scope.kind).toBe("wallet");
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
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        }
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
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        }
      );

      const positionResults = await repository.getLatest({
        pair: TEST_PAIR,
        scope: {
          kind: "position",
          network: "solana-mainnet",
          walletAddress,
          whirlpoolAddress,
          positionId
        },
        source: null,
        nowUnixMs: base + 1000
      });

      expect(positionResults).toHaveLength(1);
      expect(positionResults[0].bundle.scope.kind).toBe("position");
    });

    it("returns empty list when no evidence matches the scope (no fallback)", async () => {
      const base = Date.now();

      await appendBundle(
        "test-source-no-match",
        { kind: "pair" },
        {
          createdAt: new Date(base).toISOString(),
          asOf: new Date(base).toISOString(),
          freshUntil: new Date(base + 3_600_000).toISOString(),
          expiresAt: new Date(base + 7_200_000).toISOString()
        }
      );

      const results = await repository.getLatest({
        pair: TEST_PAIR,
        scope: {
          kind: "whirlpool",
          network: "solana-mainnet",
          whirlpoolAddress: "NonExistentWhirlpool"
        },
        source: null,
        nowUnixMs: base + 1000
      });

      expect(results).toHaveLength(0);
    });
  });

  describe("fails visibly when stored payload JSON is corrupt", () => {
    it("throws when evidence_json contains invalid JSON structure", async () => {
      const base = Date.now();

      await db.execute(sql`
        INSERT INTO regime_engine.evidence_bundles (
          schema_version, source_publisher, source_id, run_id, pair, scope_key,
          correlation_id, as_of_unix_ms, created_at_unix_ms, received_at_unix_ms,
          fresh_until_unix_ms, expires_at_unix_ms, evidence_json, evidence_canonical,
          evidence_hash, ingested_at_unix_ms, processed_at_unix_ms
        ) VALUES (
          'evidence-bundle.v1', ${TEST_PUBLISHER}, 'test-source-corrupt-001',
          'run-corrupt-001', ${TEST_PAIR}, 'pair',
          'corr-001', ${base}, ${base}, ${base},
          ${base + 3_600_000}, ${base + 7_200_000},
          '{"schemaVersion": "evidence-bundle.v1", "INVALID": "CORRUPT"}',
          ${CANONICAL_PAYLOAD}, ${PAYLOAD_HASH}, ${Date.now()}, 0
        )
      `);

      await expect(
        repository.getLatest({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: { publisher: TEST_PUBLISHER, sourceId: "test-source-corrupt-001" },
          nowUnixMs: base + 1000
        })
      ).rejects.toThrow();
    });

    it("throws when evidence_json is not valid EvidenceBundleV1", async () => {
      const base = Date.now();

      await db.execute(sql`
        INSERT INTO regime_engine.evidence_bundles (
          schema_version, source_publisher, source_id, run_id, pair, scope_key,
          correlation_id, as_of_unix_ms, created_at_unix_ms, received_at_unix_ms,
          fresh_until_unix_ms, expires_at_unix_ms, evidence_json, evidence_canonical,
          evidence_hash, ingested_at_unix_ms, processed_at_unix_ms
        ) VALUES (
          'evidence-bundle.v1', ${TEST_PUBLISHER}, 'test-source-invalid-001',
          'run-invalid-001', ${TEST_PAIR}, 'pair',
          'corr-002', ${base}, ${base}, ${base},
          ${base + 3_600_000}, ${base + 7_200_000},
          '{"schemaVersion": "evidence-bundle.v1", "pair": "INVALID/PAIR"}',
          ${CANONICAL_PAYLOAD}, ${PAYLOAD_HASH}, ${Date.now()}, 0
        )
      `);

      await expect(
        repository.getLatest({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: { publisher: TEST_PUBLISHER, sourceId: "test-source-invalid-001" },
          nowUnixMs: base + 1000
        })
      ).rejects.toThrow();
    });
  });
});
