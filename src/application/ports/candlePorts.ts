import type { CandleRow, GetLatestCandlesParams } from "../../contract/v1/types.js";

export interface CandleFeed {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: string;
}

export interface ExistingLatestCandleRevision {
  sourceRecordedAtUnixMs: number;
  sourceRecordedAtIso: string;
  ohlcvHash: string;
}

export interface CandleRevisionInsert {
  feed: CandleFeed;
  unixMs: number;
  sourceRecordedAtIso: string;
  sourceRecordedAtUnixMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ohlcvCanonical: string;
  ohlcvHash: string;
  receivedAtUnixMs: number;
}

export interface CandleIngestSession {
  readLatestRevisions(unixMsValues: number[]): Promise<Map<number, ExistingLatestCandleRevision>>;
  insertRevisions(revisions: CandleRevisionInsert[]): Promise<void>;
}

export interface CandleWritePort {
  withIngestLock<T>(
    feed: CandleFeed,
    unixMsValues: number[],
    fn: (session: CandleIngestSession) => Promise<T>
  ): Promise<T>;
}

export interface CandleReadPort {
  getLatestCandlesForFeed(params: GetLatestCandlesParams): Promise<CandleRow[]>;
  getCandlesForFeedWindow(params: GetCandlesForFeedWindowParams): Promise<CandleRow[]>;
}

export interface GetCandlesForFeedWindowParams extends CandleFeed {
  fromUnixMs: number;
  closedCandleCutoffUnixMs: number;
}
