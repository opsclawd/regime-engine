import { describe, it, expect, vi } from "vitest";
import {
  HttpError,
  ProtocolError,
  RequestTransportError,
  isRetryableHttpStatus,
  withRetry,
  createRateLimiter
} from "../retry.js";

describe("HttpError", () => {
  it("stores statusCode and responseBody", () => {
    const err = new HttpError(503, "Service Unavailable");
    expect(err.statusCode).toBe(503);
    expect(err.responseBody).toBe("Service Unavailable");
    expect(err.name).toBe("HttpError");
    expect(err.retryable).toBe(true);
  });

  it("allows explicit retryable override", () => {
    const err = new HttpError(429, "rate limited", false);
    expect(err.retryable).toBe(false);
  });
});

describe("isRetryableHttpStatus", () => {
  it("returns true for 429", () => {
    expect(isRetryableHttpStatus(429)).toBe(true);
  });

  it("returns true for 500-504", () => {
    expect(isRetryableHttpStatus(500)).toBe(true);
    expect(isRetryableHttpStatus(502)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(504)).toBe(true);
  });

  it("returns false for 4xx client errors", () => {
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(isRetryableHttpStatus(401)).toBe(false);
    expect(isRetryableHttpStatus(403)).toBe(false);
    expect(isRetryableHttpStatus(404)).toBe(false);
    expect(isRetryableHttpStatus(409)).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries with exponential backoff and jitter", async () => {
    const sleeps: number[] = [];
    const sleep = (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    };

    let attempt = 0;
    const operation = vi.fn(async () => {
      attempt++;
      if (attempt <= 2) throw new HttpError(503, "retry");
      return "ok";
    });

    const result = await withRetry(operation, { sleep });
    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBe(1000 + 10);
    expect(sleeps[1]).toBe(2000 + 20);
  });

  it("throws non-retryable HttpError on first attempt", async () => {
    const operation = vi.fn(async () => {
      throw new HttpError(404, "not found");
    });

    await expect(withRetry(operation)).rejects.toThrow("HTTP 404");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("throws ProtocolError on first attempt", async () => {
    const operation = vi.fn(async () => {
      throw new ProtocolError("bad envelope");
    });

    await expect(withRetry(operation)).rejects.toThrow("bad envelope");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("throws unclassified errors on first attempt", async () => {
    const operation = vi.fn(async () => {
      throw new TypeError("not a function");
    });

    await expect(withRetry(operation)).rejects.toThrow("not a function");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries transport errors", async () => {
    let attempt = 0;
    const operation = vi.fn(async () => {
      attempt++;
      if (attempt <= 2) throw new RequestTransportError("ECONNRESET");
      return "ok";
    });

    const result = await withRetry(operation, { sleep: () => Promise.resolve() });
    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("exits promptly when abort during sleep", async () => {
    const operation = vi.fn(async () => {
      throw new HttpError(503, "retry");
    });

    const sleep = vi.fn(async () => {
      throw new Error("aborted");
    });
    const controller = new AbortController();
    controller.abort();
    const signal = controller.signal;

    await expect(withRetry(operation, { sleep, signal })).rejects.toThrow("HTTP 503");
  });

  it("stops before another attempt when shouldContinue=false", async () => {
    let callCount = 0;
    const operation = vi.fn(async () => {
      callCount++;
      throw new HttpError(503, "retry");
    });

    const shouldContinue = () => callCount < 1;
    await expect(
      withRetry(operation, { shouldContinue, sleep: () => Promise.resolve() })
    ).rejects.toThrow("HTTP 503");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe("createRateLimiter", () => {
  it("first call is immediate, subsequent calls are spaced", async () => {
    let currentTime = 0;
    const now = () => currentTime;
    const sleeps: number[] = [];
    const sleep = (ms: number) => {
      sleeps.push(ms);
      currentTime += ms;
      return Promise.resolve();
    };

    const limiter = createRateLimiter(6, { sleep, now });
    await limiter.waitForPermit();
    expect(sleeps).toHaveLength(0);

    currentTime = 5000;
    await limiter.waitForPermit();
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBe(5000);
  });
});
