import { describe, expect, it } from "vitest";
import { projectPolicyInsightRead, projectPolicyInsightHistoryResponse } from "../project.js";
import { parsePolicyInsightContent } from "../validate.js";
import type { PolicyInsightContent, PolicyInsightRead } from "../types.generated.js";

function toUnixMs(iso: string): number {
  return new Date(iso).getTime();
}

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

describe("PolicyInsight projection", () => {
  describe("marks freshness fresh immediately before expiry", () => {
    it("evaluatedAt < expiresAt yields FRESH", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const parseResult = parsePolicyInsightContent(fixture);
      expect(parseResult.ok).toBe(true);

      const expiresAtMs = toUnixMs(fixture.expiresAt);
      const evaluatedAtMs = expiresAtMs - 1;

      const result = projectPolicyInsightRead(content as PolicyInsightContent, evaluatedAtMs);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness.status).toBe("FRESH");
      }
    });
  });

  describe("marks freshness stale at exact expiry", () => {
    it("evaluatedAt equals expiresAt yields STALE", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const expiresAtMs = toUnixMs(fixture.expiresAt);
      const result = projectPolicyInsightRead(content as PolicyInsightContent, expiresAtMs);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness.status).toBe("STALE");
      }
    });
  });

  describe("marks freshness stale after expiry", () => {
    it("evaluatedAt > expiresAt yields STALE", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const expiresAtMs = toUnixMs(fixture.expiresAt);
      const evaluatedAtMs = expiresAtMs + 1;

      const result = projectPolicyInsightRead(content as PolicyInsightContent, evaluatedAtMs);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness.status).toBe("STALE");
      }
    });
  });

  describe("computes nonnegative floored age seconds from asOf", () => {
    it("rejects negative age (evaluatedAt before asOf)", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const asOfMs = toUnixMs(fixture.asOf);
      const evaluatedAtMs = asOfMs - 1000;

      const result = projectPolicyInsightRead(content as PolicyInsightContent, evaluatedAtMs);
      expect(result.ok).toBe(false);
    });

    it("computes correct ageSeconds floor deterministically", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const asOfMs = toUnixMs(fixture.asOf);
      const evaluatedAtMs = asOfMs + 6500;

      const result = projectPolicyInsightRead(content as PolicyInsightContent, evaluatedAtMs);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness.ageSeconds).toBe(6);
      }
    });

    it("ageSeconds floors fractional seconds deterministically", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const asOfMs = toUnixMs(fixture.asOf);
      const evaluatedAtMs = asOfMs + 5999;

      const result = projectPolicyInsightRead(content as PolicyInsightContent, evaluatedAtMs);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.freshness.ageSeconds).toBe(5);
      }
    });
  });

  describe("uses one evaluatedAt for every projected history item", () => {
    it("uses supplied query instant for queriedAt and every item", () => {
      const content1 = createValidPairContent();
      const content2 = createValidPairContent();
      content2.generatedAt = "2026-07-19T10:00:00.000Z";
      content2.asOf = "2026-07-19T09:59:00.000Z";
      content2.expiresAt = "2026-07-19T11:00:00.000Z";

      const contents = [content1, content2].map((c) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { freshness, ...content } = c;
        return content as PolicyInsightContent;
      });
      const queryInstantMs = toUnixMs("2026-07-19T14:00:00.000Z");

      const result = projectPolicyInsightHistoryResponse(contents, 50, null, queryInstantMs);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.queriedAt).toBe("2026-07-19T14:00:00.000Z");
        for (const item of result.value.items) {
          expect(item.freshness.evaluatedAt).toBe("2026-07-19T14:00:00.000Z");
        }
      }
    });

    it("projects history response with limit", () => {
      const content1 = createValidPairContent();
      const content2 = createValidPairContent();
      content2.generatedAt = "2026-07-19T10:00:00.000Z";
      content2.asOf = "2026-07-19T09:59:00.000Z";
      content2.expiresAt = "2026-07-19T11:00:00.000Z";

      const contents = [content1, content2].map((c) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { freshness, ...content } = c;
        return content as PolicyInsightContent;
      });
      const queryInstantMs = toUnixMs("2026-07-19T12:00:00.000Z");

      const result = projectPolicyInsightHistoryResponse(contents, 1, null, queryInstantMs);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items.length).toBeLessThanOrEqual(1);
        expect(result.value.limit).toBe(1);
      }
    });
  });

  describe("invalid read instant", () => {
    it("rejects negative evaluatedAt", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const result = projectPolicyInsightRead(content as PolicyInsightContent, -1);
      expect(result.ok).toBe(false);
    });

    it("rejects non-integer evaluatedAt", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const result = projectPolicyInsightRead(content as PolicyInsightContent, 123.456);
      expect(result.ok).toBe(false);
    });
  });

  describe("position-scoped read projection", () => {
    it("projects position-scoped insight correctly", () => {
      const fixture = createValidPositionContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const evaluatedAtMs = toUnixMs(fixture.expiresAt) - 1;

      const result = projectPolicyInsightRead(content as PolicyInsightContent, evaluatedAtMs);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.position).not.toBeNull();
      }
    });
  });
});
