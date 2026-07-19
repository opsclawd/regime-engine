import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type { SelectedEvidenceSummary } from "../evidence/selectEvidence.js";
import type {
  RegimeCurrentResponse,
  PlanRequestPosition,
  PlanResponse,
  Regime
} from "../../contract/v1/types.js";
import type { PolicyRuleset } from "./ruleset.js";
import type { InsightIngestRequest } from "../../contract/v1/insights.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import {
  RECOMMENDED_ACTIONS,
  POSTURES,
  RANGE_BIASES,
  REBALANCE_SENSITIVITIES,
  CONFIDENCES,
  RISK_LEVELS
} from "../../contract/v1/insights.js";

type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];
type Posture = (typeof POSTURES)[number];
type RangeBias = (typeof RANGE_BIASES)[number];
type RebalanceSensitivity = (typeof REBALANCE_SENSITIVITIES)[number];
type Confidence = (typeof CONFIDENCES)[number];
type RiskLevel = (typeof RISK_LEVELS)[number];

export type PolicyInsightV1 = InsightIngestRequest;

export interface PolicySynthesisHashes {
  readonly inputHash: string;
  readonly rulesetHash: string;
}

export interface PolicySynthesisEnvelope {
  readonly synthesisAtUnixMs: number;
  readonly pair: "SOL/USDC";
  readonly scope: Scope;
  readonly market: RegimeCurrentResponse;
  readonly positionPlan: {
    readonly position: PlanRequestPosition;
    readonly plan: PlanResponse;
  } | null;
  readonly evidence: SelectedEvidenceSummary;
  readonly hashes: PolicySynthesisHashes;
}

