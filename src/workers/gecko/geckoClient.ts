import type { GeckoCollectorConfig } from "./config.js";
import { HttpError, ProtocolError, RequestTimeoutError, RequestTransportError } from "./retry.js";
import { readTextWithLimit, parseJson, readErrorBody } from "./httpUtils.js";

export type GeckoClientDeps = {
  waitForProviderPermit?: () => Promise<void>;
  fetch?: typeof globalThis.fetch;
  AbortSignal?: typeof globalThis.AbortSignal;
  shutdownSignal?: AbortSignal;
};

const TIMEFRAME_TO_GECKO_PATH_PARAMS: Record<string, { path: string; aggregate: string }> = {
  "15m": { path: "minute", aggregate: "15" }
};

function buildGeckoUrl(config: GeckoCollectorConfig): URL {
  const params = TIMEFRAME_TO_GECKO_PATH_PARAMS[config.geckoTimeframe];
  if (!params) {
    throw new ProtocolError(
      `Unsupported geckoTimeframe for URL construction: ${config.geckoTimeframe}`
    );
  }
  const base = "https://api.geckoterminal.com";
  const path = `/api/v2/networks/${encodeURIComponent(config.geckoNetwork)}/pools/${encodeURIComponent(config.geckoPoolAddress)}/ohlcv/${params.path}`;
  const url = new URL(path, base);
  url.searchParams.set("aggregate", params.aggregate);
  url.searchParams.set("include_empty_intervals", "true");
  url.searchParams.set("limit", String(config.geckoLookback));
  return url;
}

export async function fetchGeckoOhlcv(
  config: GeckoCollectorConfig,
  deps?: GeckoClientDeps
): Promise<unknown> {
  const waitForPermit = deps?.waitForProviderPermit ?? (() => Promise.resolve());
  const fetchFn = deps?.fetch ?? globalThis.fetch;
  const AbortSignalCtor = deps?.AbortSignal ?? globalThis.AbortSignal;

  await waitForPermit();

  const url = buildGeckoUrl(config);
  const timeoutSignal = AbortSignalCtor.timeout(config.geckoRequestTimeoutMs);
  const signal = deps?.shutdownSignal
    ? AbortSignalCtor.any([timeoutSignal, deps.shutdownSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetchFn(url.href, {
      headers: { Accept: "application/json" },
      signal
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new RequestTimeoutError(
        `GeckoTerminal request timed out after ${config.geckoRequestTimeoutMs}ms`
      );
    }
    if (err instanceof TypeError) {
      throw new RequestTransportError(`GeckoTerminal transport error: ${err.message}`);
    }
    throw err;
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new HttpError(response.status, body);
  }

  const text = await readTextWithLimit(response);
  return parseJson(text, "GeckoTerminal");
}
