import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PlanRequest } from "../contract/v1/types.js";

export interface LedgerStore {
  db: DatabaseSync;
  path: string;
  close: () => void;
}

const resolveSchemaSql = (): string => {
  return readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
};

const migratePlanRequests = (db: DatabaseSync): void => {
  const tableInfo = db.prepare("PRAGMA table_info(plan_requests)").all() as Array<{ name: string }>;
  if (tableInfo.length === 0) {
    return;
  }

  const columnNames = new Set(tableInfo.map((col) => col.name));
  const hasPositionId = columnNames.has("position_id");
  const hasWalletId = columnNames.has("wallet_id");
  const hasPoolAddress = columnNames.has("pool_address");

  if (hasPositionId && hasWalletId && hasPoolAddress) {
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    if (!hasPositionId) {
      db.exec("ALTER TABLE plan_requests ADD COLUMN position_id TEXT");
    }
    if (!hasWalletId) {
      db.exec("ALTER TABLE plan_requests ADD COLUMN wallet_id TEXT");
    }
    if (!hasPoolAddress) {
      db.exec("ALTER TABLE plan_requests ADD COLUMN pool_address TEXT");
    }

    const BATCH_SIZE = 500;
    let lastId = 0;

    const selectStmt = db.prepare(
      "SELECT id, request_json FROM plan_requests WHERE id > ? ORDER BY id ASC LIMIT ?"
    );
    const updateStmt = db.prepare(
      "UPDATE plan_requests SET position_id = ?, wallet_id = ?, pool_address = ? WHERE id = ?"
    );

    let hasMore = true;
    while (hasMore) {
      const rows = selectStmt.all(lastId, BATCH_SIZE) as Array<{
        id: number;
        request_json: string;
      }>;
      if (rows.length === 0) {
        hasMore = false;
        break;
      }

      for (const row of rows) {
        const parsed = JSON.parse(row.request_json) as PlanRequest;
        const positionId = parsed.position?.positionId;
        const walletId = parsed.position?.walletId ?? null;
        const poolAddress = parsed.market?.poolAddress;
        if (!positionId || !poolAddress) {
          throw new Error("Invalid position identity");
        }
        updateStmt.run(positionId, walletId, poolAddress, row.id);
        lastId = row.id;
      }

      if (rows.length < BATCH_SIZE) {
        hasMore = false;
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

export const createLedgerStore = (databasePath: string): LedgerStore => {
  if (databasePath !== ":memory:") {
    const resolvedPath = resolve(databasePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA busy_timeout = 2000");
  if (databasePath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }

  migratePlanRequests(db);
  db.exec(resolveSchemaSql());

  return {
    db,
    path: databasePath,
    close: () => {
      db.close();
    }
  };
};

export const runInTransaction = <T>(store: LedgerStore, operation: () => T): T => {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    store.db.exec("COMMIT");
    return result;
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
};

export const getLedgerCounts = (store: LedgerStore) => {
  const planRequests =
    (store.db.prepare("SELECT COUNT(*) AS count FROM plan_requests").get() as { count: number })
      .count ?? 0;
  const plans =
    (store.db.prepare("SELECT COUNT(*) AS count FROM plans").get() as { count: number }).count ?? 0;
  const executionResults =
    (store.db.prepare("SELECT COUNT(*) AS count FROM execution_results").get() as { count: number })
      .count ?? 0;
  const srLevelBriefs =
    (store.db.prepare("SELECT COUNT(*) AS count FROM sr_level_briefs").get() as { count: number })
      .count ?? 0;
  const srLevels =
    (store.db.prepare("SELECT COUNT(*) AS count FROM sr_levels").get() as { count: number })
      .count ?? 0;
  const clmmExecutionEvents =
    (
      store.db.prepare("SELECT COUNT(*) AS count FROM clmm_execution_events").get() as {
        count: number;
      }
    ).count ?? 0;
  const candleRevisions =
    (store.db.prepare("SELECT COUNT(*) AS count FROM candle_revisions").get() as { count: number })
      .count ?? 0;

  return {
    planRequests,
    plans,
    executionResults,
    srLevelBriefs,
    srLevels,
    clmmExecutionEvents,
    candleRevisions
  };
};

export type PlanValidationResult =
  | { kind: "found" }
  | { kind: "not_found" }
  | { kind: "hash_mismatch" };

export const validatePlanForExecutionResult = (
  store: LedgerStore,
  planId: string,
  planHash: string
): PlanValidationResult => {
  const anyPlan = store.db.prepare("SELECT id FROM plans WHERE plan_id = ? LIMIT 1").get(planId) as
    | { id: number }
    | undefined;

  if (!anyPlan) {
    return { kind: "not_found" };
  }

  const matchingPlan = store.db
    .prepare("SELECT id FROM plans WHERE plan_id = ? AND plan_hash = ? LIMIT 1")
    .get(planId, planHash) as { id: number } | undefined;

  if (!matchingPlan) {
    return { kind: "hash_mismatch" };
  }

  return { kind: "found" };
};
