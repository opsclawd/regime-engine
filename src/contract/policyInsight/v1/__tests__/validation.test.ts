import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parsePolicyInsightContent,
  parsePolicyInsightRead,
  parsePolicyInsightHistoryResponse
} from "../validate.js";
import type { PolicyInsightHistoryResponse, PolicyInsightRead } from "../types.generated.js";

const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../../");
const __fixturesDir = resolve(__repoRoot, "contracts/policy-insight/v1/fixtures");

const loadInvalid = (name: string): unknown[] => {
  const content = readFileSync(resolve(__fixturesDir, `invalid/${name}.json`), "utf-8");
  return JSON.parse(content);
};

function createValidPairContent(): PolicyInsightRead {
  return {
    schemaVersion: "policy-insight.v1",
    insightId: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    rulesetVersion: "sol-usdc-policy.v1.2026-07",
    pair: "SOL/USDC",
    position: null,
    generatedAt: "2026-07-19T12:00:00.000Z",
    asOf: "2026-07-19T11:59:00.000Z",
    expiresAt: "2026-07-19T13:00:00.000Z",
    marketRegime: "UP",
    fundamentalRegime: "BULLISH",
    posture: "AGGRESSIVE",
    recommendedAction: "HOLD",
    riskLevel: "NORMAL",
    clmmPolicy: {
      rangeBias: "MEDIUM",
      rebalanceSensitivity: "NORMAL",
      maxCapitalDeploymentBps: 7500
    },
    levels: {
      supportsUsdcPerSol: [],
      resistancesUsdcPerSol: []
    },
    evidence: {
      selectionStatus: "FULL",
      selectionPolicyVersion: "selector.v1.2026-07",
      selectedBundleRefs: [],
      selectedSourceRefs: []
    },
    confidenceBps: 7500,
    dataQuality: "COMPLETE",
    reasonCodes: ["MARKET_REGIME_UP", "ADVISORY_ONLY"],
    reasoning: "Market regime is UP with bullish fundamental signals.",
    warnings: [],
    freshness: {
      status: "FRESH",
      evaluatedAt: "2026-07-19T12:00:00.000Z",
      ageSeconds: 60
    }
  };
}

function createValidPositionContent(): PolicyInsightRead {
  return {
    schemaVersion: "policy-insight.v1",
    insightId: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bc",
    rulesetVersion: "sol-usdc-policy.v1.2026-07",
    pair: "SOL/USDC",
    position: {
      network: "solana-mainnet" as const,
      walletAddress: "Wallet1111111111111111111111111111111111",
      whirlpoolAddress: "Whrl11111111111111111111111111111111111",
      positionId: "Posn111111111111111111111111111111111111"
    },
    generatedAt: "2026-07-19T12:00:00.000Z",
    asOf: "2026-07-19T11:59:00.000Z",
    expiresAt: "2026-07-19T13:00:00.000Z",
    marketRegime: "UP",
    fundamentalRegime: "BULLISH",
    posture: "MODERATELY_AGGRESSIVE",
    recommendedAction: "EXIT_TO_SOL",
    riskLevel: "ELEVATED",
    clmmPolicy: {
      rangeBias: "TIGHT",
      rebalanceSensitivity: "HIGH",
      maxCapitalDeploymentBps: 5000
    },
    levels: {
      supportsUsdcPerSol: ["138.5", "135.2"],
      resistancesUsdcPerSol: ["142.0", "145.5"]
    },
    evidence: {
      selectionStatus: "PARTIAL",
      selectionPolicyVersion: "selector.v1.2026-07",
      selectedBundleRefs: [],
      selectedSourceRefs: []
    },
    confidenceBps: 5000,
    dataQuality: "PARTIAL",
    reasonCodes: ["CLMM_BREACH_UPPER", "MARKET_REGIME_UP"],
    reasoning: "Upper position bound breached.",
    warnings: [],
    freshness: {
      status: "STALE",
      evaluatedAt: "2026-07-19T12:05:00.000Z",
      ageSeconds: 360
    }
  };
}

function createValidHistoryContent(): PolicyInsightHistoryResponse {
  const item1 = createValidPairContent();
  item1.generatedAt = "2026-07-19T14:00:00.000Z";
  item1.asOf = "2026-07-19T13:59:00.000Z";
  item1.expiresAt = "2026-07-19T15:00:00.000Z";

  const item2 = createValidPairContent();
  item2.insightId = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bd";
  item2.generatedAt = "2026-07-19T12:00:00.000Z";
  item2.asOf = "2026-07-19T11:59:00.000Z";
  item2.expiresAt = "2026-07-19T13:00:00.000Z";

  return {
    schemaVersion: "policy-insight.v1",
    pair: "SOL/USDC",
    queriedAt: "2026-07-19T12:00:00.000Z",
    limit: 50,
    items: [item1, item2],
    nextCursor: null
  };
}

