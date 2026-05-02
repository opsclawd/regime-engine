export type GeckoCollectorConfig = {
  regimeEngineUrl: URL;
  candlesIngestToken: string;
  geckoSource: string;
  geckoNetwork: string;
  geckoPoolAddress: string;
  geckoSymbol: string;
  geckoTimeframe: string;
  geckoLookback: number;
  geckoPollIntervalMs: number;
  geckoMaxCallsPerMinute: number;
  geckoRequestTimeoutMs: number;
};

const ALLOWED_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const RAILWAY_INTERNAL_SUFFIX = ".railway.internal";

function isAllowedHttpHost(hostname: string): boolean {
  if (ALLOWED_HTTP_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(RAILWAY_INTERNAL_SUFFIX)) return true;
  return false;
}

function readRequired(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

function readLiteral<T extends string>(
  env: Record<string, string | undefined>,
  key: string,
  allowed: readonly T[],
  defaultValue: T
): T {
  const raw = env[key];
  if (raw === undefined || raw === "") return defaultValue;
  if (!allowed.includes(raw as T)) {
    throw new Error(`Unsupported ${key}: ${raw}. Allowed: ${allowed.join(", ")}`);
  }
  return raw as T;
}

function readPositiveInteger(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number
): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${key} must be a positive integer, got: ${raw}`);
  }
  return n;
}

function readLookback(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number,
  max: number
): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new Error(`${key} must be a positive integer ≤ ${max}, got: ${raw}`);
  }
  return n;
}

function readPoolAddress(env: Record<string, string | undefined>, key: string): string {
  const value = readRequired(env, key);
  if (/<|>/.test(value)) {
    throw new Error(`${key} contains placeholder characters: ${value}`);
  }
  return value;
}

function readAbsoluteUrl(env: Record<string, string | undefined>, key: string): URL {
  const raw = readRequired(env, key);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} is not a valid absolute URL: ${raw}`);
  }
  if (url.protocol !== "https:" && !isAllowedHttpHost(url.hostname)) {
    throw new Error(
      `${key} must use HTTPS (got ${url.protocol}). HTTP is only allowed for localhost or *.railway.internal`
    );
  }
  return url;
}

export function parseGeckoCollectorConfig(
  env: Record<string, string | undefined>
): GeckoCollectorConfig {
  return {
    regimeEngineUrl: readAbsoluteUrl(env, "REGIME_ENGINE_URL"),
    candlesIngestToken: readRequired(env, "CANDLES_INGEST_TOKEN"),
    geckoSource: readLiteral(env, "GECKO_SOURCE", ["geckoterminal"] as const, "geckoterminal"),
    geckoNetwork: readLiteral(env, "GECKO_NETWORK", ["solana"] as const, "solana"),
    geckoPoolAddress: readPoolAddress(env, "GECKO_POOL_ADDRESS"),
    geckoSymbol: readLiteral(env, "GECKO_SYMBOL", ["SOL/USDC"] as const, "SOL/USDC"),
    geckoTimeframe: readLiteral(env, "GECKO_TIMEFRAME", ["1h"] as const, "1h"),
    geckoLookback: readLookback(env, "GECKO_LOOKBACK", 200, 1000),
    geckoPollIntervalMs: readPositiveInteger(env, "GECKO_POLL_INTERVAL_MS", 300000),
    geckoMaxCallsPerMinute: readPositiveInteger(env, "GECKO_MAX_CALLS_PER_MINUTE", 6),
    geckoRequestTimeoutMs: readPositiveInteger(env, "GECKO_REQUEST_TIMEOUT_MS", 10000)
  };
}
