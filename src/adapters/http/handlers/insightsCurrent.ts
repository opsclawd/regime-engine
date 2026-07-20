import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../../contract/v1/types.js";
import type { InsightCurrentResponse, InsightFreshness } from "../../../contract/v1/insights.js";
import { ERROR_CODES, ContractValidationError } from "../../../contract/v1/errors.js";
import type { GetCurrentPolicyInsightUseCase } from "../../../application/use-cases/getCurrentPolicyInsightUseCase.js";
import { PolicyInsightNotFoundError } from "../../../application/use-cases/getCurrentPolicyInsightUseCase.js";
import { PolicyInsightStoreUnavailableError } from "../../../application/errors/policyInsightErrors.js";

const CURRENT_ALLOWED_KEYS = new Set(["scope", "walletAddress", "whirlpoolAddress", "positionId"]);

const LENGTH_PREFIX = (s: string): string => `${s.length}:${s}`;

function parseIdentifier(value: unknown, fieldName: string): string {
  if (value === undefined || typeof value !== "string" || value.trim() === "") {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `${fieldName} must be a non-empty string`,
        details: [
          {
            path: `$.${fieldName}`,
            code: "INVALID_TYPE",
            message: `Expected string, received ${typeof value}`
          }
        ]
      }
    });
  }

  if (value.length < 1 || value.length > 128) {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `${fieldName} must be between 1 and 128 characters`,
        details: [
          {
            path: `$.${fieldName}`,
            code: "OUT_OF_RANGE",
            message: `${fieldName} length ${value.length} is out of range`
          }
        ]
      }
    });
  }

  return value;
}

export function parsePolicyInsightCurrentQuery(query: Record<string, unknown>): {
  scopeKey: string;
} {
  // Check extra keys
  const extraKeys = Object.keys(query).filter((k) => !CURRENT_ALLOWED_KEYS.has(k));
  if (extraKeys.length > 0) {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Unknown query parameters: ${extraKeys.join(", ")}`,
        details: extraKeys.map((k) => ({
          path: `$.${k}`,
          code: "UNKNOWN_KEY",
          message: `Unexpected key: ${k}`
        }))
      }
    });
  }

  const scopeValue = query.scope;

  if (scopeValue === undefined || scopeValue === "" || scopeValue === "pair") {
    // Check inapplicable params
    const inapplicable = ["walletAddress", "whirlpoolAddress", "positionId"].filter(
      (k) => query[k] !== undefined
    );
    if (inapplicable.length > 0) {
      throw new ContractValidationError(400, {
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: `Parameter '${inapplicable[0]}' is not applicable for the specified scope`,
          details: inapplicable.map((k) => ({
            path: `$.${k}`,
            code: "INVALID_VALUE",
            message: `Parameter '${k}' is not applicable`
          }))
        }
      });
    }
    return { scopeKey: "pair" };
  }

  if (typeof scopeValue !== "string") {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "scope must be a string",
        details: [
          {
            path: "$.scope",
            code: "INVALID_TYPE",
            message: `Expected string, received ${typeof scopeValue}`
          }
        ]
      }
    });
  }

  if (scopeValue === "position") {
    const wallet = parseIdentifier(query.walletAddress, "walletAddress");
    const pool = parseIdentifier(query.whirlpoolAddress, "whirlpoolAddress");
    const posId = parseIdentifier(query.positionId, "positionId");

    const scopeKey =
      "position:" + LENGTH_PREFIX(wallet) + LENGTH_PREFIX(pool) + LENGTH_PREFIX(posId);

    return { scopeKey };
  }

  throw new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: `Invalid scope kind: ${scopeValue}`,
      details: [
        {
          path: "$.scope",
          code: "INVALID_VALUE",
          message: `Unknown scope kind: ${scopeValue}`
        }
      ]
    }
  });
}

export const createInsightsCurrentHandler = (useCase: GetCurrentPolicyInsightUseCase | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!useCase) {
      return reply.code(503).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: "Insights store is not available (no DATABASE_URL configured)",
          details: []
        }
      });
    }

    try {
      const { scopeKey } = parsePolicyInsightCurrentQuery(request.query as Record<string, unknown>);

      const result = await useCase({
        pair: "SOL/USDC",
        scopeKey
      });

      const record = result.record;
      const nowUnixMs = Date.now();
      const ageSeconds = Math.floor((nowUnixMs - record.asOfUnixMs) / 1000);
      const stale = nowUnixMs >= record.expiresAtUnixMs;

      const freshness: InsightFreshness = {
        generatedAtIso: new Date(record.asOfUnixMs).toISOString(),
        expiresAtIso: new Date(record.expiresAtUnixMs).toISOString(),
        ageSeconds,
        stale
      };

      const response: InsightCurrentResponse = {
        ...record.synthesisOutputJson,
        status: stale ? "STALE" : "FRESH",
        payloadHash: record.payloadHash,
        receivedAtIso: new Date(record.persistedAtUnixMs).toISOString(),
        freshness
      };

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof PolicyInsightNotFoundError) {
        return reply.code(404).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.INSIGHT_NOT_FOUND,
            message: error.message,
            details: []
          }
        });
      }

      if (error instanceof PolicyInsightStoreUnavailableError) {
        return reply.code(503).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.SERVICE_UNAVAILABLE,
            message: error.message,
            details: []
          }
        });
      }

      request.log.error(error, "Unhandled error in GET /v1/insights/sol-usdc/current");
      return reply.code(500).send({
        schemaVersion: SCHEMA_VERSION,
        error: { code: ERROR_CODES.INTERNAL_ERROR, message: "Internal server error", details: [] }
      });
    }
  };
};
