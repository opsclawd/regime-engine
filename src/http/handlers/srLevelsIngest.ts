import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION, type SrLevelBriefIngestResponse } from "../../contract/v1/types.js";
import { parseSrLevelBriefRequest } from "../../contract/v1/validation.js";
import { type LedgerStore } from "../../ledger/store.js";
import { LedgerWriteError } from "../../ledger/writer.js";
import { writeSrLevelBrief } from "../../ledger/srLevelsWriter.js";
import { AuthError, requireSharedSecret } from "../auth.js";
import { ContractValidationError } from "../errors.js";

export const createSrLevelsIngestHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-Ingest-Token", "OPENCLAW_INGEST_TOKEN");

      const body = parseSrLevelBriefRequest(request.body);
      const result = writeSrLevelBrief(store, body);

      if (result.status === "already_ingested") {
        const response: SrLevelBriefIngestResponse = {
          briefId: result.briefId,
          insertedCount: result.insertedCount,
          status: "already_ingested"
        };
        return reply.code(200).send(response);
      }

      const response: SrLevelBriefIngestResponse = {
        briefId: result.briefId,
        insertedCount: result.insertedCount
      };
      return reply.code(201).send(response);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }

      if (error instanceof LedgerWriteError) {
        return reply.code(409).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: error.code,
            message: error.message,
            details: []
          }
        });
      }

      throw error;
    }
  };
};