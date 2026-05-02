import type { GeckoCollectorConfig } from "./config.js";
import { HttpError, RequestTimeoutError, RequestTransportError } from "./retry.js";
import { readTextWithLimit, parseJson, readErrorBody } from "./httpUtils.js";

export type GeckoClientDeps = {
  waitForProviderPermit?: () => Promise<void>;
  fetch?: typeof globalThis.fetch;
  AbortSignal?: typeof globalThis.AbortSignal;
};

function buildGeckoUrl(config: GeckoCollectorConfig): URL {
  const base = "https://api.geckoterminal.com";
  const path = `/api/v2/networks/${encodeURIComponent(config.geckoNetwork)}/pools/${encodeURIComponent(config.geckoPoolAddress)}/ohlcv/hour`;
  const url = new URL(path, base);
  url.searchParams.set("aggregate", "1");
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
  const signal = AbortSignalCtor.timeout(config.geckoRequestTimeoutMs);

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
