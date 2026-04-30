import { describe, expect, it } from "vitest";
import { createSrLevelsV2IngestHandler } from "../srLevelsV2Ingest.js";

describe("createSrLevelsV2IngestHandler", () => {
  it("returns a request handler when the store is null", () => {
    const handler = createSrLevelsV2IngestHandler(null);
    expect(typeof handler).toBe("function");
  });
});
