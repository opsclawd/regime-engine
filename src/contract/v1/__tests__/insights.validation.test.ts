import { describe, expect, it } from "vitest";
import { parseInsightIngestRequest } from "../insights.js";
import { ContractValidationError } from "../../../http/errors.js";

const validPayload = () => ({
  schemaVersion: "1.0",
  pair: "SOL/USDC",
  asOf: "2026-04-27T13:00:00Z",
  source: "openclaw",
  runId: "clmm-daily-sol-usdc-insight-2026-04-27",
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
  levels: {
    support: [138.5, 132.0],
    resistance: [154.0, 162.0]
  },
  reasoning: ["SOL volatility expanded.", "Range is near upper edge."],
  sourceRefs: ["openclaw:clmm-daily-sol-usdc-insight"],
  expiresAt: "2026-04-28T13:00:00Z"
});

const expectReject = (overrides: Record<string, unknown>): ContractValidationError => {
  const payload = { ...validPayload(), ...overrides };
  try {
    parseInsightIngestRequest(payload);
  } catch (err) {
    if (err instanceof ContractValidationError) return err;
    throw err;
  }
  throw new Error("Expected ContractValidationError, got success");
};

describe("parseInsightIngestRequest — acceptance", () => {
  it("accepts the canonical fixture", () => {
    expect(() => parseInsightIngestRequest(validPayload())).not.toThrow();
  });

  it("accepts an empty support array if resistance has at least one level", () => {
    const payload = { ...validPayload(), levels: { support: [], resistance: [150] } };
    expect(() => parseInsightIngestRequest(payload)).not.toThrow();
  });

  it("accepts an empty resistance array if support has at least one level", () => {
    const payload = { ...validPayload(), levels: { support: [140], resistance: [] } };
    expect(() => parseInsightIngestRequest(payload)).not.toThrow();
  });
});

describe("parseInsightIngestRequest — rejections", () => {
  it("rejects schemaVersion !== 1.0 with UNSUPPORTED_SCHEMA_VERSION", () => {
    const err = expectReject({ schemaVersion: "0.9" });
    expect(err.statusCode).toBe(400);
    expect(err.response.error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });

  it("rejects pair other than SOL/USDC", () => {
    const err = expectReject({ pair: "ETH/USDC" });
    expect(err.statusCode).toBe(400);
    expect(err.response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown source values", () => {
    expect(expectReject({ source: "manual" }).response.error.code).toBe("VALIDATION_ERROR");
    expect(expectReject({ source: "" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty runId", () => {
    expect(expectReject({ runId: "" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects runId over 256 chars", () => {
    expect(expectReject({ runId: "x".repeat(257) }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects asOf that is not ISO 8601", () => {
    expect(expectReject({ asOf: "April 27" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects expiresAt that is not ISO 8601", () => {
    expect(expectReject({ expiresAt: "next week" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects expiresAt <= asOf", () => {
    expect(
      expectReject({
        asOf: "2026-04-28T00:00:00Z",
        expiresAt: "2026-04-27T00:00:00Z"
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects marketRegime that violates snake_case regex", () => {
    expect(expectReject({ marketRegime: "Uppercase" }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
    expect(expectReject({ marketRegime: "1leading_digit" }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
    expect(expectReject({ marketRegime: "has-dash" }).response.error.code).toBe("VALIDATION_ERROR");
    expect(expectReject({ marketRegime: "" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects fundamentalRegime that violates snake_case regex", () => {
    expect(expectReject({ fundamentalRegime: "Constructive" }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects unknown recommendedAction", () => {
    expect(expectReject({ recommendedAction: "yolo" }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects unknown confidence / riskLevel / dataQuality", () => {
    expect(expectReject({ confidence: "extreme" }).response.error.code).toBe("VALIDATION_ERROR");
    expect(expectReject({ riskLevel: "minor" }).response.error.code).toBe("VALIDATION_ERROR");
    expect(expectReject({ dataQuality: "missing" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown clmmPolicy enums", () => {
    expect(
      expectReject({
        clmmPolicy: {
          posture: "ultra",
          rangeBias: "wide",
          rebalanceSensitivity: "high",
          maxCapitalDeploymentPercent: 50
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({
        clmmPolicy: {
          posture: "defensive",
          rangeBias: "ultra",
          rebalanceSensitivity: "high",
          maxCapitalDeploymentPercent: 50
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({
        clmmPolicy: {
          posture: "defensive",
          rangeBias: "wide",
          rebalanceSensitivity: "ultra",
          maxCapitalDeploymentPercent: 50
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects maxCapitalDeploymentPercent outside [0, 100]", () => {
    expect(
      expectReject({
        clmmPolicy: {
          posture: "defensive",
          rangeBias: "wide",
          rebalanceSensitivity: "high",
          maxCapitalDeploymentPercent: -1
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({
        clmmPolicy: {
          posture: "defensive",
          rangeBias: "wide",
          rebalanceSensitivity: "high",
          maxCapitalDeploymentPercent: 101
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects when both support and resistance arrays are empty", () => {
    expect(expectReject({ levels: { support: [], resistance: [] } }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects negative or zero level prices", () => {
    expect(expectReject({ levels: { support: [-1], resistance: [] } }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
    expect(expectReject({ levels: { support: [0], resistance: [] } }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects too many reasoning entries or over-length entries", () => {
    expect(
      expectReject({ reasoning: Array.from({ length: 17 }, () => "x") }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(expectReject({ reasoning: ["x".repeat(1025)] }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
    expect(expectReject({ reasoning: [""] }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects too many sourceRefs entries or over-length entries", () => {
    expect(
      expectReject({ sourceRefs: Array.from({ length: 17 }, () => "x") }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(expectReject({ sourceRefs: ["x".repeat(513)] }).response.error.code).toBe(
      "VALIDATION_ERROR"
    );
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(
      expectReject({ extraField: true } as unknown as Record<string, unknown>).response.error.code
    ).toBe("VALIDATION_ERROR");
  });
});
