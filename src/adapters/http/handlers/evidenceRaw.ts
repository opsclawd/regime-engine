import type { FastifyReply, FastifyRequest } from "fastify";
import { EVIDENCE_SCHEMA_VERSION } from "../evidenceHttp.js";
import type { GetRawObservationsForBundleUseCase } from "../../../application/use-cases/getRawObservationsForBundleUseCase.js";
import {
  RawObservationIdentifierValidationError,
  EvidenceBundleNotFoundError,
  RawObservationsNotFoundError,
  EvidenceStoreUnavailableError
} from "../../../application/errors/evidenceErrors.js";

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  EVIDENCE_BUNDLE_NOT_FOUND: "EVIDENCE_BUNDLE_NOT_FOUND",
  RAW_OBSERVATIONS_NOT_FOUND: "RAW_OBSERVATIONS_NOT_FOUND",
  EVIDENCE_STORE_UNAVAILABLE: "EVIDENCE_STORE_UNAVAILABLE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export const createEvidenceRawHandler = (useCase: GetRawObservationsForBundleUseCase | null) => {
  return async (request: FastifyRequest<{ Params: { id?: string } }>, reply: FastifyReply) => {
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
      const identifier = request.params.id ?? "";

      const result = await useCase({ identifier });

      return reply.code(200).send({
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        pair: "SOL/USDC",
        runId: result.runId,
        items: result.items
      });
    } catch (error) {
      if (error instanceof RawObservationIdentifierValidationError) {
        return reply.code(400).send({
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: error.message,
            details: []
          }
        });
      }

      if (error instanceof EvidenceBundleNotFoundError) {
        return reply.code(404).send({
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.EVIDENCE_BUNDLE_NOT_FOUND,
            message: error.message,
            details: []
          }
        });
      }

      if (error instanceof RawObservationsNotFoundError) {
        return reply.code(404).send({
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          error: {
            code: ERROR_CODES.RAW_OBSERVATIONS_NOT_FOUND,
            message: error.message,
            details: []
          }
        });
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

      request.log.error(error, "Unhandled error in GET /v1/evidence/sol-usdc/:id/raw");

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
