import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createEvidenceCurrentHandler } from "../evidenceCurrent.js";
import type { GetCurrentEvidenceUseCase } from "../../../../application/use-cases/getCurrentEvidenceUseCase.js";
import type { EvidenceBundleRecord } from "../../../../application/ports/evidenceBundleRepositoryPort.js";
import type { EvidenceBundleV1 } from "../../../../contract/evidence/v1/types.generated.js";
import type { Scope } from "../../../../contract/evidence/v1/types.generated.js";
import { EvidenceLifecycle } from "../../../../application/ports/evidenceBundleRepositoryPort.js";

const EVIDENCE_SCHEMA_VERSION = "1.0";

const MOCK_BUNDLE_PAIR = {
  schemaVersion: "evidence-bundle.v1" as const,
  pair: "SOL/USDC" as const,
  scope: { kind: "pair" as const },
  source: {
    publisher: "sol-usdc-clmm-intelligence" as const,
    sourceId: "source-123",
    sourceVersion: "v1.0"
  },
  runId: "run-001",
  correlationId: "corr-001",
  createdAt: "2026-04-29T12:00:00Z",
  asOf: "2026-04-29T12:00:00Z",
  freshUntil: "2026-04-29T18:00:00Z",
  expiresAt: "2026-04-30T12:00:00Z",
  deterministicFeatures: [],
  contextualEvidence: {
    supportResistance: [],
    flows: [],
    derivatives: [],
    events: [],
    newsRegulatory: []
  },
  researchBrief: null,
  sourceReferences: [],
  assessment: {
    overallConfidenceBps: 5000,
    quality: "complete" as const,
    coverage: {
      deterministic: "available" as const,
      supportResistance: "available" as const,
      flows: "available" as const,
      derivatives: "available" as const,
      events: "available" as const,
      newsRegulatory: "available" as const,
      researchBrief: "available" as const
    },
    warnings: []
  },
  provenance: {
    pipelineVersion: "1.0.0",
    gitCommit: "abc123def456",
    environment: "test" as const,
    upstreamRunIds: []
  }
};

const makeMockRecord = (overrides: Partial<EvidenceBundleRecord> = {}): EvidenceBundleRecord =>
  ({
    id: 1,
    bundle: MOCK_BUNDLE_PAIR as unknown as EvidenceBundleV1,
    evidenceHash: "hash-abc123",
    receivedAtUnixMs: 1_700_000_000_000,
    lifecycle: "FRESH" as EvidenceLifecycle,
    ...overrides
  }) as EvidenceBundleRecord;

