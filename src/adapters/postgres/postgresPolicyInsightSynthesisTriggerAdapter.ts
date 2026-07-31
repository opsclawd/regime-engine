import { sql } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import type {
  PolicyInsightSynthesisClaim,
  PolicyInsightSynthesisTriggerPort
} from "../../application/ports/policyInsightSynthesisTriggerPort.js";

type CursorRow = {
  cursor_key: string;
  last_processed_receipt_id: number;
  target_receipt_id: number | null;
  lease_owner: string | null;
  lease_expires_at_unix_ms: number | null;
  attempt_count: number;
  next_attempt_at_unix_ms: number | null;
};

type MaxIdRow = {
  max_id: number | null;
};

export const createPostgresPolicyInsightSynthesisTriggerAdapter = (
  db: Db
): PolicyInsightSynthesisTriggerPort => {
  return {
    claimLatestPairEvidence: async ({
      cursorKey,
      leaseOwner,
      leaseDurationMs,
      nowUnixMs,
      pair = "SOL/USDC",
      scopeKey = "pair"
    }): Promise<PolicyInsightSynthesisClaim | null> => {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`
          INSERT INTO regime_engine.policy_insight_synthesis_cursor (
            cursor_key,
            last_processed_receipt_id,
            attempt_count,
            updated_at_unix_ms
          ) VALUES (
            ${cursorKey},
            0,
            0,
            ${nowUnixMs}
          )
          ON CONFLICT (cursor_key) DO NOTHING
        `);

        const cursorRows = await tx.execute(sql`
          SELECT
            cursor_key,
            last_processed_receipt_id,
            target_receipt_id,
            lease_owner,
            lease_expires_at_unix_ms,
            attempt_count,
            next_attempt_at_unix_ms
          FROM regime_engine.policy_insight_synthesis_cursor
          WHERE cursor_key = ${cursorKey}
          FOR UPDATE
        `);

        if (cursorRows.length === 0) {
          return null;
        }

        const cursor = cursorRows[0] as unknown as CursorRow;

        const nextAttemptAt =
          cursor.next_attempt_at_unix_ms !== null ? Number(cursor.next_attempt_at_unix_ms) : null;
        if (nextAttemptAt !== null && nextAttemptAt > nowUnixMs) {
          return null;
        }

        const leaseExpiresAt =
          cursor.lease_expires_at_unix_ms !== null ? Number(cursor.lease_expires_at_unix_ms) : null;
        if (cursor.lease_owner !== null && leaseExpiresAt !== null && leaseExpiresAt > nowUnixMs) {
          return null;
        }

        const lastProcessedReceiptId = Number(cursor.last_processed_receipt_id);

        const maxIdRows = await tx.execute(sql`
          SELECT MAX(id) AS max_id
          FROM regime_engine.evidence_bundles
          WHERE pair = ${pair}
            AND scope_key = ${scopeKey}
            AND id > ${lastProcessedReceiptId}
        `);

        const maxIdRaw = (maxIdRows[0] as unknown as MaxIdRow).max_id;
        if (maxIdRaw === null || maxIdRaw === undefined) {
          return null;
        }

        const targetReceiptId = Number(maxIdRaw);

        const currentTargetReceiptId =
          cursor.target_receipt_id !== null ? Number(cursor.target_receipt_id) : null;

        const newAttemptCount =
          currentTargetReceiptId === targetReceiptId ? Number(cursor.attempt_count) + 1 : 1;

        const newLeaseExpiresAt = nowUnixMs + leaseDurationMs;

        await tx.execute(sql`
          UPDATE regime_engine.policy_insight_synthesis_cursor
          SET
            target_receipt_id = ${targetReceiptId},
            lease_owner = ${leaseOwner},
            lease_expires_at_unix_ms = ${newLeaseExpiresAt},
            attempt_count = ${newAttemptCount},
            next_attempt_at_unix_ms = NULL,
            updated_at_unix_ms = ${nowUnixMs}
          WHERE cursor_key = ${cursorKey}
        `);

        return {
          cursorKey,
          targetReceiptId,
          attemptCount: newAttemptCount,
          leaseOwner,
          leaseExpiresAtUnixMs: newLeaseExpiresAt,
          lastProcessedReceiptId
        };
      });
    },

    complete: async ({
      cursorKey,
      leaseOwner,
      targetReceiptId,
      nowUnixMs,
      outcome,
      errorCode,
      errorMessage
    }): Promise<boolean> => {
      const result = await db.execute(sql`
        UPDATE regime_engine.policy_insight_synthesis_cursor
        SET
          last_processed_receipt_id = ${targetReceiptId},
          target_receipt_id = NULL,
          lease_owner = NULL,
          lease_expires_at_unix_ms = NULL,
          attempt_count = 0,
          next_attempt_at_unix_ms = NULL,
          last_outcome = ${outcome},
          last_error_code = ${errorCode ?? null},
          last_error_message = ${errorMessage ?? null},
          updated_at_unix_ms = ${nowUnixMs}
        WHERE cursor_key = ${cursorKey}
          AND lease_owner = ${leaseOwner}
          AND target_receipt_id = ${targetReceiptId}
        RETURNING cursor_key
      `);

      return result.length > 0;
    },

    releaseForRetry: async ({
      cursorKey,
      leaseOwner,
      targetReceiptId,
      nowUnixMs,
      classification,
      sanitizedMessage,
      retryAtUnixMs
    }): Promise<boolean> => {
      const result = await db.execute(sql`
        UPDATE regime_engine.policy_insight_synthesis_cursor
        SET
          lease_owner = NULL,
          lease_expires_at_unix_ms = NULL,
          next_attempt_at_unix_ms = ${retryAtUnixMs},
          last_outcome = 'transient_failure',
          last_error_code = ${classification},
          last_error_message = ${sanitizedMessage},
          updated_at_unix_ms = ${nowUnixMs}
        WHERE cursor_key = ${cursorKey}
          AND lease_owner = ${leaseOwner}
          AND target_receipt_id = ${targetReceiptId}
        RETURNING cursor_key
      `);

      return result.length > 0;
    }
  };
};
