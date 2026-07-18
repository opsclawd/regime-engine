/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SCHEMA_VERSION,
  EVIDENCE_BODY_LIMIT_BYTES,
  EvidenceHttpValidationError,
  parseEvidenceCurrentQuery,
  parseEvidenceHistoryQuery,
  encodeEvidenceCursor,
  decodeEvidenceCursor,
  toEvidenceWireItem,
  evidenceErrorResponse
} from "../evidenceHttp.js";
import type { EvidenceBundleRecord } from "../../../application/ports/evidenceBundleRepositoryPort.js";

const MOCK_BUNDLE = {
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

const createMockRecord = (overrides: Partial<EvidenceBundleRecord> = {}): EvidenceBundleRecord =>
  ({
    id: 1,
    bundle: MOCK_BUNDLE,
    evidenceHash: "hash-abc123",
    receivedAtUnixMs: 1_700_000_000_000,
    lifecycle: "FRESH",
    ...overrides
  }) as EvidenceBundleRecord;

describe("evidenceHttp", () => {
  describe("constants", () => {
    it("exports EVIDENCE_SCHEMA_VERSION", () => {
      expect(EVIDENCE_SCHEMA_VERSION).toBe("evidence-bundle.v1");
    });

    it("exports EVIDENCE_BODY_LIMIT_BYTES as 4MB", () => {
      expect(EVIDENCE_BODY_LIMIT_BYTES).toBe(4 * 1024 * 1024);
    });
  });

  describe("constructs exactly one evidence scope", () => {
    it("pair scope is default when no scope parameters provided", () => {
      const result = parseEvidenceCurrentQuery({});
      expect(result.scope).toEqual({ kind: "pair" });
    });

    it("pair scope is default when empty scope param provided", () => {
      const result = parseEvidenceCurrentQuery({ scope: "" });
      expect(result.scope).toEqual({ kind: "pair" });
    });

    it("constructs pair scope explicitly", () => {
      const result = parseEvidenceCurrentQuery({ scope: "pair" });
      expect(result.scope).toEqual({ kind: "pair" });
    });

    it("constructs whirlpool scope with whirlpoolAddress", () => {
      const result = parseEvidenceCurrentQuery({
        scope: "whirlpool",
        whirlpoolAddress: "Whabc123xyz"
      });
      expect(result.scope).toEqual({
        kind: "whirlpool",
        network: "solana-mainnet",
        whirlpoolAddress: "Whabc123xyz"
      });
    });

    it("constructs wallet scope with walletAddress", () => {
      const result = parseEvidenceCurrentQuery({
        scope: "wallet",
        walletAddress: "Walabc123xyz"
      });
      expect(result.scope).toEqual({
        kind: "wallet",
        network: "solana-mainnet",
        walletAddress: "Walabc123xyz"
      });
    });

    it("constructs position scope with walletAddress, whirlpoolAddress, and positionId", () => {
      const result = parseEvidenceCurrentQuery({
        scope: "position",
        walletAddress: "Walabc123xyz",
        whirlpoolAddress: "Whabc123xyz",
        positionId: "Pos123"
      });
      expect(result.scope).toEqual({
        kind: "position",
        network: "solana-mainnet",
        walletAddress: "Walabc123xyz",
        whirlpoolAddress: "Whabc123xyz",
        positionId: "Pos123"
      });
    });

    it("rejects whirlpool scope without whirlpoolAddress", () => {
      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "whirlpool"
        })
      ).toThrow(EvidenceHttpValidationError);
    });

    it("rejects wallet scope without walletAddress", () => {
      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "wallet"
        })
      ).toThrow(EvidenceHttpValidationError);
    });

    it("rejects position scope without required parameters", () => {
      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "position",
          walletAddress: "Walabc123xyz"
        })
      ).toThrow(EvidenceHttpValidationError);

      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "position",
          whirlpoolAddress: "Whabc123xyz"
        })
      ).toThrow(EvidenceHttpValidationError);

      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "position",
          positionId: "Pos123"
        })
      ).toThrow(EvidenceHttpValidationError);
    });

    it("rejects unknown scope kind", () => {
      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "unknown" as any
        })
      ).toThrow(EvidenceHttpValidationError);
    });
  });

  describe("rejects unknown repeated empty and inapplicable parameters", () => {
    it("rejects unknown top-level query parameters for current", () => {
      expect(() => parseEvidenceCurrentQuery({ unknownParam: "value" } as any)).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects repeated parameters (arrays) for current query", () => {
      expect(() => parseEvidenceCurrentQuery({ scope: ["pair", "whirlpool"] } as any)).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects unknown top-level query parameters for history", () => {
      expect(() => parseEvidenceHistoryQuery({ unknownParam: "value" } as any)).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects repeated parameters (arrays) for history query", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: [10, 20] } as any)).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects empty string scope that is not empty", () => {
      expect(() => parseEvidenceCurrentQuery({ scope: "   " })).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects inapplicable parameters for pair scope", () => {
      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "pair",
          whirlpoolAddress: "Whabc123xyz"
        })
      ).toThrow(EvidenceHttpValidationError);
    });

    it("rejects inapplicable parameters for whirlpool scope", () => {
      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "whirlpool",
          whirlpoolAddress: "Whabc123xyz",
          walletAddress: "Walabc123xyz"
        })
      ).toThrow(EvidenceHttpValidationError);
    });
  });

  describe("defaults history limit to thirty and bounds it at one hundred", () => {
    it("defaults limit to 30 when not provided", () => {
      const result = parseEvidenceHistoryQuery({});
      expect(result.limit).toBe(30);
    });

    it("defaults limit to 30 when undefined", () => {
      const result = parseEvidenceHistoryQuery({ limit: undefined });
      expect(result.limit).toBe(30);
    });

    it("accepts limit between 1 and 100", () => {
      expect(parseEvidenceHistoryQuery({ limit: 1 }).limit).toBe(1);
      expect(parseEvidenceHistoryQuery({ limit: 50 }).limit).toBe(50);
      expect(parseEvidenceHistoryQuery({ limit: 100 }).limit).toBe(100);
    });

    it("rejects limit less than 1", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: 0 })).toThrow(EvidenceHttpValidationError);
    });

    it("rejects limit greater than 100", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: 101 })).toThrow(EvidenceHttpValidationError);
    });

    it("rejects non-integer limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: 10.5 })).toThrow(EvidenceHttpValidationError);
    });

    it("rejects decimal string limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: "10.5" as any })).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects negative limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: -1 })).toThrow(EvidenceHttpValidationError);
    });

    it("rejects NaN limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: NaN })).toThrow(EvidenceHttpValidationError);
    });

    it("rejects whitespace-only string limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: "   " as any })).toThrow(
        EvidenceHttpValidationError
      );
    });
  });

  describe("round trips only versioned opaque history cursors", () => {
    it("round trips a valid cursor", () => {
      const cursor = { receivedAtUnixMs: 1_700_000_000_500, id: 42 };
      const encoded = encodeEvidenceCursor(cursor);
      const decoded = decodeEvidenceCursor(encoded);
      expect(decoded).toEqual(cursor);
    });

    it("round trips cursor with minimum values", () => {
      const cursor = { receivedAtUnixMs: 0, id: 1 };
      const encoded = encodeEvidenceCursor(cursor);
      const decoded = decodeEvidenceCursor(encoded);
      expect(decoded).toEqual(cursor);
    });

    it("round trips cursor with maximum safe integer values", () => {
      const cursor = {
        receivedAtUnixMs: Number.MAX_SAFE_INTEGER,
        id: Number.MAX_SAFE_INTEGER
      };
      const encoded = encodeEvidenceCursor(cursor);
      const decoded = decodeEvidenceCursor(encoded);
      expect(decoded).toEqual(cursor);
    });

    it("rejects cursor without version field", () => {
      const cursor = { receivedAtUnixMs: 1_700_000_000_500, id: 42 };
      const json = JSON.stringify(cursor);
      const encoded = Buffer.from(json, "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor with unsupported version", () => {
      const cursor = { v: 2, receivedAtUnixMs: 1_700_000_000_500, id: 42 };
      const json = JSON.stringify(cursor);
      const encoded = Buffer.from(json, "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor with non-integer receivedAtUnixMs", () => {
      const cursor = { v: 1, receivedAtUnixMs: 1_700_000_000_500.5, id: 42 };
      const encoded = encodeEvidenceCursor(cursor as any);
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor with negative receivedAtUnixMs", () => {
      const cursor = { v: 1, receivedAtUnixMs: -1, id: 42 };
      const encoded = encodeEvidenceCursor(cursor as any);
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor with non-positive integer id", () => {
      const cursor = { v: 1, receivedAtUnixMs: 1_700_000_000_500, id: 0 };
      const encoded = encodeEvidenceCursor(cursor as any);
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);

      const cursor2 = { v: 1, receivedAtUnixMs: 1_700_000_000_500, id: -1 };
      const encoded2 = encodeEvidenceCursor(cursor2 as any);
      expect(() => decodeEvidenceCursor(encoded2)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor with non-integer id", () => {
      const cursor = { v: 1, receivedAtUnixMs: 1_700_000_000_500, id: 42.5 };
      const encoded = encodeEvidenceCursor(cursor as any);
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor with extra fields", () => {
      const cursor = {
        v: 1,
        receivedAtUnixMs: 1_700_000_000_500,
        id: 42,
        extra: "field"
      };
      const json = JSON.stringify(cursor);
      const encoded = Buffer.from(json, "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects non-base64url characters", () => {
      expect(() => decodeEvidenceCursor("abc123+/==")).toThrow(EvidenceHttpValidationError);
    });

    it("rejects valid base64 but invalid JSON", () => {
      const invalid = Buffer.from("not json", "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(invalid)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor that decodes to array instead of object", () => {
      const invalid = Buffer.from("[]", "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(invalid)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor that decodes to string instead of object", () => {
      const invalid = Buffer.from('"string"', "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(invalid)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor with non-canonical encoding (different JSON stringify output)", () => {
      const cursor = { id: 1, v: 1, receivedAtUnixMs: 1000 };
      const json = JSON.stringify(cursor);
      const encoded = Buffer.from(json, "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });
  });

  describe("identifier length 1..128", () => {
    it("accepts identifier with exactly 1 character", () => {
      const result = parseEvidenceCurrentQuery({
        scope: "whirlpool",
        whirlpoolAddress: "a"
      });
      expect((result.scope as any).whirlpoolAddress).toBe("a");
    });

    it("accepts identifier with exactly 128 characters", () => {
      const id128 = "a".repeat(128);
      const result = parseEvidenceCurrentQuery({
        scope: "whirlpool",
        whirlpoolAddress: id128
      });
      expect((result.scope as any).whirlpoolAddress).toBe(id128);
    });

    it("rejects identifier with 0 characters (empty string)", () => {
      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "whirlpool",
          whirlpoolAddress: ""
        })
      ).toThrow(EvidenceHttpValidationError);
    });

    it("rejects identifier with more than 128 characters", () => {
      const id129 = "a".repeat(129);
      expect(() =>
        parseEvidenceCurrentQuery({
          scope: "whirlpool",
          whirlpoolAddress: id129
        })
      ).toThrow(EvidenceHttpValidationError);
    });
  });

  describe("cursor safe integers", () => {
    it("accepts cursor with safe integer id", () => {
      const cursor = { receivedAtUnixMs: 1_700_000_000_500, id: 42 };
      const encoded = encodeEvidenceCursor(cursor);
      const decoded = decodeEvidenceCursor(encoded);
      expect(decoded.id).toBe(42);
    });

    it("rejects cursor with id exceeding MAX_SAFE_INTEGER", () => {
      const cursor = {
        v: 1,
        receivedAtUnixMs: 1_700_000_000_500,
        id: Number.MAX_SAFE_INTEGER + 1
      };
      const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects cursor with receivedAtUnixMs exceeding MAX_SAFE_INTEGER", () => {
      const cursor = {
        v: 1,
        receivedAtUnixMs: Number.MAX_SAFE_INTEGER + 1,
        id: 42
      };
      const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });
  });

  describe("positive ID", () => {
    it("accepts positive integer id", () => {
      const cursor = { receivedAtUnixMs: 1_700_000_000_500, id: 1 };
      const encoded = encodeEvidenceCursor(cursor);
      const decoded = decodeEvidenceCursor(encoded);
      expect(decoded.id).toBe(1);
    });

    it("rejects zero id", () => {
      const cursor = { v: 1, receivedAtUnixMs: 1_700_000_000_500, id: 0 };
      const json = JSON.stringify(cursor);
      const encoded = Buffer.from(json, "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects negative id", () => {
      const cursor = { v: 1, receivedAtUnixMs: 1_700_000_000_500, id: -1 };
      const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });
  });

  describe("exact keys", () => {
    it("only accepts v, receivedAtUnixMs, and id keys in cursor", () => {
      const validCursor = { receivedAtUnixMs: 1_700_000_000_500, id: 42 };
      const encoded = encodeEvidenceCursor(validCursor);
      const decoded = decodeEvidenceCursor(encoded);
      expect(Object.keys(decoded).sort()).toEqual(["id", "receivedAtUnixMs"]);
    });

    it("rejects cursor with additional numeric keys", () => {
      const cursor = {
        v: 1,
        receivedAtUnixMs: 1_700_000_000_500,
        id: 42,
        0: "numeric key"
      };
      const encoded = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
      expect(() => decodeEvidenceCursor(encoded)).toThrow(EvidenceHttpValidationError);
    });
  });

  describe("base64url alphabet", () => {
    it("accepts base64url characters in encoded cursor", () => {
      const cursor = { receivedAtUnixMs: 1_700_000_000_500, id: 42 };
      const encoded = encodeEvidenceCursor(cursor);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("rejects standard base64 with + and / characters", () => {
      const invalidBase64 = "abc+def/ghi==";
      expect(() => decodeEvidenceCursor(invalidBase64)).toThrow(EvidenceHttpValidationError);
    });

    it("rejects base64 with = padding only", () => {
      const invalidBase64 = "===";
      expect(() => decodeEvidenceCursor(invalidBase64)).toThrow(EvidenceHttpValidationError);
    });
  });

  describe("current rejecting limit/cursor", () => {
    it("rejects limit parameter in current query", () => {
      expect(() => parseEvidenceCurrentQuery({ limit: 10 } as any)).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects cursor parameter in current query", () => {
      expect(() => parseEvidenceCurrentQuery({ cursor: "abc123" } as any)).toThrow(
        EvidenceHttpValidationError
      );
    });
  });

  describe("history integer syntax", () => {
    it("accepts string integer limit", () => {
      const result = parseEvidenceHistoryQuery({ limit: "50" as any });
      expect(result.limit).toBe(50);
    });

    it("rejects decimal string limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: "10.5" as any })).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects sign prefix in limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: "+10" as any })).toThrow(
        EvidenceHttpValidationError
      );

      expect(() => parseEvidenceHistoryQuery({ limit: "-10" as any })).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects whitespace in limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: " 10" as any })).toThrow(
        EvidenceHttpValidationError
      );

      expect(() => parseEvidenceHistoryQuery({ limit: "10 " as any })).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects NaN string limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: "NaN" as any })).toThrow(
        EvidenceHttpValidationError
      );
    });

    it("rejects empty string limit", () => {
      expect(() => parseEvidenceHistoryQuery({ limit: "" as any })).toThrow(
        EvidenceHttpValidationError
      );
    });
  });

  describe("source filters", () => {
    it("accepts source.publisher filter", () => {
      const result = parseEvidenceCurrentQuery({
        "source.publisher": "test-publisher"
      });
      expect(result.sourceFilter?.publisher).toBe("test-publisher");
    });

    it("accepts source.sourceId filter", () => {
      const result = parseEvidenceCurrentQuery({
        "source.sourceId": "test-source-id"
      });
      expect(result.sourceFilter?.sourceId).toBe("test-source-id");
    });

    it("accepts both source filters", () => {
      const result = parseEvidenceCurrentQuery({
        "source.publisher": "pub",
        "source.sourceId": "src"
      });
      expect(result.sourceFilter?.publisher).toBe("pub");
      expect(result.sourceFilter?.sourceId).toBe("src");
    });

    it("rejects unknown source field", () => {
      expect(() =>
        parseEvidenceCurrentQuery({
          "source.unknown": "value"
        })
      ).toThrow(EvidenceHttpValidationError);
    });

    it("rejects array value for source.publisher", () => {
      expect(() =>
        parseEvidenceCurrentQuery({
          "source.publisher": ["a", "b"] as any
        })
      ).toThrow(EvidenceHttpValidationError);
    });
  });

  describe("toEvidenceWireItem", () => {
    it("transforms record to wire format with bundle, evidenceHash, receiptId, receivedAt, and freshness", () => {
      const record = createMockRecord({
        id: 42,
        evidenceHash: "hash-xyz",
        receivedAtUnixMs: 1_701_000_000_000
      });

      const wireItem = toEvidenceWireItem(record);

      expect(wireItem.bundle).toEqual(record.bundle);
      expect(wireItem.evidenceHash).toBe("hash-xyz");
      expect(wireItem.receiptId).toBe(42);
      expect(wireItem.receivedAt).toBe("2023-11-26T12:00:00.000Z");
      expect(wireItem.freshness).toEqual({
        status: "FRESH",
        asOf: "2026-04-29T12:00:00Z",
        freshUntil: "2026-04-29T18:00:00Z",
        expiresAt: "2026-04-30T12:00:00Z"
      });
    });

    it("handles STALE lifecycle", () => {
      const record = createMockRecord({
        lifecycle: "STALE"
      });

      const wireItem = toEvidenceWireItem(record);
      expect(wireItem.freshness.status).toBe("STALE");
    });

    it("handles EXPIRED lifecycle", () => {
      const record = createMockRecord({
        lifecycle: "EXPIRED"
      });

      const wireItem = toEvidenceWireItem(record);
      expect(wireItem.freshness.status).toBe("EXPIRED");
    });
  });

  describe("evidenceErrorResponse", () => {
    it("creates error response with VALIDATION_ERROR code", () => {
      const error = new EvidenceHttpValidationError("Invalid query parameters", [
        { path: "$.scope", code: "INVALID_VALUE", message: "Invalid scope" }
      ]);

      const response = evidenceErrorResponse(error);

      expect(response.schemaVersion).toBe("evidence-bundle.v1");
      expect(response.error.code).toBe("VALIDATION_ERROR");
      expect(response.error.message).toBe("Invalid query parameters");
      expect(response.error.details).toHaveLength(1);
      expect(response.error.details[0].path).toBe("$.scope");
    });

    it("creates error response with custom error code when provided", () => {
      const error = new EvidenceHttpValidationError(
        "Service unavailable",
        [],
        "SERVICE_UNAVAILABLE"
      );

      const response = evidenceErrorResponse(error);

      expect(response.error.code).toBe("SERVICE_UNAVAILABLE");
    });
  });

  describe("EvidenceHttpValidationError", () => {
    it("can be instantiated with message and details", () => {
      const error = new EvidenceHttpValidationError("test message", [
        { path: "$.field", code: "INVALID", message: "Invalid" }
      ]);

      expect(error.message).toBe("test message");
      expect(error.details).toHaveLength(1);
      expect(error.statusCode).toBe(400);
    });

    it("can be instantiated with custom error code", () => {
      const error = new EvidenceHttpValidationError("test", [], "CUSTOM_ERROR");

      expect(error.errorCode).toBe("CUSTOM_ERROR");
    });
  });

  describe("decodeEvidenceCursor", () => {
    it("is exported and works as inverse of encodeEvidenceCursor", () => {
      const original = { receivedAtUnixMs: 1_700_000_000_500, id: 99 };
      const encoded = encodeEvidenceCursor(original);
      const decoded = decodeEvidenceCursor(encoded);
      expect(decoded).toEqual(original);
    });
  });
});
