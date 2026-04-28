import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface LedgerStore {
  db: DatabaseSync;
  path: string;
  close: () => void;
}

const resolveSchemaSql = (): string => {
  return readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
};

export const createLedgerStore = (databasePath: string): LedgerStore => {
  if (databasePath !== ":memory:") {
    const resolvedPath = resolve(databasePath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const db = new DatabaseSync(databasePath);
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
  store.db.exec("BEGIN");
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

export const findPlanHashByPlanId = (store: LedgerStore, planId: string): string | null => {
  const row = store.db
    .prepare("SELECT plan_hash FROM plans WHERE plan_id = ? ORDER BY id DESC LIMIT 1")
    .get(planId) as { plan_hash: string } | undefined;

  if (!row) {
    return null;
  }

  return row.plan_hash;
};
