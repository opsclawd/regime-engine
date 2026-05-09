export interface FreshnessConfig {
  softStaleMs: number;
  hardStaleMs: number;
}

export interface FreshnessResult {
  generatedAtIso: string;
  lastCandleOpenUnixMs: number;
  lastCandleOpenIso: string;
  lastCandleCloseUnixMs: number;
  lastCandleCloseIso: string;
  ageSeconds: number;
  softStale: boolean;
  hardStale: boolean;
  softStaleSeconds: number;
  hardStaleSeconds: number;
}

export const computeFreshness = (
  nowUnixMs: number,
  lastCandleOpenUnixMs: number,
  timeframeMs: number,
  config: FreshnessConfig
): FreshnessResult => {
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    throw new Error("timeframeMs must be a positive finite number");
  }

  const lastCandleCloseUnixMs = lastCandleOpenUnixMs + timeframeMs;
  const ageMs = Math.max(0, nowUnixMs - lastCandleCloseUnixMs);

  return {
    generatedAtIso: new Date(nowUnixMs).toISOString(),
    lastCandleOpenUnixMs,
    lastCandleOpenIso: new Date(lastCandleOpenUnixMs).toISOString(),
    lastCandleCloseUnixMs,
    lastCandleCloseIso: new Date(lastCandleCloseUnixMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    softStale: ageMs >= config.softStaleMs,
    hardStale: ageMs >= config.hardStaleMs,
    softStaleSeconds: Math.floor(config.softStaleMs / 1000),
    hardStaleSeconds: Math.floor(config.hardStaleMs / 1000)
  };
};
