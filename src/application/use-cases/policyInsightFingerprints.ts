import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type {
  RegimeCurrentResponse,
  PlanRequestPosition,
  PlanResponse
} from "../../contract/v1/types.js";
import type { SelectedEvidenceSummary } from "../../engine/evidence/selectEvidence.js";
import { sha256Hex } from "../../contract/v1/hash.js";
import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { evidenceScopeKey } from "../ports/evidenceBundleRepositoryPort.js";

export interface FingerprintsInput {
  readonly rulesetVersion: string;
  readonly pair: "SOL/USDC";
  readonly scope: Scope;
  readonly market: RegimeCurrentResponse;
  readonly positionPlan: {
    readonly position: PlanRequestPosition;
    readonly plan: PlanResponse;
  } | null;
  readonly evidence: SelectedEvidenceSummary;
}

export interface PolicyInsightFingerprints {
  readonly marketHash: string;
  readonly positionHash: string;
  readonly selectionHash: string;
  readonly synthesisInputHash: string;
}

export function computePolicyInsightFingerprints(
  input: FingerprintsInput
): PolicyInsightFingerprints {
  // 1. marketHash: regime snapshot excluding presentation-only moving fields such as `ageSeconds`
  const marketCopy = JSON.parse(JSON.stringify(input.market));
  if (marketCopy.freshness) {
    delete marketCopy.freshness.ageSeconds;
  }
  const marketHash = sha256Hex(toCanonicalJson(marketCopy));

  // 2. positionHash: canonicalize and SHA-256 the position/plan or NONE
  let positionHash = "";
  if (input.positionPlan) {
    positionHash = sha256Hex(toCanonicalJson(input.positionPlan));
  } else {
    positionHash = sha256Hex(toCanonicalJson("NONE"));
  }

  // 3. selectionHash: full selection result excluding only presentation-time fields (selectedAtUnixMs)
  const selectionCopy = JSON.parse(JSON.stringify(input.evidence));
  delete selectionCopy.selectedAtUnixMs;
  const selectionHash = sha256Hex(toCanonicalJson(selectionCopy));

  // 4. synthesisInputHash: hash ruleset+pair+scope+component hashes
  const scopeKey = evidenceScopeKey(input.scope);
  const inputForHash = {
    rulesetVersion: input.rulesetVersion,
    pair: input.pair,
    scopeKey,
    marketHash,
    positionHash,
    selectionHash
  };
  const synthesisInputHash = sha256Hex(toCanonicalJson(inputForHash));

  return {
    marketHash,
    positionHash,
    selectionHash,
    synthesisInputHash
  };
}
