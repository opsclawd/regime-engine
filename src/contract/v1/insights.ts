import { z } from "zod";
import { SCHEMA_VERSION, type SchemaVersion } from "./types.js";
import {
  unsupportedSchemaVersionError,
  validationErrorFromZod
} from "../../http/errors.js";
import { toCanonicalJson } from "./canonical.js";
import { sha256Hex } from "./hash.js";

const ISO = z.string().datetime({ offset: true });
const finitePositive = z.number().finite().positive();
const snakeCaseLabel = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);

export const RECOMMENDED_ACTIONS = [
  "hold",
  "watch",
  "tighten_range",
  "widen_range",
  "exit_range",
  "pause_rebalances"
] as const;

export const POSTURES = [
  "aggressive",
  "moderately_aggressive",
  "neutral",
  "defensive",
  "paused"
] as const;

export const RANGE_BIASES = ["tight", "medium", "wide", "passive"] as const;
export const REBALANCE_SENSITIVITIES = ["low", "normal", "high", "paused"] as const;
export const CONFIDENCES = ["low", "medium", "high"] as const;
export const RISK_LEVELS = ["normal", "elevated", "critical"] as const;
export const DATA_QUALITIES = ["complete", "partial", "stale"] as const;

const clmmPolicySchema = z
  .object({
    posture: z.enum(POSTURES),
    rangeBias: z.enum(RANGE_BIASES),
    rebalanceSensitivity: z.enum(REBALANCE_SENSITIVITIES),
    maxCapitalDeploymentPercent: z.number().min(0).max(100)
  })
  .strict();

const levelsSchema = z
  .object({
    support: z.array(finitePositive).max(16),
    resistance: z.array(finitePositive).max(16)
  })
  .strict()
  .refine((v) => v.support.length + v.resistance.length >= 1, {
    message: "at least one support or resistance level is required"
  });

export const insightIngestRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    pair: z.literal("SOL/USDC"),
    asOf: ISO,
    source: z.enum(["openclaw"]),
    runId: z.string().min(1).max(256),
    marketRegime: snakeCaseLabel,
    fundamentalRegime: snakeCaseLabel,
    recommendedAction: z.enum(RECOMMENDED_ACTIONS),
    confidence: z.enum(CONFIDENCES),
    riskLevel: z.enum(RISK_LEVELS),
    dataQuality: z.enum(DATA_QUALITIES),
    clmmPolicy: clmmPolicySchema,
    levels: levelsSchema,
    reasoning: z.array(z.string().min(1).max(1024)).max(16),
    sourceRefs: z.array(z.string().min(1).max(512)).max(16),
    expiresAt: ISO
  })
  .strict()
  .refine((v) => Date.parse(v.expiresAt) > Date.parse(v.asOf), {
    path: ["expiresAt"],
    message: "expiresAt must be greater than asOf"
  });

export type InsightIngestRequest = z.infer<typeof insightIngestRequestSchema>;
export type InsightClmmPolicy = InsightIngestRequest["clmmPolicy"];
export type InsightLevels = InsightIngestRequest["levels"];

export interface InsightFreshness {
  generatedAtIso: string;
  expiresAtIso: string;
  ageSeconds: number;
  stale: boolean;
}

export interface InsightCurrentResponse extends InsightIngestRequest {
  status: "FRESH" | "STALE";
  payloadHash: string;
  receivedAtIso: string;
  freshness: InsightFreshness;
}

export interface InsightHistoryItem extends InsightIngestRequest {
  payloadHash: string;
  receivedAtIso: string;
}

export interface InsightHistoryResponse {
  schemaVersion: SchemaVersion;
  pair: "SOL/USDC";
  limit: number;
  items: InsightHistoryItem[];
}

export interface InsightIngestCreatedResponse {
  schemaVersion: SchemaVersion;
  status: "created";
  runId: string;
  payloadHash: string;
  receivedAtIso: string;
}

export interface InsightIngestAlreadyIngestedResponse {
  schemaVersion: SchemaVersion;
  status: "already_ingested";
  runId: string;
  payloadHash: string;
}

export const parseInsightRowEnums = (row: {
  marketRegime: string;
  fundamentalRegime: string;
  recommendedAction: string;
  confidence: string;
  riskLevel: string;
  dataQuality: string;
  source: string;
  clmmPolicyJson: unknown;
  levelsJson: unknown;
  reasoningJson: unknown;
  sourceRefsJson: unknown;
}): InsightIngestRequest => {
  const clmmPolicy = clmmPolicySchema.parse(row.clmmPolicyJson);
  const levels = levelsSchema.parse(row.levelsJson);
  const reasoning = z.array(z.string().min(1).max(1024)).max(16).parse(row.reasoningJson);
  const sourceRefs = z.array(z.string().min(1).max(512)).max(16).parse(row.sourceRefsJson);

  return {
    schemaVersion: SCHEMA_VERSION,
    pair: "SOL/USDC",
    asOf: "", // filled by caller from asOfUnixMs
    source: z.enum(["openclaw"]).parse(row.source),
    runId: "", // filled by caller
    marketRegime: row.marketRegime,
    fundamentalRegime: row.fundamentalRegime,
    recommendedAction: z.enum(RECOMMENDED_ACTIONS).parse(row.recommendedAction),
    confidence: z.enum(CONFIDENCES).parse(row.confidence),
    riskLevel: z.enum(RISK_LEVELS).parse(row.riskLevel),
    dataQuality: z.enum(DATA_QUALITIES).parse(row.dataQuality),
    clmmPolicy,
    levels,
    reasoning,
    sourceRefs,
    expiresAt: "" // filled by caller from expiresAtUnixMs
  };
};

export const parseInsightIngestRequest = (raw: unknown): InsightIngestRequest => {
  const probe = z.object({ schemaVersion: z.string() }).passthrough().safeParse(raw);
  if (probe.success && probe.data.schemaVersion !== SCHEMA_VERSION) {
    throw unsupportedSchemaVersionError(probe.data.schemaVersion);
  }

  const parsed = insightIngestRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw validationErrorFromZod(
      "Invalid /v1/insights/sol-usdc request body",
      parsed.error.issues
    );
  }

  return parsed.data;
};

export const computeInsightCanonicalAndHash = (
  req: InsightIngestRequest
): { canonical: string; hash: string } => {
  const canonical = toCanonicalJson(req);
  const hash = sha256Hex(canonical);
  return { canonical, hash };
};