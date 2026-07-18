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
  market?: {
    symbol?: string;
    source?: string;
    network?: string;
    poolAddress?: string;
    timeframe?: string;
  };
}): boolean => {
  // `request` is JSON.parse'd from persisted request_json and only
  // type-asserted, not runtime-validated — a legacy/corrupt row can be
  // missing `market` entirely, so it must not be dereferenced unchecked.
  if (request.market === null || typeof request.market !== "object") return false;
  const market = request.market;
  return (
    typeof market.symbol === "string" &&
    market.symbol.length > 0 &&
    typeof market.source === "string" &&
    market.source.length > 0 &&
    typeof market.network === "string" &&
    market.network.length > 0 &&
    typeof market.poolAddress === "string" &&
    market.poolAddress.length > 0 &&
    (market.timeframe === "15m" || market.timeframe === "1h")
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
