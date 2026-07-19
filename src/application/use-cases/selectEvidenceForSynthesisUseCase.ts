import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type { EvidenceBundleRepositoryPort } from "../ports/evidenceBundleRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";
import type { EvidenceSelectionPolicy } from "../../engine/evidence/selectionPolicy.js";
import { EVIDENCE_SELECTION_POLICY_V1 } from "../../engine/evidence/selectionPolicy.js";
import type {
  SelectedEvidenceSummary,
  SelectEvidenceInput
} from "../../engine/evidence/selectEvidence.js";
import { selectEvidence } from "../../engine/evidence/selectEvidence.js";

export type SelectEvidenceForSynthesisUseCase = (input: {
  readonly scope: Scope;
}) => Promise<SelectedEvidenceSummary>;

export interface SelectEvidenceForSynthesisUseCaseDeps {
  readonly repository: EvidenceBundleRepositoryPort;
  readonly clock: ClockPort;
  readonly selector?: (input: SelectEvidenceInput) => SelectedEvidenceSummary;
  readonly policy?: EvidenceSelectionPolicy;
}

export const createSelectEvidenceForSynthesisUseCase =
  (deps: SelectEvidenceForSynthesisUseCaseDeps): SelectEvidenceForSynthesisUseCase =>
  async ({ scope }) => {
    const selectedAtUnixMs = deps.clock.nowUnixMs();
    const records = await deps.repository.getLatest({
      pair: "SOL/USDC",
      scope,
      source: null,
      nowUnixMs: selectedAtUnixMs
    });
    return (deps.selector ?? selectEvidence)({
      records,
      selectedAtUnixMs,
      scope,
      policy: deps.policy ?? EVIDENCE_SELECTION_POLICY_V1
    });
  };
