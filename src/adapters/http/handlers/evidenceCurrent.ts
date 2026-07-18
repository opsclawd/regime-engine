import type { FastifyReply, FastifyRequest } from "fastify";
import {
  EVIDENCE_SCHEMA_VERSION,
  parseEvidenceCurrentQuery,
  toEvidenceWireItem,
  EvidenceHttpValidationError,
  evidenceErrorResponse
} from "../evidenceHttp.js";
import type { GetCurrentEvidenceUseCase } from "../../../application/use-cases/getCurrentEvidenceUseCase.js";
import { EvidenceStoreUnavailableError } from "../../../application/errors/evidenceErrors.js";

export const ERROR_CODES = {
  EVIDENCE_STORE_UNAVAILABLE: "EVIDENCE_STORE_UNAVAILABLE",
  EVIDENCE_NOT_FOUND: "EVIDENCE_NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export const createEvidenceCurrentHandler = (useCase: GetCurrentEvidenceUseCase | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (useCase === null) {
      return reply.code(503).send({
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        error: {
          code: ERROR_CODES.EVIDENCE_STORE_UNAVAILABLE,
          message: "Evidence store is not available (no DATABASE_URL configured)",
          details: []
        }
      });
    }

    try {
      const queryResult = parseEvidenceCurrentQuery(request.query as Record<string, unknown>);

      const result = await useCase({
        scope: queryResult.scope,
        source: queryResult.sourceFilter ?? null
      });

      if (result.records.length === 0) {
        return reply.code(404).send({
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.EVIDENCE_NOT_FOUND,
            message: "No evidence found for the specified scope",
            details: []
          }
        });
      }

      return reply.code(200).send({
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        pair: "SOL/USDC",
        scope: queryResult.scope,
        queriedAt: new Date(result.queriedAtUnixMs).toISOString(),
        items: result.records.map(toEvidenceWireItem)
      });
    } catch (error) {
      if (error instanceof EvidenceHttpValidationError) {
        return reply.code(400).send(evidenceErrorResponse(error));
      }

      if (error instanceof EvidenceStoreUnavailableError) {
        return reply.code(503).send({
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.EVIDENCE_STORE_UNAVAILABLE,
            message: "Evidence store is temporarily unavailable",
            details: []
          }
        });
      }

      request.log.error(error, "Unhandled error in GET /v1/evidence/sol-usdc/current");

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
