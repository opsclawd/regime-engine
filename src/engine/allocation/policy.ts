import type { Regime } from "../../contract/v1/types.js";

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

const clampBps = (value: number): number => {
  return Math.min(10_000, Math.max(0, Math.round(value)));
};

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
  const desiredSolBps = clampBps(desiredByRegime(input.regime, input.config));
  const currentSolBps = clampBps(input.currentSolBps);

  const reasons: AllocationDecision["reasons"] = [];
  reasons.push({
    code: "ALLOCATION_TARGET_BY_REGIME",
    severity: "INFO",
    message: `Desired target selected for regime ${input.regime}.`
  });

  return {
    targets: {
      solBps: desiredSolBps,
      usdcBps: 10_000 - desiredSolBps
    },
    desiredSolBps,
    appliedDeltaBps: desiredSolBps - currentSolBps,
    capped: false,
    reasons
  };
};