export function synthesizePolicyInsight(
  envelope: PolicySynthesisEnvelope,
  ruleset: PolicyRuleset
): PolicyInsightV1 {
  const synthesisAt = new Date(envelope.synthesisAtUnixMs).toISOString();

  // Expiry calculation
  let earliestExpiryMs = envelope.synthesisAtUnixMs + ruleset.maxInsightLifetimeMs;

  if (envelope.market.freshness?.generatedAtIso) {
    const marketGen = Date.parse(envelope.market.freshness.generatedAtIso);
    const hardStaleSec =
      envelope.market.freshness.hardStaleSeconds ?? ruleset.degradedSafetyTtlMs / 1000;
    const marketExpiry = marketGen + hardStaleSec * 1000;
    if (marketExpiry < earliestExpiryMs) {
      earliestExpiryMs = marketExpiry;
    }
  }

  if (envelope.positionPlan?.position?.observedAtUnixMs) {
    const positionExpiry =
      envelope.positionPlan.position.observedAtUnixMs + ruleset.positionMaxAgeMs;
    if (positionExpiry < earliestExpiryMs) {
      earliestExpiryMs = positionExpiry;
    }
  }

  const evidenceExpiresAt: number[] = [];
  if (envelope.evidence.selected?.contextualEvidence) {
    const ctx = envelope.evidence.selected.contextualEvidence;
    const allClaims = [
      ...(ctx.supportResistance || []),
      ...(ctx.flows || []),
      ...(ctx.derivatives || []),
      ...(ctx.events || []),
      ...(ctx.newsRegulatory || [])
    ];
    for (const claim of allClaims) {
      if (claim.originalItem?.expiresAt) {
        evidenceExpiresAt.push(Date.parse(claim.originalItem.expiresAt));
      }
    }
  }
  if (evidenceExpiresAt.length > 0) {
    const minEvidenceExpiry = Math.min(...evidenceExpiresAt);
    if (minEvidenceExpiry < earliestExpiryMs) {
      earliestExpiryMs = minEvidenceExpiry;
    }
  }

  const expiresAtIso = new Date(earliestExpiryMs).toISOString();

  // Baseline config based on market regime
  const regime: Regime = envelope.market.regime;
  let action: string = "watch";
  let posture: string = "neutral";
  let rangeBias: string = "medium";
  let sensitivity: string = "normal";
  let maxCapital: number = 75;
  let confidence: string = "medium";
  let riskLevel: string = "normal";

  if (regime === "UP") {
    action = "watch";
    posture = "moderately_aggressive";
    rangeBias = "medium";
    sensitivity = "high";
    maxCapital = 100;
    confidence = "medium";
    riskLevel = "normal";
  } else if (regime === "DOWN") {
    action = "watch";
    posture = "defensive";
    rangeBias = "wide";
    sensitivity = "low";
    maxCapital = 50;
    confidence = "medium";
    riskLevel = "elevated";
  } else {
    // CHOP
    action = "watch";
    posture = "neutral";
    rangeBias = "tight";
    sensitivity = "normal";
    maxCapital = 75;
    confidence = "medium";
    riskLevel = "normal";
  }

  const baselineSensitivity = sensitivity;
  const baselineCapital = maxCapital;

  const reasoningSet = new Set<string>();

  // Explicit locks state
  let actionLock: string | null = null;
  let postureLock: string | null = null;
  let riskFloor: string | null = null;
  let confidenceCeiling: string | null = null;
  let allowClmm: boolean = true;
  let capitalCap: number | null = null;
  let sensitivityCap: string | null = null;

  // Helper to compare risk levels (normal < elevated < critical)
  const compareRisk = (r1: string, r2: string): number => {
    const order = ruleset.riskOrder;
    return order.indexOf(r1) - order.indexOf(r2);
  };

  // Helper to compare confidence (low < medium < high)
  const compareConfidence = (c1: string, c2: string): number => {
    const order = ruleset.confidenceOrder;
    return order.indexOf(c1) - order.indexOf(c2);
  };

  // Helper to compare sensitivity (paused < low < normal < high)
  const sensitivityOrder = ["paused", "low", "normal", "high"];
  const compareSensitivity = (s1: string, s2: string): number => {
    return sensitivityOrder.indexOf(s1) - sensitivityOrder.indexOf(s2);
  };

  // Stage 1: Hard stale or insufficient safety data
  if (envelope.market.freshness?.hardStale) {
    reasoningSet.add("DATA_HARD_STALE");
    actionLock = "pause_rebalances";
    postureLock = "paused";
    riskFloor = "critical";
    confidenceCeiling = "low";
    allowClmm = false;
  }
  if (
    envelope.market.clmmSuitability?.status === "UNKNOWN" ||
    envelope.market.clmmSuitability?.status === "BLOCKED"
  ) {
    reasoningSet.add("DATA_INSUFFICIENT_SAMPLES");
    actionLock = "pause_rebalances";
    postureLock = "paused";
    riskFloor = "critical";
    confidenceCeiling = "low";
    allowClmm = false;
  }

  // Stage 2: Qualified lower and upper breaches
  if (envelope.positionPlan?.plan?.actions) {
    const exitAction = envelope.positionPlan.plan.actions.find(
      (a) => a.type === "REQUEST_EXIT_CLMM"
    );
    if (exitAction) {
      actionLock = "exit_range";
      allowClmm = false;
      if (envelope.positionPlan.position?.rangeState === "below-range") {
        reasoningSet.add("CLMM_BREACH_LOWER");
      } else {
        reasoningSet.add("CLMM_BREACH_UPPER");
      }
    }
  }

  // Stage 3: Churn governor (Stand-down and Cooldown)
  const standDownUntil = envelope.positionPlan?.plan?.constraints?.standDownUntilUnixMs ?? 0;
  const isStandDownAction = envelope.positionPlan?.plan?.actions?.some(
    (a) => a.type === "STAND_DOWN"
  );
  if (isStandDownAction || standDownUntil > envelope.synthesisAtUnixMs) {
    reasoningSet.add("CHURN_STAND_DOWN_ACTIVE");
    actionLock = "pause_rebalances";
    postureLock = "paused";
    allowClmm = false;
  }

  const cooldownUntil = envelope.positionPlan?.plan?.constraints?.cooldownUntilUnixMs ?? 0;
  if (cooldownUntil > envelope.synthesisAtUnixMs) {
    reasoningSet.add("CHURN_COOLDOWN_ACTIVE");
    capitalCap = baselineCapital;
    sensitivityCap = baselineSensitivity;
  }

  // Stage 4: Market Regime
  if (regime === "UP") {
    reasoningSet.add("MARKET_REGIME_UP");
  } else if (regime === "DOWN") {
    reasoningSet.add("MARKET_REGIME_DOWN");
  } else {
    reasoningSet.add("MARKET_REGIME_CHOP");
  }

  // Apply locks and limits
  if (actionLock) {
    action = actionLock;
  }
  if (postureLock) {
    posture = postureLock;
  }
  if (riskFloor) {
    if (compareRisk(riskLevel, riskFloor) < 0) {
      riskLevel = riskFloor;
    }
  }
  if (confidenceCeiling) {
    if (compareConfidence(confidence, confidenceCeiling) > 0) {
      confidence = confidenceCeiling;
    }
  }
  if (!allowClmm) {
    maxCapital = 0;
    sensitivity = "paused";
    posture = "paused";
  }

  if (capitalCap !== null) {
    if (maxCapital > capitalCap) {
      maxCapital = capitalCap;
    }
  }

  if (sensitivityCap !== null) {
    if (compareSensitivity(sensitivity, sensitivityCap) > 0) {
      sensitivity = sensitivityCap;
    }
  }

  // Build sorting for reasoning based on Ruleset reasonOrder
  const sortedReasoning = Array.from(reasoningSet).sort((a, b) => {
    const orderA = ruleset.reasonOrder[a] ?? 999;
    const orderB = ruleset.reasonOrder[b] ?? 999;
    return orderA - orderB;
  });

  const levels = {
    support: envelope.positionPlan ? [envelope.positionPlan.position.lowerBoundPrice] : [100],
    resistance: envelope.positionPlan ? [envelope.positionPlan.position.upperBoundPrice] : [200]
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    pair: "SOL/USDC",
    asOf: synthesisAt,
    source: "openclaw",
    runId: `synthesis-sol-usdc-${envelope.synthesisAtUnixMs}`,
    marketRegime: regime.toLowerCase(),
    fundamentalRegime: "unknown",
    recommendedAction: action as RecommendedAction,
    confidence: confidence as Confidence,
    riskLevel: riskLevel as RiskLevel,
    dataQuality: envelope.market.freshness?.hardStale ? "stale" : "complete",
    clmmPolicy: {
      posture: posture as Posture,
      rangeBias: rangeBias as RangeBias,
      rebalanceSensitivity: sensitivity as RebalanceSensitivity,
      maxCapitalDeploymentPercent: maxCapital
    },
    levels,
    reasoning: sortedReasoning,
    sourceRefs: [],
    expiresAt: expiresAtIso
  };
}