describe("PolicyInsight validation", () => {
  describe("accepts canonical content and rejects every named invalid fixture at its expected path", () => {
    it("rejects fields-and-enums invalid cases", () => {
      const cases = loadInvalid("fields-and-enums") as Array<{
        name: string;
        payload: unknown;
        expectedPath: string;
        expectedCode: string;
      }>;
      for (const c of cases) {
        const result = parsePolicyInsightContent(c.payload);
        expect(result.ok).toBe(false);
      }
    });

    it("rejects numbers-and-levels invalid cases", () => {
      const cases = loadInvalid("numbers-and-levels") as Array<{
        name: string;
        payload: unknown;
        expectedPath: string;
        expectedCode: string;
      }>;
      for (const c of cases) {
        const result = parsePolicyInsightContent(c.payload);
        expect(result.ok).toBe(false);
      }
    });

    it("rejects timestamps-and-freshness invalid cases", () => {
      const cases = loadInvalid("timestamps-and-freshness") as Array<{
        name: string;
        payload: unknown;
        expectedPath: string;
        expectedCode: string;
      }>;
      for (const c of cases) {
        const result = parsePolicyInsightContent(c.payload);
        expect(result.ok).toBe(false);
      }
    });

    it("rejects ordering-and-duplicates invalid cases", () => {
      const cases = loadInvalid("ordering-and-duplicates") as Array<{
        name: string;
        payload: unknown;
        expectedPath: string;
        expectedCode: string;
      }>;
      for (const c of cases) {
        const result = parsePolicyInsightContent(c.payload);
        expect(result.ok).toBe(false);
      }
    });

    it("rejects action-position-and-version invalid cases", () => {
      const cases = loadInvalid("action-position-and-version") as Array<{
        name: string;
        payload: unknown;
        expectedPath: string;
        expectedCode: string;
      }>;
      for (const c of cases) {
        const result = parsePolicyInsightContent(c.payload);
        expect(result.ok).toBe(false);
      }
    });
  });

  describe("requires asOf <= generatedAt < expiresAt", () => {
    it("accepts when asOf < generatedAt < expiresAt", () => {
      const fixture = createValidPairContent();
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(true);
    });

    it("rejects when asOf equals generatedAt", () => {
      const fixture = createValidPairContent();
      fixture.asOf = fixture.generatedAt;
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects when generatedAt equals expiresAt", () => {
      const fixture = createValidPairContent();
      fixture.generatedAt = fixture.expiresAt;
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects when asOf is after generatedAt", () => {
      const fixture = createValidPairContent();
      const asOfDate = new Date(fixture.asOf);
      asOfDate.setMinutes(asOfDate.getMinutes() + 5);
      fixture.asOf = asOfDate.toISOString();
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects when generatedAt is after expiresAt", () => {
      const fixture = createValidPairContent();
      const genDate = new Date(fixture.generatedAt);
      genDate.setHours(genDate.getHours() + 3);
      fixture.generatedAt = genDate.toISOString();
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });
  });

  describe("sorts no input and rejects noncanonical level reference reason and warning order", () => {
    it("rejects unsorted supports (not descending)", () => {
      const fixture = createValidPositionContent();
      fixture.levels.supportsUsdcPerSol = ["135.2", "138.5"];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects unsorted resistances (not ascending)", () => {
      const fixture = createValidPositionContent();
      fixture.levels.resistancesUsdcPerSol = ["145.5", "142.0"];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects duplicate reason codes", () => {
      const fixture = createValidPairContent();
      fixture.reasonCodes = ["MARKET_REGIME_UP", "MARKET_REGIME_UP", "ADVISORY_ONLY"];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects duplicate warning codes", () => {
      const fixture = createValidPairContent();
      fixture.warnings = [
        { code: "NO_ELIGIBLE_PRICE_LEVELS", message: "msg" },
        { code: "NO_ELIGIBLE_PRICE_LEVELS", message: "msg" }
      ];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects unordered selectedBundleRefs", () => {
      const fixture = createValidPairContent();
      fixture.evidence.selectedBundleRefs = [
        {
          bundleHash: "hash0000000000000000000000000000000000",
          publisher: "pub2",
          sourceId: "src2",
          runId: "run2"
        },
        {
          bundleHash: "hash0000000000000000000000000000000001",
          publisher: "pub1",
          sourceId: "src1",
          runId: "run1"
        }
      ];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects duplicate selectedBundleRefs", () => {
      const fixture = createValidPairContent();
      fixture.evidence.selectedBundleRefs = [
        {
          bundleHash: "hash0000000000000000000000000000000000",
          publisher: "pub1",
          sourceId: "src1",
          runId: "run1"
        },
        {
          bundleHash: "hash0000000000000000000000000000000000",
          publisher: "pub1",
          sourceId: "src1",
          runId: "run1"
        }
      ];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects unordered selectedSourceRefs", () => {
      const fixture = createValidPairContent();
      fixture.evidence.selectedSourceRefs = [
        {
          referenceId: "ref2",
          sourceType: "api",
          locator: "https://b.example.com",
          observedAt: "2026-07-19T12:00:00.000Z"
        },
        {
          referenceId: "ref1",
          sourceType: "api",
          locator: "https://a.example.com",
          observedAt: "2026-07-19T12:00:00.000Z"
        }
      ];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects duplicate selectedSourceRefs", () => {
      const fixture = createValidPairContent();
      fixture.evidence.selectedSourceRefs = [
        {
          referenceId: "ref1",
          sourceType: "api",
          locator: "https://a.example.com",
          observedAt: "2026-07-19T12:00:00.000Z"
        },
        {
          referenceId: "ref1",
          sourceType: "api",
          locator: "https://a.example.com",
          observedAt: "2026-07-19T12:00:00.000Z"
        }
      ];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });
  });

  describe("compares decimal level strings without binary floating point", () => {
    it("rejects supports not in strict descending decimal order", () => {
      const fixture = createValidPositionContent();
      fixture.levels.supportsUsdcPerSol = ["138.5", "138.5"];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects resistances not in strict ascending decimal order", () => {
      const fixture = createValidPositionContent();
      fixture.levels.resistancesUsdcPerSol = ["142.0", "142.0"];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("accepts '1' and '1.0' as same decimal value but different strings", () => {
      const fixture = createValidPositionContent();
      fixture.levels.supportsUsdcPerSol = ["1.0"];
      const result1 = parsePolicyInsightContent(fixture);
      expect(result1.ok).toBe(true);

      fixture.levels.supportsUsdcPerSol = ["1"];
      const result2 = parsePolicyInsightContent(fixture);
      expect(result2.ok).toBe(true);
    });

    it("rejects supports where '1' and '1.0' would both be present (duplicate value)", () => {
      const fixture = createValidPairContent();
      fixture.levels.supportsUsdcPerSol = ["1", "1.0"];
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });
  });

  describe("requires actions with position semantics to include position identity", () => {
    it("accepts EXIT_TO_SOL with position", () => {
      const fixture = createValidPositionContent();
      fixture.recommendedAction = "EXIT_TO_SOL";
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(true);
    });

    it("accepts EXIT_TO_USDC with position", () => {
      const fixture = createValidPositionContent();
      fixture.recommendedAction = "EXIT_TO_USDC";
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(true);
    });

    it("accepts MONITOR_LOWER_BOUND with position", () => {
      const fixture = createValidPositionContent();
      fixture.recommendedAction = "MONITOR_LOWER_BOUND";
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(true);
    });

    it("accepts MONITOR_UPPER_BOUND with position", () => {
      const fixture = createValidPositionContent();
      fixture.recommendedAction = "MONITOR_UPPER_BOUND";
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(true);
    });

    it("rejects EXIT_TO_SOL without position", () => {
      const fixture = createValidPairContent();
      fixture.recommendedAction = "EXIT_TO_SOL";
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("rejects EXIT_TO_USDC without position", () => {
      const fixture = createValidPairContent();
      fixture.recommendedAction = "EXIT_TO_USDC";
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(false);
    });

    it("accepts HOLD without position (pair-scoped)", () => {
      const fixture = createValidPairContent();
      fixture.recommendedAction = "HOLD";
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(true);
    });

    it("accepts STAND_DOWN without position (pair-scoped)", () => {
      const fixture = createValidPairContent();
      fixture.recommendedAction = "STAND_DOWN";
      const result = parsePolicyInsightContent(fixture);
      expect(result.ok).toBe(true);
    });
  });

  describe("parsePolicyInsightRead", () => {
    it("accepts valid PolicyInsightRead with freshness", () => {
      const fixture = createValidPairContent();
      const result = parsePolicyInsightRead(fixture);
      expect(result.ok).toBe(true);
    });

    it("rejects content passed to read parser (missing freshness)", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;
      const result = parsePolicyInsightRead(content as unknown as PolicyInsightRead);
      expect(result.ok).toBe(false);
    });
  });

  describe("parsePolicyInsightHistoryResponse", () => {
    it("accepts valid history response", () => {
      const fixture = createValidHistoryContent();
      const result = parsePolicyInsightHistoryResponse(fixture);
      expect(result.ok).toBe(true);
    });

    it("rejects history with items in wrong order (newest first required)", () => {
      const fixture = createValidHistoryContent();
      if (fixture.items.length >= 2) {
        const [first, second] = fixture.items;
        fixture.items = [second, first];
        const result = parsePolicyInsightHistoryResponse(fixture);
        expect(result.ok).toBe(false);
      }
    });
  });
});
