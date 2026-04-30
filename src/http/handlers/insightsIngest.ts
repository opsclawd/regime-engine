import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import type {
  InsightIngestCreatedResponse,
  InsightIngestAlreadyIngestedResponse
} from "../../contract/v1/insights.js";
import { parseInsightIngestRequest, computeInsightCanonicalAndHash } from "../../contract/v1/insights.js";
import { InsightsStore, InsightConflictError } from "../../ledger/insightsStore.js";
import { AuthError, requireSharedSecret } from "../auth.js";
import { ContractValidationError } from "../errors.js";

export const createInsightsIngestHandler = (insightsStore: InsightsStore | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
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

    try {
      requireSharedSecret(request.headers, "X-Insight-Ingest-Token", "INSIGHT_INGEST_TOKEN");

      const parsed = parseInsightIngestRequest(request.body);
      const { hash, canonical } = computeInsightCanonicalAndHash(parsed);
      const receivedAtUnixMs = Date.now();

      const result = await insightsStore.insertInsight({
        request: parsed,
        payloadCanonical: canonical,
        payloadHash: hash,
        receivedAtUnixMs
      });

      if (result.status === "created") {
        const response: InsightIngestCreatedResponse = {
          schemaVersion: SCHEMA_VERSION,
          status: "created",
          runId: parsed.runId,
          payloadHash: hash,
          receivedAtIso: new Date(receivedAtUnixMs).toISOString()
        };
        return reply.code(201).send(response);
      }

      const response: InsightIngestAlreadyIngestedResponse = {
        schemaVersion: SCHEMA_VERSION,
        status: "already_ingested",
        runId: parsed.runId,
        payloadHash: result.row.payloadHash
      };
      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof InsightConflictError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: "INSIGHT_RUN_CONFLICT",
            message: `Insight conflict for source="${error.source}", runId="${error.runId}"`,
            details: []
          }
        });
      }
      request.log.error(error, "Unhandled error in POST /v1/insights/sol-usdc");
      return reply.code(500).send({
        schemaVersion: SCHEMA_VERSION,
        error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] }
      });
    }
  };
};