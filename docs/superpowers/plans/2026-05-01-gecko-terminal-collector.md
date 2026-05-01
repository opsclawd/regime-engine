# GeckoTerminal Candle Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate zero-dependency GeckoTerminal worker that fetches SOL/USDC 1h OHLCV candles and posts validated rolling-window batches to `POST /v1/candles`.

**Architecture:** Add a small worker slice under `src/workers/` with an ESM-guarded entrypoint, strict env parser, local retry/rate-limit helpers, Gecko fetch client, normalizer, ingest client, and minimal structured logging. The worker runs as a second Railway service and communicates with `regime-engine` only over HTTP.

**Tech Stack:** TypeScript, Node 22 built-in `fetch`, `AbortController`, `node:timers/promises`, Vitest, existing contract types from `src/contract/v1/types.ts`.

---

## Source Spec

Implement from [docs/superpowers/specs/2026-05-01-gecko-terminal-collector-design.md](../specs/2026-05-01-gecko-terminal-collector-design.md).

## File Structure

Create:

- `src/workers/geckoCollector.ts` - ESM-guarded worker entrypoint, immediate-start sequential loop, shutdown phase control.
- `src/workers/gecko/config.ts` - env parsing, defaults, strict MVP validation.
- `src/workers/gecko/geckoClient.ts` - GeckoTerminal URL construction, provider fetch, HTTP/protocol error conversion.
- `src/workers/gecko/normalize.ts` - provider payload validation, Unix seconds to milliseconds conversion, duplicate handling, corruption guard.
- `src/workers/gecko/ingestClient.ts` - `POST /v1/candles` payload construction, auth header, strict response validation.
- `src/workers/gecko/retry.ts` - `HttpError`, `ProtocolError`, `RequestTimeoutError`, `RequestTransportError`, bounded retry, provider-scoped rate limiter.
- `src/workers/gecko/logger.ts` - tiny structured console logger and redaction helpers.
- `src/workers/gecko/__tests__/config.test.ts`
- `src/workers/gecko/__tests__/retry.test.ts`
- `src/workers/gecko/__tests__/normalize.test.ts`
- `src/workers/gecko/__tests__/geckoClient.test.ts`
- `src/workers/gecko/__tests__/ingestClient.test.ts`
- `src/workers/__tests__/geckoCollector.test.ts`

Modify:

- `package.json` - add `start`, `dev:gecko`, and `start:gecko` scripts.
- `.env.example` - add worker env vars with placeholder pool address.
- `README.md` - document local worker usage and two Railway services.
- `docs/runbooks/railway-deploy.md` - add collector service deployment and verification notes.

Do not modify:

- `railway.toml` - the collector runs by Railway service start-command override.
- `src/app.ts`, `src/server.ts`, `src/http/routes.ts`, `src/ledger/store.ts`, `src/ledger/candleStore.ts`, `src/ledger/candlesWriter.ts`, `src/ledger/pg/db.ts`.

---

### Task 1: Config Parser And Logger Foundation

**Files:**

- Create: `src/workers/gecko/config.ts`
- Create: `src/workers/gecko/logger.ts`
- Test: `src/workers/gecko/__tests__/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Create `src/workers/gecko/__tests__/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseGeckoCollectorConfig } from "../config.js";

const validEnv = {
  REGIME_ENGINE_URL: "https://regime-engine.example",
  CANDLES_INGEST_TOKEN: "secret-token",
  GECKO_POOL_ADDRESS: "solana-pool-address"
};

describe("parseGeckoCollectorConfig", () => {
  it("applies MVP defaults", () => {
    const config = parseGeckoCollectorConfig(validEnv);

    expect(config.regimeEngineUrl.href).toBe("https://regime-engine.example/");
    expect(config.candlesIngestToken).toBe("secret-token");
    expect(config.geckoSource).toBe("geckoterminal");
    expect(config.geckoNetwork).toBe("solana");
    expect(config.geckoPoolAddress).toBe("solana-pool-address");
    expect(config.geckoSymbol).toBe("SOL/USDC");
    expect(config.geckoTimeframe).toBe("1h");
    expect(config.geckoLookback).toBe(200);
    expect(config.geckoPollIntervalMs).toBe(300_000);
    expect(config.geckoMaxCallsPerMinute).toBe(6);
    expect(config.geckoRequestTimeoutMs).toBe(10_000);
  });

  it("accepts explicit valid values", () => {
    const config = parseGeckoCollectorConfig({
      ...validEnv,
      GECKO_SOURCE: "geckoterminal",
      GECKO_NETWORK: "solana",
      GECKO_SYMBOL: "SOL/USDC",
      GECKO_TIMEFRAME: "1h",
      GECKO_LOOKBACK: "250",
      GECKO_POLL_INTERVAL_MS: "600000",
      GECKO_MAX_CALLS_PER_MINUTE: "5",
      GECKO_REQUEST_TIMEOUT_MS: "12000"
    });

    expect(config.geckoLookback).toBe(250);
    expect(config.geckoPollIntervalMs).toBe(600_000);
    expect(config.geckoMaxCallsPerMinute).toBe(5);
    expect(config.geckoRequestTimeoutMs).toBe(12_000);
  });

  it.each([
    ["REGIME_ENGINE_URL", ""],
    ["CANDLES_INGEST_TOKEN", ""],
    ["GECKO_POOL_ADDRESS", ""]
  ])("rejects missing required env %s", (key, value) => {
    expect(() => parseGeckoCollectorConfig({ ...validEnv, [key]: value })).toThrow(key);
  });

  it("rejects non-absolute REGIME_ENGINE_URL", () => {
    expect(() =>
      parseGeckoCollectorConfig({ ...validEnv, REGIME_ENGINE_URL: "regime-engine.local" })
    ).toThrow("REGIME_ENGINE_URL");
  });

  it("rejects plain HTTP except localhost and Railway private hosts", () => {
    expect(() =>
      parseGeckoCollectorConfig({ ...validEnv, REGIME_ENGINE_URL: "http://example.com" })
    ).toThrow("REGIME_ENGINE_URL");

    expect(
      parseGeckoCollectorConfig({ ...validEnv, REGIME_ENGINE_URL: "http://localhost:8787" })
        .regimeEngineUrl.href
    ).toBe("http://localhost:8787/");
    expect(
      parseGeckoCollectorConfig({
        ...validEnv,
        REGIME_ENGINE_URL: "http://regime-engine.railway.internal:8787"
      }).regimeEngineUrl.href
    ).toBe("http://regime-engine.railway.internal:8787/");
  });

  it.each([
    ["GECKO_SOURCE", "other"],
    ["GECKO_NETWORK", "ethereum"],
    ["GECKO_SYMBOL", "ETH/USDC"],
    ["GECKO_TIMEFRAME", "5m"]
  ])("rejects unsupported MVP value %s=%s", (key, value) => {
    expect(() => parseGeckoCollectorConfig({ ...validEnv, [key]: value })).toThrow(key);
  });

  it.each(["GECKO_SOURCE", "GECKO_LOOKBACK", "GECKO_SYMBOL"])(
    "rejects explicit empty optional env %s",
    (key) => {
      expect(() => parseGeckoCollectorConfig({ ...validEnv, [key]: "" })).toThrow(key);
    }
  );

  it.each([
    ["GECKO_LOOKBACK", "0"],
    ["GECKO_LOOKBACK", "-1"],
    ["GECKO_LOOKBACK", "1.5"],
    ["GECKO_POLL_INTERVAL_MS", "0"],
    ["GECKO_MAX_CALLS_PER_MINUTE", "abc"],
    ["GECKO_REQUEST_TIMEOUT_MS", "-100"]
  ])("rejects invalid positive integer %s=%s", (key, value) => {
    expect(() => parseGeckoCollectorConfig({ ...validEnv, [key]: value })).toThrow(key);
  });
});
```

- [ ] **Step 2: Run the failing config tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/config.test.ts
```

Expected: FAIL because `src/workers/gecko/config.ts` does not exist.

- [ ] **Step 3: Implement config parser**

Create `src/workers/gecko/config.ts`:

```ts
export type GeckoCollectorConfig = {
  regimeEngineUrl: URL;
  candlesIngestToken: string;
  geckoSource: "geckoterminal";
  geckoNetwork: "solana";
  geckoPoolAddress: string;
  geckoSymbol: "SOL/USDC";
  geckoTimeframe: "1h";
  geckoLookback: number;
  geckoPollIntervalMs: number;
  geckoMaxCallsPerMinute: number;
  geckoRequestTimeoutMs: number;
};

const readRequired = (env: NodeJS.ProcessEnv, key: string): string => {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const readOptional = (env: NodeJS.ProcessEnv, key: string, defaultValue: string): string => {
  if (!(key in env)) {
    return defaultValue;
  }
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} must not be empty`);
  }
  return value;
};

const readLiteral = <T extends string>(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: T,
  allowed: T
): T => {
  const value = readOptional(env, key, defaultValue) as T;
  if (value !== allowed) {
    throw new Error(`${key} must equal ${allowed}`);
  }
  return value;
};

