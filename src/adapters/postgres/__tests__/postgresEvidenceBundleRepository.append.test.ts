import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../../../ledger/pg/db.js";
import { createPostgresEvidenceBundleRepository } from "../postgresEvidenceBundleRepository.js";
import {
  EvidenceRunConflictError,
  evidenceScopeKey
} from "../../../application/ports/evidenceBundleRepositoryPort.js";
import { sql } from "drizzle-orm";
import type { EvidenceBundleV1 } from "../../../contract/evidence/v1/types.generated.js";

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

describe.skipIf(!process.env.DATABASE_URL)("postgresEvidenceBundleRepository.append", () => {
  let db: ReturnType<typeof createDb>["db"];
  let repository: ReturnType<typeof createPostgresEvidenceBundleRepository>;

  const testScopeKey = evidenceScopeKey({ kind: "pair" });

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

  const CANONICAL_PAYLOAD = JSON.stringify({ price: 150.25 });
  const PAYLOAD_HASH = "a".repeat(64);

  describe("creates one immutable row for a new source run", () => {
    it("inserts bundle and returns created status with receipt", async () => {
      const bundle = createTestBundle({
        source: {
          publisher: TEST_PUBLISHER,
          sourceId: "test-source-new-001",
          sourceVersion: "1.0.0"
        },
        runId: "test-run-new-001"
      });

      const result = await repository.append({
        bundle,
        payloadCanonical: CANONICAL_PAYLOAD,
        payloadHash: PAYLOAD_HASH,
        receivedAtUnixMs: Date.now()
      });

      expect(result.status).toBe("created");
      expect(result.receipt).toBeDefined();
      expect(result.receipt.id).toBeGreaterThan(0);
      expect(result.receipt.evidenceHash).toBe(PAYLOAD_HASH);
      expect(result.receipt.scopeKey).toBe(testScopeKey);
    });

    it("creates exactly one row per (schemaVersion, sourcePublisher, sourceId, runId)", async () => {
      const bundle = createTestBundle({
        source: {
          publisher: TEST_PUBLISHER,
          sourceId: "test-source-unique-001",
          sourceVersion: "1.0.0"
        },
        runId: "test-run-unique-001"
      });

      await repository.append({
        bundle,
        payloadCanonical: CANONICAL_PAYLOAD,
        payloadHash: PAYLOAD_HASH,
        receivedAtUnixMs: Date.now()
      });

      const rows = await db.execute(sql`
        SELECT id, run_id FROM regime_engine.evidence_bundles
        WHERE source_publisher = ${TEST_PUBLISHER}
          AND source_id = 'test-source-unique-001'
          AND run_id = 'test-run-unique-001'
      `);

      expect(rows).toHaveLength(1);
    });
  });

  describe("returns already_ingested for an identical source run replay", () => {
    it("returns already_ingested with same receipt when same hash and canonical", async () => {
      const bundle = createTestBundle({
        source: {
          publisher: TEST_PUBLISHER,
          sourceId: "test-source-dup-001",
          sourceVersion: "1.0.0"
        },
        runId: "test-run-dup-001"
      });

      const first = await repository.append({
        bundle,
        payloadCanonical: CANONICAL_PAYLOAD,
        payloadHash: PAYLOAD_HASH,
        receivedAtUnixMs: Date.now()
      });

      const second = await repository.append({
        bundle,
        payloadCanonical: CANONICAL_PAYLOAD,
        payloadHash: PAYLOAD_HASH,
        receivedAtUnixMs: Date.now() + 1
      });

      expect(first.status).toBe("created");
      expect(second.status).toBe("already_ingested");
      expect(second.receipt.id).toBe(first.receipt.id);
      expect(second.receipt.evidenceHash).toBe(first.receipt.evidenceHash);
    });
  });

  describe("throws EVIDENCE_RUN_CONFLICT when same run has different payload", () => {
    it("throws EvidenceRunConflictError with existing and incoming hashes", async () => {
      const bundle = createTestBundle({
        source: {
          publisher: TEST_PUBLISHER,
          sourceId: "test-source-conflict-001",
          sourceVersion: "1.0.0"
        },
        runId: "test-run-conflict-001"
      });

      await repository.append({
        bundle,
        payloadCanonical: CANONICAL_PAYLOAD,
        payloadHash: PAYLOAD_HASH,
        receivedAtUnixMs: Date.now()
      });

      const differentHash = "b".repeat(64);
      const differentCanonical = JSON.stringify({ price: 160.0 });

      await expect(
        repository.append({
          bundle,
          payloadCanonical: differentCanonical,
          payloadHash: differentHash,
          receivedAtUnixMs: Date.now()
        })
      ).rejects.toThrow(EvidenceRunConflictError);

      try {
        await repository.append({
          bundle,
          payloadCanonical: differentCanonical,
          payloadHash: differentHash,
          receivedAtUnixMs: Date.now()
        });
      } catch (e) {
        expect(e).toBeInstanceOf(EvidenceRunConflictError);
        const conflictError = e as EvidenceRunConflictError;
        expect(conflictError.errorCode).toBe("EVIDENCE_RUN_CONFLICT");
        expect(conflictError.existingHash).toBe(PAYLOAD_HASH);
        expect(conflictError.incomingHash).toBe(differentHash);
      }
    });
  });

  describe("fails when a losing append cannot load the winning row", () => {
    it("throws when conflict is detected but the winning row cannot be loaded", async () => {
      // The invariant path is a race window: the insert is suppressed by
      // conflict, then the winning row disappears before the follow-up
      // select. Real SQL on one connection cannot produce that state — if
      // the row exists the winner is found, if it does not the insert
      // succeeds — so both queries are stubbed to return empty.
      const stubDb = {
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => ({
              returning: async () => []
            })
          })
        }),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => []
            })
          })
        })
      } as unknown as Db;

      const stubRepository = createPostgresEvidenceBundleRepository(stubDb);

      await expect(
        stubRepository.append({
          bundle: createTestBundle({
            source: {
              publisher: TEST_PUBLISHER,
              sourceId: "test-source-missing-winner-001",
              sourceVersion: "1.0.0"
            },
            runId: "test-run-missing-winner-001"
          }),
          payloadCanonical: CANONICAL_PAYLOAD,
          payloadHash: PAYLOAD_HASH,
          receivedAtUnixMs: Date.now()
        })
      ).rejects.toThrow("Append-only invariant violated");
    });
  });

  describe("concurrent appends", () => {
    it("both succeed when concurrent identical replays return same result", async () => {
      const bundle = createTestBundle({
        source: {
          publisher: TEST_PUBLISHER,
          sourceId: "test-source-concurrent-identical-001",
          sourceVersion: "1.0.0"
        },
        runId: "test-run-concurrent-identical-001"
      });

      const results = await Promise.all([
        repository.append({
          bundle,
          payloadCanonical: CANONICAL_PAYLOAD,
          payloadHash: PAYLOAD_HASH,
          receivedAtUnixMs: Date.now()
        }),
        repository.append({
          bundle,
          payloadCanonical: CANONICAL_PAYLOAD,
          payloadHash: PAYLOAD_HASH,
          receivedAtUnixMs: Date.now() + 1
        })
      ]);

      const statuses = results.map((r) => r.status);
      expect(statuses).toContain("created");
      expect(statuses).toContain("already_ingested");

      const created = results.find((r) => r.status === "created");
      const alreadyIngested = results.find((r) => r.status === "already_ingested");
      expect(alreadyIngested?.receipt.id).toBe(created?.receipt.id);
    });

    it("first wins and second throws when concurrent different payloads race", async () => {
      const bundle = createTestBundle({
        source: {
          publisher: TEST_PUBLISHER,
          sourceId: "test-source-concurrent-diff-001",
          sourceVersion: "1.0.0"
        },
        runId: "test-run-concurrent-diff-001"
      });

      const differentHash = "b".repeat(64);
      const differentCanonical = JSON.stringify({ price: 160.0 });

      const results = await Promise.allSettled([
        repository.append({
          bundle,
          payloadCanonical: CANONICAL_PAYLOAD,
          payloadHash: PAYLOAD_HASH,
          receivedAtUnixMs: Date.now()
        }),
        repository.append({
          bundle,
          payloadCanonical: differentCanonical,
          payloadHash: differentHash,
          receivedAtUnixMs: Date.now() + 1
        })
      ]);

      const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.status : "rejected"));

      expect(statuses).toContain("created");
      expect(statuses).toContain("rejected");
    });
  });
});
