import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { type LedgerStore } from "../../ledger/store.js";
import { getCurrentSrLevels } from "../../ledger/srLevelsWriter.js";

export const createSrLevelsCurrentHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | string[] | undefined>;
    const symbolParam = query["symbol"];
    const sourceParam = query["source"];
    const symbol = typeof symbolParam === "string" ? symbolParam : undefined;
    const source = typeof sourceParam === "string" ? sourceParam : undefined;

    if (!symbol || !source) {
      return reply.code(400).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "VALIDATION_ERROR",
          message: "Query parameters 'symbol' and 'source' are required",
          details: []
        }
      });
    }

    const result = getCurrentSrLevels(store, symbol, source);

    if (!result) {
      return reply.code(404).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "NOT_FOUND",
          message: `No S/R level brief found for symbol "${symbol}" and source "${source}".`,
          details: []
        }
      });
    }

    return reply.code(200).send(result);
  };
};
