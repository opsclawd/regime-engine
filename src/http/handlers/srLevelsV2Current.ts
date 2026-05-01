import type { FastifyReply, FastifyRequest } from "fastify";
import { SrThesesV2Store } from "../../ledger/srThesesV2Store.js";
import {
  internalErrorV2,
  serviceUnavailableV2Error,
  srThesisV2NotFoundError,
  validationErrorV2
} from "../../contract/v2/errors.js";

export const createSrLevelsV2CurrentHandler = (store: SrThesesV2Store | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!store) {
      return reply
        .code(503)
        .send(
          serviceUnavailableV2Error(
            "S/R thesis v2 store is not available (no DATABASE_URL configured)"
          )
        );
    }

    const query = request.query as Record<string, string | string[] | undefined>;
    const symbolRaw = query["symbol"];
    const sourceRaw = query["source"];
    const symbol = typeof symbolRaw === "string" ? symbolRaw.trim() : undefined;
    const source = typeof sourceRaw === "string" ? sourceRaw.trim() : undefined;

    if (!symbol || !source) {
      const missing: Array<{ path: string; code: "REQUIRED"; message: string }> = [];
      if (!symbol) {
        missing.push({ path: "$.symbol", code: "REQUIRED", message: "Field is required" });
      }
      if (!source) {
        missing.push({ path: "$.source", code: "REQUIRED", message: "Field is required" });
      }
      return reply
        .code(400)
        .send(
          validationErrorV2("Query parameters 'symbol' and 'source' are required", missing).response
        );
    }

    try {
      const result = await store.getCurrent(symbol, source);
      if (!result) {
        return reply.code(404).send(srThesisV2NotFoundError(symbol, source));
      }
      return reply.code(200).send(result);
    } catch (error) {
      request.log.error(error, "Unhandled error in GET /v2/sr-levels/current");
      return reply.code(500).send(internalErrorV2());
    }
  };
};
