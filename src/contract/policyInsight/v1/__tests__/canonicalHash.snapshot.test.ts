import { describe, expect, it } from "vitest";
import { computePolicyInsightContentCanonicalAndHash } from "../canonical.js";
import { parsePolicyInsightContent } from "../validate.js";
import type { PolicyInsightContent, PolicyInsightRead } from "../types.generated.js";

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

describe("PolicyInsight canonical hash", () => {
  describe("hashed immutable content without freshness", () => {
    it("changing the read instant never changes content canonical JSON/hash", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const { canonical, hash } = computePolicyInsightContentCanonicalAndHash(
        content as PolicyInsightContent
      );
      expect(canonical).toBeDefined();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      const modified = {
        ...fixture,
        freshness: { status: "STALE", evaluatedAt: "2099-01-01T00:00:00.000Z", ageSeconds: 999999 }
      };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness: f2, ...content2 } = modified;
      const { canonical: canonical2, hash: hash2 } = computePolicyInsightContentCanonicalAndHash(
        content2 as PolicyInsightContent
      );

      expect(canonical).toBe(canonical2);
      expect(hash).toBe(hash2);
    });

    it("object-key order does not matter for canonical JSON", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const result1 = computePolicyInsightContentCanonicalAndHash(content as PolicyInsightContent);

      const shuffled = shuffleKeys(content);
      const result2 = computePolicyInsightContentCanonicalAndHash(shuffled as PolicyInsightContent);

      expect(result1.canonical).toBe(result2.canonical);
      expect(result1.hash).toBe(result2.hash);
    });
  });

  describe("canonical JSON snapshots", () => {
    it("current-pair fixture produces stable canonical JSON and hash", () => {
      const fixture = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const parseResult = parsePolicyInsightContent(fixture);
      expect(parseResult.ok).toBe(true);

      const { canonical, hash } = computePolicyInsightContentCanonicalAndHash(
        content as PolicyInsightContent
      );

      expect(canonical).toMatchSnapshot("current-pair canonical");
      expect(hash).toMatchSnapshot("current-pair hash");
    });

    it("current-position fixture produces stable canonical JSON and hash", () => {
      const fixture = createValidPositionContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness, ...content } = fixture;

      const parseResult = parsePolicyInsightContent(fixture);
      expect(parseResult.ok).toBe(true);

      const { canonical, hash } = computePolicyInsightContentCanonicalAndHash(
        content as PolicyInsightContent
      );

      expect(canonical).toMatchSnapshot("current-position canonical");
      expect(hash).toMatchSnapshot("current-position hash");
    });

    it("different object key orders produce identical canonical JSON", () => {
      const fixture1 = createValidPairContent();
      const fixture2 = createValidPairContent();
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness: f1, ...content1 } = fixture1;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { freshness: f2, ...content2 } = fixture2;

      const result1 = computePolicyInsightContentCanonicalAndHash(content1 as PolicyInsightContent);
      const result2 = computePolicyInsightContentCanonicalAndHash(content2 as PolicyInsightContent);

      expect(result1.canonical).toBe(result2.canonical);
      expect(result1.hash).toBe(result2.hash);
    });
  });
});

function shuffleKeys<T extends object>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(shuffleKeys) as unknown as T;
  }

  const keys = Object.keys(obj);
  const shuffledKeys = [...keys].sort(() => Math.random() - 0.5);

  const result: Record<string, unknown> = {};
  for (const key of shuffledKeys) {
    result[key] = shuffleKeys((obj as Record<string, unknown>)[key] as object);
  }
  return result as T;
}
