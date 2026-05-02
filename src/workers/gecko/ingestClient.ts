import { SCHEMA_VERSION, type Candle, type CandleIngestResponse } from "../../contract/v1/types.js";
import type { GeckoCollectorConfig } from "./config.js";
import { HttpError, ProtocolError, RequestTimeoutError, RequestTransportError } from "./retry.js";

const MAX_BODY_BYTES = 512 * 1024;

export type IngestClientDeps = {
  fetch?: typeof globalThis.fetch;
  AbortSignal?: typeof globalThis.AbortSignal;
};

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validateResponse(data: unknown): CandleIngestResponse {
  if (data === null || typeof data !== "object") {
    throw new ProtocolError("Invalid ingest response: not an object");
  }

  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== SCHEMA_VERSION) {
    throw new ProtocolError(
      `Invalid ingest response schemaVersion: expected ${SCHEMA_VERSION}, got ${obj.schemaVersion}`
    );
  }

  if (!nonNegativeInteger(obj.insertedCount)) {
    throw new ProtocolError(
      "Invalid ingest response: insertedCount must be a non-negative integer"
    );
  }
  if (!nonNegativeInteger(obj.revisedCount)) {
    throw new ProtocolError("Invalid ingest response: revisedCount must be a non-negative integer");
  }
  if (!nonNegativeInteger(obj.idempotentCount)) {
    throw new ProtocolError(
      "Invalid ingest response: idempotentCount must be a non-negative integer"
    );
  }
  if (!nonNegativeInteger(obj.rejectedCount)) {
    throw new ProtocolError(
      "Invalid ingest response: rejectedCount must be a non-negative integer"
    );
  }

  if (!Array.isArray(obj.rejections)) {
    throw new ProtocolError("Invalid ingest response: rejections must be an array");
  }

  for (const rejection of obj.rejections) {
    if (rejection === null || typeof rejection !== "object") {
      throw new ProtocolError("Invalid ingest response: each rejection must be an object");
    }
    const r = rejection as Record<string, unknown>;
    if (typeof r.unixMs !== "number" || !Number.isInteger(r.unixMs)) {
      throw new ProtocolError("Invalid ingest response: rejection.unixMs must be an integer");
    }
    if (typeof r.reason !== "string") {
      throw new ProtocolError("Invalid ingest response: rejection.reason must be a string");
    }
    if (typeof r.existingSourceRecordedAtIso !== "string") {
      throw new ProtocolError(
        "Invalid ingest response: rejection.existingSourceRecordedAtIso must be a string"
      );
    }
  }

  return obj as unknown as CandleIngestResponse;
}

async function readTextWithLimit(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      throw new ProtocolError(
        `Response body exceeds ${MAX_BODY_BYTES} bytes (Content-Length: ${length})`
      );
    }
  }
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new ProtocolError(
      `Response body exceeds ${MAX_BODY_BYTES} bytes (actual: ${text.length})`
    );
  }
  return text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err: unknown) {
    throw new ProtocolError(
      `Invalid JSON from regime engine: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function postCandles(
  config: GeckoCollectorConfig,
  candles: Candle[],
  sourceRecordedAtIso: string,
  deps?: IngestClientDeps
): Promise<CandleIngestResponse> {
  const fetchFn = deps?.fetch ?? globalThis.fetch;
  const AbortSignalCtor = deps?.AbortSignal ?? globalThis.AbortSignal;

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

  const signal = AbortSignalCtor.timeout(config.geckoRequestTimeoutMs);

  let response: Response;
  try {
    response = await fetchFn(url.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Candles-Ingest-Token": config.candlesIngestToken
      },
      body: JSON.stringify(payload),
      signal
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new RequestTimeoutError(
        `Ingest request timed out after ${config.geckoRequestTimeoutMs}ms`
      );
    }
    if (err instanceof TypeError) {
      throw new RequestTransportError(`Ingest transport error: ${err.message}`);
    }
    throw err;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new HttpError(response.status, body);
  }

  const text = await readTextWithLimit(response);
  const data = parseJson(text);
  return validateResponse(data);
}
