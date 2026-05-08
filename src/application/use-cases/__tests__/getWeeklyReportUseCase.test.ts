import { describe, expect, it } from "vitest";
import { createGetWeeklyReportUseCase } from "../getWeeklyReportUseCase.js";
import { FakeWeeklyReportReadPort } from "./fakes/fakeWeeklyReportReadPort.js";
import { ReportRangeApplicationError } from "../../errors/reportErrors.js";
import type { WeeklyReportOutput } from "../../ports/weeklyReportReadPort.js";

const sampleSummary: WeeklyReportOutput["summary"] = {
  window: { from: "2026-01-01", to: "2026-01-07", fromUnixMs: 0, toUnixMs: 0 },
  totals: { plans: 0, executionResults: 0 },
  regimeDistribution: {
    UP: { count: 0, pct: 0 },
    DOWN: { count: 0, pct: 0 },
    CHOP: { count: 0, pct: 0 }
  },
  churn: { standDownPlans: 0, holdPlans: 0, standDownPct: 0 },
  execution: {
    totalActions: 0,
    successActions: 0,
    failedActions: 0,
    skippedActions: 0,
    successRate: 0,
    totalTxFeesUsd: 0,
    totalPriorityFeesUsd: 0,
    totalSlippageUsd: 0
  },
  baselines: {
    solHodlFinalNavUsd: 0,
    solDcaFinalNavUsd: 0,
    usdcCarryFinalNavUsd: 0
  }
};

describe("GetWeeklyReportUseCase", () => {
  it("calls port once with from/to and returns its output unchanged", async () => {
    const port = new FakeWeeklyReportReadPort();
    const expected: WeeklyReportOutput = {
      markdown: "# Weekly Report\n",
      summary: sampleSummary
    };
    port.setNextResult(expected);
    const useCase = createGetWeeklyReportUseCase({ port });

    const result = await useCase({ from: "2026-01-01", to: "2026-01-07" });

    expect(result).toBe(expected);
    expect(port.calls).toEqual([{ from: "2026-01-01", to: "2026-01-07" }]);
  });

  it("propagates ReportRangeApplicationError thrown by the port", async () => {
    const port = new FakeWeeklyReportReadPort();
    port.setNextError(new ReportRangeApplicationError("Invalid weekly report date range."));
    const useCase = createGetWeeklyReportUseCase({ port });

    await expect(useCase({ from: "2026-02-30", to: "2026-03-01" })).rejects.toThrow(
      ReportRangeApplicationError
    );
    await expect(useCase({ from: "2026-02-30", to: "2026-03-01" })).rejects.toThrow(
      "Invalid weekly report date range."
    );
  });
});
