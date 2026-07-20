import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import { policyInsights } from "../../ledger/pg/schema/policyInsights.js";
import type { PolicyInsightRow } from "../../ledger/pg/schema/policyInsights.js";
import type {
  NewPolicyInsightRecord,
  PolicyInsightRepositoryPort,
  StoredPolicyInsight,
  PolicyInsightHistoryCursor
} from "../../application/ports/policyInsightRepositoryPort.js";
import {
  PolicyInsightStoreUnavailableError,
  PolicyInsightValidationError
} from "../../application/errors/policyInsightErrors.js";
import { parsePolicyInsightContent } from "../../contract/policyInsight/v1/validate.js";
import { computePolicyInsightContentCanonicalAndHash } from "../../contract/policyInsight/v1/canonical.js";
import type { PolicyInsightContent } from "../../contract/policyInsight/v1/types.generated.js";
import type { PolicySynthesisEnvelope } from "../../engine/policy/synthesizePolicyInsight.js";
import type { EvidenceSelectionDecision } from "../../engine/evidence/selectEvidence.js";

const TRANSIENT_POSTGRES_CODES = new Set(["57P01", "57P02", "57P03"]);

// postgres.js driver-native connection failure codes, distinct from PostgreSQL SQLSTATE codes.
const TRANSIENT_DRIVER_CODES = new Set([
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED"
]);

const TRANSIENT_NET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN"
]);

// PostgreSQL SQLSTATE class 08 -- Connection Exception.
const isConnectionExceptionSqlState = (code: string): boolean => code.startsWith("08");

const isTransientPostgresFailure = (error: unknown): boolean => {
  if (error == null || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: string }).code;
  if (
    code != null &&
    (TRANSIENT_NET_CODES.has(code) ||
      TRANSIENT_POSTGRES_CODES.has(code) ||
      TRANSIENT_DRIVER_CODES.has(code) ||
      isConnectionExceptionSqlState(code))
  ) {
    return true;
  }
  const message = (error as { message?: string }).message ?? "";
  if (message === "Connection terminated") {
    return true;
  }
  return false;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isPolicySynthesisEnvelope = (value: unknown): value is PolicySynthesisEnvelope => {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.synthesisAtUnixMs === "number" &&
    Number.isFinite(value.synthesisAtUnixMs) &&
    value.pair === "SOL/USDC" &&
    isPlainObject(value.scope) &&
    isPlainObject(value.market) &&
    (value.positionPlan === null || isPlainObject(value.positionPlan)) &&
    isPlainObject(value.evidence) &&
    isPlainObject(value.hashes) &&
    typeof (value.hashes as Record<string, unknown>).inputHash === "string" &&
    typeof (value.hashes as Record<string, unknown>).rulesetHash === "string"
  );
};

const isEvidenceSelectionDecision = (value: unknown): value is EvidenceSelectionDecision => {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.candidateId === "string" &&
    typeof value.bundleHash === "string" &&
    typeof value.publisher === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.runId === "string" &&
    typeof value.correlationId === "string" &&
    typeof value.receivedAtUnixMs === "number" &&
    (value.kind === "deterministic_feature" ||
      value.kind === "contextual_claim" ||
      value.kind === "research_brief") &&
    typeof value.localId === "string" &&
    typeof value.rawConfidence === "number" &&
    typeof value.sourceQuality === "number" &&
    typeof value.provenanceQuality === "number" &&
    typeof value.freshnessWeight === "number" &&
    (value.score === null || typeof value.score === "number") &&
    (value.status === "INCLUDED" || value.status === "EXCLUDED") &&
    Array.isArray(value.reasons) &&
    value.reasons.every((reason) => typeof reason === "string")
  );
};

const validateLineage = (
  value: unknown,
  expectedStatus: "INCLUDED" | "EXCLUDED",
  fieldName: string
): readonly EvidenceSelectionDecision[] => {
  if (!Array.isArray(value)) {
    throw new PolicyInsightValidationError(
      `${fieldName} must be an array of evidence selection decisions`
    );
  }
  for (const entry of value) {
    if (!isEvidenceSelectionDecision(entry) || entry.status !== expectedStatus) {
      throw new PolicyInsightValidationError(
        `${fieldName} must contain only ${expectedStatus} evidence selection decisions`
      );
    }
  }
  return value as readonly EvidenceSelectionDecision[];
};

