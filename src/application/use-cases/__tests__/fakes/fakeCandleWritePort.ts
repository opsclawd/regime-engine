import type {
  CandleFeed,
  CandleIngestSession,
  CandleRevisionInsert,
  CandleWritePort,
  ExistingLatestCandleRevision
} from "../../../ports/candlePorts.js";

interface StoredRevision {
  feed: CandleFeed;
  unixMs: number;
  sourceRecordedAtUnixMs: number;
  sourceRecordedAtIso: string;
  ohlcvHash: string;
  insertSeq: number;
}

const feedKey = (feed: CandleFeed): string =>
  `${feed.symbol}|${feed.source}|${feed.network}|${feed.poolAddress}|${feed.timeframe}`;

export class FakeCandleWritePort implements CandleWritePort {
  private readonly revisions: StoredRevision[] = [];
  private seq = 0;
  public lockCalls: Array<{ feed: CandleFeed; unixMsValues: number[] }> = [];

  async withIngestLock<T>(
    feed: CandleFeed,
    unixMsValues: number[],
    fn: (session: CandleIngestSession) => Promise<T>
  ): Promise<T> {
    this.lockCalls.push({ feed, unixMsValues: [...unixMsValues] });

    const session: CandleIngestSession = {
      readLatestRevisions: async (slots) => {
        const result = new Map<number, ExistingLatestCandleRevision>();
        const fk = feedKey(feed);
        for (const slot of slots) {
          const candidates = this.revisions
            .filter((r) => feedKey(r.feed) === fk && r.unixMs === slot)
            .sort(
              (a, b) =>
                b.sourceRecordedAtUnixMs - a.sourceRecordedAtUnixMs || b.insertSeq - a.insertSeq
            );
          if (candidates.length > 0) {
            const top = candidates[0];
            result.set(slot, {
              sourceRecordedAtUnixMs: top.sourceRecordedAtUnixMs,
              sourceRecordedAtIso: top.sourceRecordedAtIso,
              ohlcvHash: top.ohlcvHash
            });
          }
        }
        return result;
      },
      insertRevisions: async (revisions: CandleRevisionInsert[]) => {
        for (const r of revisions) {
          this.seq += 1;
          this.revisions.push({
            feed: r.feed,
            unixMs: r.unixMs,
            sourceRecordedAtUnixMs: r.sourceRecordedAtUnixMs,
            sourceRecordedAtIso: r.sourceRecordedAtIso,
            ohlcvHash: r.ohlcvHash,
            insertSeq: this.seq
          });
        }
      }
    };

    return fn(session);
  }

  totalRevisions(): number {
    return this.revisions.length;
  }
}
