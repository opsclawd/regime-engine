import type { PlanRequest, PlanResponse, ExecutionResultRequest } from "../../contract/v1/types.js";

export interface WeeklyReportData {
  window: { from: string; to: string; fromUnixMs: number; toUnixMs: number };
  plans: Array<{ asOfUnixMs: number; plan: PlanResponse }>;
  planRequests: Array<{ asOfUnixMs: number; request: PlanRequest }>;
  executionResults: Array<{ asOfUnixMs: number; result: ExecutionResultRequest }>;
}

export interface WeeklyReportLedgerReadPort {
  getWeeklyReportData(input: { from: string; to: string }): Promise<WeeklyReportData>;
}

export type { WeeklyReportOutput } from "../../report/weekly.js";
export { ReportRangeError, parseDateWindow } from "../../report/weekly.js";
