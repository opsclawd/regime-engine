import { describe, it, expect, vi } from "vitest";
import { postCandles } from "../ingestClient.js";
import { HttpError, ProtocolError, RequestTimeoutError, RequestTransportError } from "../retry.js";
import type { GeckoCollectorConfig } from "../config.js";
import { SCHEMA_VERSION } from "../../../contract/v1/types.js";

const BASE_CONFIG: GeckoCollectorConfig = {
  regimeEngineUrl: new URL("https://regime-engine.example/base"),
  candlesIngestToken: "tok_ingest_abc",
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

const VALID_CANDLES = [
  { unixMs: 1714536000000, open: 100, high: 105, low: 98, close: 102, volume: 1000 }
];

const VALID_RESPONSE = {
  schemaVersion: SCHEMA_VERSION,
  insertedCount: 1,
  revisedCount: 0,
  idempotentCount: 0,
  rejectedCount: 0,
  rejections: []
};

function jsonResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status,
    headers: { "content-type": "application/json", "content-length": String(text.length) }
  });
}

function mockFetch(response: Response | (() => Promise<Response>)): typeof globalThis.fetch {
  if (typeof response === "function") {
    return vi.fn(response);
  }
  return vi.fn(async () => response);
}

describe("postCandles", () => {
  it("POSTs with X-Candles-Ingest-Token header", async () => {
    const fetch = mockFetch(jsonResponse(VALID_RESPONSE));
    const result = await postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch });
    expect(result.insertedCount).toBe(1);

    const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-Candles-Ingest-Token"]).toBe("tok_ingest_abc");
  });

  it("treats rejectedCount > 0 as success", async () => {
    const response = {
      ...VALID_RESPONSE,
      rejectedCount: 2,
      rejections: [
        {
          unixMs: 1714536000000,
          reason: "STALE_REVISION",
          existingSourceRecordedAtIso: "2026-05-01T00:00:00Z"
        }
      ]
    };
    const fetch = mockFetch(jsonResponse(response));
    const result = await postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch });
    expect(result.rejectedCount).toBe(2);
  });

  it("returns 429 as retryable HttpError", async () => {
    const fetch = mockFetch(new Response("rate limited", { status: 429 }));
    await expect(
      postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch })
    ).rejects.toThrow(HttpError);
    const err = await postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", {
      fetch
    }).catch((e) => e);
    expect(err.retryable).toBe(true);
  });

  it("returns 502 as retryable HttpError", async () => {
    const fetch = mockFetch(new Response("bad gateway", { status: 502 }));
    await expect(
      postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch })
    ).rejects.toThrow(HttpError);
  });

  it("returns 401 as non-retryable HttpError", async () => {
    const fetch = mockFetch(new Response("unauthorized", { status: 401 }));
    await expect(
      postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch })
    ).rejects.toThrow(HttpError);
    const err = await postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", {
      fetch
    }).catch((e) => e);
    expect(err.retryable).toBe(false);
  });

  it("throws ProtocolError for wrong schemaVersion", async () => {
    const response = { ...VALID_RESPONSE, schemaVersion: "0.9" };
    const fetch = mockFetch(jsonResponse(response));
    await expect(
      postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch })
    ).rejects.toThrow(ProtocolError);
  });

  it("throws ProtocolError for negative count", async () => {
    const response = { ...VALID_RESPONSE, insertedCount: -1 };
    const fetch = mockFetch(jsonResponse(response));
    await expect(
      postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch })
    ).rejects.toThrow(ProtocolError);
  });

  it("throws ProtocolError for oversized body", async () => {
    const fetch = mockFetch(
      new Response("", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "600000" }
      })
    );
    await expect(
      postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch })
    ).rejects.toThrow(ProtocolError);
  });

  it("throws RequestTimeoutError on timeout", async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "TimeoutError");
    });
    await expect(
      postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch })
    ).rejects.toThrow(RequestTimeoutError);
  });

  it("throws RequestTransportError on TypeError", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      postCandles(BASE_CONFIG, VALID_CANDLES, "2026-05-01T00:00:00Z", { fetch })
    ).rejects.toThrow(RequestTransportError);
  });
});
