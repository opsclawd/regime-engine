import type { LedgerStore } from "../ledger/store.js";
import { computeBaselines } from "./baselines.js";

export interface WeeklyReportSummary {
  window: {
    from: string;
    to: string;
    fromUnixMs: number;
    toUnixMs: number;
  };
  totals: {
    plans: number;
    executionResults: number;
  };
  regimeDistribution: {
    UP: { count: number; pct: number };
    DOWN: { count: number; pct: number };
    CHOP: { count: number; pct: number };
  };
  churn: {
    standDownPlans: number;
    holdPlans: number;
    standDownPct: number;
  };
  execution: {
    totalActions: number;
    successActions: number;
    failedActions: number;
    skippedActions: number;
    successRate: number;
    totalTxFeesUsd: number;
    totalPriorityFeesUsd: number;
    totalSlippageUsd: number;
  };
  baselines: {
    solHodlFinalNavUsd: number;
    solDcaFinalNavUsd: number;
    usdcCarryFinalNavUsd: number;
  };
}

export interface WeeklyReportOutput {
  markdown: string;
  summary: WeeklyReportSummary;
}

export class ReportRangeError extends Error {}

const round = (value: number, precision = 6): number => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseDate = (value: string, endOfDay: boolean): number => {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new ReportRangeError("Invalid weekly report date range.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = endOfDay ? 23 : 0;
  const minutes = endOfDay ? 59 : 0;
  const seconds = endOfDay ? 59 : 0;
  const milliseconds = endOfDay ? 999 : 0;

  const unixMs = Date.UTC(year, month - 1, day, hours, minutes, seconds, milliseconds);
  const parsed = new Date(unixMs);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new ReportRangeError("Invalid weekly report date range.");
  }

  return unixMs;
};

const parseDateWindow = (from: string, to: string) => {
  const fromUnixMs = parseDate(from, false);
  const toUnixMs = parseDate(to, true);

  if (fromUnixMs > toUnixMs) {
    throw new ReportRangeError("Invalid weekly report date range: from > to.");
  }

  return { fromUnixMs, toUnixMs };
};

const asRecord = (json: string): Record<string, unknown> => {
  return JSON.parse(json) as Record<string, unknown>;
};

