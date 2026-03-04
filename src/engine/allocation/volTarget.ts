import type { Regime } from "../../contract/v1/types.js";
import { applyExposureCaps } from "./caps.js";

export interface VolTargetInput {
  regime: Regime;
  currentSolBps: number;
  targetSolBps: number;
  realizedVolShort: number;
  realizedVolLong: number;
  maxDeltaExposureBpsPerDay: number;
  maxTurnoverPerDayBps: number;
}

export interface VolTargetDecision {
  targets: {
    solBps: number;
    usdcBps: number;
  };
  volRatio: number;
  scale: number;
  desiredAfterVolSolBps: number;
  capped: boolean;
}

const clampBps = (value: number): number => {
  return Math.min(10_000, Math.max(0, Math.round(value)));
};

const computeScale = (regime: Regime, volRatio: number): number => {
  if (volRatio >= 1.35) {
    return 0.6;
  }

  if (regime === "UP" && volRatio <= 0.85) {
    return 1.15;
  }

  return 1;
};

export const applyVolatilityTargeting = (
  input: VolTargetInput
): VolTargetDecision => {
  const volRatio =
    input.realizedVolLong > 0
      ? input.realizedVolShort / input.realizedVolLong
      : 1;

  const scale = computeScale(input.regime, volRatio);
  const neutralSolBps = 5_000;
  const tilt = input.targetSolBps - neutralSolBps;
  const desiredAfterVolSolBps = clampBps(neutralSolBps + tilt * scale);

  const capped = applyExposureCaps({
    currentSolBps: input.currentSolBps,
    desiredSolBps: desiredAfterVolSolBps,
    maxDeltaExposureBpsPerDay: input.maxDeltaExposureBpsPerDay,
    maxTurnoverPerDayBps: input.maxTurnoverPerDayBps
  });

  return {
    targets: {
      solBps: capped.targetSolBps,
      usdcBps: 10_000 - capped.targetSolBps
    },
    volRatio,
    scale,
    desiredAfterVolSolBps,
    capped: capped.wasCapped
  };
};
