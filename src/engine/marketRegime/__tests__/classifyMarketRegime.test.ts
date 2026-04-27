import { describe, expect, it } from "vitest";
import { classifyMarketRegime } from "../classifyMarketRegime.js";
import { MARKET_REGIME_CONFIG } from "../config.js";

const config = MARKET_REGIME_CONFIG["1h"].regime;

describe("classifyMarketRegime", () => {
  it("returns CHOP when telemetry is calm and trend is flat", () => {
    const result = classifyMarketRegime(
      { realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
        trendStrength: 0, compression: 0.05 },
      config
    );
    expect(result.regime).toBe("CHOP");
    expect(result.reasons.map((r) => r.code)).toEqual(["REGIME_STABLE"]);
  });

  it("returns UP and emits REGIME_SWITCH_CONFIRMED when trend strong + low vol", () => {
    const result = classifyMarketRegime(
      { realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
        trendStrength: 1.0, compression: 0.05 },
      config
    );
    expect(result.regime).toBe("UP");
    expect(result.reasons.map((r) => r.code)).toEqual(["REGIME_SWITCH_CONFIRMED"]);
  });

  it("returns DOWN when trend is strongly negative", () => {
    const result = classifyMarketRegime(
      { realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
        trendStrength: -1.0, compression: 0.05 },
      config
    );
    expect(result.regime).toBe("DOWN");
  });

  it("rewrites the message for REGIME_SWITCH_CONFIRMED to market-read language", () => {
    const result = classifyMarketRegime(
      { realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
        trendStrength: 1.0, compression: 0.05 },
      config
    );
    expect(result.reasons[0].message).toBe("Current telemetry supports UP regime.");
  });

  it("never emits REGIME_CONFIRM_PENDING or REGIME_MIN_HOLD_ACTIVE", () => {
    const samples = [
      { realizedVolShort: 0, realizedVolLong: 0, volRatio: 2.0, trendStrength: 0, compression: 0 },
      { realizedVolShort: 0, realizedVolLong: 0, volRatio: 0.1, trendStrength: 0.5, compression: 0 },
      { realizedVolShort: 0, realizedVolLong: 0, volRatio: 0.1, trendStrength: -0.5, compression: 0 }
    ];
    for (const telemetry of samples) {
      const codes = classifyMarketRegime(telemetry, config).reasons.map((r) => r.code);
      expect(codes).not.toContain("REGIME_CONFIRM_PENDING");
      expect(codes).not.toContain("REGIME_MIN_HOLD_ACTIVE");
    }
  });

  it("is deterministic: same telemetry produces identical output", () => {
    const telemetry = {
      realizedVolShort: 0.01, realizedVolLong: 0.01, volRatio: 0.5,
      trendStrength: 0, compression: 0.05
    };
    const a = classifyMarketRegime(telemetry, config);
    const b = classifyMarketRegime(telemetry, config);
    expect(a).toEqual(b);
  });
});