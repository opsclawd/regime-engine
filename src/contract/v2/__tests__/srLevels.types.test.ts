import { describe, expect, it } from "vitest";
import type { SrLevelsV2IngestRequest, SrThesisV2 } from "../srLevels.js";
import { parseSrLevelsV2IngestRequest } from "../srLevels.js";

describe("SrLevelsV2IngestRequest types", () => {
  it("compiles with the canonical wire shape", () => {
    const thesis: SrThesisV2 = {
      asset: "SOL",
      timeframe: "1d",
      bias: "bullish",
      setupType: "breakout",
      supportLevels: ["140.50"],
      resistanceLevels: ["160.00"],
      entryZone: "145-148",
      targets: ["170", "180"],
      invalidation: "<135",
      trigger: "close above 160",
      chartReference: "https://example.com/chart.png",
      sourceHandle: "@trader",
      sourceChannel: "twitter",
      sourceKind: "post",
      sourceReliability: "medium",
      rawThesisText: "raw text",
      collectedAt: "2026-04-29T13:00:00Z",
      publishedAt: "2026-04-29T12:00:00Z",
      sourceUrl: "https://x.com/trader/status/1",
      notes: null
    };
    const request: SrLevelsV2IngestRequest = {
      schemaVersion: "2.0",
      source: "macro-charts",
      symbol: "SOL",
      brief: {
        briefId: "mco-sol-2026-04-29",
        sourceRecordedAtIso: "2026-04-29T11:00:00Z",
        summary: "summary"
      },
      theses: [thesis]
    };
    expect(request.theses[0].asset).toBe("SOL");
  });

  it("parser is exported", () => {
    expect(typeof parseSrLevelsV2IngestRequest).toBe("function");
  });
});
