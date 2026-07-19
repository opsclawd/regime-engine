import type { SelectedEvidenceSummary } from "../evidence/selectEvidence.js";

// Precedence map based on SOL_USDC_POLICY_V1.reasonOrder
const REASON_PRECEDENCE: Record<string, number> = {
  DATA_HARD_STALE: 10,
  DATA_INSUFFICIENT_SAMPLES: 20,
  CLMM_BREACH_LOWER: 30,
  CLMM_BREACH_UPPER: 40,
  CHURN_STAND_DOWN_ACTIVE: 50,
  CHURN_COOLDOWN_ACTIVE: 60,
  MARKET_REGIME_UP: 70,
  MARKET_REGIME_DOWN: 80,
  MARKET_REGIME_CHOP: 90,
  FEATURE_THRESHOLD_BREACHED: 100,
  CONTEXTUAL_EVIDENCE_VOTE: 110,
  RESEARCH_BRIEF_ANALYSIS: 120
};

export function renderPolicyReasoning(input: {
  readonly orderedReasonCodes: readonly string[];
  readonly boundedIdentifiers: readonly string[];
}): readonly string[] {
  const result: string[] = [];

  // Always include ADVISORY_ONLY as part of the reasoning
  result.push("ADVISORY_ONLY: This insight is advisory and holds no execution authority");

  // Sort reason codes by precedence then lexicographically
  const sortedCodes = [...input.orderedReasonCodes].sort((a, b) => {
    const precA = REASON_PRECEDENCE[a] ?? 999;
    const precB = REASON_PRECEDENCE[b] ?? 999;
    if (precA !== precB) {
      return precA - precB;
    }
    return a.localeCompare(b);
  });

  for (const code of sortedCodes) {
    result.push(code);
  }

  // Include bounded identifiers (features, claims, briefs, etc.)
  for (const ident of input.boundedIdentifiers) {
    result.push(`IDENTIFIER: ${ident}`);
  }

  // Cap strings to 1024 characters and array length to 16
  return result
    .map((str) => (str.length > 1024 ? str.substring(0, 1021) + "..." : str))
    .slice(0, 16);
}

export function renderPolicyWarnings(input: {
  readonly selection: SelectedEvidenceSummary;
  readonly derivedWarnings: readonly string[];
}): readonly string[] {
  const result: string[] = [];

  // Map #60 warnings from selected evidence summary without losing original lineage
  if (input.selection.warnings) {
    for (const w of input.selection.warnings) {
      result.push(`WARNING_${w.code.toUpperCase()}: ${w.message}`);
    }
  }

  // Add derived warnings from synthesis
  for (const dw of input.derivedWarnings) {
    result.push(`DERIVED_WARNING: ${dw}`);
  }

  // Cap strings to 1024 characters and array length to 16
  return result
    .map((str) => (str.length > 1024 ? str.substring(0, 1021) + "..." : str))
    .slice(0, 16);
}