const readPositiveInteger = (env: NodeJS.ProcessEnv, key: string, defaultValue: number): number => {
  const raw = readOptional(env, key, String(defaultValue));
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
};

const isAllowedHttpHost = (hostname: string): boolean => {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".railway.internal")
  );
};

const readAbsoluteUrl = (env: NodeJS.ProcessEnv, key: string): URL => {
  const raw = readRequired(env, key);
  try {
    const url = new URL(raw);
    if (!url.protocol || !url.hostname) {
      throw new Error("missing protocol or host");
    }
    if (url.protocol === "http:" && !isAllowedHttpHost(url.hostname)) {
      throw new Error("plain HTTP is only allowed for localhost or Railway private hosts");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    return url;
  } catch {
    throw new Error(
      `${key} must be an absolute HTTPS URL, localhost HTTP URL, or Railway private HTTP URL`
    );
  }
};

export function parseGeckoCollectorConfig(
  env: NodeJS.ProcessEnv = process.env
): GeckoCollectorConfig {
  return {
    regimeEngineUrl: readAbsoluteUrl(env, "REGIME_ENGINE_URL"),
    candlesIngestToken: readRequired(env, "CANDLES_INGEST_TOKEN"),
    geckoSource: readLiteral(env, "GECKO_SOURCE", "geckoterminal", "geckoterminal"),
    geckoNetwork: readLiteral(env, "GECKO_NETWORK", "solana", "solana"),
    geckoPoolAddress: readRequired(env, "GECKO_POOL_ADDRESS"),
    geckoSymbol: readLiteral(env, "GECKO_SYMBOL", "SOL/USDC", "SOL/USDC"),
    geckoTimeframe: readLiteral(env, "GECKO_TIMEFRAME", "1h", "1h"),
    geckoLookback: readPositiveInteger(env, "GECKO_LOOKBACK", 200),
    geckoPollIntervalMs: readPositiveInteger(env, "GECKO_POLL_INTERVAL_MS", 300_000),
    geckoMaxCallsPerMinute: readPositiveInteger(env, "GECKO_MAX_CALLS_PER_MINUTE", 6),
    geckoRequestTimeoutMs: readPositiveInteger(env, "GECKO_REQUEST_TIMEOUT_MS", 10_000)
  };
}
```

- [ ] **Step 4: Implement minimal redacting logger**

Create `src/workers/gecko/logger.ts`:

```ts
export type LogContext = Record<string, unknown>;

export type WorkerLogger = {
  info: (event: string, context?: LogContext) => void;
  warn: (event: string, context?: LogContext) => void;
  error: (event: string, context?: LogContext) => void;
};

const SECRET_KEY_PATTERN = /(token|secret|authorization|headers|responseBody)/i;

const redactValue = (key: string, value: unknown): unknown => {
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue("", item));
  }
  if (typeof value === "object" && value !== null) {
    const nested: LogContext = {};
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      nested[nestedKey] = redactValue(nestedKey, nestedValue);
    }
    return nested;
  }
  return value;
};

export const redactLogContext = (context: LogContext = {}): LogContext => {
  const redacted: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    redacted[key] = redactValue(key, value);
  }
  return redacted;
};

const write = (level: "info" | "warn" | "error", event: string, context: LogContext = {}) => {
  const payload = {
    level,
    event,
    at: new Date().toISOString(),
    ...redactLogContext(context)
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
};

export const consoleLogger: WorkerLogger = {
  info: (event, context) => write("info", event, context),
  warn: (event, context) => write("warn", event, context),
  error: (event, context) => write("error", event, context)
};
```

- [ ] **Step 5: Run config tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit config and logger foundation**

Run:

```bash
git add src/workers/gecko/config.ts src/workers/gecko/logger.ts src/workers/gecko/__tests__/config.test.ts
git commit -m "feat: add Gecko collector config"
```

---

### Task 2: Retry, HTTP Errors, And Provider Rate Limiter

**Files:**

- Create: `src/workers/gecko/retry.ts`
- Test: `src/workers/gecko/__tests__/retry.test.ts`

- [ ] **Step 1: Write failing retry tests**

Create `src/workers/gecko/__tests__/retry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  HttpError,
  ProtocolError,
  RequestTransportError,
  RequestTimeoutError,
  createRateLimiter,
  isRetryableHttpStatus,
  withRetry
} from "../retry.js";

describe("HttpError", () => {
  it("stores status, response body, and retryable flag", () => {
    const error = new HttpError({
      statusCode: 429,
      responseBody: "too many",
      retryable: true,
      message: "rate limited"
    });

    expect(error.message).toBe("rate limited");
    expect(error.statusCode).toBe(429);
    expect(error.responseBody).toBe("too many");
    expect(error.retryable).toBe(true);
  });
});

