export interface ExposureCapResult {
  targetSolBps: number;
  appliedDeltaBps: number;
  wasCapped: boolean;
}

const clampBps = (value: number): number => {
  return Math.min(10_000, Math.max(0, Math.round(value)));
};

export const applyExposureCaps = (input: {
  currentSolBps: number;
  desiredSolBps: number;
  maxDeltaExposureBpsPerDay: number;
  maxTurnoverPerDayBps: number;
}): ExposureCapResult => {
  const current = clampBps(input.currentSolBps);
  const desired = clampBps(input.desiredSolBps);
  const rawDelta = desired - current;

  const maxStep = Math.max(
    0,
    Math.min(
      Math.round(input.maxDeltaExposureBpsPerDay),
      Math.round(input.maxTurnoverPerDayBps)
    )
  );

  const cappedDeltaMagnitude = Math.min(Math.abs(rawDelta), maxStep);
  const cappedDelta = Math.sign(rawDelta) * cappedDeltaMagnitude;
  const targetSolBps = clampBps(current + cappedDelta);

  return {
    targetSolBps,
    appliedDeltaBps: targetSolBps - current,
    wasCapped: Math.abs(rawDelta) > cappedDeltaMagnitude
  };
};
