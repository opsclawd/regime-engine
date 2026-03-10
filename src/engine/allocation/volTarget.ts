import type { Regime } from "../../contract/v1/types.js";
import { applyExposureCaps } from "./caps.js";

export interface VolTargetInput {
  regime: Regime;
  currentSolBps: number;
  targetSolBps: number;
  volRatio: number;
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
  reasons: Array<{
    code: string;
    severity: "INFO" | "WARN";
    message: string;
  }>;
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
  const scale = computeScale(input.regime, input.volRatio);
  const neutralSolBps = 5_000;
  const tilt = input.targetSolBps - neutralSolBps;
  const desiredAfterVolSolBps = clampBps(neutralSolBps + tilt * scale);

  const capped = applyExposureCaps({
    currentSolBps: input.currentSolBps,
    desiredSolBps: desiredAfterVolSolBps,
    maxDeltaExposureBpsPerDay: input.maxDeltaExposureBpsPerDay,
    maxTurnoverPerDayBps: input.maxTurnoverPerDayBps
  });

  const reasons: VolTargetDecision["reasons"] = [];
  if (capped.wasCapped) {
    reasons.push({
      code: "ALLOCATION_CAP_APPLIED",
      severity: "WARN",
      message:
        "Exposure change was capped by maxDeltaExposureBpsPerDay/maxTurnoverPerDayBps."
    });
  }

  return {
    targets: {
      solBps: capped.targetSolBps,
      usdcBps: 10_000 - capped.targetSolBps
    },
    volRatio: input.volRatio,
    scale,
    desiredAfterVolSolBps,
    capped: capped.wasCapped,
    reasons
  };
};
