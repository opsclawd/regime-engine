import type { SelectedEvidenceSummary } from "../evidence/selectEvidence.js";

export function renderPolicyReasoning(input: {
  readonly orderedReasonCodes: readonly string[];
  readonly boundedIdentifiers: readonly string[];
  readonly reasonOrder: Readonly<Record<string, number>>;
}): readonly string[] {
  const result: string[] = [];

  // Always include ADVISORY_ONLY as part of the reasoning
  result.push("ADVISORY_ONLY: This insight is advisory and holds no execution authority");

  // Sort reason codes by precedence then lexicographically
  const sortedCodes = [...input.orderedReasonCodes].sort((a, b) => {
    const precA = input.reasonOrder[a] ?? 999;
    const precB = input.reasonOrder[b] ?? 999;
    if (precA !== precB) {
      return precA - precB;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });

  for (const code of sortedCodes) {
    result.push(code);
  }

  // Include bounded identifiers (features, claims, briefs, etc.) sorted lexicographically
  const sortedIdentifiers = [...input.boundedIdentifiers].sort((a, b) => {
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const ident of sortedIdentifiers) {
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