describe("isRetryableHttpStatus", () => {
  it.each([429, 500, 502, 503, 504])("marks %s retryable", (status) => {
    expect(isRetryableHttpStatus(status)).toBe(true);
  });

  it.each([400, 401, 403, 404, 409])("marks %s non-retryable", (status) => {
    expect(isRetryableHttpStatus(status)).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries retryable errors with exponential backoff and jitter", async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new RequestTimeoutError("timeout"))
      .mockRejectedValueOnce(new HttpError({ statusCode: 503, retryable: true }))
      .mockResolvedValue("ok");

    await expect(
      withRetry((attempt) => operation().then((value) => `${value}:${attempt}`), {
        maxAttempts: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 30000,
        jitterMs: (attempt) => attempt * 10,
        sleep
      })
    ).resolves.toBe("ok:3");

    expect(sleep).toHaveBeenNthCalledWith(1, 1010);
    expect(sleep).toHaveBeenNthCalledWith(2, 2020);
  });

  it("does not retry non-retryable HttpError", async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      throw new HttpError({ statusCode: 404, retryable: false });
    });

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 30000,
        jitterMs: () => 0,
        sleep
      })
    ).rejects.toBeInstanceOf(HttpError);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry protocol errors", async () => {
    const operation = vi.fn(async () => {
      throw new ProtocolError("bad json");
    });

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 30000,
        jitterMs: () => 0,
        sleep: vi.fn(async () => {})
      })
    ).rejects.toBeInstanceOf(ProtocolError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("does not retry unclassified programmer errors", async () => {
    const operation = vi.fn(async () => {
      throw new TypeError("programmer error");
    });

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 30000,
        jitterMs: () => 0,
        sleep: vi.fn(async () => {})
      })
    ).rejects.toBeInstanceOf(TypeError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries explicitly classified transport errors", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new RequestTransportError("fetch failed"))
      .mockResolvedValue("ok");

    await expect(
      withRetry(operation, {
        maxAttempts: 2,
        initialBackoffMs: 1000,
        maxBackoffMs: 30000,
        jitterMs: () => 0,
        sleep: vi.fn(async () => {})
      })
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("exits promptly when retry backoff sleep is aborted", async () => {
    const abort = new AbortController();
    const originalError = new HttpError({ statusCode: 503, retryable: true });
    const operation = vi.fn(async () => {
      throw originalError;
    });
    const sleep = vi.fn(async (_ms: number, _options?: { signal?: AbortSignal }) => {
      abort.abort();
      throw new DOMException("aborted", "AbortError");
    });

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 30000,
        jitterMs: () => 0,
        sleep,
        signal: abort.signal
      })
    ).rejects.toBe(originalError);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops before another attempt when shouldContinue returns false", async () => {
    const operation = vi.fn(async () => {
      throw new HttpError({ statusCode: 503, retryable: true });
    });

    await expect(
      withRetry(operation, {
        maxAttempts: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 30000,
        jitterMs: () => 0,
        sleep: vi.fn(async () => {}),
        shouldContinue: () => false
      })
    ).rejects.toBeInstanceOf(HttpError);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("createRateLimiter", () => {
  it("allows first call immediately and spaces later calls", async () => {
    let now = 10_000;
    const sleep = vi.fn(async (ms: number) => {
      now += ms;
    });
    const waitForPermit = createRateLimiter(6, { sleep, now: () => now });

    await waitForPermit();
    expect(sleep).not.toHaveBeenCalled();

    await waitForPermit();
    await waitForPermit();

    expect(sleep).toHaveBeenNthCalledWith(1, 10_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 10_000);
  });
});
```

- [ ] **Step 2: Run failing retry tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/retry.test.ts
```

Expected: FAIL because `src/workers/gecko/retry.ts` does not exist.

- [ ] **Step 3: Implement retry helpers**

Create `src/workers/gecko/retry.ts`:

```ts
import { setTimeout as defaultSleep } from "node:timers/promises";

export type HttpErrorOptions = {
  statusCode: number;
  responseBody?: string;
  retryable?: boolean;
  message?: string;
};

export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly responseBody?: string;
  public readonly retryable: boolean;

  public constructor(options: HttpErrorOptions) {
    super(options.message ?? `HTTP ${options.statusCode}`);
    this.name = "HttpError";
    this.statusCode = options.statusCode;
    this.responseBody = options.responseBody;
    this.retryable = options.retryable ?? isRetryableHttpStatus(options.statusCode);
  }
}

export class ProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export class RequestTimeoutError extends Error {
  public constructor(message = "Request timed out") {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

export class RequestTransportError extends Error {
  public constructor(message = "Request transport failed") {
    super(message);
    this.name = "RequestTransportError";
  }
}

export type RetryOptions = {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  jitterMs: (attempt: number) => number;
  sleep: (ms: number, options?: { signal?: AbortSignal }) => Promise<unknown>;
  signal?: AbortSignal;
  shouldContinue?: () => boolean;
};

export const isRetryableHttpStatus = (status: number): boolean => {
  return status === 429 || status >= 500;
};

const isRetryableError = (error: unknown): boolean => {
  if (error instanceof HttpError) return error.retryable;
  if (error instanceof RequestTimeoutError) return true;
  if (error instanceof RequestTransportError) return true;
  if (error instanceof ProtocolError) return false;
  return false;
};

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt >= options.maxAttempts) {
        throw error;
      }
      if (options.shouldContinue && !options.shouldContinue()) {
        throw error;
      }

      const exponential = options.initialBackoffMs * 2 ** (attempt - 1);
      const capped = Math.min(options.maxBackoffMs, exponential);
      try {
        await options.sleep(capped + options.jitterMs(attempt), { signal: options.signal });
      } catch (sleepError) {
        if (
          sleepError instanceof DOMException &&
          (sleepError.name === "AbortError" || sleepError.name === "TimeoutError")
        ) {
          throw error;
        }
        throw sleepError;
      }

      if (options.shouldContinue && !options.shouldContinue()) {
        throw error;
      }
    }
  }

  throw lastError;
}

export function createRateLimiter(
  maxCallsPerMinute: number,
  deps: {
    sleep?: (ms: number) => Promise<unknown>;
    now?: () => number;
  } = {}
): () => Promise<void> {
  const intervalMs = 60_000 / maxCallsPerMinute;
  const sleep = deps.sleep ?? ((ms: number) => defaultSleep(ms));
  const now = deps.now ?? (() => Date.now());
  let nextAllowedAt = 0;

  return async () => {
    const current = now();
    const waitMs = Math.max(0, nextAllowedAt - current);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    nextAllowedAt = Math.max(current, nextAllowedAt) + intervalMs;
  };
}
```

- [ ] **Step 4: Run retry tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/retry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit retry and rate limiter**

Run:

```bash
git add src/workers/gecko/retry.ts src/workers/gecko/__tests__/retry.test.ts
git commit -m "feat: add Gecko collector retry helpers"
```

---

### Task 3: Gecko Normalizer And Corruption Guard

**Files:**

- Create: `src/workers/gecko/normalize.ts`
- Test: `src/workers/gecko/__tests__/normalize.test.ts`

- [ ] **Step 1: Write failing normalizer tests**

Create `src/workers/gecko/__tests__/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GeckoCollectorConfig } from "../config.js";
import { normalizeGeckoOhlcv, shouldPostNormalizedBatch } from "../normalize.js";

const config: GeckoCollectorConfig = {
  regimeEngineUrl: new URL("https://regime-engine.example"),
  candlesIngestToken: "secret",
  geckoSource: "geckoterminal",
  geckoNetwork: "solana",
  geckoPoolAddress: "pool",
  geckoSymbol: "SOL/USDC",
  geckoTimeframe: "1h",
  geckoLookback: 200,
  geckoPollIntervalMs: 300_000,
  geckoMaxCallsPerMinute: 6,
  geckoRequestTimeoutMs: 10_000
};

const payload = (rows: unknown[]) => ({
  data: {
    attributes: {
      ohlcv_list: rows
    }
  }
});

describe("normalizeGeckoOhlcv", () => {
  it("converts Gecko Unix seconds into contract Unix milliseconds", () => {
    const result = normalizeGeckoOhlcv(payload([[3600, 100, 110, 90, 105, 123.45]]), config);

    expect(result.validCandles).toEqual([
      { unixMs: 3_600_000, open: 100, high: 110, low: 90, close: 105, volume: 123.45 }
    ]);
    expect(result.stats.providerRowCount).toBe(1);
    expect(result.stats.validCount).toBe(1);
  });

  it("throws ProtocolError for malformed top-level envelope", () => {
    expect(() => normalizeGeckoOhlcv({ data: { attributes: {} } }, config)).toThrow("ohlcv_list");
  });

  it("throws ProtocolError when provider returns more than 1000 rows", () => {
    const rows = Array.from({ length: 1001 }, (_, index) => [
      (index + 1) * 3600,
      100,
      110,
      90,
      105,
      1
    ]);

    expect(() => normalizeGeckoOhlcv(payload(rows), config)).toThrow("1000");
  });

  it("drops non-array rows and rows with missing or extra fields", () => {
    const result = normalizeGeckoOhlcv(
      payload([
        "not-array",
        [3600, 100, 110, 90, 105],
        [7200, 100, 110, 90, 105, 1, "extra"],
        [10_800, 100, 110, 90, 105, 1]
      ]),
      config
    );

    expect(result.validCandles.map((candle) => candle.unixMs)).toEqual([10_800_000]);
    expect(result.stats.malformedRowCount).toBe(3);
    expect(result.stats.corruptionDroppedCount).toBe(3);
  });

  it("drops misaligned and invalid OHLCV rows", () => {
    const result = normalizeGeckoOhlcv(
      payload([
        [1, 100, 110, 90, 105, 1],
        [3600, 0, 110, 90, 105, 1],
        [7200, 100, 99, 90, 105, 1],
        [10_800, 100, 110, 90, 105, -1],
        [14_400, 100, 110, 90, 105, 1]
      ]),
      config
    );

    expect(result.validCandles.map((candle) => candle.unixMs)).toEqual([14_400_000]);
    expect(result.stats.misalignedRowCount).toBe(1);
    expect(result.stats.invalidOhlcvRowCount).toBe(3);
  });

  it("drops unsafe timestamp rows as malformed", () => {
    const result = normalizeGeckoOhlcv(
      payload([[Number.MAX_SAFE_INTEGER + 1, 100, 110, 90, 105, 1]]),
      config
    );

    expect(result.validCandles).toEqual([]);
    expect(result.stats.malformedRowCount).toBe(1);
  });

  it("dedupes identical rows without adding to corruption dropped count", () => {
    const result = normalizeGeckoOhlcv(
      payload([
        [3600, 100, 110, 90, 105, 1],
        [3600, 100, 110, 90, 105, 1]
      ]),
      config
    );

    expect(result.validCandles).toHaveLength(1);
    expect(result.stats.duplicateIdenticalDroppedCount).toBe(1);
    expect(result.stats.totalDroppedCount).toBe(1);
    expect(result.stats.corruptionDroppedCount).toBe(0);
  });

  it("drops all rows for conflicting duplicate timestamps", () => {
    const result = normalizeGeckoOhlcv(
      payload([
        [3600, 100, 110, 90, 105, 1],
        [3600, 101, 111, 91, 106, 1],
        [7200, 100, 110, 90, 105, 1]
      ]),
      config
    );

    expect(result.validCandles.map((candle) => candle.unixMs)).toEqual([7_200_000]);
    expect(result.stats.duplicateConflictDroppedCount).toBe(2);
    expect(result.stats.corruptionDroppedCount).toBe(2);
  });

  it("sorts valid candles by unixMs ascending", () => {
    const result = normalizeGeckoOhlcv(
      payload([
        [7200, 100, 110, 90, 105, 1],
        [3600, 100, 110, 90, 105, 1]
      ]),
      config
    );

    expect(result.validCandles.map((candle) => candle.unixMs)).toEqual([3_600_000, 7_200_000]);
  });
});

describe("shouldPostNormalizedBatch", () => {
  it("blocks zero-valid batches", () => {
    expect(
      shouldPostNormalizedBatch(
        {
          providerRowCount: 0,
          malformedRowCount: 0,
          misalignedRowCount: 0,
          invalidOhlcvRowCount: 0,
          duplicateIdenticalDroppedCount: 0,
          duplicateConflictDroppedCount: 0,
          totalDroppedCount: 0,
          corruptionDroppedCount: 0,
          validCount: 0,
          dropReasons: {}
        },
        config
      )
    ).toBe(false);
  });

  it("blocks corruption rate above 10 percent", () => {
    expect(
      shouldPostNormalizedBatch(
        {
          providerRowCount: 100,
          malformedRowCount: 11,
          misalignedRowCount: 0,
          invalidOhlcvRowCount: 0,
          duplicateIdenticalDroppedCount: 0,
          duplicateConflictDroppedCount: 0,
          totalDroppedCount: 11,
          corruptionDroppedCount: 11,
          validCount: 89,
          dropReasons: { malformed: 11 }
        },
        config
      )
    ).toBe(false);
  });

  it("does not block exact duplicates by corruption rate", () => {
    expect(
      shouldPostNormalizedBatch(
        {
          providerRowCount: 100,
          malformedRowCount: 0,
          misalignedRowCount: 0,
          invalidOhlcvRowCount: 0,
          duplicateIdenticalDroppedCount: 90,
          duplicateConflictDroppedCount: 0,
          totalDroppedCount: 90,
          corruptionDroppedCount: 0,
          validCount: 10,
          dropReasons: { duplicate_identical: 90 }
        },
        { ...config, geckoLookback: 10 }
      )
    ).toBe(true);
  });

  it("blocks low valid count when lookback is at least 50", () => {
    expect(
      shouldPostNormalizedBatch(
        {
          providerRowCount: 49,
          malformedRowCount: 0,
          misalignedRowCount: 0,
          invalidOhlcvRowCount: 0,
          duplicateIdenticalDroppedCount: 0,
          duplicateConflictDroppedCount: 0,
          totalDroppedCount: 0,
          corruptionDroppedCount: 0,
          validCount: 49,
          dropReasons: {}
        },
        config
      )
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing normalizer tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/normalize.test.ts
```

Expected: FAIL because `src/workers/gecko/normalize.ts` does not exist.

- [ ] **Step 3: Implement normalizer**

Create `src/workers/gecko/normalize.ts` with these exported types and functions:

```ts
import type { Candle } from "../../contract/v1/types.js";
import type { GeckoCollectorConfig } from "./config.js";
import { ProtocolError } from "./retry.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

export type NormalizationStats = {
  providerRowCount: number;
  malformedRowCount: number;
  misalignedRowCount: number;
  invalidOhlcvRowCount: number;
  duplicateIdenticalDroppedCount: number;
  duplicateConflictDroppedCount: number;
  totalDroppedCount: number;
  corruptionDroppedCount: number;
  validCount: number;
  dropReasons: Record<string, number>;
};

export type NormalizationResult = {
  validCandles: Candle[];
  stats: NormalizationStats;
};

const increment = (stats: NormalizationStats, reason: string): void => {
  stats.dropReasons[reason] = (stats.dropReasons[reason] ?? 0) + 1;
};

const emptyStats = (): NormalizationStats => ({
  providerRowCount: 0,
  malformedRowCount: 0,
  misalignedRowCount: 0,
  invalidOhlcvRowCount: 0,
  duplicateIdenticalDroppedCount: 0,
  duplicateConflictDroppedCount: 0,
  totalDroppedCount: 0,
  corruptionDroppedCount: 0,
  validCount: 0,
  dropReasons: {}
});

const readRows = (payload: unknown): unknown[] => {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("data" in payload) ||
    typeof payload.data !== "object" ||
    payload.data === null ||
    !("attributes" in payload.data) ||
    typeof payload.data.attributes !== "object" ||
    payload.data.attributes === null ||
    !("ohlcv_list" in payload.data.attributes) ||
    !Array.isArray(payload.data.attributes.ohlcv_list)
  ) {
    throw new ProtocolError("GeckoTerminal payload missing data.attributes.ohlcv_list array");
  }
  if (payload.data.attributes.ohlcv_list.length > 1000) {
    throw new ProtocolError("GeckoTerminal ohlcv_list must not exceed 1000 rows");
  }
  return payload.data.attributes.ohlcv_list;
};

const sameOhlcv = (a: Candle, b: Candle): boolean =>
  a.unixMs === b.unixMs &&
  a.open === b.open &&
  a.high === b.high &&
  a.low === b.low &&
  a.close === b.close &&
  a.volume === b.volume;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const timeframeMsForConfig = (config: GeckoCollectorConfig): number => {
  if (config.geckoTimeframe !== "1h") {
    throw new ProtocolError("Only GECKO_TIMEFRAME=1h is supported");
  }
  return ONE_HOUR_MS;
};

const parseRow = (row: unknown, stats: NormalizationStats, timeframeMs: number): Candle | null => {
  if (!Array.isArray(row) || row.length !== 6) {
    stats.malformedRowCount += 1;
    increment(stats, "malformed");
    return null;
  }

  const [timestampSecondsRaw, openRaw, highRaw, lowRaw, closeRaw, volumeRaw] = row;
  const timestampSeconds = toFiniteNumber(timestampSecondsRaw);
  const open = toFiniteNumber(openRaw);
  const high = toFiniteNumber(highRaw);
  const low = toFiniteNumber(lowRaw);
  const close = toFiniteNumber(closeRaw);
  const volume = toFiniteNumber(volumeRaw);

  if (
    timestampSeconds === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volume === null ||
    !Number.isInteger(timestampSeconds) ||
    !Number.isSafeInteger(timestampSeconds)
  ) {
    stats.malformedRowCount += 1;
    increment(stats, "malformed");
    return null;
  }

  const unixMs = timestampSeconds * 1000;
  if (!Number.isSafeInteger(unixMs)) {
    stats.malformedRowCount += 1;
    increment(stats, "malformed");
    return null;
  }

  if (!Number.isInteger(unixMs) || unixMs % timeframeMs !== 0) {
    stats.misalignedRowCount += 1;
    increment(stats, "misaligned");
    return null;
  }

  if (
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    volume < 0 ||
    high < Math.max(open, close, low) ||
    low > Math.min(open, close, high)
  ) {
    stats.invalidOhlcvRowCount += 1;
    increment(stats, "invalid_ohlcv");
    return null;
  }

  return { unixMs, open, high, low, close, volume };
};

export function normalizeGeckoOhlcv(
  payload: unknown,
  config: GeckoCollectorConfig
): NormalizationResult {
  const rows = readRows(payload);
  const timeframeMs = timeframeMsForConfig(config);
  const stats = emptyStats();
  stats.providerRowCount = rows.length;

  const groups = new Map<number, Candle[]>();
  for (const row of rows) {
    const candle = parseRow(row, stats, timeframeMs);
    if (!candle) continue;
    const existing = groups.get(candle.unixMs) ?? [];
    existing.push(candle);
    groups.set(candle.unixMs, existing);
  }

  const validCandles: Candle[] = [];
  for (const candles of groups.values()) {
    const [first] = candles;
    if (candles.every((candidate) => sameOhlcv(first, candidate))) {
      validCandles.push(first);
      const duplicateCount = candles.length - 1;
      if (duplicateCount > 0) {
        stats.duplicateIdenticalDroppedCount += duplicateCount;
        stats.dropReasons.duplicate_identical =
          (stats.dropReasons.duplicate_identical ?? 0) + duplicateCount;
      }
    } else {
      stats.duplicateConflictDroppedCount += candles.length;
      stats.dropReasons.duplicate_conflict =
        (stats.dropReasons.duplicate_conflict ?? 0) + candles.length;
    }
  }

  validCandles.sort((a, b) => a.unixMs - b.unixMs);
  stats.totalDroppedCount =
    stats.malformedRowCount +
    stats.misalignedRowCount +
    stats.invalidOhlcvRowCount +
    stats.duplicateIdenticalDroppedCount +
    stats.duplicateConflictDroppedCount;
  stats.corruptionDroppedCount =
    stats.malformedRowCount +
    stats.misalignedRowCount +
    stats.invalidOhlcvRowCount +
    stats.duplicateConflictDroppedCount;
  stats.validCount = validCandles.length;

  return { validCandles, stats };
}

export function shouldPostNormalizedBatch(
  stats: NormalizationStats,
  config: GeckoCollectorConfig
): boolean {
  if (stats.validCount === 0) return false;
  if (stats.providerRowCount > 0 && stats.corruptionDroppedCount / stats.providerRowCount > 0.1) {
    return false;
  }
  if (config.geckoLookback >= 50 && stats.validCount < 50) {
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Run normalizer tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/normalize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit normalizer**

Run:

```bash
git add src/workers/gecko/normalize.ts src/workers/gecko/__tests__/normalize.test.ts
git commit -m "feat: normalize Gecko OHLCV candles"
```

---

### Task 4: GeckoTerminal Fetch Client

**Files:**

- Create: `src/workers/gecko/geckoClient.ts`
- Test: `src/workers/gecko/__tests__/geckoClient.test.ts`

- [ ] **Step 1: Write failing Gecko client tests**

Create `src/workers/gecko/__tests__/geckoClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { GeckoCollectorConfig } from "../config.js";
import { fetchGeckoOhlcv } from "../geckoClient.js";
import { HttpError, ProtocolError, RequestTimeoutError, RequestTransportError } from "../retry.js";

const config: GeckoCollectorConfig = {
  regimeEngineUrl: new URL("https://regime-engine.example"),
  candlesIngestToken: "secret",
  geckoSource: "geckoterminal",
  geckoNetwork: "solana",
  geckoPoolAddress: "pool address/with spaces",
  geckoSymbol: "SOL/USDC",
  geckoTimeframe: "1h",
  geckoLookback: 200,
  geckoPollIntervalMs: 300_000,
  geckoMaxCallsPerMinute: 6,
  geckoRequestTimeoutMs: 10_000
};

const okPayload = { data: { attributes: { ohlcv_list: [] } } };

describe("fetchGeckoOhlcv", () => {
  it("builds encoded Gecko OHLCV URL and sends JSON accept header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(okPayload), { status: 200 }));
    const waitForProviderPermit = vi.fn(async () => {});

    await fetchGeckoOhlcv(config, {
      fetch: fetchMock,
      waitForProviderPermit
    });

    expect(waitForProviderPermit).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.geckoterminal.com/api/v2/networks/solana/pools/pool%20address%2Fwith%20spaces/ohlcv/hour?aggregate=1&limit=200"
    );
    expect(init?.headers).toEqual({ Accept: "application/json" });
  });

  it("throws retryable HttpError for 429 and 5xx", async () => {
    for (const status of [429, 503]) {
      const fetchMock = vi.fn(async () => new Response("error", { status }));

      await expect(
        fetchGeckoOhlcv(config, {
          fetch: fetchMock,
          waitForProviderPermit: async () => {}
        })
      ).rejects.toMatchObject({ statusCode: status, retryable: true });
    }
  });

  it("throws non-retryable HttpError for non-429 4xx", async () => {
    const fetchMock = vi.fn(async () => new Response("missing", { status: 404 }));

    await expect(
      fetchGeckoOhlcv(config, {
        fetch: fetchMock,
        waitForProviderPermit: async () => {}
      })
    ).rejects.toMatchObject({ statusCode: 404, retryable: false });
  });

  it("throws ProtocolError for invalid 2xx JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("{", { status: 200 }));

    await expect(
      fetchGeckoOhlcv(config, {
        fetch: fetchMock,
        waitForProviderPermit: async () => {}
      })
    ).rejects.toBeInstanceOf(ProtocolError);
  });

  it("throws ProtocolError for oversized 2xx response bodies", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(512 * 1024 + 1) }
        })
    );

    await expect(
      fetchGeckoOhlcv(config, {
        fetch: fetchMock,
        waitForProviderPermit: async () => {}
      })
    ).rejects.toBeInstanceOf(ProtocolError);
  });

  it("wraps timeout aborts as RequestTimeoutError", async () => {
    const abortError = new DOMException("aborted", "TimeoutError");
    const fetchMock = vi.fn(async () => {
      throw abortError;
    });

    await expect(
      fetchGeckoOhlcv(config, {
        fetch: fetchMock,
        waitForProviderPermit: async () => {}
      })
    ).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it("wraps transport failures as RequestTransportError", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(
      fetchGeckoOhlcv(config, {
        fetch: fetchMock,
        waitForProviderPermit: async () => {}
      })
    ).rejects.toBeInstanceOf(RequestTransportError);
  });
});
```

- [ ] **Step 2: Run failing Gecko client tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/geckoClient.test.ts
```

