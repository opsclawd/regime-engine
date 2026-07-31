import type { FastifyReply, FastifyRequest } from "fastify";
import { AuthError, requireSharedSecret } from "../auth.js";
import type { RequestPositionPolicyInsightSynthesisUseCase } from "../../../application/use-cases/requestPositionPolicyInsightSynthesisUseCase.js";

const SCHEMA_VERSION = "1.0" as const;

export interface PositionSynthesisRequestBody {
  mode?: "eligible" | "scope";
  walletAddress?: string;
  whirlpoolAddress?: string;
  positionId?: string;
}

export const createPositionSynthesisRequestHandler = (
  useCase: RequestPositionPolicyInsightSynthesisUseCase | null
) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      requireSharedSecret(
        request.headers,
        "X-Policy-Synthesis-Token",
        "POLICY_SYNTHESIS_INTERNAL_TOKEN"
      );

      if (useCase === null) {
        return reply.code(503).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: "SYNTHESIS_STORE_UNAVAILABLE",
            message: "Position synthesis dependencies are absent (no DATABASE_URL configured)",
            details: []
          }
        });
      }

      const body = (request.body as PositionSynthesisRequestBody) ?? {};

      if (!body || typeof body !== "object") {
        return reply.code(400).send({
          schemaVersion: SCHEMA_VERSION,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body",
            details: []
          }
        });
      }

      const mode = body.mode;

      if (mode === "eligible") {
        const result = await useCase({ mode: "startup" });
        const startupResults = "results" in result ? result.results : [result];

        return reply.code(202).send({
          schemaVersion: SCHEMA_VERSION,
          requests: startupResults.map((item) => ({
            requestId: item.requestId,
            status: item.status,
            freshEvidenceRequired: item.freshEvidenceRequired
          }))
        });
      }

      if (mode === "scope") {
        const { walletAddress, whirlpoolAddress, positionId } = body;
        if (
          !walletAddress ||
          typeof walletAddress !== "string" ||
          walletAddress.trim() === "" ||
          !whirlpoolAddress ||
          typeof whirlpoolAddress !== "string" ||
          whirlpoolAddress.trim() === "" ||
          !positionId ||
          typeof positionId !== "string" ||
          positionId.trim() === ""
        ) {
          return reply.code(400).send({
            schemaVersion: SCHEMA_VERSION,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Partial scope identity provided. walletAddress, whirlpoolAddress, and positionId are required for mode scope.",
              details: []
            }
          });
        }

        const result = await useCase({
          mode: "single",
          scope: {
            kind: "position",
            network: "solana-mainnet",
            walletAddress,
            whirlpoolAddress,
            positionId
          }
        });

        const results = "results" in result ? result.results : [result];

        return reply.code(202).send({
          schemaVersion: SCHEMA_VERSION,
          requests: results.map((item) => ({
            requestId: item.requestId,
            status: item.status,
            freshEvidenceRequired: item.freshEvidenceRequired
          }))
        });
      }

      return reply.code(400).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "VALIDATION_ERROR",
          message: `Invalid or missing mode '${mode}'. Expected 'eligible' or 'scope'.`,
          details: []
        }
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return reply.code(error.statusCode).send(error.response);
      }

      request.log.error({ err: error }, "Unexpected error during position synthesis request");

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
