import type { LedgerStore } from "./store.js";
import type { Db } from "./pg/db.js";
import { CandleStore } from "./candleStore.js";
import { InsightsStore } from "./insightsStore.js";
import { SrThesesV2Store } from "./srThesesV2Store.js";
import { createLedgerStore } from "./store.js";
import { createDb } from "./pg/db.js";

export interface StoreContext {
  ledger: LedgerStore;
  pg: Db;
  pgClient: { end: () => Promise<void> };
  candleStore: CandleStore;
  insightsStore: InsightsStore;
  srThesesV2Store: SrThesesV2Store | null;
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
    const srThesesV2Store = new SrThesesV2Store(pg);
    return { ledger, pg, pgClient, candleStore, insightsStore, srThesesV2Store };
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