Expected: FAIL because `src/workers/gecko/geckoClient.ts` does not exist.

- [ ] **Step 3: Implement Gecko client**

Create `src/workers/gecko/geckoClient.ts`:

```ts
import type { GeckoCollectorConfig } from "./config.js";
import {
  HttpError,
  ProtocolError,
  RequestTimeoutError,
  RequestTransportError,
  isRetryableHttpStatus
} from "./retry.js";

export type GeckoOhlcvPayload = unknown;

export type GeckoFetchDeps = {
  fetch?: typeof fetch;
  waitForProviderPermit: () => Promise<void>;
};

const encodeSegment = (segment: string): string => encodeURIComponent(segment);

const buildGeckoUrl = (config: GeckoCollectorConfig): URL => {
  const url = new URL(
    `/api/v2/networks/${encodeSegment(config.geckoNetwork)}/pools/${encodeSegment(
      config.geckoPoolAddress
    )}/ohlcv/hour`,
    "https://api.geckoterminal.com"
  );
  url.search = new URLSearchParams({
    aggregate: "1",
    limit: String(config.geckoLookback)
  }).toString();
  return url;
};

const MAX_RESPONSE_BYTES = 512 * 1024;

const readTextWithLimit = async (response: Response): Promise<string> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new ProtocolError("Response body exceeds 512 KiB limit");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ProtocolError("Response body exceeds 512 KiB limit");
  }
  return text;
};

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return JSON.parse(await readTextWithLimit(response));
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(
      `GeckoTerminal returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

