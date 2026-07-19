import type {
  PolicyInsightRepositoryPort,
  PolicyInsightHistoryCursor
} from "../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";
import type { InsightHistoryItem } from "../../contract/v1/insights.js";

export type GetPolicyInsightHistoryUseCase = (input: {
  readonly pair: "SOL/USDC";
  readonly scopeKey: string;
  readonly limit: number;
  readonly cursor: PolicyInsightHistoryCursor | null;
}) => Promise<{
  readonly queriedAtUnixMs: number;
  readonly items: readonly InsightHistoryItem[];
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
    const items = result.records.map(
      (record): InsightHistoryItem => ({
        ...record.synthesisOutputJson,
        payloadHash: record.payloadHash,
        receivedAtIso: new Date(record.persistedAtUnixMs).toISOString()
      })
    );
    return {
      queriedAtUnixMs,
      items,
      nextCursor: result.nextCursor
    };
  };
};
