import type {
  PolicyInsightRepositoryPort,
  StoredPolicyInsight
} from "../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";

export class PolicyInsightNotFoundError extends Error {
  constructor(message = "Policy insight not found") {
    super(message);
    this.name = "PolicyInsightNotFoundError";
  }
}

export type GetCurrentPolicyInsightUseCase = (input: {
  readonly pair: "SOL/USDC";
  readonly scopeKey: string;
}) => Promise<{
  readonly queriedAtUnixMs: number;
  readonly record: StoredPolicyInsight;
}>;

export interface GetCurrentPolicyInsightUseCaseDeps {
  readonly repository: PolicyInsightRepositoryPort;
  readonly clock: ClockPort;
}

export const createGetCurrentPolicyInsightUseCase = (
  deps: GetCurrentPolicyInsightUseCaseDeps
): GetCurrentPolicyInsightUseCase => {
  return async (input) => {
    const queriedAtUnixMs = deps.clock.nowUnixMs();
    const record = await deps.repository.getCurrent(input);
    if (!record) {
      throw new PolicyInsightNotFoundError(
        `No current policy insight found for pair="${input.pair}", scopeKey="${input.scopeKey}"`
      );
    }
    return {
      queriedAtUnixMs,
      record
    };
  };
};
