import { describe, it, expect } from "vitest";
import { normalizeGeckoOhlcv, shouldPostNormalizedBatch } from "../normalize.js";
import type { NormalizationStats } from "../normalize.js";
import type { GeckoCollectorConfig } from "../config.js";

const BASE_CONFIG: GeckoCollectorConfig = {
  regimeEngineUrl: new URL("https://regime-engine.example"),
  candlesIngestToken: "tok_abc123",
  geckoSource: "geckoterminal",
  geckoNetwork: "solana",
  geckoPoolAddress: "pool123",
  geckoSymbol: "SOL/USDC",
  geckoTimeframe: "1h",
  geckoLookback: 200,
  geckoPollIntervalMs: 300000,
  geckoMaxCallsPerMinute: 6,
  geckoRequestTimeoutMs: 10000
};

const VALID_PAYLOAD = {
  data: {
    attributes: {
      ohlcv_list: [
        [1714536000, 100, 105, 98, 102, 1000],
        [1714539600, 102, 108, 100, 106, 1200]
      ]
    }
  }
};

describe("normalizeGeckoOhlcv", () => {
  it("converts Unix seconds to milliseconds", () => {
    const { candles } = normalizeGeckoOhlcv(VALID_PAYLOAD, BASE_CONFIG);
    expect(candles[0].unixMs).toBe(1714536000000);
    expect(candles[1].unixMs).toBe(1714539600000);
  });

  it("throws ProtocolError for malformed envelope", () => {
    expect(() => normalizeGeckoOhlcv({}, BASE_CONFIG)).toThrow(
      "missing data.attributes.ohlcv_list"
    );
  });

  it("throws ProtocolError for non-array ohlcv_list", () => {
    expect(() =>
      normalizeGeckoOhlcv({ data: { attributes: { ohlcv_list: "bad" } } }, BASE_CONFIG)
    ).toThrow("ohlcv_list is not an array");
  });

  it("throws ProtocolError when >1000 rows returned", () => {
    const rows = Array.from({ length: 1001 }, () => [1714536000, 1, 2, 3, 4, 5]);
    expect(() =>
      normalizeGeckoOhlcv({ data: { attributes: { ohlcv_list: rows } } }, BASE_CONFIG)
    ).toThrow(">1000 rows");
  });

  it("drops rows that are not arrays of length 6", () => {
    const payload = {
      data: {
        attributes: {
          ohlcv_list: [
            [1714536000, 1, 2, 3],
            [1714539600, 1, 5, 0.5, 3, 4]
          ]
        }
      }
    };
    const { stats } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
    expect(stats.malformedRowCount).toBe(1);
    expect(stats.validCount).toBe(1);
  });

  it("drops rows with missing or extra fields", () => {
    const payload = {
      data: {
        attributes: {
          ohlcv_list: [
            [1714536000, 1, 2, 3, 4],
            [1714539600, 1, 2, 3, 4, 5, 6]
          ]
        }
      }
    };
    const { stats } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
    expect(stats.malformedRowCount).toBe(2);
  });

  it("drops rows with non-finite OHLCV values", () => {
    const payload = {
      data: {
        attributes: {
          ohlcv_list: [
            [1714536000, Infinity, 2, 3, 4, 5],
            [1714539600, 1, NaN, 3, 4, 5]
          ]
        }
      }
    };
    const { stats } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
    expect(stats.invalidOhlcvRowCount).toBe(2);
  });

  it("drops rows with unsafe integer timestamps", () => {
    const unsafeTs = Number.MAX_SAFE_INTEGER + 1;
    const payload = {
      data: { attributes: { ohlcv_list: [[unsafeTs, 1, 2, 3, 4, 5]] } }
    };
    const { stats } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
    expect(stats.validCount).toBe(0);
  });

  it("drops rows with negative timestamps", () => {
    const payload = {
      data: { attributes: { ohlcv_list: [[-1, 1, 2, 3, 4, 5]] } }
    };
    const { stats } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
    expect(stats.validCount).toBe(0);
  });

  it("drops misaligned timestamps but still returns them for counting", () => {
    const payload = {
      data: { attributes: { ohlcv_list: [[1714536001, 1, 2, 3, 4, 5]] } }
    };
    const { stats } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
    expect(stats.misalignedRowCount).toBe(1);
    expect(stats.validCount).toBe(0);
  });

  it("dedupes identical rows at same timestamp", () => {
    const payload = {
      data: {
        attributes: {
          ohlcv_list: [
            [1714536000, 100, 105, 98, 102, 1000],
            [1714536000, 100, 105, 98, 102, 1000]
          ]
        }
      }
    };
    const { candles, stats } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
    expect(candles).toHaveLength(1);
    expect(stats.duplicateIdenticalDroppedCount).toBe(1);
  });

  it("drops conflicting rows at same timestamp", () => {
    const payload = {
      data: {
        attributes: {
          ohlcv_list: [
            [1714536000, 100, 105, 98, 102, 1000],
            [1714536000, 200, 210, 190, 205, 2000]
          ]
        }
      }
    };
    const { candles, stats } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
    expect(candles).toHaveLength(0);
    expect(stats.duplicateConflictDroppedCount).toBe(2);
    expect(stats.corruptionDroppedCount).toBe(2);
  });

  it("sorts candles by unixMs ascending", () => {
    const payload = {
      data: {
        attributes: {
          ohlcv_list: [
            [1714539600, 102, 108, 100, 106, 1200],
            [1714536000, 100, 105, 98, 102, 1000]
          ]
        }
      }
    };
    const { candles } = normalizeGeckoOhlcv(payload, BASE_CONFIG);
    expect(candles[0].unixMs).toBe(1714536000000);
    expect(candles[1].unixMs).toBe(1714539600000);
  });
});

