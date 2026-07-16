import type { CandleReadPort, GetCandlesForFeedWindowParams } from "../../../ports/candlePorts.js";
import type { CandleRow, GetLatestCandlesParams } from "../../../../contract/v1/types.js";

export class FakeCandleReadPort implements CandleReadPort {
  public calls: GetLatestCandlesParams[] = [];
  public windowCalls: GetCandlesForFeedWindowParams[] = [];
  private readonly rowsByTimeframe: Map<string, CandleRow[]>;
  private readonly errorHook: ((method: string, params: unknown) => void) | undefined;

  public constructor(
    rowsByTimeframe: Record<string, CandleRow[]> = {},
    errorHook?: (method: string, params: unknown) => void
  ) {
    this.rowsByTimeframe = new Map(Object.entries(rowsByTimeframe));
    this.errorHook = errorHook;
  }

  async getLatestCandlesForFeed(params: GetLatestCandlesParams): Promise<CandleRow[]> {
    this.calls.push({ ...params });
    this.errorHook?.("getLatestCandlesForFeed", params);
    const rows = this.rowsByTimeframe.get(params.timeframe) ?? [];
    return rows.filter((row) => row.unixMs <= params.closedCandleCutoffUnixMs).slice(-params.limit);
  }

  async getCandlesForFeedWindow(params: GetCandlesForFeedWindowParams): Promise<CandleRow[]> {
    this.windowCalls.push({ ...params });
    this.errorHook?.("getCandlesForFeedWindow", params);
    const rows = this.rowsByTimeframe.get(params.timeframe) ?? [];
    return rows.filter(
      (row) => row.unixMs >= params.fromUnixMs && row.unixMs <= params.closedCandleCutoffUnixMs
    );
  }
}
