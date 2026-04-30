import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import type { InsightHistoryResponse, InsightHistoryItem } from "../../contract/v1/insights.js";
import { rowToInsightWire, InsightsStore } from "../../ledger/insightsStore.js";
import { ERROR_CODES } from "../errors.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const createInsightsHistoryHandler = (insightsStore: InsightsStore | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!insightsStore) {
      return reply.code(503).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: "Insights store is not available (no DATABASE_URL configured)",
          details: []
        }
      });
    }

    const rawLimit = (request.query as Record<string, string | undefined>).limit;
    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return reply.code(400).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: `limit must be an integer between 1 and ${MAX_LIMIT}`,
            details: []
          }
        });
      }
      limit = parsed;
    }

    try {
      const rows = await insightsStore.getHistory("SOL/USDC", limit);

      const items: InsightHistoryItem[] = rows.map((row) => ({
        ...rowToInsightWire(row),
        payloadHash: row.payloadHash,
        receivedAtIso: new Date(row.receivedAtUnixMs).toISOString()
      }));

      const response: InsightHistoryResponse = {
        schemaVersion: SCHEMA_VERSION,
        pair: "SOL/USDC",
        limit,
        items
      };

      return reply.code(200).send(response);
    } catch (error) {
      request.log.error(error, "Unhandled error in GET /v1/insights/sol-usdc/history");
      return reply.code(500).send({
        schemaVersion: SCHEMA_VERSION,
        error: { code: ERROR_CODES.INTERNAL_ERROR, message: "Internal server error", details: [] }
      });
    }
  };
};