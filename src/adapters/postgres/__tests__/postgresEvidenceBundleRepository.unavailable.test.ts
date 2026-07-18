import { describe, expect, it } from "vitest";
import { createPostgresEvidenceBundleRepository } from "../postgresEvidenceBundleRepository.js";
import {
  EvidenceRunConflictError,
  evidenceScopeKey
} from "../../../application/ports/evidenceBundleRepositoryPort.js";
import type { Db } from "../../../ledger/pg/db.js";
import type { EvidenceBundleV1 } from "../../../contract/evidence/v1/types.generated.js";

const TEST_PAIR = "SOL/USDC" as const;
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
      gitCommit: "a".repeat(64),
      environment: "test",
      upstreamRunIds: []
    }
  };
  return { ...base, ...overrides };
};

const CANONICAL_PAYLOAD = JSON.stringify({ price: 150.25 });
const PAYLOAD_HASH = "a".repeat(64);

const makeTransientDbError = (code: string, message = "connection refused") => {
  const err = new Error(message);
  (err as unknown as { code: string }).code = code;
  return err;
};

const makeClosedClientError = () => {
  const err = new Error("Connection terminated");
  (err as unknown as { code: string }).code = "ECONNRESET";
  return err;
};

describe("postgresEvidenceBundleRepository transient failure handling", () => {
  describe("translates only transient database failures to evidence store unavailable", () => {
    it("translates ECONNREFUSED to EvidenceStoreUnavailableError on append", async () => {
      const transientDb = {
        insert: () => ({
          values: () => ({
            onConflictDoNothing: () => ({
              returning: async () => {
                throw makeTransientDbError("ECONNREFUSED");
              }
            })
          })
        }),
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => []
            })
          })
        }),
        execute: async () => {
          throw makeTransientDbError("ECONNREFUSED");
        }
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(transientDb);

      const { EvidenceStoreUnavailableError } =
        await import("../../../application/errors/evidenceErrors.js");

      await expect(
        repository.append({
          bundle: createTestBundle(),
          payloadCanonical: CANONICAL_PAYLOAD,
          payloadHash: PAYLOAD_HASH,
          receivedAtUnixMs: Date.now()
        })
      ).rejects.toThrow(EvidenceStoreUnavailableError);
    });

    it("translates ECONNREFUSED to EvidenceStoreUnavailableError on getLatest", async () => {
      const transientDb = {
        execute: async () => {
          throw makeTransientDbError("ECONNREFUSED");
        }
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(transientDb);

      const { EvidenceStoreUnavailableError } =
        await import("../../../application/errors/evidenceErrors.js");

      await expect(
        repository.getLatest({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: { publisher: TEST_PUBLISHER, sourceId: "test" },
          nowUnixMs: Date.now()
        })
      ).rejects.toThrow(EvidenceStoreUnavailableError);
    });

    it("translates ECONNREFUSED to EvidenceStoreUnavailableError on getHistory", async () => {
      const transientDb = {
        execute: async () => {
          throw makeTransientDbError("ECONNREFUSED");
        }
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(transientDb);

      const { EvidenceStoreUnavailableError } =
        await import("../../../application/errors/evidenceErrors.js");

      await expect(
        repository.getHistory({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          limit: 10,
          cursor: null,
          nowUnixMs: Date.now()
        })
      ).rejects.toThrow(EvidenceStoreUnavailableError);
    });

    it("translates PostgreSQL shutdown code 57P01 to EvidenceStoreUnavailableError", async () => {
      const transientDb = {
        execute: async () => {
          throw makeTransientDbError("57P01", "administrative shutdown");
        }
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(transientDb);

      const { EvidenceStoreUnavailableError } =
        await import("../../../application/errors/evidenceErrors.js");

      await expect(
        repository.getLatest({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          nowUnixMs: Date.now()
        })
      ).rejects.toThrow(EvidenceStoreUnavailableError);
    });

    it("translates PostgreSQL shutdown code 57P02 to EvidenceStoreUnavailableError", async () => {
      const transientDb = {
        execute: async () => {
          throw makeTransientDbError("57P02", "crash shutdown");
        }
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(transientDb);

      const { EvidenceStoreUnavailableError } =
        await import("../../../application/errors/evidenceErrors.js");

      await expect(
        repository.getLatest({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          nowUnixMs: Date.now()
        })
      ).rejects.toThrow(EvidenceStoreUnavailableError);
    });

    it("translates PostgreSQL shutdown code 57P03 to EvidenceStoreUnavailableError", async () => {
      const transientDb = {
        execute: async () => {
          throw makeTransientDbError("57P03", "cannot connect now");
        }
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(transientDb);

      const { EvidenceStoreUnavailableError } =
        await import("../../../application/errors/evidenceErrors.js");

      await expect(
        repository.getLatest({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          nowUnixMs: Date.now()
        })
      ).rejects.toThrow(EvidenceStoreUnavailableError);
    });

    it("translates closed-client connection error to EvidenceStoreUnavailableError", async () => {
      const transientDb = {
        execute: async () => {
          throw makeClosedClientError();
        }
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(transientDb);

      const { EvidenceStoreUnavailableError } =
        await import("../../../application/errors/evidenceErrors.js");

      await expect(
        repository.getLatest({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          nowUnixMs: Date.now()
        })
      ).rejects.toThrow(EvidenceStoreUnavailableError);
    });

    it("preserves EvidenceRunConflictError on append conflict", async () => {
      const conflictDb = {
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
              limit: async () => [
                {
                  id: 1,
                  evidence_hash: PAYLOAD_HASH,
                  evidence_canonical: CANONICAL_PAYLOAD,
                  received_at_unix_ms: Date.now(),
                  scope_key: evidenceScopeKey({ kind: "pair" })
                }
              ]
            })
          })
        })
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(conflictDb);

      await expect(
        repository.append({
          bundle: createTestBundle(),
          payloadCanonical: CANONICAL_PAYLOAD,
          payloadHash: "different_hash",
          receivedAtUnixMs: Date.now()
        })
      ).rejects.toThrow(EvidenceRunConflictError);
    });

    it("preserves invariant error when winning row not found", async () => {
      const invariantDb = {
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

      const repository = createPostgresEvidenceBundleRepository(invariantDb);

      await expect(
        repository.append({
          bundle: createTestBundle(),
          payloadCanonical: CANONICAL_PAYLOAD,
          payloadHash: PAYLOAD_HASH,
          receivedAtUnixMs: Date.now()
        })
      ).rejects.toThrow("Append-only invariant violated");
    });

    it("rethrows unknown errors unchanged", async () => {
      const unknownErrorDb = {
        execute: async () => {
          const err = new Error("some unexpected error");
          (err as unknown as { code: string }).code = "UNKNOWN_CODE";
          throw err;
        }
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(unknownErrorDb);

      await expect(
        repository.getLatest({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: null,
          nowUnixMs: Date.now()
        })
      ).rejects.toThrow("some unexpected error");
    });

    it("does not convert invalid stored JSON to 503", async () => {
      const invalidJsonDb = {
        execute: async () => [
          {
            id: 1,
            source_publisher: TEST_PUBLISHER,
            source_id: "test",
            evidence_json: "not valid json",
            evidence_hash: PAYLOAD_HASH,
            received_at_unix_ms: Date.now(),
            fresh_until_unix_ms: Date.now() + 3600000,
            expires_at_unix_ms: Date.now() + 7200000
          }
        ]
      } as unknown as Db;

      const repository = createPostgresEvidenceBundleRepository(invalidJsonDb);

      await expect(
        repository.getLatest({
          pair: TEST_PAIR,
          scope: { kind: "pair" },
          source: { publisher: TEST_PUBLISHER, sourceId: "test" },
          nowUnixMs: Date.now()
        })
      ).rejects.toThrow();
    });
  });
});
