import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import { evidenceBundles } from "../../ledger/pg/schema/evidenceBundles.js";
import type {
  EvidenceBundleRecord,
  EvidenceBundleRepositoryPort,
  EvidenceLifecycle
} from "../../application/ports/evidenceBundleRepositoryPort.js";
import {
  EvidenceRunConflictError,
  evidenceScopeKey
} from "../../application/ports/evidenceBundleRepositoryPort.js";
import type { EvidenceBundleV1 } from "../../contract/evidence/v1/types.generated.js";
import { parseEvidenceBundleV1 } from "../../contract/evidence/v1/validate.js";

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

export const createPostgresEvidenceBundleRepository = (db: Db): EvidenceBundleRepositoryPort => {
  return {
    append: async ({ bundle, payloadCanonical, payloadHash, receivedAtUnixMs }) => {
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
    },

    getLatest: async ({ pair, scope, source, nowUnixMs }) => {
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
    }
  };
};