describe("createEvidenceCurrentHandler", () => {
  const CLOCK_TIME = 1_700_000_000_000;

  describe("null use case", () => {
    it("returns 503 when use case is null", async () => {
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(null));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
      expect(body.error.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
      expect(body.error.details).toEqual([]);
    });

    it("does not call use case when null", async () => {
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(null));
      await app.ready();

      await app.inject({
        method: "GET",
        url: "/current"
      });

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe("query parsing", () => {
    it("parses pair scope as default", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      expect(response.statusCode).toBe(200);
    });

    it("parses pair scope explicitly", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?scope=pair"
      });

      expect(response.statusCode).toBe(200);
    });

    it("parses whirlpool scope", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async ({ scope }) => {
        expect(scope.kind).toBe("whirlpool");
        const whirlpoolScope = scope as Scope & { whirlpoolAddress: string };
        expect(whirlpoolScope.whirlpoolAddress).toBe("ABC123");
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
        };
      };
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?scope=whirlpool&whirlpoolAddress=ABC123"
      });

      expect(response.statusCode).toBe(200);
    });

    it("parses wallet scope", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async ({ scope }) => {
        expect(scope.kind).toBe("wallet");
        const walletScope = scope as Scope & { walletAddress: string };
        expect(walletScope.walletAddress).toBe("WalletXYZ");
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
        };
      };
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?scope=wallet&walletAddress=WalletXYZ"
      });

      expect(response.statusCode).toBe(200);
    });

    it("parses position scope", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async ({ scope }) => {
        expect(scope.kind).toBe("position");
        const positionScope = scope as Scope & {
          walletAddress: string;
          whirlpoolAddress: string;
          positionId: string;
        };
        expect(positionScope.walletAddress).toBe("WalletABC");
        expect(positionScope.whirlpoolAddress).toBe("PoolDEF");
        expect(positionScope.positionId).toBe("Pos001");
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
        };
      };
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?scope=position&walletAddress=WalletABC&whirlpoolAddress=PoolDEF&positionId=Pos001"
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("source filters", () => {
    it("passes publisher-only source filter", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async ({ source }) => {
        expect(source).toEqual({ publisher: "sol-usdc-clmm-intelligence" });
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
        };
      };
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?source.publisher=sol-usdc-clmm-intelligence"
      });

      expect(response.statusCode).toBe(200);
    });

    it("passes sourceId-only source filter", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async ({ source }) => {
        expect(source).toEqual({ sourceId: "src-001" });
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
        };
      };
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?source.sourceId=src-001"
      });

      expect(response.statusCode).toBe(200);
    });

    it("passes both publisher and sourceId source filter", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async ({ source }) => {
        expect(source).toEqual({ publisher: "sol-usdc-clmm-intelligence", sourceId: "src-001" });
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
        };
      };
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?source.publisher=sol-usdc-clmm-intelligence&source.sourceId=src-001"
      });

      expect(response.statusCode).toBe(200);
    });

    it("passes null source filter when no source params", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async ({ source }) => {
        expect(source).toBeNull();
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
        };
      };
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("validation", () => {
    it("returns 400 for unknown query parameters", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?unknownParam=value"
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid scope value", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?scope=invalid"
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for inapplicable parameters", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?scope=pair&walletAddress=WalletXYZ"
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for empty scope string", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?scope=%20%20%20"
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for non-string scope", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?scope=pair,whirlpool"
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("empty result", () => {
    it("returns 404 EVIDENCE_NOT_FOUND when no records", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: []
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
      expect(body.error.code).toBe("EVIDENCE_NOT_FOUND");
      expect(body.error.details).toEqual([]);
    });
  });

  describe("returns all current sources without selecting", () => {
    it("returns all records including stale and expired", async () => {
      const records: EvidenceBundleRecord[] = [
        makeMockRecord({ id: 1, lifecycle: "EXPIRED" }),
        makeMockRecord({ id: 2, lifecycle: "STALE" }),
        makeMockRecord({ id: 3, lifecycle: "FRESH" })
      ];
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(3);
      expect(body.items[0].freshness.status).toBe("EXPIRED");
      expect(body.items[1].freshness.status).toBe("STALE");
      expect(body.items[2].freshness.status).toBe("FRESH");
    });

    it("returns records in repository order", async () => {
      const records: EvidenceBundleRecord[] = [
        makeMockRecord({ id: 5, lifecycle: "EXPIRED" }),
        makeMockRecord({ id: 3, lifecycle: "STALE" }),
        makeMockRecord({ id: 7, lifecycle: "FRESH" })
      ];
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items[0].receiptId).toBe(5);
      expect(body.items[1].receiptId).toBe(3);
      expect(body.items[2].receiptId).toBe(7);
    });

    it("does not select a winner among stale/expired records", async () => {
      const records: EvidenceBundleRecord[] = [
        makeMockRecord({ id: 1, lifecycle: "STALE" }),
        makeMockRecord({ id: 2, lifecycle: "EXPIRED" })
      ];
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(2);
    });
  });

  describe("response format", () => {
    it("includes schemaVersion", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      const body = JSON.parse(response.body);
      expect(body.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
    });

    it("includes pair as SOL/USDC", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      const body = JSON.parse(response.body);
      expect(body.pair).toBe("SOL/USDC");
    });

    it("includes scope from query", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current?scope=whirlpool&whirlpoolAddress=ABC123"
      });

      const body = JSON.parse(response.body);
      expect(body.scope.kind).toBe("whirlpool");
      expect(body.scope.whirlpoolAddress).toBe("ABC123");
    });

    it("includes one queriedAt ISO timestamp", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      const body = JSON.parse(response.body);
      expect(body.queriedAt).toBe("2023-11-14T22:13:20.000Z");
    });

    it("includes complete bundle in each item", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      const body = JSON.parse(response.body);
      expect(body.items[0].bundle).toBeDefined();
      expect(body.items[0].bundle.schemaVersion).toBe("evidence-bundle.v1");
      expect(body.items[0].bundle.pair).toBe("SOL/USDC");
    });

    it("includes evidenceHash in each item", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH", evidenceHash: "hash-xyz789" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      const body = JSON.parse(response.body);
      expect(body.items[0].evidenceHash).toBe("hash-xyz789");
    });

    it("includes receiptId as record id", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 42, lifecycle: "FRESH" })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      const body = JSON.parse(response.body);
      expect(body.items[0].receiptId).toBe(42);
    });

    it("includes receivedAt ISO timestamp", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1, lifecycle: "FRESH", receivedAtUnixMs: CLOCK_TIME })]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      const body = JSON.parse(response.body);
      expect(body.items[0].receivedAt).toBe("2023-11-14T22:13:20.000Z");
    });

    it("includes freshness with status, asOf, freshUntil, expiresAt", async () => {
      const bundle = {
        ...MOCK_BUNDLE_PAIR,
        asOf: "2026-04-29T12:00:00Z",
        freshUntil: "2026-04-29T18:00:00Z",
        expiresAt: "2026-04-30T12:00:00Z"
      };
      const mockUseCase: GetCurrentEvidenceUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [
          makeMockRecord({
            id: 1,
            lifecycle: "STALE",
            bundle: bundle as unknown as EvidenceBundleV1
          })
        ]
      });
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      const body = JSON.parse(response.body);
      expect(body.items[0].freshness.status).toBe("STALE");
      expect(body.items[0].freshness.asOf).toBe("2026-04-29T12:00:00Z");
      expect(body.items[0].freshness.freshUntil).toBe("2026-04-29T18:00:00Z");
      expect(body.items[0].freshness.expiresAt).toBe("2026-04-30T12:00:00Z");
    });
  });

  describe("error handling", () => {
    it("returns 500 on unknown errors", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => {
        throw new Error("Something went wrong");
      };
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("redacts unknown error details", async () => {
      const mockUseCase: GetCurrentEvidenceUseCase = async () => {
        throw new Error("Sensitive internal details");
      };
      const app = Fastify();
      app.get("/current", createEvidenceCurrentHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/current"
      });

      const body = JSON.parse(response.body);
      expect(body.error.message).not.toContain("Sensitive internal details");
      expect(body.error.message).toBe("An internal error occurred");
    });
  });
});