const validateSynthesisInput = (value: unknown): PolicySynthesisEnvelope => {
  if (!isPolicySynthesisEnvelope(value)) {
    throw new PolicyInsightValidationError(
      "synthesisInputJson must be a valid canonical PolicySynthesisEnvelope"
    );
  }
  return value;
};

const validateSynthesisOutput = (
  value: unknown,
  payloadCanonical: string,
  payloadHash: string
): PolicyInsightContent => {
  const result = parsePolicyInsightContent(value);
  if (!result.ok) {
    throw new PolicyInsightValidationError(
      `synthesisOutputJson failed PolicyInsightContent validation: ${result.issues.length} issue(s)`,
      { cause: result.issues }
    );
  }

  const { canonical, hash } = computePolicyInsightContentCanonicalAndHash(result.value);
  if (canonical !== payloadCanonical || hash !== payloadHash) {
    throw new PolicyInsightValidationError(
      "payloadCanonical/payloadHash do not match the recomputed canonical form of synthesisOutputJson"
    );
  }
  return result.value;
};

const mapRowToStoredInsight = (row: PolicyInsightRow): StoredPolicyInsight => {
  return {
    id: row.id,
    insightId: row.insightId,
    schemaVersion: row.schemaVersion,
    rulesetVersion: row.rulesetVersion,
    pair: row.pair,
    scopeKey: row.scopeKey,
    positionId: row.positionId,
    generatedAtUnixMs: Number(row.generatedAtUnixMs),
    asOfUnixMs: Number(row.asOfUnixMs),
    expiresAtUnixMs: Number(row.expiresAtUnixMs),
    persistedAtUnixMs: Number(row.persistedAtUnixMs),
    marketHash: row.marketHash,
    positionHash: row.positionHash,
    selectionHash: row.selectionHash,
    synthesisInputHash: row.synthesisInputHash,
    wireContractSha256: row.wireContractSha256 ?? "",
    selectionPolicyVersion: row.selectionPolicyVersion,
    synthesisInputJson: validateSynthesisInput(row.synthesisInputJson),
    synthesisOutputJson: validateSynthesisOutput(
      row.synthesisOutputJson,
      row.payloadCanonical,
      row.payloadHash
    ),
    payloadCanonical: row.payloadCanonical,
    payloadHash: row.payloadHash,
    selectedLineageJson: validateLineage(
      row.selectedLineageJson,
      "INCLUDED",
      "selectedLineageJson"
    ),
    excludedLineageJson: validateLineage(row.excludedLineageJson, "EXCLUDED", "excludedLineageJson")
  };
};

const validateNewRecord = (input: NewPolicyInsightRecord): void => {
  validateSynthesisInput(input.synthesisInputJson);
  validateSynthesisOutput(input.synthesisOutputJson, input.payloadCanonical, input.payloadHash);
  validateLineage(input.selectedLineageJson, "INCLUDED", "selectedLineageJson");
  validateLineage(input.excludedLineageJson, "EXCLUDED", "excludedLineageJson");
};

