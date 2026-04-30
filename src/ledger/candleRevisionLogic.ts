import { toCanonicalJson } from "../contract/v1/canonical.js";
import { sha256Hex } from "../contract/v1/hash.js";

export const computeOhlcv = (candle: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}) => {
  const ohlcvCanonical = toCanonicalJson({
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  });
  const ohlcvHash = sha256Hex(ohlcvCanonical);
  return { ohlcvCanonical, ohlcvHash };
};

export type ExistingLatest = {
  sourceRecordedAtUnixMs: number;
  sourceRecordedAtIso: string;
  ohlcvHash: string;
};

export type CandleDecision =
  | { kind: "insert" }
  | { kind: "idempotent" }
  | { kind: "revise" }
  | { kind: "stale"; existingSourceRecordedAtIso: string };

export const classifyCandle = (
  existing: ExistingLatest | undefined,
  ohlcvHash: string,
  incomingSourceRecordedAtUnixMs: number
): CandleDecision => {
  if (!existing) {
    return { kind: "insert" };
  }
  if (existing.ohlcvHash === ohlcvHash) {
    return { kind: "idempotent" };
  }
  if (existing.sourceRecordedAtUnixMs < incomingSourceRecordedAtUnixMs) {
    return { kind: "revise" };
  }
  return { kind: "stale", existingSourceRecordedAtIso: existing.sourceRecordedAtIso };
};
