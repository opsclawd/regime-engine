import { describe, expect, it } from "vitest";
import type { IndicatorTelemetry } from "../../features/indicators.js";
import { classifyRegime } from "../classifier.js";
import type { RegimeConfig, RegimeState } from "../types.js";

const config: RegimeConfig = {
  confirmBars: 2,
  minHoldBars: 3,
  enterUpTrend: 0.6,
  exitUpTrend: 0.35,
  enterDownTrend: -0.6,
  exitDownTrend: -0.35,
  chopVolRatioMax: 1.4
};

const telemetry = (trendStrength: number, volRatio = 1.1): IndicatorTelemetry => {
  return {
    realizedVolShort: 0.02,
    realizedVolLong: 0.018,
    volRatio,
    trendStrength,
    compression: 0.1
  };
};

describe("regime classifier fixtures", () => {
  it("requires confirmation bars before switching from CHOP to UP", () => {
    const first = classifyRegime({
      telemetry: telemetry(0.7),
      config
    });

    expect(first.regime).toBe("CHOP");
    expect(first.reasons[0].code).toBe("REGIME_MIN_HOLD_ACTIVE");

    const second = classifyRegime({
      telemetry: telemetry(0.72),
      config,
      state: first.nextState
    });

    expect(second.regime).toBe("CHOP");
    const third = classifyRegime({
      telemetry: telemetry(0.75),
      config,
      state: second.nextState
    });
    expect(third.regime).toBe("CHOP");

    const fourth = classifyRegime({
      telemetry: telemetry(0.8),
      config,
      state: third.nextState
    });
    expect(fourth.regime).toBe("CHOP");
    expect(fourth.nextState.pending).toBe("UP");
    expect(fourth.reasons[0].code).toBe("REGIME_CONFIRM_PENDING");

    const fifth = classifyRegime({
      telemetry: telemetry(0.82),
      config,
      state: fourth.nextState
    });
    expect(fifth.regime).toBe("UP");
    expect(fifth.reasons[0].code).toBe("REGIME_SWITCH_CONFIRMED");
  });

  it("enforces min-hold bars after a switch", () => {
    const switchedState: RegimeState = {
      current: "UP",
      barsInRegime: 0,
      pending: null,
      pendingBars: 0
    };

    const decision = classifyRegime({
      telemetry: telemetry(-0.8),
      config,
      state: switchedState
    });

    expect(decision.regime).toBe("UP");
    expect(decision.reasons[0].code).toBe("REGIME_MIN_HOLD_ACTIVE");
    expect(decision.nextState.current).toBe("UP");
  });

  it("whipsaw fixture does not repeatedly flip regimes", () => {
    const alternatingSignals = [
      telemetry(0.9),
      telemetry(-0.9),
      telemetry(0.92),
      telemetry(-0.92),
      telemetry(0.91),
      telemetry(-0.91),
      telemetry(0.93),
      telemetry(-0.93),
      telemetry(0.95),
      telemetry(-0.95)
    ];

    let state: RegimeState | undefined;
    const output: string[] = [];
    for (const sample of alternatingSignals) {
      const decision = classifyRegime({
        telemetry: sample,
        config,
        state
      });
      output.push(decision.regime);
      state = decision.nextState;
    }

    const transitions = output.reduce((count, regime, index) => {
      if (index === 0) {
        return count;
      }

      return output[index - 1] === regime ? count : count + 1;
    }, 0);

    expect(transitions).toBe(0);
    expect(new Set(output)).toEqual(new Set(["CHOP"]));
  });
});
