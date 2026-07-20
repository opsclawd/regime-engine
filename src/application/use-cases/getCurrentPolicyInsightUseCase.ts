import type { PolicyInsightRead } from "../../contract/policyInsight/v1/types.generated.js";
export const POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256 =
  "80487b0a9374d0b535accf535ef9819f2b2de00e1d65980deb73c97afaa02800";
import { projectPolicyInsightRead } from "../../contract/policyInsight/v1/project.js";
import type { PolicyInsightRepositoryPort } from "../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";
import { PolicyInsightValidationError } from "../errors/policyInsightErrors.js";

export class PolicyInsightNotFoundError extends Error {
  constructor(message = "Policy insight not found") {
    super(message);
    this.name = "PolicyInsightNotFoundError";
  }
}

export type GetCurrentPolicyInsightUseCase = (input: {
  readonly pair: "SOL/USDC";
  readonly scopeKey: string;
}) => Promise<PolicyInsightRead>;

export interface GetCurrentPolicyInsightUseCaseDeps {
  readonly repository: PolicyInsightRepositoryPort;
  readonly clock: ClockPort;
}

export const createGetCurrentPolicyInsightUseCase = (
  deps: GetCurrentPolicyInsightUseCaseDeps
): GetCurrentPolicyInsightUseCase => {
  return async (input) => {
    const queriedAtUnixMs = deps.clock.nowUnixMs();
    const record = await deps.repository.getCurrent({
      pair: input.pair,
      scopeKey: input.scopeKey,
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });
    if (!record) {
      throw new PolicyInsightNotFoundError(
        `No current policy insight found for pair="${input.pair}", scopeKey="${input.scopeKey}"`
      );
    }
    const result = projectPolicyInsightRead(record.synthesisOutputJson, queriedAtUnixMs);
    if (!result.ok) {
      throw new PolicyInsightValidationError(
        "Failed to project policy insight: " + JSON.stringify(result.issues)
      );
    }
    return result.value;
  };
};
