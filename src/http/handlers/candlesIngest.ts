import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION, type CandleIngestResponse } from "../../contract/v1/types.js";
import { parseCandleIngestRequest } from "../../contract/v1/validation.js";
import type { LedgerStore } from "../../ledger/store.js";
import { writeCandles } from "../../ledger/candlesWriter.js";
import { AuthError, requireSharedSecret } from "../auth.js";
import { ContractValidationError } from "../errors.js";

export const createCandlesIngestHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(request.headers, "X-Candles-Ingest-Token", "CANDLES_INGEST_TOKEN");

      const body = parseCandleIngestRequest(request.body);
      const result = writeCandles(store, body, Date.now());

      const response: CandleIngestResponse = {
        schemaVersion: SCHEMA_VERSION,
        ...result
      };

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      throw error;
    }
  };
};