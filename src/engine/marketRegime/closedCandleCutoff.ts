export const closedCandleCutoffUnixMs = (
  nowUnixMs: number,
  timeframeMs: number,
  closedCandleDelayMs: number
): number => {
  const adjusted = nowUnixMs - closedCandleDelayMs;
  const lastEligibleBarOpen = Math.floor(adjusted / timeframeMs) * timeframeMs;
  return lastEligibleBarOpen - timeframeMs;
};