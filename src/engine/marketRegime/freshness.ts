export interface FreshnessConfig {
  softStaleMs: number;
  hardStaleMs: number;
}

export interface FreshnessResult {
  generatedAtIso: string;
  lastCandleUnixMs: number;
  lastCandleIso: string;
  ageSeconds: number;
  softStale: boolean;
  hardStale: boolean;
  softStaleSeconds: number;
  hardStaleSeconds: number;
}

export const computeFreshness = (
  nowUnixMs: number,
  lastCandleUnixMs: number,
  config: FreshnessConfig
): FreshnessResult => {
  const ageMs = Math.max(0, nowUnixMs - lastCandleUnixMs);
  return {
    generatedAtIso: new Date(nowUnixMs).toISOString(),
    lastCandleUnixMs,
    lastCandleIso: new Date(lastCandleUnixMs).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    softStale: ageMs >= config.softStaleMs,
    hardStale: ageMs >= config.hardStaleMs,
    softStaleSeconds: Math.floor(config.softStaleMs / 1000),
    hardStaleSeconds: Math.floor(config.hardStaleMs / 1000)
  };
};