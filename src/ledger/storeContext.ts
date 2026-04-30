import type { LedgerStore } from "./store.js";
import type { Db } from "./pg/db.js";
import { CandleStore } from "./candleStore.js";
import { InsightsStore } from "./insightsStore.js";
import { createLedgerStore } from "./store.js";
import { createDb } from "./pg/db.js";

export interface StoreContext {
  ledger: LedgerStore;
  pg: Db;
  pgClient: { end: () => Promise<void> };
  candleStore: CandleStore;
  insightsStore: InsightsStore;
}

export const createStoreContext = (
  ledgerPath: string,
  pgConnectionString: string
): StoreContext => {
  const ledger = createLedgerStore(ledgerPath);
  try {
    const { db: pg, client: pgClient } = createDb(pgConnectionString);
    const candleStore = new CandleStore(pg);
    const insightsStore = new InsightsStore(pg);
    return { ledger, pg, pgClient, candleStore, insightsStore };
  } catch (err) {
    ledger.close();
    throw err;
  }
};

export const closeStoreContext = async (ctx: StoreContext): Promise<void> => {
  try {
    ctx.ledger.close();
  } finally {
    await ctx.pgClient.end();
  }
};
