import type { LedgerStore } from "./store.js";
import type { Db } from "./pg/db.js";
import { createLedgerStore } from "./store.js";
import { createDb } from "./pg/db.js";

export interface StoreContext {
  ledger: LedgerStore;
  pg: Db;
  pgClient: { end: () => Promise<void> };
}

export const createStoreContext = (
  ledgerPath: string,
  pgConnectionString: string
): StoreContext => {
  const ledger = createLedgerStore(ledgerPath);
  const { db: pg, client: pgClient } = createDb(pgConnectionString);

  return { ledger, pg, pgClient };
};

export const closeStoreContext = async (ctx: StoreContext): Promise<void> => {
  ctx.ledger.close();
  await ctx.pgClient.end();
};