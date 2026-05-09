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
  db.exec("PRAGMA busy_timeout = 2000");
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
