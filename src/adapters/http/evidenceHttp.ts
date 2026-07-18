import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type { EvidenceBundleRecord } from "../../application/ports/evidenceBundleRepositoryPort.js";

export const EVIDENCE_SCHEMA_VERSION = "evidence-bundle.v1" as const;
export const EVIDENCE_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

export interface EvidenceHttpErrorDetail {
  path: string;
  code: string;
  message: string;
}

export class EvidenceHttpValidationError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details: EvidenceHttpErrorDetail[];

  public constructor(
    message: string,
    details: EvidenceHttpErrorDetail[] = [],
    errorCode: string = "VALIDATION_ERROR"
  ) {
    super(message);
    this.name = "EvidenceHttpValidationError";
    this.statusCode = 400;
    this.errorCode = errorCode;
    this.details = details;
  }
}

const CURRENT_ALLOWED_KEYS = new Set<string>([
  "scope",
  "whirlpoolAddress",
  "walletAddress",
  "positionId",
  "source.publisher",
  "source.sourceId"
]);

const HISTORY_ALLOWED_KEYS = new Set<string>([
  "scope",
  "whirlpoolAddress",
  "walletAddress",
  "positionId",
  "source.publisher",
  "source.sourceId",
  "limit",
  "cursor"
]);

const PAIR_SCOPE_PARAMS = new Set<string>(["scope"]);
const WHIRLPOOL_SCOPE_PARAMS = new Set<string>(["scope", "whirlpoolAddress"]);
const WALLET_SCOPE_PARAMS = new Set<string>(["scope", "walletAddress"]);
const POSITION_SCOPE_PARAMS = new Set<string>([
  "scope",
  "walletAddress",
  "whirlpoolAddress",
  "positionId"
]);

const DEFAULT_HISTORY_LIMIT = 30;
const MAX_HISTORY_LIMIT = 100;
const MIN_HISTORY_LIMIT = 1;
const MIN_IDENTIFIER_LENGTH = 1;
const MAX_IDENTIFIER_LENGTH = 128;

const EVIDENCE_CURSOR_VERSION = 1;

const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isInteger(value: number): boolean {
  return Number.isInteger(value) && !Number.isNaN(value);
}

function isValidIdentifier(value: string): boolean {
  return (
    isString(value) &&
    value.length >= MIN_IDENTIFIER_LENGTH &&
    value.length <= MAX_IDENTIFIER_LENGTH
  );
}

function validateNoExtraKeys(obj: Record<string, unknown>, allowedKeys: Set<string>): void {
  const extraKeys = Object.keys(obj).filter((k) => !allowedKeys.has(k));
  if (extraKeys.length > 0) {
    throw new EvidenceHttpValidationError(
      `Unknown query parameters: ${extraKeys.join(", ")}`,
      extraKeys.map((k) => ({
        path: `$.${k}`,
        code: "UNKNOWN_KEY",
        message: `Unexpected key: ${k}`
      }))
    );
  }
}

function validateSourceFilter(
  query: Record<string, unknown>
): { publisher?: string; sourceId?: string } | undefined {
  const publisher = query["source.publisher"];
  const sourceId = query["source.sourceId"];

  if (publisher === undefined && sourceId === undefined) {
    return undefined;
  }

  const filter: { publisher?: string; sourceId?: string } = {};

  if (publisher !== undefined) {
    if (typeof publisher !== "string" || publisher.trim() === "") {
      throw new EvidenceHttpValidationError("source.publisher must be a non-empty string", [
        {
          path: "$.source.publisher",
          code: "INVALID_TYPE",
          message: "Expected string, received " + typeof publisher
        }
      ]);
    }
    filter.publisher = publisher;
  }

  if (sourceId !== undefined) {
    if (typeof sourceId !== "string" || sourceId.trim() === "") {
      throw new EvidenceHttpValidationError("source.sourceId must be a non-empty string", [
        {
          path: "$.source.sourceId",
          code: "INVALID_TYPE",
          message: "Expected string, received " + typeof sourceId
        }
      ]);
    }
    filter.sourceId = sourceId;
  }

  return filter;
}

function parseIdentifier(value: unknown, fieldName: string): string {
  if (!isString(value) || value.trim() === "") {
    throw new EvidenceHttpValidationError(`${fieldName} must be a non-empty string`, [
      {
        path: `$.${fieldName}`,
        code: "INVALID_TYPE",
        message: `Expected string, received ${typeof value}`
      }
    ]);
  }

  if (!isValidIdentifier(value)) {
    throw new EvidenceHttpValidationError(
      `${fieldName} must be between ${MIN_IDENTIFIER_LENGTH} and ${MAX_IDENTIFIER_LENGTH} characters`,
      [
        {
          path: `$.${fieldName}`,
          code: "OUT_OF_RANGE",
          message: `${fieldName} length ${value.length} is out of range`
        }
      ]
    );
  }

  return value;
}

