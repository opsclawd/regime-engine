import { sql } from "drizzle-orm/sql";
import type { LedgerStore } from "./store.js";
import type { Db } from "./pg/db.js";

export interface SqliteHealthResult {
  ok: boolean;
  status: "ok" | "unavailable";
}

export interface PgHealthResult {
  ok: boolean;
  status: "ok" | "unavailable" | "not_configured";
}

export const checkSqliteHealth = (ledger: LedgerStore): SqliteHealthResult => {
  try {
    ledger.db.prepare("SELECT 1").get();
    return { ok: true, status: "ok" };
  } catch {
    return { ok: false, status: "unavailable" };
  }
};

export const checkPgHealth = async (pg: Db | null): Promise<PgHealthResult> => {
  if (pg === null) {
    return { ok: true, status: "not_configured" };
  }
  try {
    await pg.execute(sql`SELECT 1`);
    return { ok: true, status: "ok" };
  } catch {
    return { ok: false, status: "unavailable" };
  }
};
