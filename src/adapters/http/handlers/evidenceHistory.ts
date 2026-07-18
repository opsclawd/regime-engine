import type { FastifyReply, FastifyRequest } from "fastify";
import {
  EVIDENCE_SCHEMA_VERSION,
  parseEvidenceHistoryQuery,
  toEvidenceWireItem,
  encodeEvidenceCursor,
  EvidenceHttpValidationError,
  evidenceErrorResponse
} from "../evidenceHttp.js";
import type { GetEvidenceHistoryUseCase } from "../../../application/use-cases/getEvidenceHistoryUseCase.js";

export const ERROR_CODES = {
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export const createEvidenceHistoryHandler = (useCase: GetEvidenceHistoryUseCase | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (useCase === null) {
      return reply.code(503).send({
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        error: {
          code: ERROR_CODES.SERVICE_UNAVAILABLE,
          message: "Evidence store is not available (no DATABASE_URL configured)",
          details: []
        }
      });
    }

    try {
      const queryResult = parseEvidenceHistoryQuery(request.query as Record<string, unknown>);

      const result = await useCase({
        scope: queryResult.scope,
        source: queryResult.sourceFilter ?? null,
        limit: queryResult.limit,
        cursor: queryResult.cursor ?? null
      });

      const items = result.records.map(toEvidenceWireItem);

      return reply.code(200).send({
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        pair: "SOL/USDC",
        scope: queryResult.scope,
        queriedAt: new Date(result.queriedAtUnixMs).toISOString(),
        limit: queryResult.limit,
        items,
        nextCursor: result.nextCursor ? encodeEvidenceCursor(result.nextCursor) : null
      });
    } catch (error) {
      if (error instanceof EvidenceHttpValidationError) {
        return reply.code(400).send(evidenceErrorResponse(error));
      }

      request.log.error(error, "Unhandled error in GET /v1/evidence/sol-usdc/history");

      return reply.code(500).send({
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: "An internal error occurred",
          details: []
        }
      });
    }
  };
};
