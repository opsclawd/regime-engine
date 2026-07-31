import { sql } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import type {
  ClaimBatchInput,
  CompletePositionPolicyInsightSynthesisInput,
  EnqueueOrReconcileInput,
  FailPositionPolicyInsightSynthesisInput,
  PositionPolicyInsightSynthesisClaim,
  PositionPolicyInsightSynthesisQueuePort,
  PositionPolicyInsightSynthesisRequest,
  PositionPolicyInsightSynthesisStatus,
  ReleasePositionPolicyInsightSynthesisForRetryInput,
  SupersedePositionPolicyInsightSynthesisInput
} from "../../application/ports/positionPolicyInsightSynthesisQueuePort.js";

type RawRequestRow = {
  id: number | bigint;
  scope_key: string;
  selection_hash: string | null;
  plan_hash: string | null;
  ruleset_version: string;
  status: string;
  attempt_count: number | bigint;
  next_attempt_at_unix_ms: number | bigint | null;
  lease_owner: string | null;
  lease_expires_at_unix_ms: number | bigint | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at_unix_ms: number | bigint;
  updated_at_unix_ms: number | bigint;
};

type RawClaimRow = {
  id: number | bigint;
  scope_key: string;
  selection_hash: string;
  plan_hash: string;
  ruleset_version: string;
  attempt_count: number | bigint;
  lease_owner: string;
  lease_expires_at_unix_ms: number | bigint;
};

function mapRow(row: RawRequestRow): PositionPolicyInsightSynthesisRequest {
  return {
    id: Number(row.id),
    scopeKey: row.scope_key,
    selectionHash: row.selection_hash ?? null,
    planHash: row.plan_hash ?? null,
    rulesetVersion: row.ruleset_version,
    status: row.status as PositionPolicyInsightSynthesisStatus,
    attemptCount: Number(row.attempt_count),
    nextAttemptAtUnixMs:
      row.next_attempt_at_unix_ms !== null && row.next_attempt_at_unix_ms !== undefined
        ? Number(row.next_attempt_at_unix_ms)
        : null,
    leaseOwner: row.lease_owner ?? null,
    leaseExpiresAtUnixMs:
      row.lease_expires_at_unix_ms !== null && row.lease_expires_at_unix_ms !== undefined
        ? Number(row.lease_expires_at_unix_ms)
        : null,
    lastErrorCode: row.last_error_code ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    createdAtUnixMs: Number(row.created_at_unix_ms),
    updatedAtUnixMs: Number(row.updated_at_unix_ms)
  };
}