describe("shouldPostNormalizedBatch", () => {
  const makeStats = (overrides: Partial<NormalizationStats> = {}): NormalizationStats => ({
    providerRowCount: 200,
    malformedRowCount: 0,
    misalignedRowCount: 0,
    invalidOhlcvRowCount: 0,
    duplicateIdenticalDroppedCount: 0,
    duplicateConflictDroppedCount: 0,
    totalDroppedCount: 0,
    corruptionDroppedCount: 0,
    validCount: 200,
    dropReasons: [],
    ...overrides
  });

  it("blocks when validCount is zero", () => {
    const stats = makeStats({ validCount: 0, providerRowCount: 200 });
    expect(shouldPostNormalizedBatch(stats, BASE_CONFIG)).toBe("zero_valid");
  });

  it("blocks when corruption rate exceeds 10%", () => {
    const stats = makeStats({
      providerRowCount: 200,
      malformedRowCount: 21,
      corruptionDroppedCount: 21,
      totalDroppedCount: 21,
      validCount: 179
    });
    expect(shouldPostNormalizedBatch(stats, BASE_CONFIG)).toBe("corruption_rate");
  });

  it("does not block when identical duplicates push drop rate above 10% (not corruption)", () => {
    const stats = makeStats({
      providerRowCount: 200,
      duplicateIdenticalDroppedCount: 30,
      totalDroppedCount: 30,
      corruptionDroppedCount: 0,
      validCount: 170
    });
    expect(shouldPostNormalizedBatch(stats, BASE_CONFIG)).toBeNull();
  });

  it("blocks when lookback >= 50 and validCount < 50", () => {
    const stats = makeStats({
      providerRowCount: 200,
      validCount: 49,
      totalDroppedCount: 151
    });
    expect(shouldPostNormalizedBatch(stats, BASE_CONFIG)).toBe("low_valid_count");
  });

  it("does not block low valid count when lookback < 50", () => {
    const config = { ...BASE_CONFIG, geckoLookback: 30 };
    const stats = makeStats({
      providerRowCount: 200,
      validCount: 25,
      totalDroppedCount: 175
    });
    expect(shouldPostNormalizedBatch(stats, config)).toBeNull();
  });
});
