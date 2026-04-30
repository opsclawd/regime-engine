import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import type { InsightCurrentResponse, InsightFreshness } from "../../contract/v1/insights.js";
import { rowToInsightWire, InsightsStore } from "../../ledger/insightsStore.js";
import { ERROR_CODES } from "../errors.js";

export const createInsightsCurrentHandler = (insightsStore: InsightsStore | null) => {
  return async (_request: FastifyRequest, reply: FastifyReply) => {
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

    try {
      const row = await insightsStore.getCurrent("SOL/USDC");

      if (!row) {
        return reply.code(404).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.INSIGHT_NOT_FOUND,
            message: "No insight found for pair SOL/USDC",
            details: []
          }
        });
      }

      const nowUnixMs = Date.now();
      const ageSeconds = Math.floor((nowUnixMs - row.asOfUnixMs) / 1000);
      const stale = nowUnixMs > row.expiresAtUnixMs;

      const freshness: InsightFreshness = {
        generatedAtIso: new Date(row.asOfUnixMs).toISOString(),
        expiresAtIso: new Date(row.expiresAtUnixMs).toISOString(),
        ageSeconds,
        stale
      };

      const wirePayload = rowToInsightWire(row);

      const response: InsightCurrentResponse = {
        ...wirePayload,
        status: stale ? "STALE" : "FRESH",
        payloadHash: row.payloadHash,
        receivedAtIso: new Date(row.receivedAtUnixMs).toISOString(),
        freshness
      };

      return reply.code(200).send(response);
    } catch (error) {
      _request.log.error(error, "Unhandled error in GET /v1/insights/sol-usdc/current");
      return reply.code(500).send({
        schemaVersion: SCHEMA_VERSION,
        error: { code: ERROR_CODES.INTERNAL_ERROR, message: "Internal server error", details: [] }
      });
    }
  };
};
