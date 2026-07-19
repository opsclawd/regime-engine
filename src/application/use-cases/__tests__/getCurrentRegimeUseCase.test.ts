import { describe, expect, it, vi } from "vitest";
import { createGetCurrentRegimeUseCase } from "../getCurrentRegimeUseCase.js";
import { FakeCandleReadPort } from "./fakes/fakeCandleReadPort.js";
import { FakeClockPort } from "./fakes/fakeClockPort.js";
import { RegimeCandlesNotFoundError } from "../../errors/regimeErrors.js";
import { MARKET_REGIME_CONFIG } from "../../../engine/marketRegime/config.js";
import type { CandleRow, RegimeCurrentQuery } from "../../../contract/v1/types.js";
import type { CandleReadPort } from "../../ports/candlePorts.js";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const FIXED_NOW =
  Math.floor(Date.parse("2026-05-08T12:00:00.000Z") / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;

const baseQuery: RegimeCurrentQuery = {
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool111",
  timeframe: "15m"
};

const flatRow = (unixMs: number): CandleRow => ({
  unixMs,
  open: 100,
  high: 100.5,
  low: 99.5,
  close: 100,
  volume: 1
});

const buildSequential15mRows = (count: number, anchor: number): CandleRow[] =>
  Array.from({ length: count }, (_, i) => flatRow(anchor - (count - 1 - i) * FIFTEEN_MIN_MS));

describe("GetCurrentRegimeUseCase", () => {
  it("direct 15m happy path returns response shape and metadata", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const minCandles = MARKET_REGIME_CONFIG["15m"].suitability.minCandles;
    const sourceCandles = buildSequential15mRows(minCandles + 50, FIXED_NOW - 2 * FIFTEEN_MIN_MS);
    const candleReadPort = new FakeCandleReadPort({ "15m": sourceCandles });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    const response = await useCase(baseQuery);

    expect(response.timeframe).toBe("15m");
    expect(response.metadata.engineVersion).toBe("9.9.9");
    expect(response.metadata.sourceTimeframe).toBe("15m");
    expect(response.metadata.sourceCandleCount).toBe(sourceCandles.length);
    expect(response.metadata.derivedTimeframe).toBeUndefined();
    expect(response.metadata.aggregationVersion).toBeUndefined();
    expect(candleReadPort.calls).toHaveLength(1);
    expect(candleReadPort.calls[0].timeframe).toBe("15m");
  });

  it("derived 1h happy path reads 15m, aggregates, and emits derived metadata", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const minDerived = MARKET_REGIME_CONFIG["1h"].suitability.minCandles;
    const sourceCandles = buildSequential15mRows((minDerived + 20) * 4, FIXED_NOW - ONE_HOUR_MS);
    const candleReadPort = new FakeCandleReadPort({ "15m": sourceCandles });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    const response = await useCase({ ...baseQuery, timeframe: "1h" });

    expect(response.timeframe).toBe("1h");
    expect(response.metadata.sourceTimeframe).toBe("15m");
    expect(response.metadata.derivedTimeframe).toBe("1h");
    expect(response.metadata.aggregationVersion).toBe("ohlcv-agg-v1");
    expect(response.metadata.sourceCandleCount).toBe(sourceCandles.length);
    expect(candleReadPort.calls[0].timeframe).toBe("15m");
  });

  it("throws RegimeCandlesNotFoundError when no source candles exist", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const candleReadPort = new FakeCandleReadPort({ "15m": [] });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    await expect(useCase(baseQuery)).rejects.toMatchObject({
      name: "RegimeCandlesNotFoundError",
      details: [
        {
          code: "NO_SOURCE_CANDLES",
          path: "$.sourceTimeframe",
          message: "No source candles found before the freshness cutoff"
        }
      ]
    });
    await expect(useCase(baseQuery)).rejects.toBeInstanceOf(RegimeCandlesNotFoundError);
  });

  it("throws RegimeCandlesNotFoundError when no derived candles survive the 1h cutoff", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const sourceCandles = [flatRow(FIXED_NOW - 200 * ONE_HOUR_MS)];
    const candleReadPort = new FakeCandleReadPort({ "15m": sourceCandles });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    await expect(useCase({ ...baseQuery, timeframe: "1h" })).rejects.toMatchObject({
      name: "RegimeCandlesNotFoundError",
      details: [
        expect.objectContaining({
          code: "NO_DERIVED_CANDLES_AFTER_AGGREGATION",
          path: "$.derivedTimeframe"
        })
      ]
    });
    const error = await useCase({ ...baseQuery, timeframe: "1h" }).catch((e) => e);
    expect(error.message).toContain("No complete derived 1h candles available");
    expect(error.details[0].message).toMatch(/Aggregation produced \d+ complete 1h buckets/);
    expect(error.details[0].message).toMatch(
      /Skipped: \d+ incomplete, \d+ gaps, \d+ misaligned, \d+ non-integer/
    );
  });

  it("re-throws unexpected errors from the candle read port", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const port = {
      getLatestCandlesForFeed: async () => {
        throw new Error("DB connection lost");
      }
    } as unknown as CandleReadPort;
    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort: port,
      clock,
      engineVersion: "9.9.9"
    });

    await expect(useCase(baseQuery)).rejects.toThrow("DB connection lost");
  });

  it("calls the candle read port with the read plan parameters and the parsed query feed", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const candleReadPort = new FakeCandleReadPort({ "15m": [] });

    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    await expect(useCase(baseQuery)).rejects.toBeInstanceOf(RegimeCandlesNotFoundError);

    expect(candleReadPort.calls).toHaveLength(1);
    expect(candleReadPort.calls[0]).toMatchObject({
      symbol: "SOL/USDC",
      source: "birdeye",
      network: "solana-mainnet",
      poolAddress: "Pool111",
      timeframe: "15m"
    });
    expect(candleReadPort.calls[0].limit).toBeGreaterThan(0);
    expect(candleReadPort.calls[0].closedCandleCutoffUnixMs).toBeLessThan(FIXED_NOW);
  });

  it("uses the supplied observedAtUnixMs and does not call clock.nowUnixMs", async () => {
    const clock = {
      nowUnixMs: vi.fn().mockReturnValue(FIXED_NOW)
    };
    const candleReadPort = new FakeCandleReadPort({
      "15m": buildSequential15mRows(100, FIXED_NOW)
    });
    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    const explicitTime = FIXED_NOW - 1000;
    await useCase(baseQuery, explicitTime);

    expect(clock.nowUnixMs).not.toHaveBeenCalled();
    expect(candleReadPort.calls[0].closedCandleCutoffUnixMs).toBeLessThan(explicitTime);
  });

  it("throws Error if observedAtUnixMs is invalid", async () => {
    const clock = new FakeClockPort(FIXED_NOW);
    const candleReadPort = new FakeCandleReadPort({ "15m": [] });
    const useCase = createGetCurrentRegimeUseCase({
      candleReadPort,
      clock,
      engineVersion: "9.9.9"
    });

    await expect(useCase(baseQuery, -5)).rejects.toThrow(
      "observedAtUnixMs must be a non-negative finite integer"
    );
    await expect(useCase(baseQuery, NaN)).rejects.toThrow(
      "observedAtUnixMs must be a non-negative finite integer"
    );
    await expect(useCase(baseQuery, 1.5)).rejects.toThrow(
      "observedAtUnixMs must be a non-negative finite integer"
    );
  });
});
