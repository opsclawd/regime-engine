import type { ZodIssue } from "zod";

export interface ErrorDetail {
  path: string;
  code: string;
  message: string;
}

export const pathToString = (path: Array<string | number>): string => {
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

export const stableSortDetails = (details: ErrorDetail[]): ErrorDetail[] => {
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

export const zodIssueToDetails = (issue: ZodIssue): ErrorDetail[] => {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      path: pathToString([...issue.path, key]),
      code: "UNKNOWN_KEY",
      message: `Unexpected key: ${key}`
    }));
  }

  if (issue.code === "invalid_type") {
    if (issue.received === "undefined") {
      return [
        {
          path: pathToString(issue.path),
          code: "REQUIRED",
          message: "Field is required"
        }
      ];
    }

    return [
      {
        path: pathToString(issue.path),
        code: "INVALID_TYPE",
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
        code: "INVALID_VALUE",
        message: "Invalid value"
      }
    ];
  }

  if (issue.code === "too_small" || issue.code === "too_big") {
    return [
      {
        path: pathToString(issue.path),
        code: "OUT_OF_RANGE",
        message: "Value is out of range"
      }
    ];
  }

  return [
    {
      path: pathToString(issue.path),
      code: "INVALID_VALUE",
      message: "Invalid value"
    }
  ];
};
