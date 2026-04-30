import type { ZodIssue } from "zod";
import {
  type ErrorDetail,
  zodIssueToDetails,
  stableSortDetails,
  ERROR_DETAIL_CODES
} from "../../http/errors.js";

export const V2_SCHEMA_VERSION = "2.0" as const;
export type V2SchemaVersion = typeof V2_SCHEMA_VERSION;

export const V2_ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  UNAUTHORIZED: "UNAUTHORIZED",
  SERVER_MISCONFIGURATION: "SERVER_MISCONFIGURATION",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  SR_THESIS_V2_CONFLICT: "SR_THESIS_V2_CONFLICT",
  SR_THESIS_V2_NOT_FOUND: "SR_THESIS_V2_NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export type V2ErrorCode = (typeof V2_ERROR_CODES)[keyof typeof V2_ERROR_CODES];

export interface V2ErrorEnvelope {
  schemaVersion: V2SchemaVersion;
  error: {
    code: V2ErrorCode;
    message: string;
    details: ErrorDetail[];
  };
}

export class V2ContractValidationError extends Error {
  public readonly statusCode: number;
  public readonly response: V2ErrorEnvelope;

  public constructor(statusCode: number, response: V2ErrorEnvelope) {
    super(response.error.message);
    this.statusCode = statusCode;
    this.response = response;
  }
}

export const unsupportedSchemaVersionV2Error = (received: string): V2ContractValidationError => {
  return new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: V2_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      message: `Unsupported schemaVersion "${received}". Expected "${V2_SCHEMA_VERSION}".`,
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

export const validationErrorV2FromZod = (
  message: string,
  issues: ZodIssue[]
): V2ContractValidationError => {
  const details = stableSortDetails(issues.flatMap((issue) => zodIssueToDetails(issue)));
  return new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: V2_ERROR_CODES.VALIDATION_ERROR,
      message,
      details
    }
  });
};

export const validationErrorV2 = (
  message: string,
  details: ErrorDetail[] = []
): V2ContractValidationError => {
  return new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: V2_ERROR_CODES.VALIDATION_ERROR,
      message,
      details
    }
  });
};

export const serviceUnavailableV2Error = (message: string): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.SERVICE_UNAVAILABLE,
    message,
    details: []
  }
});

export const unauthorizedV2Error = (): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.UNAUTHORIZED,
    message: "Invalid or missing authentication token",
    details: []
  }
});

export const serverMisconfigurationV2Error = (envVar: string): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.SERVER_MISCONFIGURATION,
    message: `Server misconfiguration: ${envVar} is not set.`,
    details: []
  }
});

export const srThesisV2NotFoundError = (symbol: string, source: string): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.SR_THESIS_V2_NOT_FOUND,
    message: `No S/R thesis brief found for symbol="${symbol}" and source="${source}".`,
    details: []
  }
});

export interface SrThesisV2ConflictKey {
  source: string;
  symbol: string;
  briefId: string;
  asset: string;
  sourceHandle: string;
}

export const srThesisV2ConflictError = (key: SrThesisV2ConflictKey): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.SR_THESIS_V2_CONFLICT,
    message: `S/R thesis v2 conflict for source="${key.source}" symbol="${key.symbol}" briefId="${key.briefId}" asset="${key.asset}" sourceHandle="${key.sourceHandle}".`,
    details: []
  }
});

export const internalErrorV2 = (): V2ErrorEnvelope => ({
  schemaVersion: V2_SCHEMA_VERSION,
  error: {
    code: V2_ERROR_CODES.INTERNAL_ERROR,
    message: "Internal server error",
    details: []
  }
});