function wrapFetchError(error: unknown): never {
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    throw new RequestTimeoutError();
  }
  if (error instanceof TypeError) {
    throw new RequestTransportError(error.message);
  }
  throw error;
}

export async function fetchGeckoOhlcv(
  config: GeckoCollectorConfig,
  deps: GeckoFetchDeps
): Promise<GeckoOhlcvPayload> {
  await deps.waitForProviderPermit();

  const fetchImpl = deps.fetch ?? fetch;
  const signal = AbortSignal.timeout(config.geckoRequestTimeoutMs);
  let response: Response;

  try {
    response = await fetchImpl(buildGeckoUrl(config), {
      headers: { Accept: "application/json" },
      signal
    });
  } catch (error) {
    wrapFetchError(error);
  }

  if (!response.ok) {
    throw new HttpError({
      statusCode: response.status,
      responseBody: await readTextWithLimit(response).catch(() => undefined),
      retryable: isRetryableHttpStatus(response.status)
    });
  }

  return parseJson(response);
}
```

- [ ] **Step 4: Run Gecko client tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/geckoClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Gecko client**

Run:

```bash
git add src/workers/gecko/geckoClient.ts src/workers/gecko/__tests__/geckoClient.test.ts
git commit -m "feat: fetch Gecko OHLCV candles"
```

---

### Task 5: Regime Engine Ingest Client

**Files:**

- Create: `src/workers/gecko/ingestClient.ts`
- Test: `src/workers/gecko/__tests__/ingestClient.test.ts`

- [ ] **Step 1: Write failing ingest client tests**

Create `src/workers/gecko/__tests__/ingestClient.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Candle } from "../../../contract/v1/types.js";
import type { GeckoCollectorConfig } from "../config.js";
import { postCandles } from "../ingestClient.js";
import { HttpError, ProtocolError } from "../retry.js";

const config: GeckoCollectorConfig = {
  regimeEngineUrl: new URL("https://regime-engine.example/base"),
  candlesIngestToken: "secret-token",
  geckoSource: "geckoterminal",
  geckoNetwork: "solana",
  geckoPoolAddress: "pool",
  geckoSymbol: "SOL/USDC",
  geckoTimeframe: "1h",
  geckoLookback: 200,
  geckoPollIntervalMs: 300_000,
  geckoMaxCallsPerMinute: 6,
  geckoRequestTimeoutMs: 10_000
};

const candles: Candle[] = [
  { unixMs: 3_600_000, open: 100, high: 110, low: 90, close: 105, volume: 1 }
];

const responseBody = {
  schemaVersion: "1.0",
  insertedCount: 1,
  revisedCount: 0,
  idempotentCount: 0,
  rejectedCount: 0,
  rejections: []
};

describe("postCandles", () => {
  it("posts CandleIngestRequest with token header", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(responseBody), { status: 200 })
    );

    const result = await postCandles(config, candles, "2026-05-01T00:00:00.000Z", {
      fetch: fetchMock
    });

    expect(result.insertedCount).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://regime-engine.example/v1/candles");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      "X-Candles-Ingest-Token": "secret-token"
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      schemaVersion: "1.0",
      source: "geckoterminal",
      network: "solana",
      poolAddress: "pool",
      symbol: "SOL/USDC",
      timeframe: "1h",
      sourceRecordedAtIso: "2026-05-01T00:00:00.000Z",
      candles
    });
  });

  it("treats 200 with rejectedCount as success", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...responseBody,
            insertedCount: 0,
            rejectedCount: 1,
            rejections: [
              {
                unixMs: 3_600_000,
                reason: "STALE_REVISION",
                existingSourceRecordedAtIso: "2026-05-01T01:00:00.000Z"
              }
            ]
          }),
          { status: 200 }
        )
    );

    await expect(
      postCandles(config, candles, "2026-05-01T00:00:00.000Z", {
        fetch: fetchMock
      })
    ).resolves.toMatchObject({ rejectedCount: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws retryable HttpError for 429 and 5xx", async () => {
    for (const status of [429, 502]) {
      const fetchMock = vi.fn(async () => new Response("error", { status }));
      await expect(
        postCandles(config, candles, "2026-05-01T00:00:00.000Z", {
          fetch: fetchMock
        })
      ).rejects.toMatchObject({ statusCode: status, retryable: true });
    }
  });

  it("throws non-retryable HttpError for non-429 4xx", async () => {
    const fetchMock = vi.fn(async () => new Response("bad token", { status: 401 }));
    await expect(
      postCandles(config, candles, "2026-05-01T00:00:00.000Z", {
        fetch: fetchMock
      })
    ).rejects.toMatchObject({ statusCode: 401, retryable: false });
  });

  it("throws ProtocolError for invalid response shape", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ...responseBody, schemaVersion: "2.0" }), { status: 200 })
    );
    await expect(
      postCandles(config, candles, "2026-05-01T00:00:00.000Z", {
        fetch: fetchMock
      })
    ).rejects.toBeInstanceOf(ProtocolError);
  });

  it("throws ProtocolError when count fields are not non-negative integers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ...responseBody, insertedCount: -1 }), {
          status: 200
        })
    );
    await expect(
      postCandles(config, candles, "2026-05-01T00:00:00.000Z", {
        fetch: fetchMock
      })
    ).rejects.toBeInstanceOf(ProtocolError);
  });

  it("throws ProtocolError for oversized 2xx response bodies", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(512 * 1024 + 1) }
        })
    );

    await expect(
      postCandles(config, candles, "2026-05-01T00:00:00.000Z", {
        fetch: fetchMock
      })
    ).rejects.toBeInstanceOf(ProtocolError);
  });
});
```

- [ ] **Step 2: Run failing ingest client tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/ingestClient.test.ts
```

