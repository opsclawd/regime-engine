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
import type {
  PolicyInsightContent,
  RecommendedAction,
  Posture,
  RangeBias,
  RebalanceSensitivity,
  RiskLevel,
  ConfidenceBps,
  DataQuality,
  ReasonCode,
  Warning,
  ClmmPolicy,
  Levels,
  Evidence
} from "../../contract/policyInsight/v1/types.generated.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import {
  RECOMMENDED_ACTIONS,
  POSTURES,
  RANGE_BIASES,
  REBALANCE_SENSITIVITIES,
  CONFIDENCES,
  RISK_LEVELS
} from "../../contract/v1/insights.js";
import { renderPolicyReasoning, renderPolicyWarnings } from "./reasoning.js";

type LegacyRecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];
type LegacyPosture = (typeof POSTURES)[number];
type LegacyRangeBias = (typeof RANGE_BIASES)[number];
type LegacyRebalanceSensitivity = (typeof REBALANCE_SENSITIVITIES)[number];
type LegacyConfidence = (typeof CONFIDENCES)[number];
type LegacyRiskLevel = (typeof RISK_LEVELS)[number];

export type PolicyInsightV1 = InsightIngestRequest;

export type PolicyInsightContentDraft = Omit<PolicyInsightContent, "insightId">;

function toUpperCasePosture(posture: LegacyPosture): Posture {
  switch (posture) {
    case "aggressive":
      return "AGGRESSIVE";
    case "moderately_aggressive":
      return "MODERATELY_AGGRESSIVE";
    case "neutral":
      return "NEUTRAL";
    case "defensive":
      return "DEFENSIVE";
    case "paused":
      return "PAUSED";
    default:
      return "NEUTRAL";
  }
}

function toUpperCaseRangeBias(rangeBias: LegacyRangeBias): RangeBias {
  switch (rangeBias) {
    case "tight":
      return "TIGHT";
    case "medium":
      return "MEDIUM";
    case "wide":
      return "WIDE";
    case "passive":
      return "PASSIVE";
    default:
      return "MEDIUM";
  }
}

function toUpperCaseRebalanceSensitivity(
  sensitivity: LegacyRebalanceSensitivity
): RebalanceSensitivity {
  switch (sensitivity) {
    case "low":
      return "LOW";
    case "normal":
      return "NORMAL";
    case "high":
      return "HIGH";
    case "paused":
      return "PAUSED";
    default:
      return "NORMAL";
  }
}

function toUpperCaseRiskLevel(riskLevel: LegacyRiskLevel): RiskLevel {
  switch (riskLevel) {
    case "normal":
      return "NORMAL";
    case "elevated":
      return "ELEVATED";
    case "critical":
      return "CRITICAL";
    default:
      return "NORMAL";
  }
}

function toConfidenceBps(confidence: LegacyConfidence): ConfidenceBps {
  switch (confidence) {
    case "low":
      return 2500;
    case "medium":
      return 5000;
    case "high":
      return 7500;
    default:
      return 5000;
  }
}

function toDataQuality(hardStale: boolean, suitabilityBlocked: boolean): DataQuality {
  if (hardStale) {
    return "STALE";
  }
  if (suitabilityBlocked) {
    return "PARTIAL";
  }
  return "COMPLETE";
}

