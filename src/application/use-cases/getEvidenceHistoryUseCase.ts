import type { EvidenceBundleRepositoryPort } from "../ports/evidenceBundleRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";
import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type {
  EvidenceHistoryCursor,
  EvidenceSourceFilter
} from "../ports/evidenceBundleRepositoryPort.js";
import type { EvidenceBundleRecord } from "../ports/evidenceBundleRepositoryPort.js";

export type GetEvidenceHistoryUseCase = (input: {
  scope: Scope;
  source: EvidenceSourceFilter | null;
  limit: number;
  cursor: EvidenceHistoryCursor | null;
}) => Promise<{
  queriedAtUnixMs: number;
  records: EvidenceBundleRecord[];
  nextCursor: EvidenceHistoryCursor | null;
}>;

export interface GetEvidenceHistoryUseCaseDeps {
  repository: EvidenceBundleRepositoryPort;
  clock: ClockPort;
}

export const createGetEvidenceHistoryUseCase = (
  deps: GetEvidenceHistoryUseCaseDeps
): GetEvidenceHistoryUseCase => {
  return async (input) => {
    const queriedAtUnixMs = deps.clock.nowUnixMs();
    const result = await deps.repository.getHistory({
      pair: "SOL/USDC",
      scope: input.scope,
      source: input.source,
      limit: input.limit,
      cursor: input.cursor,
      nowUnixMs: queriedAtUnixMs
    });
    return {
      queriedAtUnixMs,
      records: result.records,
      nextCursor: result.nextCursor
    };
  };
};