function parseScopeParams(query: Record<string, unknown>): {
  scope: Scope;
  usedKeys: Set<string>;
} {
  const scopeValue = query["scope"];

  if (scopeValue === undefined || scopeValue === "" || scopeValue === "pair") {
    return {
      scope: { kind: "pair" },
      usedKeys: PAIR_SCOPE_PARAMS
    };
  }

  if (!isString(scopeValue)) {
    throw new EvidenceHttpValidationError("scope must be a string", [
      {
        path: "$.scope",
        code: "INVALID_TYPE",
        message: `Expected string, received ${typeof scopeValue}`
      }
    ]);
  }

  if (scopeValue === "whirlpool") {
    const whirlpoolAddress = query["whirlpoolAddress"];
    const address = parseIdentifier(whirlpoolAddress, "whirlpoolAddress");
    return {
      scope: {
        kind: "whirlpool",
        network: "solana-mainnet",
        whirlpoolAddress: address
      },
      usedKeys: WHIRLPOOL_SCOPE_PARAMS
    };
  }

  if (scopeValue === "wallet") {
    const walletAddress = query["walletAddress"];
    const address = parseIdentifier(walletAddress, "walletAddress");
    return {
      scope: {
        kind: "wallet",
        network: "solana-mainnet",
        walletAddress: address
      },
      usedKeys: WALLET_SCOPE_PARAMS
    };
  }

  if (scopeValue === "position") {
    const walletAddress = query["walletAddress"];
    const whirlpoolAddress = query["whirlpoolAddress"];
    const positionId = query["positionId"];

    const wallet = parseIdentifier(walletAddress, "walletAddress");
    const pool = parseIdentifier(whirlpoolAddress, "whirlpoolAddress");
    const posId = parseIdentifier(positionId, "positionId");

    return {
      scope: {
        kind: "position",
        network: "solana-mainnet",
        walletAddress: wallet,
        whirlpoolAddress: pool,
        positionId: posId
      },
      usedKeys: POSITION_SCOPE_PARAMS
    };
  }

  throw new EvidenceHttpValidationError(`Invalid scope kind: ${scopeValue}`, [
    {
      path: "$.scope",
      code: "INVALID_VALUE",
      message: `Unknown scope kind: ${scopeValue}`
    }
  ]);
}

function checkInapplicableParams(
  query: Record<string, unknown>,
  usedKeys: Set<string>,
  extraApplicableKeys: string[] = []
): void {
  const applicableKeys = new Set([
    ...usedKeys,
    ...extraApplicableKeys,
    "source.publisher",
    "source.sourceId"
  ]);
  const allQueryKeys = Object.keys(query);

  for (const key of allQueryKeys) {
    if (!applicableKeys.has(key)) {
      throw new EvidenceHttpValidationError(
        `Parameter '${key}' is not applicable for the specified scope`,
        [
          {
            path: `$.${key}`,
            code: "INVALID_VALUE",
            message: `Parameter '${key}' is not applicable`
          }
        ]
      );
    }
  }
}

export interface EvidenceCurrentQueryResult {
  scope: Scope;
  sourceFilter?: { publisher?: string; sourceId?: string };
}

export function parseEvidenceCurrentQuery(
  query: Record<string, unknown>
): EvidenceCurrentQueryResult {
  validateNoExtraKeys(query, CURRENT_ALLOWED_KEYS);

  const { scope } = parseScopeParams(query);

  if (scope.kind === "pair") {
    checkInapplicableParams(query, PAIR_SCOPE_PARAMS);
  } else if (scope.kind === "whirlpool") {
    checkInapplicableParams(query, WHIRLPOOL_SCOPE_PARAMS);
  } else if (scope.kind === "wallet") {
    checkInapplicableParams(query, WALLET_SCOPE_PARAMS);
  } else if (scope.kind === "position") {
    checkInapplicableParams(query, POSITION_SCOPE_PARAMS);
  }

  const sourceFilter = validateSourceFilter(query);

  return { scope, sourceFilter };
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_HISTORY_LIMIT;
  }

  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      throw new EvidenceHttpValidationError("limit must be a non-empty string", [
        {
          path: "$.limit",
          code: "INVALID_TYPE",
          message: "limit cannot be empty"
        }
      ]);
    }

    if (!/^\d+$/.test(trimmed)) {
      throw new EvidenceHttpValidationError("limit must be an integer string", [
        {
          path: "$.limit",
          code: "INVALID_VALUE",
          message: `Invalid integer: ${trimmed}`
        }
      ]);
    }

    if (trimmed !== value) {
      throw new EvidenceHttpValidationError("limit cannot have leading or trailing whitespace", [
        {
          path: "$.limit",
          code: "INVALID_VALUE",
          message: "limit cannot have leading or trailing whitespace"
        }
      ]);
    }

    parsed = Number(trimmed);
  } else {
    throw new EvidenceHttpValidationError("limit must be a number or integer string", [
      {
        path: "$.limit",
        code: "INVALID_TYPE",
        message: `Expected number, received ${typeof value}`
      }
    ]);
  }

  if (!isInteger(parsed)) {
    throw new EvidenceHttpValidationError("limit must be an integer", [
      {
        path: "$.limit",
        code: "OUT_OF_RANGE",
        message: `limit ${parsed} is not an integer`
      }
    ]);
  }

  if (parsed < MIN_HISTORY_LIMIT || parsed > MAX_HISTORY_LIMIT) {
    throw new EvidenceHttpValidationError(
      `limit must be between ${MIN_HISTORY_LIMIT} and ${MAX_HISTORY_LIMIT}`,
      [
        {
          path: "$.limit",
          code: "OUT_OF_RANGE",
          message: `limit ${parsed} is out of range`
        }
      ]
    );
  }

  return parsed;
}

