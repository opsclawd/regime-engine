import type { LedgerStore } from "../../ledger/store.js";
import {
  type WeeklyReportData,
  type WeeklyReportLedgerReadPort,
  ReportRangeError,
  parseDateWindow
} from "../../application/ports/weeklyReportReadPort.js";
import { ReportRangeApplicationError } from "../../application/errors/reportErrors.js";
import type { PlanRequest, PlanResponse, ExecutionResultRequest } from "../../contract/v1/types.js";

const asRecord = (json: string): Record<string, unknown> => {
  return JSON.parse(json) as Record<string, unknown>;
};

const asPlanResponse = (json: string): PlanResponse => {
  return asRecord(json) as unknown as PlanResponse;
};

const asPlanRequest = (json: string): PlanRequest => {
  return asRecord(json) as unknown as PlanRequest;
};

const asExecutionResultRequest = (json: string): ExecutionResultRequest => {
  return asRecord(json) as unknown as ExecutionResultRequest;
};

export const createSqliteWeeklyReportReadAdapter = (
  store: LedgerStore
): WeeklyReportLedgerReadPort => ({
  async getWeeklyReportData(input) {
    let window;
    try {
      window = parseDateWindow(input.from, input.to);
    } catch (error) {
      if (error instanceof ReportRangeError) {
        throw new ReportRangeApplicationError(error.message);
      }
      throw error;
    }

    try {
      const plans = store.db
        .prepare(
          `
          SELECT as_of_unix_ms, plan_json
          FROM plans
          WHERE as_of_unix_ms BETWEEN ? AND ?
          ORDER BY as_of_unix_ms ASC, id ASC
        `
        )
        .all(window.fromUnixMs, window.toUnixMs) as Array<{
        as_of_unix_ms: number;
        plan_json: string;
      }>;

      const executionResults = store.db
        .prepare(
          `
          SELECT as_of_unix_ms, result_json
          FROM execution_results
          WHERE as_of_unix_ms BETWEEN ? AND ?
          ORDER BY as_of_unix_ms ASC, id ASC
        `
        )
        .all(window.fromUnixMs, window.toUnixMs) as Array<{
        as_of_unix_ms: number;
        result_json: string;
      }>;

      const planRequests = store.db
        .prepare(
          `
          SELECT as_of_unix_ms, request_json
          FROM plan_requests
          WHERE as_of_unix_ms BETWEEN ? AND ?
          ORDER BY as_of_unix_ms ASC, id ASC
        `
        )
        .all(window.fromUnixMs, window.toUnixMs) as Array<{
        as_of_unix_ms: number;
        request_json: string;
      }>;

      const data: WeeklyReportData = {
        window: {
          from: input.from,
          to: input.to,
          fromUnixMs: window.fromUnixMs,
          toUnixMs: window.toUnixMs
        },
        plans: plans.map((row) => ({
          asOfUnixMs: row.as_of_unix_ms,
          plan: asPlanResponse(row.plan_json)
        })),
        planRequests: planRequests.map((row) => ({
          asOfUnixMs: row.as_of_unix_ms,
          request: asPlanRequest(row.request_json)
        })),
        executionResults: executionResults.map((row) => ({
          asOfUnixMs: row.as_of_unix_ms,
          result: asExecutionResultRequest(row.result_json)
        }))
      };

      return data;
    } catch (error) {
      if (error instanceof ReportRangeError) {
        throw new ReportRangeApplicationError(error.message);
      }
      throw error;
    }
  }
});
