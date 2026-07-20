import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../../contract/v1/types.js";
import { ERROR_CODES, ContractValidationError } from "../../../contract/v1/errors.js";
import type { GetPolicyInsightHistoryUseCase } from "../../../application/use-cases/getPolicyInsightHistoryUseCase.js";
import { PolicyInsightStoreUnavailableError } from "../../../application/errors/policyInsightErrors.js";
import type { PolicyInsightHistoryCursor } from "../../../application/ports/policyInsightRepositoryPort.js";
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
const MAX_LIMIT = 200;
const POLICY_INSIGHT_CURSOR_VERSION = 1;

export function encodePolicyInsightCursor(cursor: PolicyInsightHistoryCursor): string {
  const obj = {
    v: POLICY_INSIGHT_CURSOR_VERSION,
    generatedAtUnixMs: cursor.generatedAtUnixMs,
    id: cursor.id
  };
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

export function decodePolicyInsightCursor(encoded: string): PolicyInsightHistoryCursor {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Cursor must be valid base64url",
        details: [
          {
            path: "$.cursor",
            code: "INVALID_VALUE",
            message: "Invalid base64url encoding"
          }
        ]
      }
    });
  }

  let json: string;
  try {
    json = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Cursor decoding failed",
        details: [
          {
            path: "$.cursor",
            code: "INVALID_VALUE",
            message: "Failed to decode base64url"
          }
        ]
      }
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Cursor must be valid JSON",
        details: [
          {
            path: "$.cursor",
            code: "INVALID_VALUE",
            message: "Invalid JSON in cursor"
          }
        ]
      }
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Cursor must be an object",
        details: [
          {
            path: "$.cursor",
            code: "INVALID_TYPE",
            message: "Expected object"
          }
        ]
      }
    });
  }

  const obj = parsed as Record<string, unknown>;

  if (obj["v"] === undefined) {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Cursor missing version field",
        details: [
          {
            path: "$.cursor.v",
            code: "REQUIRED",
            message: "Missing required field: v"
          }
        ]
      }
    });
  }

  if (obj["v"] !== POLICY_INSIGHT_CURSOR_VERSION) {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: `Unsupported cursor version: ${obj["v"]}`,
        details: [
          {
            path: "$.cursor.v",
            code: "INVALID_VALUE",
            message: `Expected version ${POLICY_INSIGHT_CURSOR_VERSION}`
          }
        ]
      }
    });
  }

  if (
    typeof obj["generatedAtUnixMs"] !== "number" ||
    !Number.isInteger(obj["generatedAtUnixMs"]) ||
    obj["generatedAtUnixMs"] < 0
  ) {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Cursor generatedAtUnixMs must be a non-negative integer",
        details: [
          {
            path: "$.cursor.generatedAtUnixMs",
            code: "INVALID_TYPE",
            message: "Expected non-negative integer"
          }
        ]
      }
    });
  }

  if (typeof obj["id"] !== "number" || !Number.isInteger(obj["id"]) || obj["id"] <= 0) {
    throw new ContractValidationError(400, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Cursor id must be a positive integer",
        details: [
          {
            path: "$.cursor.id",
            code: "INVALID_TYPE",
            message: "Expected positive integer"
          }
        ]
      }
    });
  }

  return {
    generatedAtUnixMs: obj["generatedAtUnixMs"],
    id: obj["id"]
  };
}

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

        if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
          throw new ContractValidationError(400, {
            schemaVersion: SCHEMA_VERSION,
            error: {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
              details: [
                {
                  path: "$.limit",
                  code: "OUT_OF_RANGE",
                  message: `limit is out of range: ${parsed}`
                }
              ]
            }
          });
        }
        limit = parsed;
      }

      // Parse cursor
      const rawCursor = query.cursor;
      let cursor: PolicyInsightHistoryCursor | null = null;
      if (rawCursor !== undefined) {
        if (typeof rawCursor !== "string") {
          throw new ContractValidationError(400, {
            schemaVersion: SCHEMA_VERSION,
            error: {
              code: ERROR_CODES.VALIDATION_ERROR,
              message: "cursor must be a string",
              details: [
                {
                  path: "$.cursor",
                  code: "INVALID_TYPE",
                  message: "Expected string"
                }
              ]
            }
          });
        }
        cursor = decodePolicyInsightCursor(rawCursor);
      }

      const result = await useCase({
        pair: "SOL/USDC",
        scopeKey,
        limit,
        cursor
      });

      return reply.code(200).send({
        schemaVersion: SCHEMA_VERSION,
        pair: "SOL/USDC",
        limit,
        items: result.items,
        nextCursor: result.nextCursor ? encodePolicyInsightCursor(result.nextCursor) : null
      });
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
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