Expected: FAIL because `src/workers/gecko/ingestClient.ts` does not exist.

- [ ] **Step 3: Implement ingest client**

Create `src/workers/gecko/ingestClient.ts` with strict response validation and no token logging:

```ts
import { SCHEMA_VERSION, type Candle, type CandleIngestResponse } from "../../contract/v1/types.js";
import type { GeckoCollectorConfig } from "./config.js";
import {
  HttpError,
  ProtocolError,
  RequestTimeoutError,
  RequestTransportError,
  isRetryableHttpStatus
} from "./retry.js";

export type IngestClientDeps = {
  fetch?: typeof fetch;
};

const nonNegativeInteger = (value: unknown): value is number => {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
};

const MAX_RESPONSE_BYTES = 512 * 1024;

const readTextWithLimit = async (response: Response): Promise<string> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new ProtocolError("Response body exceeds 512 KiB limit");
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ProtocolError("Response body exceeds 512 KiB limit");
  }
  return text;
};

const validateResponse = (body: unknown): CandleIngestResponse => {
  if (typeof body !== "object" || body === null) {
    throw new ProtocolError("Invalid /v1/candles response object");
  }
  const record = body as Record<string, unknown>;
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new ProtocolError("Invalid /v1/candles response schemaVersion");
  }
  for (const field of ["insertedCount", "revisedCount", "idempotentCount", "rejectedCount"]) {
    if (!nonNegativeInteger(record[field])) {
      throw new ProtocolError(`Invalid /v1/candles response ${field}`);
    }
  }
  if (!Array.isArray(record.rejections)) {
    throw new ProtocolError("Invalid /v1/candles response rejections");
  }
  for (const rejection of record.rejections) {
    if (
      typeof rejection !== "object" ||
      rejection === null ||
      !Number.isInteger((rejection as Record<string, unknown>).unixMs) ||
      (rejection as Record<string, unknown>).reason !== "STALE_REVISION" ||
      typeof (rejection as Record<string, unknown>).existingSourceRecordedAtIso !== "string"
    ) {
      throw new ProtocolError("Invalid /v1/candles rejection shape");
    }
  }
  return body as CandleIngestResponse;
};

function wrapFetchError(error: unknown): never {
  if (
    error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  ) {
    throw new RequestTimeoutError();
  }
  if (error instanceof TypeError) {
    throw new RequestTransportError(error.message);
  }
  throw error;
}

export async function postCandles(
  config: GeckoCollectorConfig,
  candles: Candle[],
  sourceRecordedAtIso: string,
  deps: IngestClientDeps = {}
): Promise<CandleIngestResponse> {
  const url = new URL("/v1/candles", config.regimeEngineUrl);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    source: config.geckoSource,
    network: config.geckoNetwork,
    poolAddress: config.geckoPoolAddress,
    symbol: config.geckoSymbol,
    timeframe: config.geckoTimeframe,
    sourceRecordedAtIso,
    candles
  };
  const signal = AbortSignal.timeout(config.geckoRequestTimeoutMs);

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Candles-Ingest-Token": config.candlesIngestToken
      },
      body: JSON.stringify(payload),
      signal
    });
  } catch (error) {
    wrapFetchError(error);
  }

  if (!response.ok) {
    throw new HttpError({
      statusCode: response.status,
      retryable: isRetryableHttpStatus(response.status)
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(await readTextWithLimit(response));
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(
      `/v1/candles returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return validateResponse(body);
}
```

- [ ] **Step 4: Run ingest client tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__/ingestClient.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit ingest client**

Run:

```bash
git add src/workers/gecko/ingestClient.ts src/workers/gecko/__tests__/ingestClient.test.ts
git commit -m "feat: post Gecko candles to regime engine"
```

---

### Task 6: Collector Loop And ESM Entrypoint Guard

**Files:**

- Create: `src/workers/geckoCollector.ts`
- Test: `src/workers/__tests__/geckoCollector.test.ts`

- [ ] **Step 1: Write failing collector loop tests**

Create `src/workers/__tests__/geckoCollector.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { GeckoCollectorConfig } from "../gecko/config.js";
import { isMainModule, runOneCycle } from "../geckoCollector.js";

const config: GeckoCollectorConfig = {
  regimeEngineUrl: new URL("https://regime-engine.example"),
  candlesIngestToken: "secret",
  geckoSource: "geckoterminal",
  geckoNetwork: "solana",
  geckoPoolAddress: "pool",
  geckoSymbol: "SOL/USDC",
  geckoTimeframe: "1h",
  geckoLookback: 1,
  geckoPollIntervalMs: 300_000,
  geckoMaxCallsPerMinute: 6,
  geckoRequestTimeoutMs: 10_000
};

const payload = { data: { attributes: { ohlcv_list: [[3600, 100, 110, 90, 105, 1]] } } };

describe("isMainModule", () => {
  it("returns false for imported modules", () => {
    expect(isMainModule("file:///repo/src/workers/geckoCollector.ts", "/repo/src/other.ts")).toBe(
      false
    );
  });
});

describe("runOneCycle", () => {
  it("fetches, normalizes, and posts using one sourceRecordedAtIso", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const postCandles = vi.fn(async () => ({
      schemaVersion: "1.0" as const,
      insertedCount: 1,
      revisedCount: 0,
      idempotentCount: 0,
      rejectedCount: 0,
      rejections: []
    }));
    await runOneCycle(config, {
      fetchGeckoOhlcv: vi.fn(async () => payload),
      postCandles,
      logger,
      nowIso: () => "2026-05-01T00:00:00.000Z",
      shouldContinue: () => true
    });

    expect(postCandles).toHaveBeenCalledWith(
      config,
      [{ unixMs: 3_600_000, open: 100, high: 110, low: 90, close: 105, volume: 1 }],
      "2026-05-01T00:00:00.000Z",
      expect.any(Object)
    );
    expect(logger.info).toHaveBeenCalledWith("gecko_fetch_succeeded", expect.any(Object));
    expect(logger.info).toHaveBeenCalledWith("gecko_ingest_succeeded", expect.any(Object));
    expect(logger.info).toHaveBeenCalledWith("gecko_cycle_completed", expect.any(Object));
  });

  it("skips ingest when shutdown is requested after fetch", async () => {
    const postCandles = vi.fn();
    let calls = 0;
    await runOneCycle(config, {
      fetchGeckoOhlcv: vi.fn(async () => payload),
      postCandles,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      nowIso: () => "2026-05-01T00:00:00.000Z",
      shouldContinue: () => {
        calls += 1;
        return calls === 1;
      }
    });

    expect(postCandles).not.toHaveBeenCalled();
  });

  it("logs and skips ingest when zero valid candles block posting", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const rows = Array.from({ length: 20 }, (_, index) => [1 + index, 100, 110, 90, 105, 1]);
    await runOneCycle(config, {
      fetchGeckoOhlcv: vi.fn(async () => ({ data: { attributes: { ohlcv_list: rows } } })),
      postCandles: vi.fn(),
      logger,
      nowIso: () => "2026-05-01T00:00:00.000Z",
      shouldContinue: () => true
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "gecko_corruption_guard_blocked",
      expect.objectContaining({ validCount: 0, guardReason: "zero_valid" })
    );
  });

  it("completes in-flight ingest when shutdown is requested during ingest", async () => {
    let ingestStarted = false;
    const postCandles = vi.fn(async () => {
      ingestStarted = true;
      return {
        schemaVersion: "1.0" as const,
        insertedCount: 1,
        revisedCount: 0,
        idempotentCount: 0,
        rejectedCount: 0,
        rejections: []
      };
    });

    await runOneCycle(config, {
      fetchGeckoOhlcv: vi.fn(async () => payload),
      postCandles,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      nowIso: () => "2026-05-01T00:00:00.000Z",
      shouldContinue: () => !ingestStarted
    });

    expect(postCandles).toHaveBeenCalledTimes(1);
  });

  it("logs ingest failures before rethrowing", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    await expect(
      runOneCycle(config, {
        fetchGeckoOhlcv: vi.fn(async () => payload),
        postCandles: vi.fn(async () => {
          throw new Error("ingest failed");
        }),
        logger,
        nowIso: () => "2026-05-01T00:00:00.000Z",
        shouldContinue: () => true
      })
    ).rejects.toThrow("ingest failed");

    expect(logger.error).toHaveBeenCalledWith(
      "gecko_ingest_failed",
      expect.objectContaining({ errorName: "Error" })
    );
  });
});
```

- [ ] **Step 2: Run failing collector tests**

Run:

```bash
pnpm exec vitest run src/workers/__tests__/geckoCollector.test.ts
```

Expected: FAIL because `src/workers/geckoCollector.ts` does not exist.

- [ ] **Step 3: Implement collector entrypoint**

Create `src/workers/geckoCollector.ts`:

```ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { parseGeckoCollectorConfig, type GeckoCollectorConfig } from "./gecko/config.js";
import { fetchGeckoOhlcv } from "./gecko/geckoClient.js";
import { postCandles } from "./gecko/ingestClient.js";
import { consoleLogger, type WorkerLogger } from "./gecko/logger.js";
import { normalizeGeckoOhlcv } from "./gecko/normalize.js";
import { createRateLimiter, HttpError, withRetry } from "./gecko/retry.js";

