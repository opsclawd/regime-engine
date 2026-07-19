import { describe, expect, it } from "vitest";
import {
  synthesizePolicyInsight,
  type PolicySynthesisEnvelope
} from "../synthesizePolicyInsight.js";
import { SOL_USDC_POLICY_V1 } from "../ruleset.js";
import type { Scope } from "../../../contract/evidence/v1/types.generated.js";
import {
  makeMockEvidenceSummary,
  makeMockMarketResponse,
  makeMockPosition,
  makeMockPlan
} from "./policyFixtures.js";

const AS_OF = 1762591200000;

const pairScope: Scope = { kind: "pair" };
const positionScope: Scope = {
  kind: "position",
  network: "solana-mainnet",
  walletAddress: "wallet-1",
  whirlpoolAddress: "pool-1",
  positionId: "pos-1"
};

describe("synthesizePolicyInsight - Precedence Guards", () => {
  it("hard-stale market locks pause posture and blocks CLMM despite bullish evidence", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({
        regime: "UP",
        freshness: {
          generatedAtIso: new Date(AS_OF - 5000).toISOString(),
          lastCandleOpenUnixMs: AS_OF - 3600000,
          lastCandleOpenIso: new Date(AS_OF - 3600000).toISOString(),
          lastCandleCloseUnixMs: AS_OF - 60000,
          lastCandleCloseIso: new Date(AS_OF - 60000).toISOString(),
          ageSeconds: 5,
          softStale: false,
          hardStale: true,
          softStaleSeconds: 1500,
          hardStaleSeconds: 2100
        }
      }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("pause_rebalances");
    expect(result.clmmPolicy.posture).toBe("paused");
    expect(result.clmmPolicy.rebalanceSensitivity).toBe("paused");
    expect(result.clmmPolicy.maxCapitalDeploymentPercent).toBe(0);
    expect(result.riskLevel).toBe("critical");
    expect(result.confidence).toBe("low");
    expect(result.reasoning).toContain("DATA_HARD_STALE");
  });

  it("qualified lower breach remains exit_range under bullish contextual evidence", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({ regime: "UP" }),
      positionPlan: {
        position: makeMockPosition({
          rangeState: "below-range",
          breachQualified: true
        }),
        plan: makeMockPlan({
          actions: [{ type: "REQUEST_EXIT_CLMM", reasonCode: "BREACH" }]
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("exit_range");
    expect(result.clmmPolicy.maxCapitalDeploymentPercent).toBe(0);
    expect(result.reasoning).toContain("CLMM_BREACH_LOWER");
  });

  it("qualified upper breach remains exit_range under bearish contextual evidence", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({ regime: "DOWN" }),
      positionPlan: {
        position: makeMockPosition({
          rangeState: "above-range",
          breachQualified: true
        }),
        plan: makeMockPlan({
          actions: [{ type: "REQUEST_EXIT_CLMM", reasonCode: "BREACH" }]
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("exit_range");
    expect(result.clmmPolicy.maxCapitalDeploymentPercent).toBe(0);
    expect(result.reasoning).toContain("CLMM_BREACH_UPPER");
  });

  it("active stand-down prevents lower-precedence deployment increases", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({ regime: "UP" }),
      positionPlan: {
        position: makeMockPosition(),
        plan: makeMockPlan({
          actions: [{ type: "STAND_DOWN", reasonCode: "CHURN" }],
          constraints: {
            cooldownUntilUnixMs: 0,
            standDownUntilUnixMs: AS_OF + 60000,
            notes: []
          }
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("pause_rebalances");
    expect(result.clmmPolicy.posture).toBe("paused");
    expect(result.clmmPolicy.maxCapitalDeploymentPercent).toBe(0);
    expect(result.reasoning).toContain("CHURN_STAND_DOWN_ACTIVE");
  });

  it("cooldown never permits higher sensitivity or capital than the baseline", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({ regime: "DOWN" }),
      positionPlan: {
        position: makeMockPosition(),
        plan: makeMockPlan({
          constraints: {
            cooldownUntilUnixMs: AS_OF + 60000,
            standDownUntilUnixMs: 0,
            notes: []
          }
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    expect(result.clmmPolicy.maxCapitalDeploymentPercent).toBeLessThanOrEqual(50); // Down regime baseline cap
    expect(result.clmmPolicy.rebalanceSensitivity).toBe("low");
    expect(result.reasoning).toContain("CHURN_COOLDOWN_ACTIVE");
  });

  it("Stage 1 hard-stale lock is not overwritten by Stage 2 exit_range breach lock", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({
        regime: "UP",
        freshness: {
          generatedAtIso: new Date(AS_OF - 5000).toISOString(),
          lastCandleOpenUnixMs: AS_OF - 3600000,
          lastCandleOpenIso: new Date(AS_OF - 3600000).toISOString(),
          lastCandleCloseUnixMs: AS_OF - 60000,
          lastCandleCloseIso: new Date(AS_OF - 60000).toISOString(),
          ageSeconds: 5,
          softStale: false,
          hardStale: true,
          softStaleSeconds: 1500,
          hardStaleSeconds: 2100
        }
      }),
      positionPlan: {
        position: makeMockPosition({
          rangeState: "below-range",
          breachQualified: true
        }),
        plan: makeMockPlan({
          actions: [{ type: "REQUEST_EXIT_CLMM", reasonCode: "BREACH" }]
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsight(envelope, SOL_USDC_POLICY_V1);

    // Stage 1 (DATA_HARD_STALE) sets actionLock = "pause_rebalances"
    // Stage 2 (BREACH) sets actionLock = "exit_range"
    // Since Stage 1 has higher precedence, recommendedAction must be "pause_rebalances"
    expect(result.recommendedAction).toBe("pause_rebalances");
  });
});