function toDecimalString(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "");
}

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
        const expiresAtMs = Date.parse(claim.originalItem.expiresAt);
        if (expiresAtMs >= envelope.synthesisAtUnixMs) {
          evidenceExpiresAt.push(expiresAtMs);
        }
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
      actionLock ??= "exit_range";
      allowClmm = false;
      if (envelope.positionPlan.position?.rangeState === "below-range") {
        reasoningSet.add("CLMM_BREACH_LOWER");
      } else if (envelope.positionPlan.position?.rangeState === "above-range") {
        reasoningSet.add("CLMM_BREACH_UPPER");
      }
    }

    const holdAction = envelope.positionPlan.plan.actions.find((a) => a.type === "HOLD");
    if (holdAction) {
      actionLock ??= "hold";
    }
  }

  // Stage 3: Churn governor (Stand-down and Cooldown)
  const standDownUntil = envelope.positionPlan?.plan?.constraints?.standDownUntilUnixMs ?? 0;
  const isStandDownAction = envelope.positionPlan?.plan?.actions?.some(
    (a) => a.type === "STAND_DOWN"
  );
  if (isStandDownAction || standDownUntil > envelope.synthesisAtUnixMs) {
    reasoningSet.add("CHURN_STAND_DOWN_ACTIVE");
    actionLock ??= "pause_rebalances";
    postureLock ??= "paused";
    allowClmm = false;
  }

  const cooldownUntil = envelope.positionPlan?.plan?.constraints?.cooldownUntilUnixMs ?? 0;
  if (cooldownUntil > envelope.synthesisAtUnixMs) {
    reasoningSet.add("CHURN_COOLDOWN_ACTIVE");
    capitalCap ??= baselineCapital;
    sensitivityCap ??= baselineSensitivity;
  }

  // Stage 4: Market Regime
  if (regime === "UP") {
    reasoningSet.add("MARKET_REGIME_UP");
  } else if (regime === "DOWN") {
    reasoningSet.add("MARKET_REGIME_DOWN");
  } else {
    reasoningSet.add("MARKET_REGIME_CHOP");
  }

  // Support & Resistance levels arrays extracted from features
  const extractedSupport: number[] = [];
  const extractedResistance: number[] = [];

  // Stage 5: Deterministic features
  if (envelope.evidence.selected?.deterministicFeatures) {
    for (const feature of envelope.evidence.selected.deterministicFeatures) {
      const originalItem = feature.originalItem;
      if (originalItem.status !== "available" || !("calculator" in originalItem)) {
        continue;
      }
      // Find matching binding
      const binding = ruleset.featureBindings.find(
        (b) =>
          b.family === feature.family &&
          b.featureId === feature.featureId &&
          b.calculatorName === originalItem.calculator.name &&
          b.calculatorVersion === originalItem.calculator.version &&
          b.unit === originalItem.unit
      );

      if (binding) {
        const val = Number(feature.value);
        if (!isNaN(val) && val >= binding.threshold) {
          reasoningSet.add("FEATURE_THRESHOLD_BREACHED");
          if (binding.tighten === "risk") {
            riskFloor = "elevated";
          } else if (binding.tighten === "confidence") {
            confidenceCeiling = "medium";
          } else if (binding.tighten === "capital") {
            capitalCap = Math.min(capitalCap ?? maxCapital, 50);
          } else if (binding.tighten === "range") {
            rangeBias = "tight";
          } else if (binding.tighten === "support") {
            if (val > 0) {
              extractedSupport.push(val);
            }
          } else if (binding.tighten === "resistance") {
            if (val > 0) {
              extractedResistance.push(val);
            }
          }
        }
      }
    }
  }

  // Stage 6: Contextual evidence votes & conflicts
  let bullishCount = 0;
  let bearishCount = 0;
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
      if (
        claim.originalItem?.expiresAt &&
        Date.parse(claim.originalItem.expiresAt) < envelope.synthesisAtUnixMs
      ) {
        // Expired contextual claims are ignored/excluded
        continue;
      }
      if (claim.direction === "bullish") {
        bullishCount++;
      } else if (claim.direction === "bearish") {
        bearishCount++;
      }
    }
  }

  const hasConflict =
    envelope.evidence.conflicts.length > 0 || (bullishCount > 0 && bearishCount > 0);

  if (hasConflict) {
    reasoningSet.add("CONTEXTUAL_EVIDENCE_VOTE");
    // Conflict can increase risk or reduce confidence but cannot produce directional upgrade
    riskFloor = "elevated";
    confidenceCeiling = "low";
  } else if (bearishCount > bullishCount) {
    reasoningSet.add("CONTEXTUAL_EVIDENCE_VOTE");
    // Bearish direction: tighten fields
    riskFloor = "elevated";
    capitalCap = Math.min(capitalCap ?? maxCapital, 50);
    // Shift posture down to a safer one (towards paused)
    const postureIndex = ruleset.postureOrder.indexOf(posture);
    if (postureIndex !== -1 && postureIndex < ruleset.postureOrder.length - 1) {
      posture = ruleset.postureOrder[postureIndex + 1];
    }
  } else if (bullishCount > bearishCount) {
    reasoningSet.add("CONTEXTUAL_EVIDENCE_VOTE");
    // Bullish direction: directional upgrade
    // Shift posture up to a more aggressive one (towards aggressive/first)
    const postureIndex = ruleset.postureOrder.indexOf(posture);
    if (postureIndex > 0) {
      posture = ruleset.postureOrder[postureIndex - 1];
    }
  }

  // Stage 7: Research briefs
  if (envelope.evidence.selected?.researchBrief) {
    reasoningSet.add("RESEARCH_BRIEF_ANALYSIS");
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

  // Support and resistance logic sorting/deduplication/bounds
  const currentPrice = envelope.positionPlan?.position?.currentPrice ?? 100;
  const lowerBound = envelope.positionPlan?.position?.lowerBoundPrice ?? 95;
  const upperBound = envelope.positionPlan?.position?.upperBoundPrice ?? 110;

  // Aggregate support values, filter, deduplicate, and sort descending
  const supportSet = new Set<number>();
  if (envelope.positionPlan) {
    supportSet.add(lowerBound);
  }
  for (const s of extractedSupport) {
    if (s <= currentPrice && s > 0) {
      supportSet.add(s);
    }
  }
  const sortedSupport = Array.from(supportSet).sort((a, b) => b - a);

  // Aggregate resistance values, filter, deduplicate, and sort ascending
  const resistanceSet = new Set<number>();
  if (envelope.positionPlan) {
    resistanceSet.add(upperBound);
  }
  for (const r of extractedResistance) {
    if (r >= currentPrice && r > 0) {
      resistanceSet.add(r);
    }
  }
  const sortedResistance = Array.from(resistanceSet).sort((a, b) => a - b);

  // Fallbacks if empty
  const finalSupport = sortedSupport.length > 0 ? sortedSupport : [100];
  const finalResistance = sortedResistance.length > 0 ? sortedResistance : [200];

  const levels = {
    support: finalSupport.slice(0, 16),
    resistance: finalResistance.slice(0, 16)
  };

  // Build sorted reasoning using deterministic reasoning engine
  const orderedReasonCodes = Array.from(reasoningSet);
  const boundedIdentifiers: string[] = [];
  if (envelope.evidence.selected?.deterministicFeatures) {
    for (const f of envelope.evidence.selected.deterministicFeatures) {
      boundedIdentifiers.push(f.candidateId);
    }
  }
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
      if (
        claim.originalItem?.expiresAt &&
        Date.parse(claim.originalItem.expiresAt) < envelope.synthesisAtUnixMs
      ) {
        continue;
      }
      boundedIdentifiers.push(claim.candidateId);
    }
  }
  if (envelope.evidence.selected?.researchBrief) {
    boundedIdentifiers.push(envelope.evidence.selected.researchBrief.candidateId);
  }

  const renderedReasoning = renderPolicyReasoning({
    orderedReasonCodes,
    boundedIdentifiers,
    reasonOrder: ruleset.reasonOrder
  });

  const derivedWarnings: string[] = [];
  if (envelope.market.freshness?.hardStale) {
    derivedWarnings.push("market data is hard stale");
  }

  const renderedWarnings = renderPolicyWarnings({
    selection: envelope.evidence,
    derivedWarnings
  });

  // Combine reasoning and warnings, keeping at most 16 elements total
  const combinedReasoning = [...renderedReasoning, ...renderedWarnings].slice(0, 16);

  // Source refs
  const sourceRefs = (envelope.evidence.sourceReferences || [])
    .map((ref) => ref.referenceId)
    .filter(Boolean)
    .slice(0, 16)
    .map((s) => s.substring(0, 512));

  return {
    schemaVersion: SCHEMA_VERSION,
    pair: "SOL/USDC",
    asOf: synthesisAt,
    source: "openclaw",
    runId: `synthesis-sol-usdc-${envelope.synthesisAtUnixMs}`,
    marketRegime: regime.toLowerCase(),
    fundamentalRegime: "unknown",
    recommendedAction: action as LegacyRecommendedAction,
    confidence: confidence as LegacyConfidence,
    riskLevel: riskLevel as LegacyRiskLevel,
    dataQuality: envelope.market.freshness?.hardStale ? "stale" : "complete",
    clmmPolicy: {
      posture: posture as LegacyPosture,
      rangeBias: rangeBias as LegacyRangeBias,
      rebalanceSensitivity: sensitivity as LegacyRebalanceSensitivity,
      maxCapitalDeploymentPercent: maxCapital
    },
    levels,
    reasoning: combinedReasoning,
    sourceRefs,
    expiresAt: expiresAtIso
  };
}

