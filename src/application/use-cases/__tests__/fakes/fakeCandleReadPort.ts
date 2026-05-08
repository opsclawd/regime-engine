import type { CandleReadPort } from "../../../ports/candlePorts.js";
import type { CandleRow, GetLatestCandlesParams } from "../../../../contract/v1/types.js";

export class FakeCandleReadPort implements CandleReadPort {
  public calls: GetLatestCandlesParams[] = [];
  private readonly rowsByTimeframe: Map<string, CandleRow[]>;

  public constructor(rowsByTimeframe: Record<string, CandleRow[]> = {}) {
    this.rowsByTimeframe = new Map(Object.entries(rowsByTimeframe));
  }

  async getLatestCandlesForFeed(params: GetLatestCandlesParams): Promise<CandleRow[]> {
    this.calls.push({ ...params });
    const rows = this.rowsByTimeframe.get(params.timeframe) ?? [];
    return rows.filter((row) => row.unixMs <= params.closedCandleCutoffUnixMs).slice(-params.limit);
  }
}
