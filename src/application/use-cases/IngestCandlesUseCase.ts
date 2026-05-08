import {
  computeOhlcv,
  classifyCandle,
  type ExistingLatest
} from "../../domain/candle/candleRevision.js";
import type {
  CandleIngestRejection,
  CandleIngestRequest,
  CandleIngestResponse
} from "../../contract/v1/types.js";
import type { CandleFeed, CandleRevisionInsert, CandleWritePort } from "../ports/candlePorts.js";

export type IngestCandlesUseCase = (
  input: CandleIngestRequest,
  receivedAtUnixMs: number
) => Promise<Omit<CandleIngestResponse, "schemaVersion">>;

export interface IngestCandlesUseCaseDeps {
  candleWritePort: CandleWritePort;
}

export const createIngestCandlesUseCase = (
  deps: IngestCandlesUseCaseDeps
): IngestCandlesUseCase => {
  return async (input, receivedAtUnixMs) => {
    const incomingSourceRecordedAtUnixMs = Date.parse(input.sourceRecordedAtIso);
    if (!Number.isFinite(incomingSourceRecordedAtUnixMs)) {
      throw new Error(`Invalid sourceRecordedAtIso: ${input.sourceRecordedAtIso}`);
    }

    const feed: CandleFeed = {
      symbol: input.symbol,
      source: input.source,
      network: input.network,
      poolAddress: input.poolAddress,
      timeframe: input.timeframe
    };

    const unixMsValues = input.candles.map((c) => c.unixMs);

    let insertedCount = 0;
    let revisedCount = 0;
    let idempotentCount = 0;
    let rejectedCount = 0;
    const rejections: CandleIngestRejection[] = [];

    await deps.candleWritePort.withIngestLock(feed, unixMsValues, async (session) => {
      const existingBySlot = await session.readLatestRevisions(unixMsValues);
      const accepted: CandleRevisionInsert[] = [];

      for (const candle of input.candles) {
        const { ohlcvCanonical, ohlcvHash } = computeOhlcv(candle);
        const existing: ExistingLatest | undefined = existingBySlot.get(candle.unixMs);
        const decision = classifyCandle(existing, ohlcvHash, incomingSourceRecordedAtUnixMs);

        switch (decision.kind) {
          case "insert":
          case "revise":
            accepted.push({
              feed,
              unixMs: candle.unixMs,
              sourceRecordedAtIso: input.sourceRecordedAtIso,
              sourceRecordedAtUnixMs: incomingSourceRecordedAtUnixMs,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              ohlcvCanonical,
              ohlcvHash,
              receivedAtUnixMs
            });
            if (decision.kind === "insert") insertedCount += 1;
            else revisedCount += 1;
            break;
          case "idempotent":
            idempotentCount += 1;
            break;
          case "stale":
            rejectedCount += 1;
            rejections.push({
              unixMs: candle.unixMs,
              reason: "STALE_REVISION",
              existingSourceRecordedAtIso: decision.existingSourceRecordedAtIso
            });
            break;
        }
      }

      if (accepted.length > 0) {
        await session.insertRevisions(accepted);
      }
    });

    rejections.sort((a, b) => a.unixMs - b.unixMs);

    return { insertedCount, revisedCount, idempotentCount, rejectedCount, rejections };
  };
};
