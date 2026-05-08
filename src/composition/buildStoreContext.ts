import type { Db } from "../ledger/pg/db.js";
import type { LedgerStore } from "../ledger/store.js";
import type { CandleStore } from "../ledger/candleStore.js";
import type { InsightsStore } from "../ledger/insightsStore.js";
import type { SrThesesV2Store } from "../ledger/srThesesV2Store.js";
import { createLedgerStore } from "../ledger/store.js";
import { closeStoreContext, createStoreContext } from "../ledger/storeContext.js";

export interface RuntimeStoreContext {
  ledger: LedgerStore;
  pg: Db | null;
  candleStore: CandleStore | null;
  insightsStore: InsightsStore | null;
  srThesesV2Store: SrThesesV2Store | null;
  close(): Promise<void>;
}

export const buildStoreContext = (): RuntimeStoreContext => {
  const databasePath =
    process.env.LEDGER_DB_PATH ??
    (process.env.NODE_ENV === "test" ? ":memory:" : "tmp/ledger.sqlite");

  const pgConnectionString = process.env.DATABASE_URL ?? "";

  if (pgConnectionString) {
    const ctx = createStoreContext(databasePath, pgConnectionString);
    return {
      ledger: ctx.ledger,
      pg: ctx.pg,
      candleStore: ctx.candleStore,
      insightsStore: ctx.insightsStore,
      srThesesV2Store: ctx.srThesesV2Store,
      close: () => closeStoreContext(ctx)
    };
  }

  const ledger = createLedgerStore(databasePath);
  return {
    ledger,
    pg: null,
    candleStore: null,
    insightsStore: null,
    srThesesV2Store: null,
    close: async () => {
      ledger.close();
    }
  };
};
