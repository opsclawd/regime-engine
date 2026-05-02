import { describe, it, expect, vi } from "vitest";
import { fetchGeckoOhlcv } from "../geckoClient.js";
import { HttpError, ProtocolError, RequestTimeoutError, RequestTransportError } from "../retry.js";
import type { GeckoCollectorConfig } from "../config.js";

const BASE_CONFIG: GeckoCollectorConfig = {
  regimeEngineUrl: new URL("https://regime-engine.example"),
  candlesIngestToken: "tok_abc123",
  geckoSource: "geckoterminal",
  geckoNetwork: "solana",
  geckoPoolAddress: "pool123",
  geckoSymbol: "SOL/USDC",
  geckoTimeframe: "1h",
  geckoLookback: 200,
  geckoPollIntervalMs: 300000,
  geckoMaxCallsPerMinute: 6,
  geckoRequestTimeoutMs: 10000
};

const VALID_RESPONSE = {
  data: {
    attributes: {
      ohlcv_list: [[1714536000, 100, 105, 98, 102, 1000]]
    }
  }
};

function mockFetch(response: Response | (() => Promise<Response>)): typeof globalThis.fetch {
  if (typeof response === "function") {
    return vi.fn(response);
  }
  return vi.fn(async () => response);
}

function jsonResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json", "content-length": String(text.length) }
  });
}

describe("fetchGeckoOhlcv", () => {
  it("builds encoded URL with network and poolAddress", async () => {
    const config = { ...BASE_CONFIG, geckoNetwork: "solana", geckoPoolAddress: "pool with spaces" };
    const fetch = mockFetch(jsonResponse(VALID_RESPONSE));
    await fetchGeckoOhlcv(config, { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("solana");
    expect(calledUrl).toContain("pool%20with%20spaces");
  });

  it("sends Accept header", async () => {
    const fetch = mockFetch(jsonResponse(VALID_RESPONSE));
    await fetchGeckoOhlcv(BASE_CONFIG, { fetch });
    const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(opts.headers).toEqual({ Accept: "application/json" });
  });

  it("returns 429 as retryable HttpError", async () => {
    const fetch = mockFetch(new Response("rate limited", { status: 429 }));
    await expect(fetchGeckoOhlcv(BASE_CONFIG, { fetch })).rejects.toThrow(HttpError);
    const err = (await fetchGeckoOhlcv(BASE_CONFIG, { fetch }).catch(
      (e: unknown) => e
    )) as HttpError;
    expect(err.retryable).toBe(true);
  });

  it("returns 503 as retryable HttpError", async () => {
    const fetch = mockFetch(new Response("unavailable", { status: 503 }));
    await expect(fetchGeckoOhlcv(BASE_CONFIG, { fetch })).rejects.toThrow(HttpError);
  });

  it("returns 404 as non-retryable HttpError", async () => {
    const fetch = mockFetch(new Response("not found", { status: 404 }));
    await expect(fetchGeckoOhlcv(BASE_CONFIG, { fetch })).rejects.toThrow(HttpError);
    const err = (await fetchGeckoOhlcv(BASE_CONFIG, { fetch }).catch(
      (e: unknown) => e
    )) as HttpError;
    expect(err.retryable).toBe(false);
  });

  it("throws ProtocolError for invalid JSON", async () => {
    const fetch = mockFetch(
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "8" }
      })
    );
    await expect(fetchGeckoOhlcv(BASE_CONFIG, { fetch })).rejects.toThrow(ProtocolError);
  });

  it("throws ProtocolError for oversized body via content-length", async () => {
    const fetch = mockFetch(
      new Response("", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "600000" }
      })
    );
    await expect(fetchGeckoOhlcv(BASE_CONFIG, { fetch })).rejects.toThrow(ProtocolError);
  });

  it("throws RequestTimeoutError on timeout", async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "TimeoutError");
    });
    await expect(fetchGeckoOhlcv(BASE_CONFIG, { fetch })).rejects.toThrow(RequestTimeoutError);
  });

  it("throws RequestTransportError on TypeError", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchGeckoOhlcv(BASE_CONFIG, { fetch })).rejects.toThrow(RequestTransportError);
  });
});
