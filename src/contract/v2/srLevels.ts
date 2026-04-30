import { z } from "zod";
import {
  V2ContractValidationError,
  V2_SCHEMA_VERSION,
  type V2SchemaVersion,
  unsupportedSchemaVersionV2Error,
  validationErrorV2FromZod
} from "./errors.js";
import { ERROR_DETAIL_CODES } from "../../http/errors.js";
import { toCanonicalJson } from "../v1/canonical.js";
import { sha256Hex } from "../v1/hash.js";

const ISO = z.string().datetime({ offset: true });
const requiredString = z.string().min(1);

const thesisSchema = z
  .object({
    asset: requiredString,
    timeframe: requiredString,
    bias: z.string().nullable(),
    setupType: z.string().nullable(),
    supportLevels: z.array(z.string()),
    resistanceLevels: z.array(z.string()),
    entryZone: z.string().nullable(),
    targets: z.array(z.string()),
    invalidation: z.string().nullable(),
    trigger: z.string().nullable(),
    chartReference: z.string().nullable(),
    sourceHandle: requiredString,
    sourceChannel: z.string().nullable(),
    sourceKind: requiredString,
    sourceReliability: z.string().nullable(),
    rawThesisText: z.string().nullable(),
    collectedAt: ISO.nullable(),
    publishedAt: ISO.nullable(),
    sourceUrl: z.string().nullable(),
    notes: z.string().nullable()
  })
  .strict();

const briefSchema = z
  .object({
    briefId: requiredString,
    sourceRecordedAtIso: ISO.nullable(),
    summary: z.string().nullable()
  })
  .strict();

export const srLevelsV2IngestRequestSchema = z
  .object({
    schemaVersion: z.literal(V2_SCHEMA_VERSION),
    source: requiredString,
    symbol: requiredString,
    brief: briefSchema,
    theses: z.array(thesisSchema).min(1)
  })
  .strict();

export type SrLevelsV2IngestRequest = z.infer<typeof srLevelsV2IngestRequestSchema>;
export type SrThesisV2 = z.infer<typeof thesisSchema>;
export type SrLevelsV2Brief = z.infer<typeof briefSchema>;

export interface SrLevelsV2CurrentResponse {
  schemaVersion: V2SchemaVersion;
  source: string;
  symbol: string;
  brief: SrLevelsV2Brief;
  capturedAtIso: string;
  theses: SrThesisV2[];
}

export interface SrLevelsV2IngestCreatedResponse {
  schemaVersion: V2SchemaVersion;
  status: "created";
  briefId: string;
  insertedCount: number;
  idempotentCount: number;
}

export interface SrLevelsV2IngestAlreadyIngestedResponse {
  schemaVersion: V2SchemaVersion;
  status: "already_ingested";
  briefId: string;
  insertedCount: 0;
  idempotentCount: number;
}

const duplicateThesisIdentityError = (duplicateIndex: number): V2ContractValidationError =>
  new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: "VALIDATION_ERROR",
      message: "Duplicate thesis identity in request",
      details: [
        {
          path: `$.theses[${duplicateIndex}]`,
          code: ERROR_DETAIL_CODES.INVALID_VALUE,
          message:
            "Duplicate (source, symbol, briefId, asset, sourceHandle) within a single request is not allowed"
        }
      ]
    }
  });

export const parseSrLevelsV2IngestRequest = (raw: unknown): SrLevelsV2IngestRequest => {
  const probe = z.object({ schemaVersion: z.string() }).passthrough().safeParse(raw);
  if (probe.success && probe.data.schemaVersion !== V2_SCHEMA_VERSION) {
    throw unsupportedSchemaVersionV2Error(probe.data.schemaVersion);
  }

  const parsed = srLevelsV2IngestRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw validationErrorV2FromZod("Invalid /v2/sr-levels request body", parsed.error.issues);
  }

  const seen = new Set<string>();
  for (let i = 0; i < parsed.data.theses.length; i += 1) {
    const t = parsed.data.theses[i];
    const key = `${parsed.data.source} ${parsed.data.symbol} ${parsed.data.brief.briefId} ${t.asset} ${t.sourceHandle}`;
    if (seen.has(key)) {
      throw duplicateThesisIdentityError(i);
    }
    seen.add(key);
  }

  return parsed.data;
};

export const computeSrThesisV2CanonicalAndHash = (
  request: SrLevelsV2IngestRequest,
  thesis: SrThesisV2
): { canonical: string; hash: string } => {
  const canonical = toCanonicalJson({
    schemaVersion: request.schemaVersion,
    source: request.source,
    symbol: request.symbol,
    brief: request.brief,
    thesis
  });
  return { canonical, hash: sha256Hex(canonical) };
};