export const generateWeeklyReport = (input: {
  store: LedgerStore;
  from: string;
  to: string;
}): WeeklyReportOutput => {
  const window = parseDateWindow(input.from, input.to);
  const plans = input.store.db
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

  const executionResults = input.store.db
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

  const planRequests = input.store.db
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

  const regimeCounts = {
    UP: 0,
    DOWN: 0,
    CHOP: 0
  };

  let standDownPlans = 0;
  let holdPlans = 0;
  for (const row of plans) {
    const plan = asRecord(row.plan_json);
    const regime = plan.regime;
    if (regime === "UP" || regime === "DOWN" || regime === "CHOP") {
      regimeCounts[regime] += 1;
    }

    const actions = (plan.actions ?? []) as Array<{ type?: string }>;
    if (actions.some((action) => action.type === "STAND_DOWN")) {
      standDownPlans += 1;
    }
    if (actions.some((action) => action.type === "HOLD")) {
      holdPlans += 1;
    }
  }

  let successActions = 0;
  let failedActions = 0;
  let skippedActions = 0;
  let totalTxFeesUsd = 0;
  let totalPriorityFeesUsd = 0;
  let totalSlippageUsd = 0;

  for (const row of executionResults) {
    const result = asRecord(row.result_json);
    const actionResults = (result.actionResults ?? []) as Array<{
      status?: string;
    }>;
    for (const action of actionResults) {
      if (action.status === "SUCCESS") {
        successActions += 1;
      } else if (action.status === "FAILED") {
        failedActions += 1;
      } else if (action.status === "SKIPPED") {
        skippedActions += 1;
      }
    }

    const costs = (result.costs ?? {}) as {
      txFeesUsd?: number;
      priorityFeesUsd?: number;
      slippageUsd?: number;
    };
    totalTxFeesUsd += costs.txFeesUsd ?? 0;
    totalPriorityFeesUsd += costs.priorityFeesUsd ?? 0;
    totalSlippageUsd += costs.slippageUsd ?? 0;
  }

  const totalPlans = plans.length;
  const totalActions = successActions + failedActions + skippedActions;

  const baselines = computeBaselines({
    window: {
      fromUnixMs: window.fromUnixMs,
      toUnixMs: window.toUnixMs
    },
    planRequests: planRequests.map((row) => ({
      asOfUnixMs: row.as_of_unix_ms,
      request: asRecord(row.request_json) as {
        market: {
          candles: Array<{
            unixMs: number;
            close: number;
          }>;
        };
        portfolio: {
          navUsd: number;
        };
        config: {
          baselines: {
            dcaIntervalDays: number;
            dcaAmountUsd: number;
            usdcCarryApr: number;
          };
        };
      }
    }))
  });

  const summary: WeeklyReportSummary = {
    window: {
      from: input.from,
      to: input.to,
      fromUnixMs: window.fromUnixMs,
      toUnixMs: window.toUnixMs
    },
    totals: {
      plans: totalPlans,
      executionResults: executionResults.length
    },
    regimeDistribution: {
      UP: {
        count: regimeCounts.UP,
        pct: round(totalPlans > 0 ? regimeCounts.UP / totalPlans : 0)
      },
      DOWN: {
        count: regimeCounts.DOWN,
        pct: round(totalPlans > 0 ? regimeCounts.DOWN / totalPlans : 0)
      },
      CHOP: {
        count: regimeCounts.CHOP,
        pct: round(totalPlans > 0 ? regimeCounts.CHOP / totalPlans : 0)
      }
    },
    churn: {
      standDownPlans,
      holdPlans,
      standDownPct: round(totalPlans > 0 ? standDownPlans / totalPlans : 0)
    },
    execution: {
      totalActions,
      successActions,
      failedActions,
      skippedActions,
      successRate: round(totalActions > 0 ? successActions / totalActions : 0),
      totalTxFeesUsd: round(totalTxFeesUsd),
      totalPriorityFeesUsd: round(totalPriorityFeesUsd),
      totalSlippageUsd: round(totalSlippageUsd)
    },
    baselines
  };

  const markdown = [
    `# Weekly Report (${input.from} to ${input.to})`,
    "",
    `- Plans: ${summary.totals.plans}`,
    `- Execution Results: ${summary.totals.executionResults}`,
    "",
    "## Regime Distribution",
    `- UP: ${summary.regimeDistribution.UP.count} (${summary.regimeDistribution.UP.pct})`,
    `- DOWN: ${summary.regimeDistribution.DOWN.count} (${summary.regimeDistribution.DOWN.pct})`,
    `- CHOP: ${summary.regimeDistribution.CHOP.count} (${summary.regimeDistribution.CHOP.pct})`,
    "",
    "## Churn",
    `- Stand-down Plans: ${summary.churn.standDownPlans}`,
    `- HOLD Plans: ${summary.churn.holdPlans}`,
    `- Stand-down Rate: ${summary.churn.standDownPct}`,
    "",
    "## Execution",
    `- Total Actions: ${summary.execution.totalActions}`,
    `- Success/Failed/Skipped: ${summary.execution.successActions}/${summary.execution.failedActions}/${summary.execution.skippedActions}`,
    `- Success Rate: ${summary.execution.successRate}`,
    `- Costs (tx/priority/slippage): ${summary.execution.totalTxFeesUsd}/${summary.execution.totalPriorityFeesUsd}/${summary.execution.totalSlippageUsd}`,
    "",
    "## Baselines",
    `- SOL HODL Final NAV: ${summary.baselines.solHodlFinalNavUsd}`,
    `- SOL DCA Final NAV: ${summary.baselines.solDcaFinalNavUsd}`,
    `- USDC Carry Final NAV: ${summary.baselines.usdcCarryFinalNavUsd}`
  ].join("\n");

  return {
    markdown,
    summary
  };
};
