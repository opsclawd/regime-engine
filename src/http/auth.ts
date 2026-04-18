import { timingSafeEqual } from "node:crypto";
import { SCHEMA_VERSION } from "../contract/v1/types.js";
import type { IncomingHttpHeaders } from "node:http";

export class AuthError extends Error {
  public readonly statusCode: number;
  public readonly response: unknown;

  public constructor(statusCode: number, response: unknown) {
    super("AuthError");
    this.statusCode = statusCode;
    this.response = response;
  }
}

const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

export const requireSharedSecret = (
  headers: IncomingHttpHeaders,
  headerName: string,
  envVar: string
): void => {
  const token = process.env[envVar];
  if (!token) {
    throw new AuthError(500, {
      schemaVersion: SCHEMA_VERSION,
      error: { code: "SERVER_MISCONFIGURATION", message: `Server misconfiguration: ${envVar} is not set.`, details: [] }
    });
  }
  const provided = headers[headerName.toLowerCase()];
  const providedValue = Array.isArray(provided) ? provided[0] : provided;
  if (!providedValue || !safeEqual(providedValue, token)) {
    throw new AuthError(401, {
      schemaVersion: SCHEMA_VERSION,
      error: { code: "UNAUTHORIZED", message: "Invalid or missing authentication token", details: [] }
    });
  }
};