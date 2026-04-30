import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import type { InsightCurrentResponse, InsightFreshness } from "../../contract/v1/insights.js";
import { rowToInsightWire } from "../../ledger/insightsStore.js";
import { InsightsStore } from "../../ledger/insightsStore.js";

export const createInsightsCurrentHandler = (insightsStore: InsightsStore | null) => {
  return async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!insightsStore) {
      return reply.code(503).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Insights store is not available (no DATABASE_URL configured)",
          details: []
        }
      });
    }

    const row = await insightsStore.getCurrent("SOL/USDC");

    if (!row) {
      return reply.code(404).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "INSIGHT_NOT_FOUND",
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
  };
};