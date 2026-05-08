import type { LedgerStore } from "../../ledger/store.js";
import type { PlanLedgerWritePort } from "../../application/ports/planLedgerPort.js";
import { writePlanLedgerEntry } from "../../ledger/writer.js";

export const createSqlitePlanLedgerWriteAdapter = (store: LedgerStore): PlanLedgerWritePort => ({
  async writePlan(input) {
    writePlanLedgerEntry(store, input);
  }
});