export const createPostgresPositionPolicyInsightSynthesisQueueAdapter = (
  db: Db
): PositionPolicyInsightSynthesisQueuePort => {
  return {
    enqueueOrReconcile: async ({
      scopeKey,
      selectionHash = null,
      planHash = null,
      rulesetVersion,
      nowUnixMs
    }: EnqueueOrReconcileInput): Promise<PositionPolicyInsightSynthesisRequest> => {
      const effectiveSelectionHash = selectionHash ?? null;
      const effectivePlanHash = planHash ?? null;

      if (!effectiveSelectionHash && !effectivePlanHash) {
        throw new Error("Either selectionHash or planHash must be provided to enqueueOrReconcile");
      }

      return await db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(hashtext(${scopeKey}), hashtext(${rulesetVersion}))
        `);

        if (effectiveSelectionHash && effectivePlanHash) {
          // Case 1: Both hashes present
          const existingReady = await tx.execute(sql`
            SELECT *
            FROM regime_engine.policy_insight_synthesis_requests
            WHERE scope_key = ${scopeKey}
              AND selection_hash = ${effectiveSelectionHash}
              AND plan_hash = ${effectivePlanHash}
              AND ruleset_version = ${rulesetVersion}
            LIMIT 1
          `);
          if (existingReady.length > 0) {
            return mapRow(existingReady[0] as unknown as RawRequestRow);
          }

          const existingWaitingPlan = await tx.execute(sql`
            SELECT *
            FROM regime_engine.policy_insight_synthesis_requests
            WHERE scope_key = ${scopeKey}
              AND selection_hash = ${effectiveSelectionHash}
              AND ruleset_version = ${rulesetVersion}
              AND status = 'waiting_for_plan'
            LIMIT 1
          `);
          if (existingWaitingPlan.length > 0) {
            const promoted = await tx.execute(sql`
              UPDATE regime_engine.policy_insight_synthesis_requests
              SET
                plan_hash = ${effectivePlanHash},
                status = 'pending',
                updated_at_unix_ms = ${nowUnixMs}
              WHERE id = ${(existingWaitingPlan[0] as unknown as RawRequestRow).id}
                AND status = 'waiting_for_plan'
              RETURNING *
            `);
            if (promoted.length > 0) {
              return mapRow(promoted[0] as unknown as RawRequestRow);
            }
          }

          const existingWaitingEvidence = await tx.execute(sql`
            SELECT *
            FROM regime_engine.policy_insight_synthesis_requests
            WHERE scope_key = ${scopeKey}
              AND plan_hash = ${effectivePlanHash}
              AND ruleset_version = ${rulesetVersion}
              AND status = 'waiting_for_evidence'
            LIMIT 1
          `);
          if (existingWaitingEvidence.length > 0) {
            const promoted = await tx.execute(sql`
              UPDATE regime_engine.policy_insight_synthesis_requests
              SET
                selection_hash = ${effectiveSelectionHash},
                status = 'pending',
                updated_at_unix_ms = ${nowUnixMs}
              WHERE id = ${(existingWaitingEvidence[0] as unknown as RawRequestRow).id}
                AND status = 'waiting_for_evidence'
              RETURNING *
            `);
            if (promoted.length > 0) {
              return mapRow(promoted[0] as unknown as RawRequestRow);
            }
          }

          const inserted = await tx.execute(sql`
            INSERT INTO regime_engine.policy_insight_synthesis_requests (
              scope_key,
              selection_hash,
              plan_hash,
              ruleset_version,
              status,
              attempt_count,
              created_at_unix_ms,
              updated_at_unix_ms
            ) VALUES (
              ${scopeKey},
              ${effectiveSelectionHash},
              ${effectivePlanHash},
              ${rulesetVersion},
              'pending',
              0,
              ${nowUnixMs},
              ${nowUnixMs}
            )
            RETURNING *
          `);
          return mapRow(inserted[0] as unknown as RawRequestRow);
        }

        if (effectiveSelectionHash && !effectivePlanHash) {
          // Case 2: Only selectionHash (waiting_for_plan)
          const existingSelection = await tx.execute(sql`
            SELECT *
            FROM regime_engine.policy_insight_synthesis_requests
            WHERE scope_key = ${scopeKey}
              AND selection_hash = ${effectiveSelectionHash}
              AND ruleset_version = ${rulesetVersion}
            LIMIT 1
          `);
          if (existingSelection.length > 0) {
            return mapRow(existingSelection[0] as unknown as RawRequestRow);
          }

          const inserted = await tx.execute(sql`
            INSERT INTO regime_engine.policy_insight_synthesis_requests (
              scope_key,
              selection_hash,
              plan_hash,
              ruleset_version,
              status,
              attempt_count,
              created_at_unix_ms,
              updated_at_unix_ms
            ) VALUES (
              ${scopeKey},
              ${effectiveSelectionHash},
              NULL,
              ${rulesetVersion},
              'waiting_for_plan',
              0,
              ${nowUnixMs},
              ${nowUnixMs}
            )
            RETURNING *
          `);
          return mapRow(inserted[0] as unknown as RawRequestRow);
        }

        // Case 3: Only planHash (waiting_for_evidence)
        const existingPlan = await tx.execute(sql`
          SELECT *
          FROM regime_engine.policy_insight_synthesis_requests
          WHERE scope_key = ${scopeKey}
            AND plan_hash = ${effectivePlanHash}
            AND ruleset_version = ${rulesetVersion}
          LIMIT 1
        `);
        if (existingPlan.length > 0) {
          return mapRow(existingPlan[0] as unknown as RawRequestRow);
        }

        const inserted = await tx.execute(sql`
          INSERT INTO regime_engine.policy_insight_synthesis_requests (
            scope_key,
            selection_hash,
            plan_hash,
            ruleset_version,
            status,
            attempt_count,
            created_at_unix_ms,
            updated_at_unix_ms
          ) VALUES (
            ${scopeKey},
            NULL,
            ${effectivePlanHash},
            ${rulesetVersion},
            'waiting_for_evidence',
            0,
            ${nowUnixMs},
            ${nowUnixMs}
          )
          RETURNING *
        `);
        return mapRow(inserted[0] as unknown as RawRequestRow);
      });
    },

    claimBatch: async ({
      leaseOwner,
      leaseDurationMs,
      batchSize,
      nowUnixMs
    }: ClaimBatchInput): Promise<PositionPolicyInsightSynthesisClaim[]> => {
      const rows = await db.transaction(async (tx) => {
        const result = await tx.execute(sql`
          WITH active_scopes AS (
            SELECT DISTINCT scope_key
            FROM regime_engine.policy_insight_synthesis_requests
            WHERE status = 'processing' AND lease_expires_at_unix_ms > ${nowUnixMs}
          ),
          candidate_ids AS (
            SELECT MIN(id) AS id
            FROM regime_engine.policy_insight_synthesis_requests
            WHERE scope_key NOT IN (SELECT scope_key FROM active_scopes)
              AND (
                (status = 'pending' AND (next_attempt_at_unix_ms IS NULL OR next_attempt_at_unix_ms <= ${nowUnixMs}))
                OR
                (status = 'processing' AND lease_expires_at_unix_ms <= ${nowUnixMs})
              )
            GROUP BY scope_key
          ),
          batch AS (
            SELECT id
            FROM regime_engine.policy_insight_synthesis_requests
            WHERE id IN (SELECT id FROM candidate_ids)
            ORDER BY id ASC
            FOR UPDATE SKIP LOCKED
            LIMIT ${batchSize}
          )
          UPDATE regime_engine.policy_insight_synthesis_requests r
          SET
            status = 'processing',
            lease_owner = ${leaseOwner},
            lease_expires_at_unix_ms = ${nowUnixMs + leaseDurationMs},
            attempt_count = r.attempt_count + 1,
            next_attempt_at_unix_ms = NULL,
            updated_at_unix_ms = ${nowUnixMs}
          FROM batch
          WHERE r.id = batch.id
          RETURNING
            r.id,
            r.scope_key,
            r.selection_hash,
            r.plan_hash,
            r.ruleset_version,
            r.attempt_count,
            r.lease_owner,
            r.lease_expires_at_unix_ms
        `);
        return result as unknown as RawClaimRow[];
      });

      const claims = rows.map((r) => ({
        id: Number(r.id),
        scopeKey: r.scope_key,
        selectionHash: r.selection_hash,
        planHash: r.plan_hash,
        rulesetVersion: r.ruleset_version,
        attemptCount: Number(r.attempt_count),
        leaseOwner: r.lease_owner,
        leaseExpiresAtUnixMs: Number(r.lease_expires_at_unix_ms)
      }));

      claims.sort((a, b) => a.id - b.id);
      return claims;
    },

    complete: async ({
      id,
      leaseOwner,
      nowUnixMs
    }: CompletePositionPolicyInsightSynthesisInput): Promise<boolean> => {
      const result = await db.execute(sql`
        UPDATE regime_engine.policy_insight_synthesis_requests
        SET
          status = 'completed',
          lease_owner = NULL,
          lease_expires_at_unix_ms = NULL,
          updated_at_unix_ms = ${nowUnixMs}
        WHERE id = ${id}
          AND lease_owner = ${leaseOwner}
          AND status = 'processing'
        RETURNING id
      `);
      return result.length > 0;
    },

    fail: async ({
      id,
      leaseOwner,
      nowUnixMs,
      errorCode,
      errorMessage
    }: FailPositionPolicyInsightSynthesisInput): Promise<boolean> => {
      const result = await db.execute(sql`
        UPDATE regime_engine.policy_insight_synthesis_requests
        SET
          status = 'failed',
          lease_owner = NULL,
          lease_expires_at_unix_ms = NULL,
          last_error_code = ${errorCode},
          last_error_message = ${errorMessage},
          updated_at_unix_ms = ${nowUnixMs}
        WHERE id = ${id}
          AND lease_owner = ${leaseOwner}
          AND status = 'processing'
        RETURNING id
      `);
      return result.length > 0;
    },

    supersede: async ({
      id,
      leaseOwner,
      nowUnixMs,
      errorCode,
      errorMessage
    }: SupersedePositionPolicyInsightSynthesisInput): Promise<boolean> => {
      const result = await db.execute(sql`
        UPDATE regime_engine.policy_insight_synthesis_requests
        SET
          status = 'superseded',
          lease_owner = NULL,
          lease_expires_at_unix_ms = NULL,
          last_error_code = ${errorCode ?? null},
          last_error_message = ${errorMessage ?? null},
          updated_at_unix_ms = ${nowUnixMs}
        WHERE id = ${id}
          AND lease_owner = ${leaseOwner}
          AND status = 'processing'
        RETURNING id
      `);
      return result.length > 0;
    },

    releaseForRetry: async ({
      id,
      leaseOwner,
      nowUnixMs,
      retryAtUnixMs,
      errorCode,
      errorMessage,
      maxAttempts = 5
    }: ReleasePositionPolicyInsightSynthesisForRetryInput): Promise<boolean> => {
      return await db.transaction(async (tx) => {
        const rows = await tx.execute(sql`
          SELECT id, attempt_count
          FROM regime_engine.policy_insight_synthesis_requests
          WHERE id = ${id}
            AND lease_owner = ${leaseOwner}
            AND status = 'processing'
          FOR UPDATE
        `);

        if (rows.length === 0) {
          return false;
        }

        const row = rows[0] as unknown as { attempt_count: number | bigint };
        const attemptCount = Number(row.attempt_count);

        if (attemptCount >= maxAttempts) {
          const updated = await tx.execute(sql`
            UPDATE regime_engine.policy_insight_synthesis_requests
            SET
              status = 'failed',
              lease_owner = NULL,
              lease_expires_at_unix_ms = NULL,
              last_error_code = 'EXHAUSTED_RETRIES',
              last_error_message = ${errorMessage ?? "Exhausted retry attempt limit"},
              updated_at_unix_ms = ${nowUnixMs}
            WHERE id = ${id}
              AND lease_owner = ${leaseOwner}
              AND status = 'processing'
            RETURNING id
          `);
          return updated.length > 0;
        }

        const updated = await tx.execute(sql`
          UPDATE regime_engine.policy_insight_synthesis_requests
          SET
            status = 'pending',
            lease_owner = NULL,
            lease_expires_at_unix_ms = NULL,
            next_attempt_at_unix_ms = ${retryAtUnixMs},
            last_error_code = ${errorCode ?? null},
            last_error_message = ${errorMessage ?? null},
            updated_at_unix_ms = ${nowUnixMs}
          WHERE id = ${id}
            AND lease_owner = ${leaseOwner}
            AND status = 'processing'
          RETURNING id
        `);
        return updated.length > 0;
      });
    },

    listWaitingScopes: async (): Promise<string[]> => {
      const rows = await db.execute(sql`
        SELECT DISTINCT scope_key
        FROM regime_engine.policy_insight_synthesis_requests
        WHERE status IN ('waiting_for_plan', 'waiting_for_evidence')
        ORDER BY scope_key ASC
      `);
      return (rows as unknown as Array<{ scope_key: string }>).map((r) => r.scope_key);
    },

    listEligiblePositionScopes: async (nowUnixMs: number): Promise<string[]> => {
      const rows = await db.execute(sql`
        SELECT DISTINCT scope_key
        FROM regime_engine.evidence_bundles
        WHERE scope_key <> 'pair'
          AND expires_at_unix_ms > ${nowUnixMs}
        ORDER BY scope_key ASC
      `);
      return (rows as unknown as Array<{ scope_key: string }>).map((r) => r.scope_key);
    },

    getById: async (id: number): Promise<PositionPolicyInsightSynthesisRequest | null> => {
      const rows = await db.execute(sql`
        SELECT *
        FROM regime_engine.policy_insight_synthesis_requests
        WHERE id = ${id}
      `);
      if (rows.length === 0) {
        return null;
      }
      return mapRow(rows[0] as unknown as RawRequestRow);
    }
  };
};
