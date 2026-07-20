import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../../contract/v1/types.js";
import { ERROR_CODES, ContractValidationError } from "../../../contract/v1/errors.js";
import type { GetPolicyInsightHistoryUseCase } from "../../../application/use-cases/getPolicyInsightHistoryUseCase.js";
import {
  PolicyInsightStoreUnavailableError,
  PolicyInsightValidationError
} from "../../../application/errors/policyInsightErrors.js";
import { parsePolicyInsightCurrentQuery } from "./insightsCurrent.js";

const HISTORY_ALLOWED_KEYS = new Set([
  "scope",
  "walletAddress",
  "whirlpoolAddress",
  "positionId",
  "limit",
  "cursor"
]);

const DEFAULT_LIMIT = 50;

export const createInsightsHistoryHandler = (useCase: GetPolicyInsightHistoryUseCase | null) => {
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
      const query = request.query as Record<string, unknown>;

      // Validate extra keys
      const extraKeys = Object.keys(query).filter((k) => !HISTORY_ALLOWED_KEYS.has(k));
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

      // Extract scope parameters for parsePolicyInsightCurrentQuery
      const currentQueryParams: Record<string, unknown> = {};
      if (query.scope !== undefined) currentQueryParams.scope = query.scope;
      if (query.walletAddress !== undefined) currentQueryParams.walletAddress = query.walletAddress;
      if (query.whirlpoolAddress !== undefined)
        currentQueryParams.whirlpoolAddress = query.whirlpoolAddress;
      if (query.positionId !== undefined) currentQueryParams.positionId = query.positionId;

      const { scopeKey } = parsePolicyInsightCurrentQuery(currentQueryParams);

      // Parse limit
      const rawLimit = query.limit;
      let limit = DEFAULT_LIMIT;
      if (rawLimit !== undefined) {
        let parsed: number;
        if (typeof rawLimit === "number") {
          parsed = rawLimit;
        } else if (typeof rawLimit === "string") {
          const trimmed = rawLimit.trim();
          if (trimmed === "" || !/^\d+$/.test(trimmed)) {
            throw new ContractValidationError(400, {
              schemaVersion: SCHEMA_VERSION,
              error: {
                code: ERROR_CODES.VALIDATION_ERROR,
                message: "limit must be an integer string",
                details: [
                  {
                    path: "$.limit",
                    code: "INVALID_VALUE",
                    message: "Invalid integer"
                  }
                ]
              }
            });
          }
          parsed = Number(trimmed);
        } else {
          throw new ContractValidationError(400, {
            schemaVersion: SCHEMA_VERSION,
            error: {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: "limit must be a number or integer string",
              details: [
                {
                  path: "$.limit",
                  code: "INVALID_TYPE",
                  message: "Invalid type"
                }
              ]
            }
          });
        }
        limit = parsed;
      }

      // Cursor: pass string cursor directly to the use case (validation is handled inside the use case)
      const cursor = typeof query.cursor === "string" ? query.cursor : null;

      const result = await useCase({
        pair: "SOL/USDC",
        scopeKey,
        limit,
        cursor
      });

      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof PolicyInsightValidationError) {
        return reply.code(400).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
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

      request.log.error(error, "Unhandled error in GET /v1/insights/sol-usdc/history");
      return reply.code(500).send({
        schemaVersion: SCHEMA_VERSION,
        error: { code: ERROR_CODES.INTERNAL_ERROR, message: "Internal server error", details: [] }
      });
    }
  };
};
