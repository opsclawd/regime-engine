export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly responseBody: string,
    public readonly retryable: boolean = isRetryableHttpStatus(statusCode)
  ) {
    super(`HTTP ${statusCode}`);
    this.name = "HttpError";
  }
}

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

export class RequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTimeoutError";
  }
}

export class RequestTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestTransportError";
  }
}

export function isRetryableHttpStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

function sleepWithAbortSignal(
  ms: number,
  signal: AbortSignal | undefined,
  fallbackSleep: (ms: number) => Promise<void>
): Promise<void> {
  if (!signal) return fallbackSleep(ms);
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export type RetryDeps = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  shouldContinue?: () => boolean;
  signal?: AbortSignal;
};

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  deps?: RetryDeps
): Promise<T> {
  const maxAttempts = 3;
  const initialBackoffMs = 1000;
  const maxBackoffMs = 30000;
  const jitterMs = (attempt: number): number => attempt * 10;

  const sleep = deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const shouldContinue = deps?.shouldContinue ?? (() => true);
  const signal = deps?.signal;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (err: unknown) {
      if (err instanceof ProtocolError) throw err;
      if (err instanceof HttpError && !err.retryable) throw err;
      if (
        !(err instanceof HttpError) &&
        !(err instanceof RequestTimeoutError) &&
        !(err instanceof RequestTransportError)
      ) {
        throw err;
      }

      if (attempt === maxAttempts) throw err;
      if (!shouldContinue()) throw err;

      const baseDelay = Math.min(initialBackoffMs * Math.pow(2, attempt - 1), maxBackoffMs);
      const delay = baseDelay + jitterMs(attempt);

      try {
        await sleepWithAbortSignal(delay, signal, sleep);
      } catch (sleepErr: unknown) {
        if (signal?.aborted) throw err;
        throw sleepErr;
      }
    }
  }

  throw new Error("withRetry: unreachable");
}

export type RateLimiter = {
  waitForPermit(): Promise<void>;
};

export function createRateLimiter(
  maxCallsPerMinute: number,
  deps?: { sleep?: (ms: number) => Promise<void>; now?: () => number }
): RateLimiter {
  const intervalMs = 60_000 / maxCallsPerMinute;
  const sleep = deps?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps?.now ?? (() => Date.now());
  let nextAllowedAt = 0;

  return {
    async waitForPermit() {
      const currentTime = now();
      if (currentTime < nextAllowedAt) {
        await sleep(nextAllowedAt - currentTime);
      }
      nextAllowedAt = Math.max(now(), nextAllowedAt) + intervalMs;
    }
  };
}
