import type { LedgerStore } from "../../ledger/store.js";
import { generateWeeklyReport, ReportRangeError } from "../../report/weekly.js";
import type { WeeklyReportReadPort } from "../../application/ports/weeklyReportReadPort.js";
import { ReportRangeApplicationError } from "../../application/errors/reportErrors.js";

export const createSqliteWeeklyReportReadAdapter = (store: LedgerStore): WeeklyReportReadPort => ({
  async getWeeklyReport(input) {
    try {
      return generateWeeklyReport({ store, from: input.from, to: input.to });
    } catch (error) {
      if (error instanceof ReportRangeError) {
        throw new ReportRangeApplicationError(error.message);
      }
      throw error;
    }
  }
});
