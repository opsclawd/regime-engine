import type {
  PolicyInsightRepositoryPort,
  PolicyInsightHistoryCursor
} from "../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";
import type { InsightHistoryItem, InsightHistoryResponse } from "../../contract/v1/insights.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";

export type GetPolicyInsightHistoryUseCase = (input: {
  readonly pair: "SOL/USDC";
  readonly scopeKey: string;
  readonly limit: number;
  readonly cursor: PolicyInsightHistoryCursor | null;
}) => Promise<
  InsightHistoryResponse & {
    readonly queriedAtUnixMs: number;
    readonly nextCursor: PolicyInsightHistoryCursor | null;
  }
>;

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
      schemaVersion: SCHEMA_VERSION,
      pair: input.pair,
      limit: input.limit,
      items,
      queriedAtUnixMs,
      nextCursor: result.nextCursor
    };
  };
};
