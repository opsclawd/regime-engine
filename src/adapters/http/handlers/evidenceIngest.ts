import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthError, requireSharedSecret } from "../auth.js";
import type { IngestEvidenceBundleUseCase } from "../../../application/use-cases/ingestEvidenceBundleUseCase.js";
import { EvidenceBundleValidationError } from "../../../contract/evidence/v1/validate.js";
import { EvidenceRunConflictError } from "../../../application/ports/evidenceBundleRepositoryPort.js";
import { EvidenceStoreUnavailableError } from "../../../application/errors/evidenceErrors.js";

const SCHEMA_VERSION = "evidence-bundle.v1" as const;

export const createEvidenceIngestHandler = (useCase: IngestEvidenceBundleUseCase | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-Evidence-Ingest-Token", "EVIDENCE_INGEST_TOKEN");

      if (useCase === null) {
        return reply.code(503).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: "EVIDENCE_STORE_UNAVAILABLE",
            message: "Evidence store is not available",
            details: []
          }
        });
      }

      const result = await useCase(request.body);

      const receivedAtIso = new Date(result.receipt.receivedAtUnixMs).toISOString();

      return reply.code(result.status === "created" ? 201 : 200).send({
        schemaVersion: SCHEMA_VERSION,
        status: result.status,
        runId: result.runId,
        evidenceHash: result.evidenceHash,
        receivedAt: receivedAtIso,
        receiptId: result.receipt.id
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof EvidenceBundleValidationError) {
        const sortedIssues = [...error.issues].sort((a, b) => {
          if (a.path !== b.path) return a.path.localeCompare(b.path);
          if (a.code !== b.code) return a.code.localeCompare(b.code);
          return a.message.localeCompare(b.message);
        });

        return reply.code(400).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: "VALIDATION_ERROR",
            message: "Evidence bundle validation failed",
            details: sortedIssues
          }
        });
      }

      if (error instanceof EvidenceRunConflictError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: "EVIDENCE_RUN_CONFLICT",
            message: "Evidence run conflict",
            details: []
          }
        });
      }

      if (error instanceof EvidenceStoreUnavailableError) {
        return reply.code(503).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: "EVIDENCE_STORE_UNAVAILABLE",
            message: "Evidence store is temporarily unavailable",
            details: []
          }
        });
      }

      request.log.error({ err: error }, "Unexpected error during evidence ingest");

      return reply.code(500).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "INTERNAL_ERROR",
          message: "An internal error occurred",
          details: []
        }
      });
    }
  };
};
