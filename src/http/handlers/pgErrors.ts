import type { FastifyReply } from "fastify";
import { serviceUnavailableV2Error } from "../../contract/v2/errors.js";

const TABLE_NOT_MIGRATED_MESSAGE =
  "S/R thesis v2 store is not available (table not migrated — run migrations first)";

export const isTableMissingError = (error: unknown): boolean => {
  if (error instanceof Error && "code" in error) {
    const pgError = error as { code: string };
    return pgError.code === "42P01";
  }
  return false;
};

export const sendTableMissing503 = (reply: FastifyReply): FastifyReply =>
  reply.code(503).send(serviceUnavailableV2Error(TABLE_NOT_MIGRATED_MESSAGE));