export type GeckoCollectorDeps = {
  fetchGeckoOhlcv?: typeof fetchGeckoOhlcv;
  postCandles?: typeof postCandles;
  logger?: WorkerLogger;
  nowIso?: () => string;
  jitterMs?: (attempt: number) => number;
  retrySignal?: AbortSignal;
  shouldContinue?: () => boolean;
  waitForProviderPermit?: () => Promise<void>;
};

const defaultJitterMs = () => Math.floor(Math.random() * 250);

const retryOptions = (
  shouldContinue: () => boolean,
  jitterMs: (attempt: number) => number,
  signal?: AbortSignal
) => ({
  maxAttempts: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30_000,
  jitterMs,
  sleep: (ms: number, options?: { signal?: AbortSignal }) => sleep(ms, undefined, options),
  signal,
  shouldContinue
});

export function isMainModule(importMetaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

const errorContext = (error: unknown): Record<string, string | number | boolean> => {
  const context: Record<string, string | number | boolean> = {
    errorName: error instanceof Error ? error.name : "UnknownError"
  };

  if (error instanceof HttpError) {
    context.statusCode = error.statusCode;
    context.retryable = error.retryable;
  }

  return context;
};

const guardReason = (
  stats: ReturnType<typeof normalizeGeckoOhlcv>["stats"],
  config: GeckoCollectorConfig
): "zero_valid" | "corruption_rate" | "low_valid_count" | null => {
  if (stats.validCount === 0) return "zero_valid";
  if (stats.providerRowCount > 0 && stats.corruptionDroppedCount / stats.providerRowCount > 0.1) {
    return "corruption_rate";
  }
  if (config.geckoLookback >= 50 && stats.validCount < 50) return "low_valid_count";
  return null;
};

export async function runOneCycle(
  config: GeckoCollectorConfig,
  deps: GeckoCollectorDeps = {}
): Promise<void> {
  const logger = deps.logger ?? consoleLogger;
  const shouldContinue = deps.shouldContinue ?? (() => true);
  const jitterMs = deps.jitterMs ?? defaultJitterMs;
  const fetchClient = deps.fetchGeckoOhlcv ?? fetchGeckoOhlcv;
  const ingestClient = deps.postCandles ?? postCandles;

  logger.info("gecko_cycle_started", {
    provider: config.geckoSource,
    network: config.geckoNetwork,
    poolAddress: config.geckoPoolAddress,
    symbol: config.geckoSymbol,
    timeframe: config.geckoTimeframe
  });

  let payload: Awaited<ReturnType<typeof fetchGeckoOhlcv>>;
  try {
    payload = await withRetry(
      () =>
        fetchClient(config, {
          waitForProviderPermit: deps.waitForProviderPermit ?? (async () => {})
        }),
      retryOptions(shouldContinue, jitterMs, deps.retrySignal)
    );
    logger.info("gecko_fetch_succeeded", {
      provider: config.geckoSource,
      network: config.geckoNetwork,
      poolAddress: config.geckoPoolAddress,
      symbol: config.geckoSymbol,
      timeframe: config.geckoTimeframe
    });
  } catch (error) {
    logger.error("gecko_fetch_failed", errorContext(error));
    throw error;
  }

  if (!shouldContinue()) return;

  const sourceRecordedAtIso = deps.nowIso?.() ?? new Date().toISOString();
  const normalized = normalizeGeckoOhlcv(payload, config);
  if (normalized.stats.totalDroppedCount > 0) {
    logger.warn("gecko_normalization_warn", normalized.stats);
  }

  if (!shouldContinue()) return;

  const blockedReason = guardReason(normalized.stats, config);
  if (blockedReason) {
    logger.warn("gecko_corruption_guard_blocked", {
      ...normalized.stats,
      guardReason: blockedReason
    });
    return;
  }

  let response: Awaited<ReturnType<typeof postCandles>>;
  try {
    response = await withRetry(
      () => ingestClient(config, normalized.validCandles, sourceRecordedAtIso),
      retryOptions(shouldContinue, jitterMs, deps.retrySignal)
    );
  } catch (error) {
    logger.error("gecko_ingest_failed", errorContext(error));
    throw error;
  }

  const ingestContext = {
    insertedCount: response.insertedCount,
    revisedCount: response.revisedCount,
    idempotentCount: response.idempotentCount,
    rejectedCount: response.rejectedCount,
    candleCountFetched: normalized.stats.providerRowCount,
    candleCountPosted: normalized.validCandles.length,
    sourceRecordedAtIso
  };

  if (response.rejectedCount > 0) {
    logger.warn("gecko_ingest_succeeded", ingestContext);
  } else {
    logger.info("gecko_ingest_succeeded", ingestContext);
  }

  logger.info("gecko_cycle_completed", ingestContext);
}

export async function runCollector(config = parseGeckoCollectorConfig()): Promise<void> {
  const shutdown = new AbortController();
  let shutdownRequested = false;
  const logger = consoleLogger;
  const waitForProviderPermit = createRateLimiter(config.geckoMaxCallsPerMinute);

  const requestShutdown = (signal: string) => {
    shutdownRequested = true;
    logger.info("gecko_collector_shutdown_requested", { signal });
    shutdown.abort();
  };

  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  process.once("SIGINT", () => requestShutdown("SIGINT"));

  logger.info("gecko_collector_started", {
    provider: config.geckoSource,
    network: config.geckoNetwork,
    poolAddress: config.geckoPoolAddress,
    symbol: config.geckoSymbol,
    timeframe: config.geckoTimeframe
  });

  while (!shutdownRequested) {
    try {
      await runOneCycle(config, {
        logger,
        waitForProviderPermit,
        jitterMs: defaultJitterMs,
        retrySignal: shutdown.signal,
        shouldContinue: () => !shutdownRequested
      });
    } catch (error) {
      logger.error("gecko_cycle_failed", errorContext(error));
    }

    if (shutdownRequested) break;
    try {
      await sleep(config.geckoPollIntervalMs, undefined, { signal: shutdown.signal });
    } catch {
      break;
    }
  }

  logger.info("gecko_collector_shutdown_complete");
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void runCollector().catch((error) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "gecko_collector_fatal",
        ...errorContext(error)
      })
    );
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run collector tests**

Run:

```bash
pnpm exec vitest run src/workers/__tests__/geckoCollector.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run all worker tests**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__ src/workers/__tests__
```

Expected: PASS.

- [ ] **Step 6: Commit collector loop**

Run:

```bash
git add src/workers/geckoCollector.ts src/workers/__tests__/geckoCollector.test.ts
git commit -m "feat: add Gecko collector loop"
```

---

### Task 7: Package Scripts, Env Example, And Deployment Docs

**Files:**

- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/runbooks/railway-deploy.md`
- Test: add package-script assertion to `src/workers/__tests__/geckoCollector.test.ts`

- [ ] **Step 1: Add package script assertion**

Append this test to `src/workers/__tests__/geckoCollector.test.ts`:

```ts
import { readFileSync } from "node:fs";

