import type {
  WeeklyReportOutput,
  WeeklyReportLedgerReadPort
} from "../ports/weeklyReportReadPort.js";
import type { CandleReadPort } from "../ports/candlePorts.js";
import { buildRegimeCandleReadPlan } from "../../engine/marketRegime/regimeCandleReadPlan.js";
import { generateWeeklyReport } from "../../report/weekly.js";

export type GetWeeklyReportUseCase = (input: {
  from: string;
  to: string;
}) => Promise<WeeklyReportOutput>;

export interface GetWeeklyReportUseCaseDeps {
  weeklyReportLedgerReadPort: WeeklyReportLedgerReadPort;
  candleReadPort: CandleReadPort;
}

const isValidMarketIdentity = (request: {
  market: {
    symbol?: string;
    source?: string;
    network?: string;
    poolAddress?: string;
    timeframe?: string;
  };
}): boolean => {
  return (
    typeof request.market.symbol === "string" &&
    request.market.symbol.length > 0 &&
    typeof request.market.source === "string" &&
    request.market.source.length > 0 &&
    typeof request.market.network === "string" &&
    request.market.network.length > 0 &&
    typeof request.market.poolAddress === "string" &&
    request.market.poolAddress.length > 0 &&
    (request.market.timeframe === "15m" || request.market.timeframe === "1h")
  );
};

export const createGetWeeklyReportUseCase = (
  deps: GetWeeklyReportUseCaseDeps
): GetWeeklyReportUseCase => {
  return async (input) => {
    const data = await deps.weeklyReportLedgerReadPort.getWeeklyReportData(input);

    let candles: Array<{ unixMs: number; close: number }> = [];

    const firstCompleteRequest = data.planRequests.find((pr) => isValidMarketIdentity(pr.request));

    if (firstCompleteRequest) {
      const requestedTimeframe = firstCompleteRequest.request.market.timeframe as "15m" | "1h";
      const readPlan = buildRegimeCandleReadPlan({
        requestedTimeframe,
        nowUnixMs: data.window.toUnixMs
      });

      const feed = firstCompleteRequest.request.market;

      const rawCandles = await deps.candleReadPort.getCandlesForFeedWindow({
        symbol: feed.symbol,
        source: feed.source,
        network: feed.network,
        poolAddress: feed.poolAddress,
        timeframe: readPlan.sourceTimeframe,
        fromUnixMs: data.window.fromUnixMs,
        closedCandleCutoffUnixMs: readPlan.sourceCutoffUnixMs
      });

      candles = rawCandles.map((c) => ({ unixMs: c.unixMs, close: c.close }));
    }

    return generateWeeklyReport({ data, candles });
  };
};
