import type { ZodIssue } from "zod";
import { SCHEMA_VERSION, type SchemaVersion } from "./types.js";
import { type ErrorDetail, stableSortDetails, zodIssueToDetails } from "../errors.js";

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  BATCH_TOO_LARGE: "BATCH_TOO_LARGE",
  MALFORMED_CANDLE: "MALFORMED_CANDLE",
  DUPLICATE_CANDLE_IN_BATCH: "DUPLICATE_CANDLE_IN_BATCH",
  CANDLES_NOT_FOUND: "CANDLES_NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  SERVER_MISCONFIGURATION: "SERVER_MISCONFIGURATION",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INSIGHT_NOT_FOUND: "INSIGHT_NOT_FOUND",
  INSIGHT_RUN_CONFLICT: "INSIGHT_RUN_CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_DETAIL_CODES = {
  REQUIRED: "REQUIRED",
  INVALID_TYPE: "INVALID_TYPE",
  INVALID_VALUE: "INVALID_VALUE",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  UNKNOWN_KEY: "UNKNOWN_KEY",
  NO_SOURCE_CANDLES: "NO_SOURCE_CANDLES",
  NO_DERIVED_CANDLES_AFTER_AGGREGATION: "NO_DERIVED_CANDLES_AFTER_AGGREGATION"
} as const;

export type ErrorDetailCode = (typeof ERROR_DETAIL_CODES)[keyof typeof ERROR_DETAIL_CODES];

export interface ErrorEnvelope {
  schemaVersion: SchemaVersion;
  error: {
    code: ErrorCode;
    message: string;
    details: ErrorDetail[];
  };
}

export class ContractValidationError extends Error {
  public readonly statusCode: number;
  public readonly response: ErrorEnvelope;

  public constructor(statusCode: number, response: ErrorEnvelope) {
    super(response.error.message);
    this.statusCode = statusCode;
    this.response = response;
  }
}

export const unsupportedSchemaVersionError = (receivedVersion: string): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: {
      code: ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      message: `Unsupported schemaVersion "${receivedVersion}". Expected "${SCHEMA_VERSION}".`,
      details: [
        {
          path: "$.schemaVersion",
          code: ERROR_DETAIL_CODES.INVALID_VALUE,
          message: "Invalid value"
        }
      ]
    }
  });
};

export const validationErrorFromZod = (
  message: string,
  issues: ZodIssue[]
): ContractValidationError => {
  const details = stableSortDetails(issues.flatMap((issue) => zodIssueToDetails(issue)));

  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      details
    }
  });
};

export const batchTooLargeError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.BATCH_TOO_LARGE, message, details }
  });
};

export const malformedCandleError = (
  message: string,
  details: ErrorDetail[]
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.MALFORMED_CANDLE, message, details }
  });
};

export const duplicateCandleInBatchError = (
  message: string,
  details: ErrorDetail[]
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.DUPLICATE_CANDLE_IN_BATCH, message, details }
  });
};

export const candlesNotFoundError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(404, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.CANDLES_NOT_FOUND, message, details }
  });
};