export interface EvidenceHistoryQueryResult {
  scope: Scope;
  sourceFilter?: { publisher?: string; sourceId?: string };
  limit: number;
  cursor?: { receivedAtUnixMs: number; id: number };
}

export function parseEvidenceHistoryQuery(
  query: Record<string, unknown>
): EvidenceHistoryQueryResult {
  validateNoExtraKeys(query, HISTORY_ALLOWED_KEYS);

  const { scope } = parseScopeParams(query);

  if (scope.kind === "pair") {
    checkInapplicableParams(query, PAIR_SCOPE_PARAMS, ["limit", "cursor"]);
  } else if (scope.kind === "whirlpool") {
    checkInapplicableParams(query, WHIRLPOOL_SCOPE_PARAMS, ["limit", "cursor"]);
  } else if (scope.kind === "wallet") {
    checkInapplicableParams(query, WALLET_SCOPE_PARAMS, ["limit", "cursor"]);
  } else if (scope.kind === "position") {
    checkInapplicableParams(query, POSITION_SCOPE_PARAMS, ["limit", "cursor"]);
  }

  const sourceFilter = validateSourceFilter(query);
  const limit = parseLimit(query["limit"]);

  const rawCursor = query["cursor"];
  let cursor: { receivedAtUnixMs: number; id: number } | undefined;
  if (rawCursor !== undefined) {
    if (typeof rawCursor !== "string") {
      throw new EvidenceHttpValidationError("cursor must be a string", [
        {
          path: "$.cursor",
          code: "INVALID_TYPE",
          message: `Expected string, received ${typeof rawCursor}`
        }
      ]);
    }
    cursor = decodeEvidenceCursor(rawCursor);
  }

  return { scope, sourceFilter, limit, cursor };
}

