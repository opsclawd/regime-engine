import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import { evidenceBundles } from "../../ledger/pg/schema/evidenceBundles.js";
import type {
  EvidenceBundleRecord,
  EvidenceBundleRepositoryPort,
  EvidenceLifecycle,
  EvidenceHistoryCursor
} from "../../application/ports/evidenceBundleRepositoryPort.js";
import {
  EvidenceRunConflictError,
  evidenceScopeKey
} from "../../application/ports/evidenceBundleRepositoryPort.js";
import type { EvidenceBundleV1 } from "../../contract/evidence/v1/types.generated.js";
import { parseEvidenceBundleV1 } from "../../contract/evidence/v1/validate.js";
import { EvidenceStoreUnavailableError } from "../../application/errors/evidenceErrors.js";

const CANONICAL_TIMESTAMP_MS = (ts: string): number => new Date(ts).getTime();

const deriveLifecycle = (
  nowUnixMs: number,
  freshUntilUnixMs: number,
  expiresAtUnixMs: number
): EvidenceLifecycle => {
  if (nowUnixMs <= freshUntilUnixMs) {
    return "FRESH";
  }
  if (nowUnixMs <= expiresAtUnixMs) {
    return "STALE";
  }
  return "EXPIRED";
};

const TRANSIENT_POSTGRES_CODES = new Set(["57P01", "57P02", "57P03"]);
const TRANSIENT_NET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN"
]);

const isTransientPostgresFailure = (error: unknown): boolean => {
  if (error == null || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: string }).code;
  if (code == null) {
    return false;
  }
  if (TRANSIENT_NET_CODES.has(code)) {
    return true;
  }
  if (TRANSIENT_POSTGRES_CODES.has(code)) {
    return true;
  }
  const message = (error as { message?: string }).message ?? "";
  if (code === "ECONNRESET" || message === "Connection terminated") {
    return true;
  }
  return false;
};

