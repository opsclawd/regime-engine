import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { createEvidenceHistoryHandler } from "../evidenceHistory.js";
import type { GetEvidenceHistoryUseCase } from "../../../../application/use-cases/getEvidenceHistoryUseCase.js";
import type { EvidenceBundleRecord } from "../../../../application/ports/evidenceBundleRepositoryPort.js";
import type { EvidenceBundleV1 } from "../../../../contract/evidence/v1/types.generated.js";
import { encodeEvidenceCursor } from "../../../http/evidenceHttp.js";

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
    lifecycle: "FRESH",
    ...overrides
  }) as EvidenceBundleRecord;

describe("createEvidenceHistoryHandler", () => {
  const CLOCK_TIME = 1_700_000_000_000;

  describe("null use case", () => {
    it("returns 503 when use case is null", async () => {
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(null));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
      expect(body.error.code).toBe("EVIDENCE_STORE_UNAVAILABLE");
      expect(body.error.details).toEqual([]);
    });

    it("does not call use case when null", async () => {
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(null));
      await app.ready();

      await app.inject({
        method: "GET",
        url: "/history"
      });

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(503);
    });
  });

  describe("default and maximum limits", () => {
    it("uses default limit when not specified", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ limit }) => {
        expect(limit).toBe(30);
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(200);
    });

    it("uses default limit when limit is omitted", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ limit }) => {
        expect(limit).toBe(30);
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(200);
    });

    it("accepts maximum limit", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ limit }) => {
        expect(limit).toBe(100);
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?limit=100"
      });

      expect(response.statusCode).toBe(200);
    });

    it("rejects limit exceeding maximum", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?limit=101"
      });

      expect(response.statusCode).toBe(400);
    });

    it("rejects limit below minimum", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?limit=0"
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("cursor pass-through", () => {
    it("passes decoded cursor to use case", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ cursor }) => {
        expect(cursor).toEqual({ receivedAtUnixMs: 1_699_999_999_000, id: 42 });
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const cursor = { receivedAtUnixMs: 1_699_999_999_000, id: 42 };
      const encodedCursor = encodeEvidenceCursor(cursor);

      const response = await app.inject({
        method: "GET",
        url: `/history?cursor=${encodedCursor}`
      });

      expect(response.statusCode).toBe(200);
    });

    it("passes null cursor when not provided", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ cursor }) => {
        expect(cursor).toBeNull();
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("malformed cursor", () => {
    it("returns 400 for invalid base64 cursor", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?cursor=not-valid-base64!"
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for invalid JSON cursor", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const invalidCursor = Buffer.from("not json", "utf8").toString("base64url");

      const response = await app.inject({
        method: "GET",
        url: `/history?cursor=${invalidCursor}`
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for cursor with missing version", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const invalidCursor = Buffer.from(
        JSON.stringify({ receivedAtUnixMs: 1000, id: 1 }),
        "utf8"
      ).toString("base64url");

      const response = await app.inject({
        method: "GET",
        url: `/history?cursor=${invalidCursor}`
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("all scopes and source filters", () => {
    it("parses pair scope as default", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ scope }) => {
        expect(scope.kind).toBe("pair");
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(200);
    });

    it("parses whirlpool scope", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ scope }) => {
        expect(scope.kind).toBe("whirlpool");
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?scope=whirlpool&whirlpoolAddress=ABC123"
      });

      expect(response.statusCode).toBe(200);
    });

    it("parses wallet scope", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ scope }) => {
        expect(scope.kind).toBe("wallet");
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?scope=wallet&walletAddress=WalletXYZ"
      });

      expect(response.statusCode).toBe(200);
    });

    it("parses position scope", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ scope }) => {
        expect(scope.kind).toBe("position");
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?scope=position&walletAddress=WalletABC&whirlpoolAddress=PoolDEF&positionId=Pos001"
      });

      expect(response.statusCode).toBe(200);
    });

    it("passes publisher-only source filter", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ source }) => {
        expect(source).toEqual({ publisher: "sol-usdc-clmm-intelligence" });
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?source.publisher=sol-usdc-clmm-intelligence"
      });

      expect(response.statusCode).toBe(200);
    });

    it("passes sourceId-only source filter", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ source }) => {
        expect(source).toEqual({ sourceId: "src-001" });
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?source.sourceId=src-001"
      });

      expect(response.statusCode).toBe(200);
    });

    it("passes both publisher and sourceId source filter", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ source }) => {
        expect(source).toEqual({ publisher: "sol-usdc-clmm-intelligence", sourceId: "src-001" });
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?source.publisher=sol-usdc-clmm-intelligence&source.sourceId=src-001"
      });

      expect(response.statusCode).toBe(200);
    });

    it("passes null source filter when no source params", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async ({ source }) => {
        expect(source).toBeNull();
        return {
          queriedAtUnixMs: CLOCK_TIME,
          records: [],
          nextCursor: null
        };
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("empty history", () => {
    it("returns empty history as a collection", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toEqual([]);
      expect(body.nextCursor).toBeNull();
    });

    it("never returns 404 for empty history", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).not.toBe(404);
    });
  });

  describe("ordered non-empty items", () => {
    it("returns records in repository order", async () => {
      const records: EvidenceBundleRecord[] = [
        makeMockRecord({ id: 5, lifecycle: "EXPIRED" }),
        makeMockRecord({ id: 3, lifecycle: "STALE" }),
        makeMockRecord({ id: 7, lifecycle: "FRESH" })
      ];
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records,
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items[0].receiptId).toBe(5);
      expect(body.items[1].receiptId).toBe(3);
      expect(body.items[2].receiptId).toBe(7);
    });
  });

  describe("next cursor encoding", () => {
    it("encodes next cursor when present", async () => {
      const nextCursor = { receivedAtUnixMs: 1_699_999_999_000, id: 42 };
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 42 })],
        nextCursor
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.nextCursor).toBe(encodeEvidenceCursor(nextCursor));
    });

    it("returns null next cursor when no more records", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [makeMockRecord({ id: 1 })],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.nextCursor).toBeNull();
    });
  });

  describe("response format", () => {
    it("includes schemaVersion", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      const body = JSON.parse(response.body);
      expect(body.schemaVersion).toBe(EVIDENCE_SCHEMA_VERSION);
    });

    it("includes pair as SOL/USDC", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      const body = JSON.parse(response.body);
      expect(body.pair).toBe("SOL/USDC");
    });

    it("includes scope from query", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?scope=whirlpool&whirlpoolAddress=ABC123"
      });

      const body = JSON.parse(response.body);
      expect(body.scope.kind).toBe("whirlpool");
      expect(body.scope.whirlpoolAddress).toBe("ABC123");
    });

    it("includes queriedAt ISO timestamp", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      const body = JSON.parse(response.body);
      expect(body.queriedAt).toBe("2023-11-14T22:13:20.000Z");
    });

    it("includes effective limit", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records: [],
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history?limit=50"
      });

      const body = JSON.parse(response.body);
      expect(body.limit).toBe(50);
    });

    it("includes items array", async () => {
      const records = [makeMockRecord({ id: 1, lifecycle: "FRESH" })];
      const mockUseCase: GetEvidenceHistoryUseCase = async () => ({
        queriedAtUnixMs: CLOCK_TIME,
        records,
        nextCursor: null
      });
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].receiptId).toBe(1);
    });
  });

  describe("error handling", () => {
    it("returns 500 on unknown errors", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => {
        throw new Error("Something went wrong");
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("redacts unknown error details", async () => {
      const mockUseCase: GetEvidenceHistoryUseCase = async () => {
        throw new Error("Sensitive internal details");
      };
      const app = Fastify();
      app.get("/history", createEvidenceHistoryHandler(mockUseCase));
      await app.ready();

      const response = await app.inject({
        method: "GET",
        url: "/history"
      });

      const body = JSON.parse(response.body);
      expect(body.error.message).not.toContain("Sensitive internal details");
      expect(body.error.message).toBe("An internal error occurred");
    });
  });
});
