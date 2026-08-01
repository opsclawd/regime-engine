import type { SrLevelsV2CurrentResponse } from "../../contract/v2/srLevels.js";

export interface SrThesesReadPort {
  getCurrent(
    symbol: string,
    source: string,
    asOfUnixMs?: number
  ): Promise<SrLevelsV2CurrentResponse | null>;
}
