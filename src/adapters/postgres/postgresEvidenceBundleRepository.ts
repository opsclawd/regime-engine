import { and, eq } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import { evidenceBundles } from "../../ledger/pg/schema/evidenceBundles.js";
import type { EvidenceBundleRepositoryPort } from "../../application/ports/evidenceBundleRepositoryPort.js";
import {
  EvidenceRunConflictError,
  evidenceScopeKey
} from "../../application/ports/evidenceBundleRepositoryPort.js";
import type { EvidenceBundleV1 } from "../../contract/evidence/v1/types.generated.js";
import { parseEvidenceBundleV1 } from "../../contract/evidence/v1/validate.js";

const CANONICAL_TIMESTAMP_MS = (ts: string): number => new Date(ts).getTime();

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
    }
  };
};
