import type { EvidenceBundleRepositoryPort } from "../ports/evidenceBundleRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";
import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type { EvidenceSourceFilter } from "../ports/evidenceBundleRepositoryPort.js";
import type { EvidenceBundleRecord } from "../ports/evidenceBundleRepositoryPort.js";

export type GetCurrentEvidenceUseCase = (input: {
  scope: Scope;
  source: EvidenceSourceFilter | null;
}) => Promise<{ queriedAtUnixMs: number; records: EvidenceBundleRecord[] }>;

export interface GetCurrentEvidenceUseCaseDeps {
  repository: EvidenceBundleRepositoryPort;
  clock: ClockPort;
}

export const createGetCurrentEvidenceUseCase = (
  deps: GetCurrentEvidenceUseCaseDeps
): GetCurrentEvidenceUseCase => {
  return async (input) => {
    const nowUnixMs = deps.clock.nowUnixMs();
    const records = await deps.repository.getLatest({
      pair: "SOL/USDC",
      scope: input.scope,
      source: input.source,
      nowUnixMs
    });
    return { queriedAtUnixMs: nowUnixMs, records };
  };
};
