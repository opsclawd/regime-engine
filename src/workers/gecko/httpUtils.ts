import { ProtocolError } from "./retry.js";

const MAX_BODY_BYTES = 512 * 1024;

export async function readTextWithLimit(response: Response): Promise<string> {
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

export function parseJson(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err: unknown) {
    throw new ProtocolError(
      `Invalid JSON from ${source}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES) {
      return text.slice(0, 1024);
    }
    return text;
  } catch {
    return "";
  }
}
