import { describe, expect, it } from "vitest";
import {
  synthesizePolicyInsightV1,
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

describe("synthesizePolicyInsightV1 - Action Transitions", () => {
  it("maps hard-stale market data to STAND_DOWN before all other actions", () => {
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

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("STAND_DOWN");
  });

  it("maps blocked suitability and active churn stand-down to STAND_DOWN", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({
        regime: "UP",
        clmmSuitability: {
          status: "BLOCKED",
          reasons: [
            { code: "INSUFFICIENT_LIQUIDITY", severity: "ERROR", message: "Insufficient liquidity" }
          ]
        }
      }),
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

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("STAND_DOWN");
  });

  it("maps a qualified lower-bound breach to EXIT_TO_USDC", () => {
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

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("EXIT_TO_USDC");
  });

  it("maps a qualified upper-bound breach to EXIT_TO_SOL", () => {
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

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("EXIT_TO_SOL");
  });

  it("maps an unqualified lower observation to MONITOR_LOWER_BOUND", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({ regime: "CHOP" }),
      positionPlan: {
        position: makeMockPosition({
          rangeState: "below-range",
          breachQualified: false
        }),
        plan: makeMockPlan({
          actions: [{ type: "HOLD", reasonCode: "POSITION_HOLD" }]
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("MONITOR_LOWER_BOUND");
  });

  it("maps an unqualified upper observation to MONITOR_UPPER_BOUND", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: positionScope,
      market: makeMockMarketResponse({ regime: "CHOP" }),
      positionPlan: {
        position: makeMockPosition({
          rangeState: "above-range",
          breachQualified: false
        }),
        plan: makeMockPlan({
          actions: [{ type: "HOLD", reasonCode: "POSITION_HOLD" }]
        })
      },
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("MONITOR_UPPER_BOUND");
  });

  it("maps pair-scoped and in-range advice with no higher guard to HOLD", () => {
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs: AS_OF,
      pair: "SOL/USDC",
      scope: pairScope,
      market: makeMockMarketResponse({ regime: "CHOP" }),
      positionPlan: null,
      evidence: makeMockEvidenceSummary(),
      hashes: { inputHash: "in-1", rulesetHash: "rules-1" }
    };

    const result = synthesizePolicyInsightV1(envelope, SOL_USDC_POLICY_V1);

    expect(result.recommendedAction).toBe("HOLD");
  });
});