function deriveCanonicalRecommendedAction(input: {
  readonly envelope: PolicySynthesisEnvelope;
  readonly actionLock: string | null;
  readonly postureLock: string | null;
  readonly rangeState: string | null;
  readonly breachQualified: boolean;
  readonly allowClmm: boolean;
}): RecommendedAction {
  const { envelope, actionLock, postureLock, rangeState, breachQualified } = input;

  if (actionLock === "exit_range") {
    if (
      rangeState === "below-range" ||
      envelope.positionPlan?.position?.rangeState === "below-range"
    ) {
      return "EXIT_TO_USDC";
    }
    return "EXIT_TO_SOL";
  }

  if (postureLock === "paused" || actionLock === "pause_rebalances") {
    return "STAND_DOWN";
  }

  if (actionLock === "hold") {
    if (envelope.scope.kind === "pair") {
      return "HOLD";
    }
    const posRangeState = envelope.positionPlan?.position?.rangeState;
    if (posRangeState === "below-range" && !breachQualified) {
      return "MONITOR_LOWER_BOUND";
    }
    if (posRangeState === "above-range" && !breachQualified) {
      return "MONITOR_UPPER_BOUND";
    }
    return "HOLD";
  }

  if (envelope.scope.kind === "pair") {
    return "HOLD";
  }

  const posRangeState = envelope.positionPlan?.position?.rangeState;
  if (posRangeState === "below-range" && !breachQualified) {
    return "MONITOR_LOWER_BOUND";
  }
  if (posRangeState === "above-range" && !breachQualified) {
    return "MONITOR_UPPER_BOUND";
  }

  return "HOLD";
}