describe("package scripts", () => {
  it("points start scripts at dist/src outputs", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.start).toContain("dist/src/server.js");
    expect(packageJson.scripts["dev:gecko"]).toContain("src/workers/geckoCollector.ts");
    expect(packageJson.scripts["start:gecko"]).toContain("dist/src/workers/geckoCollector.js");
  });
});
```

- [ ] **Step 2: Run failing package script assertion**

Run:

```bash
pnpm exec vitest run src/workers/__tests__/geckoCollector.test.ts
```

Expected: FAIL because `package.json` does not yet have the required scripts.

- [ ] **Step 3: Modify `package.json` scripts**

Update the `scripts` block so it includes these exact entries while preserving existing scripts:

```json
{
  "dev": "tsx watch src/server.ts",
  "start": "node --env-file-if-exists=.env dist/src/server.js",
  "dev:gecko": "tsx watch src/workers/geckoCollector.ts",
  "start:gecko": "node --env-file-if-exists=.env dist/src/workers/geckoCollector.js"
}
```

Do not remove existing `build`, `typecheck`, `lint`, `test`, `test:watch`, `test:pg`, `format`, `harness`, `db:migrate`, `db:generate`, `db:push`, or `prepare`.

- [ ] **Step 4: Add worker env vars to `.env.example`**

Append this block to `.env.example`:

```text
# GeckoTerminal candle collector worker
REGIME_ENGINE_URL=https://<regime-engine-service>
CANDLES_INGEST_TOKEN=
GECKO_SOURCE=geckoterminal
GECKO_NETWORK=solana
GECKO_POOL_ADDRESS=<confirm-before-production>
GECKO_SYMBOL=SOL/USDC
GECKO_TIMEFRAME=1h
GECKO_LOOKBACK=200
GECKO_POLL_INTERVAL_MS=300000
GECKO_MAX_CALLS_PER_MINUTE=6
GECKO_REQUEST_TIMEOUT_MS=10000
```

- [ ] **Step 5: Update README**

Add a `## GeckoTerminal candle collector` section after the endpoint list:

````md
## GeckoTerminal candle collector

The GeckoTerminal collector is a separate worker service from the same repo. It
does not start Fastify and does not write SQLite or Postgres directly. It fetches
the configured Solana SOL/USDC GeckoTerminal pool and posts normalized `1h`
candles to `POST /v1/candles` with `X-Candles-Ingest-Token`.

Local commands:

```bash
npm run dev:gecko
npm run start:gecko
```

Worker env vars:

| Variable                     | Default         | Notes                                                                     |
| ---------------------------- | --------------- | ------------------------------------------------------------------------- |
| `REGIME_ENGINE_URL`          | -               | Absolute URL for the regime-engine web service.                           |
| `CANDLES_INGEST_TOKEN`       | -               | Shared secret sent as `X-Candles-Ingest-Token`; never commit real values. |
| `GECKO_SOURCE`               | `geckoterminal` | Must equal `geckoterminal` for MVP.                                       |
| `GECKO_NETWORK`              | `solana`        | Must equal `solana` for MVP.                                              |
| `GECKO_POOL_ADDRESS`         | -               | Explicit GeckoTerminal SOL/USDC pool address. Confirm before production.  |
| `GECKO_SYMBOL`               | `SOL/USDC`      | Must equal `SOL/USDC` for MVP.                                            |
| `GECKO_TIMEFRAME`            | `1h`            | Must equal `1h` for MVP.                                                  |
| `GECKO_LOOKBACK`             | `200`           | Rolling candle window size.                                               |
| `GECKO_POLL_INTERVAL_MS`     | `300000`        | Sleep after each completed cycle.                                         |
| `GECKO_MAX_CALLS_PER_MINUTE` | `6`             | Provider-scoped GeckoTerminal call cap.                                   |
| `GECKO_REQUEST_TIMEOUT_MS`   | `10000`         | Per-request timeout for provider and ingest calls.                        |

Railway services from the same repo:

| Service                         | Build        | Start              |
| ------------------------------- | ------------ | ------------------ |
| `regime-engine-web`             | `pnpm build` | `pnpm start`       |
| `regime-engine-gecko-collector` | `pnpm build` | `pnpm start:gecko` |

Production setup and pool confirmation live in
`docs/runbooks/railway-deploy.md`.
````

- [ ] **Step 6: Update Railway runbook**

Add a section after the web service deployment env vars:

````md
## GeckoTerminal collector Railway service

Create a second service from the same repo:

| Setting       | Value                           |
| ------------- | ------------------------------- |
| Service name  | `regime-engine-gecko-collector` |
| Build command | `pnpm build`                    |
| Start command | `pnpm start:gecko`              |

Do not change `railway.toml` for the collector. The web service continues to use
`pnpm start`; the collector uses a Railway service start-command override.

Collector env vars:

| Variable                     | Value                                                 |
| ---------------------------- | ----------------------------------------------------- |
| `REGIME_ENGINE_URL`          | Railway private or public URL for `regime-engine-web` |
| `CANDLES_INGEST_TOKEN`       | same value as web service `CANDLES_INGEST_TOKEN`      |
| `GECKO_SOURCE`               | `geckoterminal`                                       |
| `GECKO_NETWORK`              | `solana`                                              |
| `GECKO_POOL_ADDRESS`         | confirmed GeckoTerminal SOL/USDC pool address         |
| `GECKO_SYMBOL`               | `SOL/USDC`                                            |
| `GECKO_TIMEFRAME`            | `1h`                                                  |
| `GECKO_LOOKBACK`             | `200`                                                 |
| `GECKO_POLL_INTERVAL_MS`     | `300000`                                              |
| `GECKO_MAX_CALLS_PER_MINUTE` | `6`                                                   |
| `GECKO_REQUEST_TIMEOUT_MS`   | `10000`                                               |

URL notes:

- Public `REGIME_ENGINE_URL` values must use HTTPS.
- Plain HTTP is accepted only for `localhost`, `127.0.0.1`, `::1`, or Railway
  private `*.railway.internal` hosts.
- The collector posts to `new URL("/v1/candles", REGIME_ENGINE_URL)`, which
  targets the origin root. Do not configure a base URL that relies on a path
  prefix.

Pool preflight:

```bash
curl -fsS "https://api.geckoterminal.com/api/v2/networks/solana/pools/$GECKO_POOL_ADDRESS/ohlcv/hour?aggregate=1&limit=1"
```

Before production:

- [ ] Confirm and record the canonical GeckoTerminal Solana SOL/USDC pool address.
- [ ] Confirm the collector can reach `REGIME_ENGINE_URL`.
- [ ] Confirm the web service and collector share the same `CANDLES_INGEST_TOKEN`.

Token management:

1. Generate a new `CANDLES_INGEST_TOKEN` in the password manager.
2. Update the web service token and collector service token in the same Railway
   maintenance window.
3. Restart the web service, then restart the collector service.
4. Confirm collector logs show successful ingest after rotation.
5. Treat suspected token exposure as a same-day rotation event.
````

- [ ] **Step 7: Run package/docs checks**

Run:

```bash
pnpm exec vitest run src/workers/__tests__/geckoCollector.test.ts
pnpm exec prettier --check package.json .env.example README.md docs/runbooks/railway-deploy.md
```

Expected: PASS.

- [ ] **Step 8: Commit scripts and docs**

Run:

```bash
git add package.json .env.example README.md docs/runbooks/railway-deploy.md src/workers/__tests__/geckoCollector.test.ts
git commit -m "docs: document Gecko collector deployment"
```

---

### Task 8: Full Validation Gate

**Files:**

- Validate all changed files.

- [ ] **Step 1: Run worker test suite**

Run:

```bash
pnpm exec vitest run src/workers/gecko/__tests__ src/workers/__tests__
```

Expected: PASS.

- [ ] **Step 2: Run full unit test suite**

Run:

```bash
pnpm run test
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript checks**

Run:

```bash
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
pnpm run lint
```

Expected: PASS with zero warnings.

- [ ] **Step 5: Run build**

Run:

```bash
pnpm run build
```

Expected: PASS and emits `dist/src/workers/geckoCollector.js`.

- [ ] **Step 6: Verify built worker path**

Run:

```bash
test -f dist/src/workers/geckoCollector.js
```

Expected: exit code 0.

- [ ] **Step 7: Run final quality gate**

Run:

```bash
pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run build
```

Expected: PASS.

- [ ] **Step 8: Confirm validation did not create accidental file changes**

Run:

```bash
git status --short
```

Expected: no output. If this shows changed files, inspect them and either commit intentional generated artifacts with a specific file list or remove accidental local artifacts before handing off.

---

## Self-Review Notes

Spec coverage:

- Worker entrypoint: Task 6.
- Config validation and defaults: Task 1.
- Gecko fetch URL, headers, HTTP error conversion, timeout wrapping: Task 4.
- Provider-scoped rate limiter created once and reused: Tasks 2 and 6.
- Retry/backoff with injectable jitter and non-retryable protocol/programmer errors: Task 2.
- Normalization, duplicate handling, and corruption guard: Task 3.
- Controlled skipped-ingest cycle: Tasks 3 and 6.
- Ingest POST payload, token header, strict response shape, stale revision warning semantics: Task 5.
- ESM import guard: Task 6.
- Secret redaction: Tasks 1 and 5.
- Scripts, `.env.example`, README, Railway runbook: Task 7.
- Quality gate: Task 8.

No implementation task imports or modifies Fastify app, route registration, ledger stores, candle writers, Postgres DB modules, or `railway.toml`.