export const createPostgresEvidenceBundleRepository = (db: Db): EvidenceBundleRepositoryPort => {
  return {
    append: async ({ bundle, payloadCanonical, payloadHash, receivedAtUnixMs }) => {
      try {
        const parsed = parseEvidenceBundleV1(bundle) as EvidenceBundleV1;

        const schemaVersion = parsed.schemaVersion;
        const sourcePublisher = parsed.source.publisher;
        const sourceId = parsed.source.sourceId;
        const runId = parsed.runId;
        const pair = parsed.pair;
        const scopeKeyVal = evidenceScopeKey(parsed.scope);
        const correlationId = parsed.correlationId;
        const asOfUnixMs = CANONICAL_TIMESTAMP_MS(parsed.asOf);
        const createdAtUnixMs = CANONICAL_TIMESTAMP_MS(parsed.createdAt);
        const freshUntilUnixMs = CANONICAL_TIMESTAMP_MS(parsed.freshUntil);
        const expiresAtUnixMs = CANONICAL_TIMESTAMP_MS(parsed.expiresAt);
        const now = Date.now();

        const insertResult = await db
          .insert(evidenceBundles)
          .values({
            schemaVersion,
            sourcePublisher,
            sourceId,
            runId,
            pair,
            scopeKey: scopeKeyVal,
            correlationId,
            asOfUnixMs,
            createdAtUnixMs,
            receivedAtUnixMs,
            freshUntilUnixMs,
            expiresAtUnixMs,
            evidenceJson: parsed,
            evidenceCanonical: payloadCanonical,
            evidenceHash: payloadHash,
            ingestedAtUnixMs: now,
            processedAtUnixMs: 0
          })
          .onConflictDoNothing({
            target: [
              evidenceBundles.schemaVersion,
              evidenceBundles.sourcePublisher,
              evidenceBundles.sourceId,
              evidenceBundles.runId
            ]
          })
          .returning({ id: evidenceBundles.id });

        if (insertResult.length > 0) {
          const row = insertResult[0];
          return {
            status: "created",
            receipt: {
              id: row.id,
              evidenceHash: payloadHash,
              receivedAtUnixMs,
              scopeKey: scopeKeyVal
            }
          };
        }

        const existing = await db
          .select({
            id: evidenceBundles.id,
            evidenceHash: evidenceBundles.evidenceHash,
            evidenceCanonical: evidenceBundles.evidenceCanonical,
            receivedAtUnixMs: evidenceBundles.receivedAtUnixMs,
            scopeKey: evidenceBundles.scopeKey
          })
          .from(evidenceBundles)
          .where(
            and(
              eq(evidenceBundles.schemaVersion, schemaVersion),
              eq(evidenceBundles.sourcePublisher, sourcePublisher),
              eq(evidenceBundles.sourceId, sourceId),
              eq(evidenceBundles.runId, runId)
            )
          )
          .limit(1);

        if (existing.length === 0) {
          throw new Error(
            "Append-only invariant violated: conflict detected but winning row not found"
          );
        }

        const winner = existing[0];

        if (winner.evidenceHash === payloadHash) {
          if (winner.evidenceCanonical === payloadCanonical) {
            return {
              status: "already_ingested",
              receipt: {
                id: winner.id,
                evidenceHash: winner.evidenceHash,
                receivedAtUnixMs: winner.receivedAtUnixMs,
                scopeKey: winner.scopeKey
              }
            };
          }
        }

        throw new EvidenceRunConflictError(
          `Evidence run ${runId} from ${sourcePublisher}/${sourceId} already exists with different payload`,
          winner.evidenceHash,
          payloadHash
        );
      } catch (error) {
        if (isTransientPostgresFailure(error)) {
          throw new EvidenceStoreUnavailableError(undefined, { cause: error });
        }
        throw error;
      }
    },

    getLatest: async ({ pair, scope, source, nowUnixMs }) => {
      try {
        const scopeKeyVal = evidenceScopeKey(scope);

        if (source !== null && source.publisher !== undefined && source.sourceId !== undefined) {
          const row = await db.execute(sql`
            SELECT
              id,
              evidence_json,
              evidence_hash,
              received_at_unix_ms,
              fresh_until_unix_ms,
              expires_at_unix_ms
            FROM regime_engine.evidence_bundles
            WHERE pair = ${pair}
              AND scope_key = ${scopeKeyVal}
              AND source_publisher = ${source.publisher}
              AND source_id = ${source.sourceId}
            ORDER BY as_of_unix_ms DESC, received_at_unix_ms DESC, id DESC
            LIMIT 1
          `);

          if (row.length === 0) {
            return [];
          }

          type SingleRawRow = {
            id: number;
            evidence_json: unknown;
            evidence_hash: string;
            received_at_unix_ms: number;
            fresh_until_unix_ms: number;
            expires_at_unix_ms: number;
          };

          const raw = row[0] as unknown as SingleRawRow;

          const bundle = parseEvidenceBundleV1(raw.evidence_json) as EvidenceBundleV1;
          const lifecycle = deriveLifecycle(
            nowUnixMs,
            raw.fresh_until_unix_ms,
            raw.expires_at_unix_ms
          );

          return [
            {
              id: raw.id,
              bundle,
              evidenceHash: raw.evidence_hash,
              receivedAtUnixMs: raw.received_at_unix_ms,
              lifecycle
            }
          ];
        }

        const rows = await db.execute(sql`
          SELECT
            id,
            source_publisher,
            source_id,
            evidence_json,
            evidence_hash,
            received_at_unix_ms,
            fresh_until_unix_ms,
            expires_at_unix_ms
          FROM (
            SELECT
              id,
              source_publisher,
              source_id,
              evidence_json,
              evidence_hash,
              received_at_unix_ms,
              fresh_until_unix_ms,
              expires_at_unix_ms,
              ROW_NUMBER() OVER (
                PARTITION BY source_publisher, source_id
                ORDER BY as_of_unix_ms DESC, received_at_unix_ms DESC, id DESC
              ) AS rn
            FROM regime_engine.evidence_bundles
            WHERE pair = ${pair}
              AND scope_key = ${scopeKeyVal}
              ${source?.publisher !== undefined ? sql`AND source_publisher = ${source.publisher}` : sql``}
              ${source?.sourceId !== undefined ? sql`AND source_id = ${source.sourceId}` : sql``}
          ) ranked
          WHERE rn = 1
          ORDER BY source_publisher, source_id
        `);

        const records: EvidenceBundleRecord[] = [];

        type RawRow = {
          id: number;
          source_publisher: string;
          source_id: string;
          evidence_json: unknown;
          evidence_hash: string;
          received_at_unix_ms: number;
          fresh_until_unix_ms: number;
          expires_at_unix_ms: number;
        };

        for (const raw of rows as unknown as RawRow[]) {
          const bundle = parseEvidenceBundleV1(raw.evidence_json) as EvidenceBundleV1;
          const lifecycle = deriveLifecycle(
            nowUnixMs,
            raw.fresh_until_unix_ms,
            raw.expires_at_unix_ms
          );

          records.push({
            id: raw.id,
            bundle,
            evidenceHash: raw.evidence_hash,
            receivedAtUnixMs: raw.received_at_unix_ms,
            lifecycle
          });
        }

        return records;
      } catch (error) {
        if (isTransientPostgresFailure(error)) {
          throw new EvidenceStoreUnavailableError(undefined, { cause: error });
        }
        throw error;
      }
    },

    getHistory: async ({ pair, scope, source, limit, cursor, nowUnixMs }) => {
      try {
        const DEFAULT_LIMIT = 30;
        const MIN_LIMIT = 1;
        const MAX_LIMIT = 100;

        const effectiveLimit = limit === undefined ? DEFAULT_LIMIT : limit;

        if (effectiveLimit < MIN_LIMIT || effectiveLimit > MAX_LIMIT) {
          throw new Error(`History limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`);
        }

        const scopeKeyVal = evidenceScopeKey(scope);
        const queryLimit = effectiveLimit + 1;

        let cursorPredicate = sql``;
        if (cursor !== null) {
          cursorPredicate = sql`
            AND (
              received_at_unix_ms < ${cursor.receivedAtUnixMs}
              OR (received_at_unix_ms = ${cursor.receivedAtUnixMs} AND id < ${cursor.id})
            )
          `;
        }

        let sourcePredicate = sql``;
        if (source !== null) {
          if (source.publisher !== undefined) {
            sourcePredicate = sql`${sourcePredicate} AND source_publisher = ${source.publisher}`;
          }
          if (source.sourceId !== undefined) {
            sourcePredicate = sql`${sourcePredicate} AND source_id = ${source.sourceId}`;
          }
        }

        const rows = await db.execute(sql`
          SELECT
            id,
            evidence_json,
            evidence_hash,
            received_at_unix_ms,
            fresh_until_unix_ms,
            expires_at_unix_ms
          FROM regime_engine.evidence_bundles
          WHERE pair = ${pair}
            AND scope_key = ${scopeKeyVal}
            ${cursorPredicate}
            ${sourcePredicate}
          ORDER BY received_at_unix_ms DESC, id DESC
          LIMIT ${queryLimit}
        `);

        type RawRow = {
          id: number;
          evidence_json: unknown;
          evidence_hash: string;
          received_at_unix_ms: number;
          fresh_until_unix_ms: number;
          expires_at_unix_ms: number;
        };

        const rawRows = rows as unknown as RawRow[];
        const hasMore = rawRows.length > effectiveLimit;
        const records: EvidenceBundleRecord[] = [];

        for (let i = 0; i < effectiveLimit && i < rawRows.length; i++) {
          const raw = rawRows[i];
          const bundle = parseEvidenceBundleV1(raw.evidence_json) as EvidenceBundleV1;
          const lifecycle = deriveLifecycle(
            nowUnixMs,
            raw.fresh_until_unix_ms,
            raw.expires_at_unix_ms
          );

          records.push({
            id: raw.id,
            bundle,
            evidenceHash: raw.evidence_hash,
            receivedAtUnixMs: raw.received_at_unix_ms,
            lifecycle
          });
        }

        let nextCursor: EvidenceHistoryCursor | null = null;
        if (hasMore && records.length > 0) {
          const lastRecord = records[records.length - 1];
          nextCursor = {
            receivedAtUnixMs: lastRecord.receivedAtUnixMs,
            id: lastRecord.id
          };
        }

        return { records, nextCursor };
      } catch (error) {
        if (isTransientPostgresFailure(error)) {
          throw new EvidenceStoreUnavailableError(undefined, { cause: error });
        }
        throw error;
      }
    }
  };
};