export function synthesizePolicyInsightV1(
  envelope: PolicySynthesisEnvelope,
  ruleset: PolicyRuleset
): PolicyInsightContentDraft {
  const synthesisAt = new Date(envelope.synthesisAtUnixMs).toISOString();

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
        const expiresAtMs = Date.parse(claim.originalItem.expiresAt);
        if (expiresAtMs >= envelope.synthesisAtUnixMs) {
          evidenceExpiresAt.push(expiresAtMs);
        }
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

  const regime: Regime = envelope.market.regime;
  let posture: string = "neutral";
  let rangeBias: string = "medium";
  let sensitivity: string = "normal";
  let maxCapital: number = 75;
  let confidence: string = "medium";
  let riskLevel: string = "normal";

  if (regime === "UP") {
    posture = "moderately_aggressive";
    sensitivity = "high";
    maxCapital = 100;
  } else if (regime === "DOWN") {
    posture = "defensive";
    rangeBias = "wide";
    sensitivity = "low";
    maxCapital = 50;
    riskLevel = "elevated";
  } else {
    posture = "neutral";
    rangeBias = "tight";
  }

  const baselineSensitivity = sensitivity;
  const baselineCapital = maxCapital;

  const reasonCodeSet = new Set<ReasonCode>();

  let actionLock: string | null = null;
  let postureLock: string | null = null;
  let riskFloor: string | null = null;
  let confidenceCeiling: string | null = null;
  let allowClmm: boolean = true;
  let capitalCap: number | null = null;
  let sensitivityCap: string | null = null;

  const compareRisk = (r1: string, r2: string): number => {
    const order = ruleset.riskOrder;
    return order.indexOf(r1) - order.indexOf(r2);
  };

  const compareConfidence = (c1: string, c2: string): number => {
    const order = ruleset.confidenceOrder;
    return order.indexOf(c1) - order.indexOf(c2);
  };

  const sensitivityOrder = ["paused", "low", "normal", "high"];
  const compareSensitivity = (s1: string, s2: string): number => {
    return sensitivityOrder.indexOf(s1) - sensitivityOrder.indexOf(s2);
  };

  const hardStale = envelope.market.freshness?.hardStale ?? false;
  const suitabilityBlocked =
    envelope.market.clmmSuitability?.status === "UNKNOWN" ||
    envelope.market.clmmSuitability?.status === "BLOCKED";

  if (hardStale) {
    reasonCodeSet.add("DATA_HARD_STALE");
    actionLock = "pause_rebalances";
    postureLock = "paused";
    riskFloor = "critical";
    confidenceCeiling = "low";
    allowClmm = false;
  }

  if (suitabilityBlocked) {
    reasonCodeSet.add("DATA_INSUFFICIENT_SAMPLES");
    if (!actionLock) {
      actionLock = "pause_rebalances";
    }
    if (!postureLock) {
      postureLock = "paused";
    }
    if (!riskFloor || compareRisk(riskLevel, "critical") < 0) {
      riskFloor = "critical";
    }
    if (!confidenceCeiling || compareConfidence(confidence, "low") > 0) {
      confidenceCeiling = "low";
    }
    allowClmm = false;
  }

  const positionRangeState = envelope.positionPlan?.position?.rangeState;
  const breachQualified = envelope.positionPlan?.position?.breachQualified ?? false;

  if (envelope.positionPlan?.plan?.actions) {
    const exitAction = envelope.positionPlan.plan.actions.find(
      (a) => a.type === "REQUEST_EXIT_CLMM"
    );
    if (exitAction) {
      actionLock ??= "exit_range";
      allowClmm = false;
      if (positionRangeState === "below-range") {
        reasonCodeSet.add("CLMM_BREACH_LOWER");
      } else if (positionRangeState === "above-range") {
        reasonCodeSet.add("CLMM_BREACH_UPPER");
      }
    }

    const holdAction = envelope.positionPlan.plan.actions.find((a) => a.type === "HOLD");
    if (holdAction) {
      actionLock ??= "hold";
    }
  }

  const standDownUntil = envelope.positionPlan?.plan?.constraints?.standDownUntilUnixMs ?? 0;
  const isStandDownAction = envelope.positionPlan?.plan?.actions?.some(
    (a) => a.type === "STAND_DOWN"
  );
  if (isStandDownAction || standDownUntil > envelope.synthesisAtUnixMs) {
    reasonCodeSet.add("CHURN_STAND_DOWN_ACTIVE");
    actionLock ??= "pause_rebalances";
    postureLock ??= "paused";
    allowClmm = false;
  }

  const cooldownUntil = envelope.positionPlan?.plan?.constraints?.cooldownUntilUnixMs ?? 0;
  if (cooldownUntil > envelope.synthesisAtUnixMs) {
    reasonCodeSet.add("CHURN_COOLDOWN_ACTIVE");
    capitalCap ??= baselineCapital;
    sensitivityCap ??= baselineSensitivity;
  }

  if (regime === "UP") {
    reasonCodeSet.add("MARKET_REGIME_UP");
  } else if (regime === "DOWN") {
    reasonCodeSet.add("MARKET_REGIME_DOWN");
  } else {
    reasonCodeSet.add("MARKET_REGIME_CHOP");
  }

  const extractedSupport: number[] = [];
  const extractedResistance: number[] = [];

  if (envelope.evidence.selected?.deterministicFeatures) {
    for (const feature of envelope.evidence.selected.deterministicFeatures) {
      const originalItem = feature.originalItem;
      if (originalItem.status !== "available" || !("calculator" in originalItem)) {
        continue;
      }
      const binding = ruleset.featureBindings.find(
        (b) =>
          b.family === feature.family &&
          b.featureId === feature.featureId &&
          b.calculatorName === originalItem.calculator.name &&
          b.calculatorVersion === originalItem.calculator.version &&
          b.unit === originalItem.unit
      );

      if (binding) {
        const val = Number(feature.value);
        if (!isNaN(val) && val >= binding.threshold) {
          reasonCodeSet.add("FEATURE_THRESHOLD_BREACHED");
          if (binding.tighten === "risk") {
            riskFloor = "elevated";
          } else if (binding.tighten === "confidence") {
            confidenceCeiling = "medium";
          } else if (binding.tighten === "capital") {
            capitalCap = Math.min(capitalCap ?? maxCapital, 50);
          } else if (binding.tighten === "range") {
            rangeBias = "tight";
          } else if (binding.tighten === "support") {
            if (val > 0) {
              extractedSupport.push(val);
            }
          } else if (binding.tighten === "resistance") {
            if (val > 0) {
              extractedResistance.push(val);
            }
          }
        }
      }
    }
  }

  let bullishCount = 0;
  let bearishCount = 0;
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
      if (
        claim.originalItem?.expiresAt &&
        Date.parse(claim.originalItem.expiresAt) < envelope.synthesisAtUnixMs
      ) {
        continue;
      }
      if (claim.direction === "bullish") {
        bullishCount++;
      } else if (claim.direction === "bearish") {
        bearishCount++;
      }
    }
  }

  const hasConflict =
    envelope.evidence.conflicts.length > 0 || (bullishCount > 0 && bearishCount > 0);

  if (hasConflict) {
    reasonCodeSet.add("CONTEXTUAL_EVIDENCE_VOTE");
    riskFloor = "elevated";
    confidenceCeiling = "low";
  } else if (bearishCount > bullishCount) {
    reasonCodeSet.add("CONTEXTUAL_EVIDENCE_VOTE");
    riskFloor = "elevated";
    capitalCap = Math.min(capitalCap ?? maxCapital, 50);
    const postureIndex = ruleset.postureOrder.indexOf(posture);
    if (postureIndex !== -1 && postureIndex < ruleset.postureOrder.length - 1) {
      posture = ruleset.postureOrder[postureIndex + 1];
    }
  } else if (bullishCount > bearishCount) {
    reasonCodeSet.add("CONTEXTUAL_EVIDENCE_VOTE");
    confidence = "high";
    const postureIndex = ruleset.postureOrder.indexOf(posture);
    if (postureIndex > 0) {
      posture = ruleset.postureOrder[postureIndex - 1];
    }
  }

  if (envelope.evidence.selected?.researchBrief) {
    reasonCodeSet.add("RESEARCH_BRIEF_ANALYSIS");
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

  const currentPrice = envelope.positionPlan?.position?.currentPrice ?? 100;
  const lowerBound = envelope.positionPlan?.position?.lowerBoundPrice ?? 95;
  const upperBound = envelope.positionPlan?.position?.upperBoundPrice ?? 110;

  const supportSet = new Set<string>();
  if (envelope.positionPlan) {
    supportSet.add(toDecimalString(lowerBound));
  }
  for (const s of extractedSupport) {
    if (s <= currentPrice && s > 0) {
      supportSet.add(toDecimalString(s));
    }
  }
  const sortedSupportArray = Array.from(supportSet)
    .map(Number)
    .sort((a, b) => b - a)
    .map(toDecimalString);

  const resistanceSet = new Set<string>();
  if (envelope.positionPlan) {
    resistanceSet.add(toDecimalString(upperBound));
  }
  for (const r of extractedResistance) {
    if (r >= currentPrice && r > 0) {
      resistanceSet.add(toDecimalString(r));
    }
  }
  const sortedResistanceArray = Array.from(resistanceSet)
    .map(Number)
    .sort((a, b) => a - b)
    .map(toDecimalString);

  const hasEligiblePriceLevels = supportSet.size > 0 || resistanceSet.size > 0;
  if (!hasEligiblePriceLevels) {
    reasonCodeSet.add("NO_ELIGIBLE_PRICE_LEVELS");
  }

  const finalSupports = sortedSupportArray.slice(0, 16);
  const finalResistances = sortedResistanceArray.slice(0, 16);

  const orderedReasonCodes = Array.from(reasonCodeSet);
  const boundedIdentifiers: string[] = [];

  if (envelope.evidence.selected?.deterministicFeatures) {
    for (const f of envelope.evidence.selected.deterministicFeatures) {
      boundedIdentifiers.push(f.candidateId);
    }
  }
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
      if (
        claim.originalItem?.expiresAt &&
        Date.parse(claim.originalItem.expiresAt) < envelope.synthesisAtUnixMs
      ) {
        continue;
      }
      boundedIdentifiers.push(claim.candidateId);
    }
  }
  if (envelope.evidence.selected?.researchBrief) {
    boundedIdentifiers.push(envelope.evidence.selected.researchBrief.candidateId);
  }

  const renderedReasoning = renderPolicyReasoning({
    orderedReasonCodes,
    boundedIdentifiers,
    reasonOrder: ruleset.reasonOrder
  });

  const derivedWarnings: string[] = [];
  if (hardStale) {
    derivedWarnings.push("market data is hard stale");
  }

  const renderedWarnings = renderPolicyWarnings({
    selection: envelope.evidence,
    derivedWarnings
  });

  const combinedReasoning = [...renderedReasoning, ...renderedWarnings].slice(0, 16);

  const sortedBundleRefs = envelope.evidence.bundles
    .filter((b) => b.status === "ACCEPTED")
    .map((b) => ({
      bundleHash:
        b.bundleHash as import("../../contract/policyInsight/v1/types.generated.js").Hex64,
      publisher:
        b.publisher as import("../../contract/policyInsight/v1/types.generated.js").Identifier,
      sourceId:
        b.sourceId as import("../../contract/policyInsight/v1/types.generated.js").Identifier,
      runId: b.runId as import("../../contract/policyInsight/v1/types.generated.js").Identifier
    }))
    .sort((a, b) => {
      if (a.bundleHash < b.bundleHash) return -1;
      if (a.bundleHash > b.bundleHash) return 1;
      return 0;
    });

  const sortedSourceRefs = envelope.evidence.sourceReferences
    .filter((ref) => ref.isSelectedLineage && !ref.isAuditOnly)
    .map((ref) => ({
      referenceId:
        ref.referenceId as import("../../contract/policyInsight/v1/types.generated.js").Identifier,
      sourceType: ref.sourceType as "api" | "database" | "chain" | "document" | "internal_bundle",
      locator: ref.locator,
      observedAt:
        ref.observedAt as import("../../contract/policyInsight/v1/types.generated.js").CanonicalTimestamp
    }))
    .sort((a, b) => {
      if (a.referenceId < b.referenceId) return -1;
      if (a.referenceId > b.referenceId) return 1;
      return 0;
    });

  const canonicalRecommendedAction = deriveCanonicalRecommendedAction({
    envelope,
    actionLock,
    postureLock,
    rangeState: positionRangeState ?? null,
    breachQualified,
    allowClmm
  });

  const reasonCodesTuple = orderedReasonCodes.slice(
    0,
    16
  ) as unknown as import("../../contract/policyInsight/v1/types.generated.js").ReasonCode[];

  const warningsTuple = renderedWarnings.slice(0, 16).map((w) => {
    const codeMatch = w.match(/^WARNING_([A-Z_]+):/);
    const code = codeMatch
      ? (codeMatch[1] as import("../../contract/policyInsight/v1/types.generated.js").WarningCode)
      : "MARKET_DATA_HARD_STALE";
    const message = w.replace(/^WARNING_[A-Z_]+: /, "");
    return { code, message } as Warning;
  }) as unknown as import("../../contract/policyInsight/v1/types.generated.js").Warning[];

  const reasoningString = combinedReasoning.join(" | ");

  const positionScopeValue =
    envelope.scope.kind === "position"
      ? {
          network: "solana-mainnet" as const,
          walletAddress: envelope.scope
            .walletAddress as import("../../contract/policyInsight/v1/types.generated.js").Identifier,
          whirlpoolAddress: envelope.scope
            .whirlpoolAddress as import("../../contract/policyInsight/v1/types.generated.js").Identifier,
          positionId: envelope.scope
            .positionId as import("../../contract/policyInsight/v1/types.generated.js").Identifier
        }
      : null;

  return {
    schemaVersion: "policy-insight.v1",
    rulesetVersion: ruleset.version,
    pair: "SOL/USDC",
    position: positionScopeValue,
    generatedAt: synthesisAt,
    asOf: synthesisAt,
    expiresAt: expiresAtIso,
    marketRegime: regime,
    fundamentalRegime: "UNKNOWN",
    posture: toUpperCasePosture(posture as LegacyPosture),
    recommendedAction: canonicalRecommendedAction,
    riskLevel: toUpperCaseRiskLevel(riskLevel as LegacyRiskLevel),
    clmmPolicy: {
      rangeBias: toUpperCaseRangeBias(rangeBias as LegacyRangeBias),
      rebalanceSensitivity: toUpperCaseRebalanceSensitivity(
        sensitivity as LegacyRebalanceSensitivity
      ),
      maxCapitalDeploymentBps: maxCapital * 100
    } as ClmmPolicy,
    levels: {
      supportsUsdcPerSol: finalSupports,
      resistancesUsdcPerSol: finalResistances
    } as Levels,
    evidence: {
      selectionStatus:
        envelope.evidence.mode === "FULL"
          ? "FULL"
          : envelope.evidence.mode === "PARTIAL"
            ? "PARTIAL"
            : "DEGRADED",
      selectionPolicyVersion: envelope.evidence
        .selectionPolicyVersion as import("../../contract/policyInsight/v1/types.generated.js").Identifier,
      selectedBundleRefs: sortedBundleRefs,
      selectedSourceRefs: sortedSourceRefs
    } as Evidence,
    confidenceBps: toConfidenceBps(confidence as LegacyConfidence),
    dataQuality: toDataQuality(hardStale, suitabilityBlocked),
    reasonCodes:
      reasonCodesTuple as import("../../contract/policyInsight/v1/types.generated.js").ReasonCode[],
    reasoning: reasoningString,
    warnings:
      warningsTuple as import("../../contract/policyInsight/v1/types.generated.js").Warning[]
  } as unknown as PolicyInsightContentDraft;
}
