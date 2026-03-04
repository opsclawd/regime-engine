import type { Regime } from "../../contract/v1/types.js";
import { applyExposureCaps } from "./caps.js";

export interface AllocationConfig {
  upSolBps: number;
  downSolBps: number;
  chopSolBps: number;
  maxDeltaExposureBpsPerDay: number;
  maxTurnoverPerDayBps: number;
}

export interface AllocationDecision {
  targets: {
    solBps: number;
    usdcBps: number;
  };
  desiredSolBps: number;
  appliedDeltaBps: number;
  capped: boolean;
  reasons: Array<{
    code: string;
    severity: "INFO" | "WARN";
    message: string;
  }>;
}

const desiredByRegime = (
  regime: Regime,
  config: AllocationConfig
): number => {
  if (regime === "UP") {
    return config.upSolBps;
  }

  if (regime === "DOWN") {
    return config.downSolBps;
  }

  return config.chopSolBps;
};

export const computeAllocationTargets = (input: {
  regime: Regime;
  currentSolBps: number;
  config: AllocationConfig;
}): AllocationDecision => {
  const desiredSolBps = desiredByRegime(input.regime, input.config);
  const capped = applyExposureCaps({
    currentSolBps: input.currentSolBps,
    desiredSolBps,
    maxDeltaExposureBpsPerDay: input.config.maxDeltaExposureBpsPerDay,
    maxTurnoverPerDayBps: input.config.maxTurnoverPerDayBps
  });

  const reasons: AllocationDecision["reasons"] = [];
  reasons.push({
    code: "ALLOCATION_TARGET_BY_REGIME",
    severity: "INFO",
    message: `Desired target selected for regime ${input.regime}.`
  });

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
    desiredSolBps,
    appliedDeltaBps: capped.appliedDeltaBps,
    capped: capped.wasCapped,
    reasons
  };
};
