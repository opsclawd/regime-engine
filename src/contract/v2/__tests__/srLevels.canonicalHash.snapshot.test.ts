import { describe, expect, it } from "vitest";
import {
  computeSrThesisV2CanonicalAndHash,
  parseSrLevelsV2IngestRequest,
  type SrLevelsV2IngestRequest,
  type SrThesisV2
} from "../srLevels.js";
import { toCanonicalJson } from "../../v1/canonical.js";

const baseThesis = (overrides: Partial<SrThesisV2> = {}): SrThesisV2 => ({
  asset: "SOL",
  timeframe: "1d",
  bias: "bullish",
  setupType: "breakout",
  supportLevels: ["140.50", "135.00"],
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
  notes: null,
  ...overrides
});

const baseRequest = (overrides: Partial<SrLevelsV2IngestRequest> = {}): SrLevelsV2IngestRequest =>
  ({
    schemaVersion: "2.0",
    source: "macro-charts",
    symbol: "SOL",
    brief: {
      briefId: "mco-sol-2026-04-29",
      sourceRecordedAtIso: "2026-04-29T11:00:00Z",
      summary: "summary"
    },
    theses: [baseThesis()],
    ...overrides
  }) as SrLevelsV2IngestRequest;

describe("computeSrThesisV2CanonicalAndHash", () => {
  it("snapshot of canonical JSON is stable", () => {
    const req = baseRequest();
    const { canonical } = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    expect(canonical).toMatchSnapshot();
  });

  it("snapshot of payload hash is stable", () => {
    const req = baseRequest();
    const { hash } = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    expect(hash).toMatchSnapshot();
  });

  it("is byte-identical across object key permutations", () => {
    const reqA = baseRequest();
    const reqB = parseSrLevelsV2IngestRequest({
      theses: [
        {
          notes: null,
          sourceUrl: "https://x.com/trader/status/1",
          publishedAt: "2026-04-29T12:00:00Z",
          collectedAt: "2026-04-29T13:00:00Z",
          rawThesisText: "raw text",
          sourceReliability: "medium",
          sourceKind: "post",
          sourceChannel: "twitter",
          sourceHandle: "@trader",
          chartReference: "https://example.com/chart.png",
          trigger: "close above 160",
          invalidation: "<135",
          targets: ["170", "180"],
          entryZone: "145-148",
          resistanceLevels: ["160.00"],
          supportLevels: ["140.50", "135.00"],
          setupType: "breakout",
          bias: "bullish",
          timeframe: "1d",
          asset: "SOL"
        }
      ],
      brief: {
        summary: "summary",
        sourceRecordedAtIso: "2026-04-29T11:00:00Z",
        briefId: "mco-sol-2026-04-29"
      },
      symbol: "SOL",
      source: "macro-charts",
      schemaVersion: "2.0"
    });
    const a = computeSrThesisV2CanonicalAndHash(reqA, reqA.theses[0]);
    const b = computeSrThesisV2CanonicalAndHash(reqB, reqB.theses[0]);
    expect(a.canonical).toBe(b.canonical);
    expect(a.hash).toBe(b.hash);
  });

  it("preserves exact non-null timestamp strings (different ISO formats produce different hashes)", () => {
    const reqNoMillis = baseRequest({
      brief: {
        briefId: "b-1",
        sourceRecordedAtIso: "2026-04-29T11:00:00Z",
        summary: null
      },
      theses: [baseThesis({ collectedAt: "2026-04-29T11:00:00Z", publishedAt: null })]
    });
    const reqWithMillis = baseRequest({
      brief: {
        briefId: "b-1",
        sourceRecordedAtIso: "2026-04-29T11:00:00.000Z",
        summary: null
      },
      theses: [baseThesis({ collectedAt: "2026-04-29T11:00:00.000Z", publishedAt: null })]
    });
    const a = computeSrThesisV2CanonicalAndHash(reqNoMillis, reqNoMillis.theses[0]);
    const b = computeSrThesisV2CanonicalAndHash(reqWithMillis, reqWithMillis.theses[0]);
    expect(a.hash).not.toBe(b.hash);
  });

  it("preserves null timestamps in the canonical output", () => {
    const req = baseRequest({
      brief: { briefId: "b-1", sourceRecordedAtIso: null, summary: null },
      theses: [baseThesis({ collectedAt: null, publishedAt: null })]
    });
    const { canonical } = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    expect(canonical).toContain('"sourceRecordedAtIso":null');
    expect(canonical).toContain('"collectedAt":null');
    expect(canonical).toContain('"publishedAt":null');
  });

  it("produces different hashes for different theses in the same request", () => {
    const req = baseRequest({
      theses: [
        baseThesis({ asset: "SOL" }),
        baseThesis({ asset: "BTC", sourceHandle: "@trader2" })
      ]
    });
    const a = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    const b = computeSrThesisV2CanonicalAndHash(req, req.theses[1]);
    expect(a.hash).not.toBe(b.hash);
  });

  it("alternative canonical JSON output uses the v1 canonical helper as a sanity check", () => {
    const req = baseRequest();
    const { canonical } = computeSrThesisV2CanonicalAndHash(req, req.theses[0]);
    const expected = toCanonicalJson({
      schemaVersion: req.schemaVersion,
      source: req.source,
      symbol: req.symbol,
      brief: req.brief,
      thesis: req.theses[0]
    });
    expect(canonical).toBe(expected);
  });
});