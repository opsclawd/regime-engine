import type { FastifyReply, FastifyRequest } from "fastify";
import {
  parseSrLevelsV2IngestRequest,
  type SrLevelsV2IngestCreatedResponse,
  type SrLevelsV2IngestAlreadyIngestedResponse
} from "../../contract/v2/srLevels.js";
import {
  V2ContractValidationError,
  V2_SCHEMA_VERSION,
  serverMisconfigurationV2Error,
  serviceUnavailableV2Error,
  unauthorizedV2Error,
  buildSrThesisV2ConflictEnvelope,
  internalErrorV2
} from "../../contract/v2/errors.js";
import { SrThesesV2Store, SrThesisV2ConflictError } from "../../ledger/srThesesV2Store.js";
import { safeEqual } from "../auth.js";
import { isTableMissingError } from "./pgErrors.js";

const ENV_VAR = "OPENCLAW_INGEST_TOKEN";
const HEADER = "x-ingest-token";

export const createSrLevelsV2IngestHandler = (store: SrThesesV2Store | null) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const token = process.env[ENV_VAR];
    if (!token) {
      return reply.code(500).send(serverMisconfigurationV2Error(ENV_VAR));
    }
    const headerValue = request.headers[HEADER];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!provided || !safeEqual(provided, token)) {
      return reply.code(401).send(unauthorizedV2Error());
    }

    if (!store) {
      return reply
        .code(503)
        .send(
          serviceUnavailableV2Error(
            "S/R thesis v2 store is not available (no DATABASE_URL configured)"
          )
        );
    }

    try {
      const parsed = parseSrLevelsV2IngestRequest(request.body);
      const now = Date.now();
      const result = await store.insertBrief({
        request: parsed,
        capturedAtUnixMs: now,
        receivedAtUnixMs: now
      });

      if (result.status === "created") {
        const response: SrLevelsV2IngestCreatedResponse = {
          schemaVersion: V2_SCHEMA_VERSION,
          status: "created",
          briefId: parsed.brief.briefId,
          insertedCount: result.insertedCount,
          idempotentCount: result.idempotentCount
        };
        return reply.code(201).send(response);
      }

      const response: SrLevelsV2IngestAlreadyIngestedResponse = {
        schemaVersion: V2_SCHEMA_VERSION,
        status: "already_ingested",
        briefId: parsed.brief.briefId,
        insertedCount: 0,
        idempotentCount: result.idempotentCount
      };
      return reply.code(200).send(response);
    } catch (error) {
      if (isTableMissingError(error)) {
        return reply
          .code(503)
          .send(
            serviceUnavailableV2Error(
              "S/R thesis v2 store is not available (table not migrated — run migrations first)"
            )
          );
      }
      if (error instanceof V2ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      if (error instanceof SrThesisV2ConflictError) {
        return reply.code(409).send(buildSrThesisV2ConflictEnvelope(error.key));
      }
      request.log.error(error, "Unhandled error in POST /v2/sr-levels");
      return reply.code(500).send(internalErrorV2());
    }
  };
};
