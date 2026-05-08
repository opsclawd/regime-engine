import { describe, expect, it } from "vitest";
import { computeOhlcv, classifyCandle, type ExistingLatest } from "../candleRevision.js";

describe("computeOhlcv", () => {
  it("produces the same hash for byte-equal OHLCV", () => {
    const a = computeOhlcv({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
    const b = computeOhlcv({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
    expect(a.ohlcvHash).toBe(b.ohlcvHash);
    expect(a.ohlcvCanonical).toBe(b.ohlcvCanonical);
  });

  it("produces a different hash when any field changes", () => {
    const base = computeOhlcv({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
    const changed = computeOhlcv({ open: 1, high: 2, low: 0.5, close: 1.5, volume: 11 });
    expect(base.ohlcvHash).not.toBe(changed.ohlcvHash);
  });
});

describe("classifyCandle", () => {
  const incomingHash = "incoming-hash";
  const incomingTs = 2_000_000;

  it("returns insert when no latest revision exists", () => {
    expect(classifyCandle(undefined, incomingHash, incomingTs)).toEqual({ kind: "insert" });
  });

  it("returns idempotent on equal OHLCV hash regardless of timestamp", () => {
    const existing: ExistingLatest = {
      ohlcvHash: incomingHash,
      sourceRecordedAtUnixMs: incomingTs + 1,
      sourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
    };
    expect(classifyCandle(existing, incomingHash, incomingTs)).toEqual({ kind: "idempotent" });
  });

  it("returns revise on changed OHLCV with strictly newer incoming timestamp", () => {
    const existing: ExistingLatest = {
      ohlcvHash: "old-hash",
      sourceRecordedAtUnixMs: incomingTs - 1,
      sourceRecordedAtIso: "2026-04-26T11:00:00.000Z"
    };
    expect(classifyCandle(existing, incomingHash, incomingTs)).toEqual({ kind: "revise" });
  });

  it("returns stale on changed OHLCV with older incoming timestamp", () => {
    const existing: ExistingLatest = {
      ohlcvHash: "old-hash",
      sourceRecordedAtUnixMs: incomingTs + 1,
      sourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
    };
    expect(classifyCandle(existing, incomingHash, incomingTs)).toEqual({
      kind: "stale",
      existingSourceRecordedAtIso: "2026-04-26T13:00:00.000Z"
    });
  });

  it("returns stale on changed OHLCV with equal incoming timestamp", () => {
    const existing: ExistingLatest = {
      ohlcvHash: "old-hash",
      sourceRecordedAtUnixMs: incomingTs,
      sourceRecordedAtIso: "2026-04-26T12:00:00.000Z"
    };
    expect(classifyCandle(existing, incomingHash, incomingTs)).toEqual({
      kind: "stale",
      existingSourceRecordedAtIso: "2026-04-26T12:00:00.000Z"
    });
  });
});
