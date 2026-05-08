import type { WeeklyReportOutput } from "../../report/weekly.js";

export type { WeeklyReportOutput };

export interface WeeklyReportReadPort {
  getWeeklyReport(input: { from: string; to: string }): Promise<WeeklyReportOutput>;
}
