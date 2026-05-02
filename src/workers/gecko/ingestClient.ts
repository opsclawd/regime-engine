import { SCHEMA_VERSION, type Candle, type CandleIngestResponse } from "../../contract/v1/types.js";
import type { GeckoCollectorConfig } from "./config.js";
import { HttpError, ProtocolError, RequestTimeoutError, RequestTransportError } from "./retry.js";
import { readTextWithLimit, parseJson, readErrorBody } from "./httpUtils.js";

export type IngestClientDeps = {
  fetch?: typeof globalThis.fetch;
  AbortSignal?: typeof globalThis.AbortSignal;
  shutdownSignal?: AbortSignal;
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

  const timeoutSignal = AbortSignalCtor.timeout(config.geckoRequestTimeoutMs);
  const signal = deps?.shutdownSignal
    ? AbortSignalCtor.any([timeoutSignal, deps.shutdownSignal])
    : timeoutSignal;

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
    const body = await readErrorBody(response);
    throw new HttpError(response.status, body);
  }

  const text = await readTextWithLimit(response);
  const data = parseJson(text, "regime engine");
  return validateResponse(data);
}
