import type {
  PolicyInsightRepositoryPort,
  PolicyInsightHistoryCursor,
  StoredPolicyInsight
} from "../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";

export type GetPolicyInsightHistoryUseCase = (input: {
  readonly pair: "SOL/USDC";
  readonly scopeKey: string;
  readonly limit: number;
  readonly cursor: PolicyInsightHistoryCursor | null;
}) => Promise<{
  readonly queriedAtUnixMs: number;
  readonly records: readonly StoredPolicyInsight[];
  readonly nextCursor: PolicyInsightHistoryCursor | null;
}>;

export interface GetPolicyInsightHistoryUseCaseDeps {
  readonly repository: PolicyInsightRepositoryPort;
  readonly clock: ClockPort;
}

export const createGetPolicyInsightHistoryUseCase = (
  deps: GetPolicyInsightHistoryUseCaseDeps
): GetPolicyInsightHistoryUseCase => {
  return async (input) => {
    const queriedAtUnixMs = deps.clock.nowUnixMs();
    const result = await deps.repository.getHistory(input);
    return {
      queriedAtUnixMs,
      records: result.records,
      nextCursor: result.nextCursor
    };
  };
};
