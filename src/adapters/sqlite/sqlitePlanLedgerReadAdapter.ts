import type { LedgerStore } from "../../ledger/store.js";
import type {
  PlanLedgerReadPort,
  PositionPlanScope,
  StoredPositionPlan
} from "../../application/ports/planLedgerPort.js";
import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";

const parseStoredRow = (row: { request_json: string; plan_json: string }): StoredPositionPlan => ({
  planRequest: JSON.parse(row.request_json) as PlanRequest,
  planResponse: JSON.parse(row.plan_json) as PlanResponse
});

export class SqlitePlanLedgerReadAdapter implements PlanLedgerReadPort {
  public constructor(private readonly store: LedgerStore) {}

  public async getLatestPositionPlan(scope: PositionPlanScope): Promise<StoredPositionPlan | null> {
    const hasWallet = scope.walletId !== undefined;
    const sql = hasWallet
      ? `
        SELECT pr.request_json, p.plan_json
        FROM plan_requests pr
        JOIN plans p ON pr.plan_id = p.plan_id
        WHERE pr.position_id = ?
          AND pr.wallet_id = ?
          AND pr.pool_address = ?
        ORDER BY p.as_of_unix_ms DESC, p.id DESC
        LIMIT 1
      `
      : `
        SELECT pr.request_json, p.plan_json
        FROM plan_requests pr
        JOIN plans p ON pr.plan_id = p.plan_id
        WHERE pr.position_id = ?
          AND pr.wallet_id IS NULL
          AND pr.pool_address = ?
        ORDER BY p.as_of_unix_ms DESC, p.id DESC
        LIMIT 1
      `;

    const params = hasWallet
      ? [scope.positionId, scope.walletId!, scope.poolAddress]
      : [scope.positionId, scope.poolAddress];

    const row = this.store.db.prepare(sql).get(...params) as
      | { request_json: string; plan_json: string }
      | undefined;

    if (!row) {
      return null;
    }

    return parseStoredRow(row);
  }

  public async getPositionPlanByHash(
    scope: PositionPlanScope,
    planHash: string
  ): Promise<StoredPositionPlan | null> {
    const hasWallet = scope.walletId !== undefined;
    const sql = hasWallet
      ? `
        SELECT pr.request_json, p.plan_json
        FROM plan_requests pr
        JOIN plans p ON pr.plan_id = p.plan_id
        WHERE pr.position_id = ?
          AND pr.wallet_id = ?
          AND pr.pool_address = ?
          AND p.plan_hash = ?
        ORDER BY p.as_of_unix_ms DESC, p.id DESC
        LIMIT 1
      `
      : `
        SELECT pr.request_json, p.plan_json
        FROM plan_requests pr
        JOIN plans p ON pr.plan_id = p.plan_id
        WHERE pr.position_id = ?
          AND pr.wallet_id IS NULL
          AND pr.pool_address = ?
          AND p.plan_hash = ?
        ORDER BY p.as_of_unix_ms DESC, p.id DESC
        LIMIT 1
      `;

    const params = hasWallet
      ? [scope.positionId, scope.walletId!, scope.poolAddress, planHash]
      : [scope.positionId, scope.poolAddress, planHash];

    const row = this.store.db.prepare(sql).get(...params) as
      | { request_json: string; plan_json: string }
      | undefined;

    if (!row) {
      return null;
    }

    return parseStoredRow(row);
  }

  public async listLatestPositionPlans(): Promise<readonly StoredPositionPlan[]> {
    const sql = `
      WITH RankedPlans AS (
        SELECT
          pr.request_json,
          p.plan_json,
          p.as_of_unix_ms,
          p.id,
          ROW_NUMBER() OVER (
            PARTITION BY pr.position_id, pr.wallet_id, pr.pool_address
            ORDER BY p.as_of_unix_ms DESC, p.id DESC
          ) AS rn
        FROM plan_requests pr
        JOIN plans p ON pr.plan_id = p.plan_id
        WHERE pr.wallet_id IS NOT NULL
      )
      SELECT request_json, plan_json
      FROM RankedPlans
      WHERE rn = 1
      ORDER BY as_of_unix_ms DESC, id DESC
    `;

    const rows = this.store.db.prepare(sql).all() as Array<{
      request_json: string;
      plan_json: string;
    }>;

    return rows.map(parseStoredRow);
  }
}

export const createSqlitePlanLedgerReadAdapter = (store: LedgerStore): PlanLedgerReadPort =>
  new SqlitePlanLedgerReadAdapter(store);
