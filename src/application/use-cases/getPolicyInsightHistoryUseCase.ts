import type { PolicyInsightHistoryResponse } from "../../contract/policyInsight/v1/types.generated.js";
export const POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256 =
  "80487b0a9374d0b535accf535ef9819f2b2de00e1d65980deb73c97afaa02800";
import { projectPolicyInsightHistoryResponse } from "../../contract/policyInsight/v1/project.js";
import type {
  PolicyInsightRepositoryPort,
  PolicyInsightHistoryCursor
} from "../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";
import { PolicyInsightValidationError } from "../errors/policyInsightErrors.js";

export function encodeHistoryCursor(cursor: PolicyInsightHistoryCursor): string {
  const obj = {
    v: 1,
    generatedAtUnixMs: cursor.generatedAtUnixMs,
    id: cursor.id
  };
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

export function decodeHistoryCursor(encoded: string): PolicyInsightHistoryCursor {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const obj = JSON.parse(json);
    if (obj.v !== 1 || typeof obj.generatedAtUnixMs !== "number" || typeof obj.id !== "number") {
      throw new Error("Invalid cursor structure");
    }
    return {
      generatedAtUnixMs: obj.generatedAtUnixMs,
      id: obj.id
    };
  } catch {
    throw new Error("Invalid cursor format");
  }
}

export type GetPolicyInsightHistoryUseCase = (input: {
  readonly pair: "SOL/USDC";
  readonly scopeKey: string;
  readonly limit: number;
  readonly cursor: string | null;
}) => Promise<PolicyInsightHistoryResponse>;

export interface GetPolicyInsightHistoryUseCaseDeps {
  readonly repository: PolicyInsightRepositoryPort;
  readonly clock: ClockPort;
}

export const createGetPolicyInsightHistoryUseCase = (
  deps: GetPolicyInsightHistoryUseCaseDeps
): GetPolicyInsightHistoryUseCase => {
  return async (input) => {
    const queriedAtUnixMs = deps.clock.nowUnixMs();
    let repoCursor: PolicyInsightHistoryCursor | null = null;
    if (input.cursor !== null) {
      try {
        repoCursor = decodeHistoryCursor(input.cursor);
      } catch (err) {
        throw new PolicyInsightValidationError("Invalid pagination cursor", { cause: err });
      }
    }

    if (input.limit < 1 || input.limit > 100) {
      throw new PolicyInsightValidationError("History limit must be between 1 and 100");
    }

    const result = await deps.repository.getHistory({
      pair: input.pair,
      scopeKey: input.scopeKey,
      limit: input.limit,
      cursor: repoCursor,
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });

    const contents = result.records.map((record) => record.synthesisOutputJson);
    const projectResult = projectPolicyInsightHistoryResponse(
      contents,
      input.limit,
      input.cursor,
      queriedAtUnixMs
    );
    if (!projectResult.ok) {
      throw new PolicyInsightValidationError(
        "Failed to project policy insight history: " + JSON.stringify(projectResult.issues)
      );
    }

    const response = projectResult.value;
    return {
      ...response,
      nextCursor: result.nextCursor ? encodeHistoryCursor(result.nextCursor) : null
    };
  };
};