export const createPostgresPolicyInsightRepository = (db: Db): PolicyInsightRepositoryPort => {
  return {
    findBySynthesisInputHash: async (input) => {
      try {
        const rows = await db
          .select()
          .from(policyInsights)
          .where(
            and(
              eq(policyInsights.schemaVersion, input.schemaVersion),
              eq(policyInsights.rulesetVersion, input.rulesetVersion),
              eq(policyInsights.synthesisInputHash, input.synthesisInputHash),
              eq(policyInsights.wireContractSha256, input.wireContractSha256)
            )
          )
          .limit(1);

        if (rows.length === 0) {
          return null;
        }

        return mapRowToStoredInsight(rows[0]);
      } catch (error) {
        if (isTransientPostgresFailure(error)) {
          throw new PolicyInsightStoreUnavailableError(undefined, { cause: error });
        }
        throw error;
      }
    },

    insertOrGet: async (input) => {
      validateNewRecord(input);

      try {
        return await db.transaction(async (tx) => {
          const insertResult = await tx
            .insert(policyInsights)
            .values({
              insightId: input.insightId,
              schemaVersion: input.schemaVersion,
              rulesetVersion: input.rulesetVersion,
              pair: input.pair,
              scopeKey: input.scopeKey,
              positionId: input.positionId,
              generatedAtUnixMs: input.generatedAtUnixMs,
              asOfUnixMs: input.asOfUnixMs,
              expiresAtUnixMs: input.expiresAtUnixMs,
              persistedAtUnixMs: input.persistedAtUnixMs,
              marketHash: input.marketHash,
              positionHash: input.positionHash,
              selectionHash: input.selectionHash,
              synthesisInputHash: input.synthesisInputHash,
              wireContractSha256: input.wireContractSha256,
              selectionPolicyVersion: input.selectionPolicyVersion,
              synthesisInputJson: input.synthesisInputJson,
              synthesisOutputJson: input.synthesisOutputJson,
              payloadCanonical: input.payloadCanonical,
              payloadHash: input.payloadHash,
              selectedLineageJson: input.selectedLineageJson,
              excludedLineageJson: input.excludedLineageJson
            })
            .onConflictDoNothing({
              target: [
                policyInsights.schemaVersion,
                policyInsights.wireContractSha256,
                policyInsights.rulesetVersion,
                policyInsights.synthesisInputHash
              ]
            })
            .returning();

          if (insertResult.length > 0) {
            return {
              status: "created" as const,
              record: mapRowToStoredInsight(insertResult[0])
            };
          }

          const existing = await tx
            .select()
            .from(policyInsights)
            .where(
              and(
                eq(policyInsights.schemaVersion, input.schemaVersion),
                eq(policyInsights.rulesetVersion, input.rulesetVersion),
                eq(policyInsights.synthesisInputHash, input.synthesisInputHash),
                eq(policyInsights.wireContractSha256, input.wireContractSha256)
              )
            )
            .limit(1);

          if (existing.length === 0) {
            throw new Error(
              "Append-only invariant violated: conflict detected but winning row not found"
            );
          }

          return {
            status: "already_exists" as const,
            record: mapRowToStoredInsight(existing[0])
          };
        });
      } catch (error) {
        if (isTransientPostgresFailure(error)) {
          throw new PolicyInsightStoreUnavailableError(undefined, { cause: error });
        }
        throw error;
      }
    },

    getCurrent: async (input) => {
      try {
        const rows = await db
          .select()
          .from(policyInsights)
          .where(
            and(
              eq(policyInsights.pair, input.pair),
              eq(policyInsights.scopeKey, input.scopeKey),
              eq(policyInsights.schemaVersion, "policy-insight.v1"),
              eq(policyInsights.wireContractSha256, input.wireContractSha256)
            )
          )
          .orderBy(desc(policyInsights.generatedAtUnixMs), desc(policyInsights.id))
          .limit(1);

        if (rows.length === 0) {
          return null;
        }

        return mapRowToStoredInsight(rows[0]);
      } catch (error) {
        if (isTransientPostgresFailure(error)) {
          throw new PolicyInsightStoreUnavailableError(undefined, { cause: error });
        }
        throw error;
      }
    },

    getHistory: async ({ pair, scopeKey, limit, cursor, wireContractSha256 }) => {
      try {
        const MIN_LIMIT = 1;
        const MAX_LIMIT = 100;

        if (limit < MIN_LIMIT || limit > MAX_LIMIT) {
          throw new Error(`History limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`);
        }

        const queryLimit = limit + 1;

        const conditions = [
          eq(policyInsights.pair, pair),
          eq(policyInsights.scopeKey, scopeKey),
          eq(policyInsights.schemaVersion, "policy-insight.v1"),
          eq(policyInsights.wireContractSha256, wireContractSha256)
        ];

        if (cursor !== null) {
          conditions.push(
            or(
              lt(policyInsights.generatedAtUnixMs, cursor.generatedAtUnixMs),
              and(
                eq(policyInsights.generatedAtUnixMs, cursor.generatedAtUnixMs),
                lt(policyInsights.id, cursor.id)
              )
            )!
          );
        }

        const rows = await db
          .select()
          .from(policyInsights)
          .where(and(...conditions))
          .orderBy(desc(policyInsights.generatedAtUnixMs), desc(policyInsights.id))
          .limit(queryLimit);

        const hasMore = rows.length > limit;
        const resultRows = rows.slice(0, limit);
        const records = resultRows.map(mapRowToStoredInsight);

        let nextCursor: PolicyInsightHistoryCursor | null = null;
        if (hasMore && records.length > 0) {
          const lastRecord = records[records.length - 1];
          nextCursor = {
            generatedAtUnixMs: lastRecord.generatedAtUnixMs,
            id: lastRecord.id
          };
        }

        return { records, nextCursor };
      } catch (error) {
        if (isTransientPostgresFailure(error)) {
          throw new PolicyInsightStoreUnavailableError(undefined, { cause: error });
        }
        throw error;
      }
    }
  };
};