export function encodeEvidenceCursor(cursor: { receivedAtUnixMs: number; id: number }): string {
  const obj = {
    v: EVIDENCE_CURSOR_VERSION,
    receivedAtUnixMs: cursor.receivedAtUnixMs,
    id: cursor.id
  };

  const json = JSON.stringify(obj);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeEvidenceCursor(encoded: string): {
  receivedAtUnixMs: number;
  id: number;
} {
  if (!BASE64URL_REGEX.test(encoded)) {
    throw new EvidenceHttpValidationError("Cursor must be valid base64url", [
      {
        path: "$.cursor",
        code: "INVALID_VALUE",
        message: "Invalid base64url encoding"
      }
    ]);
  }

  let json: string;
  try {
    json = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    throw new EvidenceHttpValidationError("Cursor decoding failed", [
      {
        path: "$.cursor",
        code: "INVALID_VALUE",
        message: "Failed to decode base64url"
      }
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new EvidenceHttpValidationError("Cursor must be valid JSON", [
      {
        path: "$.cursor",
        code: "INVALID_VALUE",
        message: "Invalid JSON in cursor"
      }
    ]);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EvidenceHttpValidationError("Cursor must be an object", [
      {
        path: "$.cursor",
        code: "INVALID_TYPE",
        message: "Expected object, received " + typeof parsed
      }
    ]);
  }

  const obj = parsed as Record<string, unknown>;

  if (obj["v"] === undefined) {
    throw new EvidenceHttpValidationError("Cursor missing version field", [
      {
        path: "$.cursor.v",
        code: "REQUIRED",
        message: "Missing required field: v"
      }
    ]);
  }

  if (typeof obj["v"] !== "number" || obj["v"] !== EVIDENCE_CURSOR_VERSION) {
    throw new EvidenceHttpValidationError(`Unsupported cursor version: ${obj["v"]}`, [
      {
        path: "$.cursor.v",
        code: "INVALID_VALUE",
        message: `Unsupported version ${obj["v"]}, expected ${EVIDENCE_CURSOR_VERSION}`
      }
    ]);
  }

  if (typeof obj["receivedAtUnixMs"] !== "number") {
    throw new EvidenceHttpValidationError("Cursor receivedAtUnixMs must be a number", [
      {
        path: "$.cursor.receivedAtUnixMs",
        code: "INVALID_TYPE",
        message: `Expected number, received ${typeof obj["receivedAtUnixMs"]}`
      }
    ]);
  }

  if (!isInteger(obj["receivedAtUnixMs"]) || obj["receivedAtUnixMs"] < 0) {
    throw new EvidenceHttpValidationError(
      "Cursor receivedAtUnixMs must be a non-negative integer",
      [
        {
          path: "$.cursor.receivedAtUnixMs",
          code: "OUT_OF_RANGE",
          message: "receivedAtUnixMs must be a non-negative integer"
        }
      ]
    );
  }

  if (obj["receivedAtUnixMs"] > Number.MAX_SAFE_INTEGER || obj["receivedAtUnixMs"] < 0) {
    throw new EvidenceHttpValidationError("Cursor receivedAtUnixMs exceeds safe integer range", [
      {
        path: "$.cursor.receivedAtUnixMs",
        code: "OUT_OF_RANGE",
        message: "receivedAtUnixMs exceeds safe integer range"
      }
    ]);
  }

  if (typeof obj["id"] !== "number") {
    throw new EvidenceHttpValidationError("Cursor id must be a number", [
      {
        path: "$.cursor.id",
        code: "INVALID_TYPE",
        message: `Expected number, received ${typeof obj["id"]}`
      }
    ]);
  }

  if (!isInteger(obj["id"]) || obj["id"] <= 0) {
    throw new EvidenceHttpValidationError("Cursor id must be a positive integer", [
      {
        path: "$.cursor.id",
        code: "OUT_OF_RANGE",
        message: "id must be a positive integer"
      }
    ]);
  }

  if (obj["id"] > Number.MAX_SAFE_INTEGER) {
    throw new EvidenceHttpValidationError("Cursor id exceeds safe integer range", [
      {
        path: "$.cursor.id",
        code: "OUT_OF_RANGE",
        message: "id exceeds safe integer range"
      }
    ]);
  }

  const keys = Object.keys(obj);
  const expectedKeys = ["v", "receivedAtUnixMs", "id"];
  if (keys.length !== expectedKeys.length) {
    throw new EvidenceHttpValidationError("Cursor has extra fields", [
      {
        path: "$.cursor",
        code: "INVALID_VALUE",
        message: `Expected keys ${expectedKeys.join(", ")}, got ${keys.join(", ")}`
      }
    ]);
  }

  const canonicalJson = JSON.stringify({
    v: EVIDENCE_CURSOR_VERSION,
    receivedAtUnixMs: obj["receivedAtUnixMs"],
    id: obj["id"]
  });

  const expectedEncoded = Buffer.from(canonicalJson, "utf8").toString("base64url");
  if (encoded !== expectedEncoded) {
    throw new EvidenceHttpValidationError("Cursor encoding is not canonical", [
      {
        path: "$.cursor",
        code: "INVALID_VALUE",
        message: "Non-canonical cursor encoding"
      }
    ]);
  }

  return {
    receivedAtUnixMs: obj["receivedAtUnixMs"],
    id: obj["id"]
  };
}

export interface EvidenceFreshness {
  status: "FRESH" | "STALE" | "EXPIRED";
  asOf: string;
  freshUntil: string;
  expiresAt: string;
}

export interface EvidenceWireItem {
  bundle: unknown;
  evidenceHash: string;
  receiptId: number;
  receivedAt: string;
  freshness: EvidenceFreshness;
}

export function toEvidenceWireItem(record: EvidenceBundleRecord): EvidenceWireItem {
  const bundle = record.bundle;

  return {
    bundle,
    evidenceHash: record.evidenceHash,
    receiptId: record.id,
    receivedAt: new Date(record.receivedAtUnixMs).toISOString(),
    freshness: {
      status: record.lifecycle,
      asOf: bundle.asOf,
      freshUntil: bundle.freshUntil,
      expiresAt: bundle.expiresAt
    }
  };
}

export interface EvidenceErrorResponse {
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  error: {
    code: string;
    message: string;
    details: EvidenceHttpErrorDetail[];
  };
}

export function evidenceErrorResponse(error: EvidenceHttpValidationError): EvidenceErrorResponse {
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    error: {
      code: error.errorCode,
      message: error.message,
      details: error.details
    }
  };
}
