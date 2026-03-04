import type { ZodIssue } from "zod";
import { SCHEMA_VERSION, type SchemaVersion } from "../contract/v1/types.js";

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_DETAIL_CODES = {
  REQUIRED: "REQUIRED",
  INVALID_TYPE: "INVALID_TYPE",
  INVALID_VALUE: "INVALID_VALUE",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  UNKNOWN_KEY: "UNKNOWN_KEY"
} as const;

export type ErrorDetailCode =
  (typeof ERROR_DETAIL_CODES)[keyof typeof ERROR_DETAIL_CODES];

export interface ErrorDetail {
  path: string;
  code: ErrorDetailCode;
  message: string;
}

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

const pathToString = (path: Array<string | number>): string => {
  if (path.length === 0) {
    return "$";
  }

  let formatted = "$";
  for (const part of path) {
    if (typeof part === "number") {
      formatted += `[${part}]`;
      continue;
    }

    formatted += `.${part}`;
  }

  return formatted;
};

const stableSortDetails = (details: ErrorDetail[]): ErrorDetail[] => {
  return [...details].sort((left, right) => {
    if (left.path !== right.path) {
      return left.path.localeCompare(right.path);
    }
    if (left.code !== right.code) {
      return left.code.localeCompare(right.code);
    }
    return left.message.localeCompare(right.message);
  });
};

const zodIssueToDetails = (issue: ZodIssue): ErrorDetail[] => {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      path: pathToString([...issue.path, key]),
      code: ERROR_DETAIL_CODES.UNKNOWN_KEY,
      message: `Unexpected key: ${key}`
    }));
  }

  if (issue.code === "invalid_type") {
    if (issue.received === "undefined") {
      return [
        {
          path: pathToString(issue.path),
          code: ERROR_DETAIL_CODES.REQUIRED,
          message: "Field is required"
        }
      ];
    }

    return [
      {
        path: pathToString(issue.path),
        code: ERROR_DETAIL_CODES.INVALID_TYPE,
        message: `Expected ${issue.expected}, received ${issue.received}`
      }
    ];
  }

  if (
    issue.code === "invalid_literal" ||
    issue.code === "invalid_enum_value" ||
    issue.code === "invalid_string"
  ) {
    return [
      {
        path: pathToString(issue.path),
        code: ERROR_DETAIL_CODES.INVALID_VALUE,
        message: "Invalid value"
      }
    ];
  }

  if (issue.code === "too_small" || issue.code === "too_big") {
    return [
      {
        path: pathToString(issue.path),
        code: ERROR_DETAIL_CODES.OUT_OF_RANGE,
        message: "Value is out of range"
      }
    ];
  }

  return [
    {
      path: pathToString(issue.path),
      code: ERROR_DETAIL_CODES.INVALID_VALUE,
      message: "Invalid value"
    }
  ];
};

export const unsupportedSchemaVersionError = (
  receivedVersion: string
): ContractValidationError => {
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
  const details = stableSortDetails(
    issues.flatMap((issue) => zodIssueToDetails(issue))
  );

  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      details
    }
  });
};
