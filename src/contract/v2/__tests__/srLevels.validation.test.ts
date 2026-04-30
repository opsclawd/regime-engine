import { describe, expect, it } from "vitest";
import { parseSrLevelsV2IngestRequest } from "../srLevels.js";
import { V2ContractValidationError } from "../errors.js";

const validThesis = (overrides: Record<string, unknown> = {}) => ({
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: "breakout",
  supportLevels: ["140.50"],
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

const validPayload = (overrides: Record<string, unknown> = {}) => ({
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
});

const expectReject = (overrides: Record<string, unknown>): V2ContractValidationError => {
  try {
    parseSrLevelsV2IngestRequest({ ...validPayload(), ...overrides });
  } catch (err) {
    if (err instanceof V2ContractValidationError) return err;
    throw err;
  }
  throw new Error("Expected V2ContractValidationError, got success");
};

describe("parseSrLevelsV2IngestRequest — acceptance", () => {
  it("accepts the canonical fixture", () => {
    expect(() => parseSrLevelsV2IngestRequest(validPayload())).not.toThrow();
  });

  it("preserves exact inbound timestamp strings (no normalization)", () => {
    const payload = validPayload({
      brief: {
        briefId: "b1",
        sourceRecordedAtIso: "2026-04-29T11:00:00.000Z",
        summary: null
      },
      theses: [
        validThesis({
          collectedAt: "2026-04-29T13:00:00+00:00",
          publishedAt: "2026-04-29T12:00:00.500Z"
        })
      ]
    });
    const parsed = parseSrLevelsV2IngestRequest(payload);
    expect(parsed.brief.sourceRecordedAtIso).toBe("2026-04-29T11:00:00.000Z");
    expect(parsed.theses[0].collectedAt).toBe("2026-04-29T13:00:00+00:00");
    expect(parsed.theses[0].publishedAt).toBe("2026-04-29T12:00:00.500Z");
  });

  it("accepts null sourceRecordedAtIso, summary, collectedAt, publishedAt", () => {
    const payload = validPayload({
      brief: { briefId: "b1", sourceRecordedAtIso: null, summary: null },
      theses: [validThesis({ collectedAt: null, publishedAt: null })]
    });
    const parsed = parseSrLevelsV2IngestRequest(payload);
    expect(parsed.brief.sourceRecordedAtIso).toBeNull();
    expect(parsed.brief.summary).toBeNull();
    expect(parsed.theses[0].collectedAt).toBeNull();
    expect(parsed.theses[0].publishedAt).toBeNull();
  });

  it("accepts empty supportLevels / resistanceLevels / targets arrays", () => {
    const payload = validPayload({
      theses: [validThesis({ supportLevels: [], resistanceLevels: [], targets: [] })]
    });
    expect(() => parseSrLevelsV2IngestRequest(payload)).not.toThrow();
  });
});

describe("parseSrLevelsV2IngestRequest — rejections", () => {
  it("rejects schemaVersion !== '2.0' with UNSUPPORTED_SCHEMA_VERSION", () => {
    const err = expectReject({ schemaVersion: "1.0" });
    expect(err.statusCode).toBe(400);
    expect(err.response.error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect(err.response.schemaVersion).toBe("2.0");
  });

  it("rejects missing source", () => {
    const err = expectReject({ source: undefined });
    expect(err.response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty source", () => {
    expect(expectReject({ source: "" }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing symbol", () => {
    expect(expectReject({ symbol: undefined }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing brief", () => {
    expect(expectReject({ brief: undefined }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty theses array", () => {
    expect(expectReject({ theses: [] }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing required thesis fields (asset, timeframe, sourceHandle, sourceKind)", () => {
    for (const field of ["asset", "timeframe", "sourceHandle", "sourceKind"] as const) {
      const t: Record<string, unknown> = validThesis();
      delete t[field];
      expect(expectReject({ theses: [t] }).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects empty required thesis strings", () => {
    for (const field of ["asset", "timeframe", "sourceHandle", "sourceKind"] as const) {
      const t = validThesis({ [field]: "" });
      expect(expectReject({ theses: [t] }).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects nullable scalars when absent (must be present, may be null)", () => {
    for (const field of [
      "bias",
      "setupType",
      "entryZone",
      "invalidation",
      "trigger",
      "chartReference",
      "sourceChannel",
      "sourceReliability",
      "rawThesisText",
      "collectedAt",
      "publishedAt",
      "sourceUrl",
      "notes"
    ] as const) {
      const t: Record<string, unknown> = validThesis();
      delete t[field];
      expect(expectReject({ theses: [t] }).response.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects bad ISO timestamps (sourceRecordedAtIso, collectedAt, publishedAt)", () => {
    expect(
      expectReject({
        brief: { briefId: "b1", sourceRecordedAtIso: "yesterday", summary: null }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({ theses: [validThesis({ collectedAt: "yesterday" })] }).response.error.code
    ).toBe("VALIDATION_ERROR");
    expect(
      expectReject({ theses: [validThesis({ publishedAt: "tomorrow" })] }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(expectReject({ extra: 1 }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown thesis keys (strict)", () => {
    const t = { ...validThesis(), surprise: 1 };
    expect(expectReject({ theses: [t] }).response.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unknown brief keys (strict)", () => {
    expect(
      expectReject({
        brief: {
          briefId: "b1",
          sourceRecordedAtIso: null,
          summary: null,
          extra: 1
        }
      }).response.error.code
    ).toBe("VALIDATION_ERROR");
  });

  it("rejects duplicate thesis identities in one request", () => {
    const dup = validThesis({ asset: "SOL", sourceHandle: "@trader" });
    const err = expectReject({ theses: [validThesis(), dup] });
    expect(err.response.error.code).toBe("VALIDATION_ERROR");
    expect(err.response.error.details[0].path).toBe("$.theses[1]");
    expect(err.response.error.details[0].message).toMatch(/Duplicate/i);
  });

  it("rejects duplicate identities even when payloads are otherwise identical", () => {
    const t = validThesis();
    expect(expectReject({ theses: [t, t] }).response.error.code).toBe("VALIDATION_ERROR");
  });
});
