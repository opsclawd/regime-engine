import { describe, expect, it } from "vitest";
import { createSrLevelsV2CurrentHandler } from "../srLevelsV2Current.js";

describe("createSrLevelsV2CurrentHandler", () => {
  it("returns a request handler when the store is null", () => {
    const handler = createSrLevelsV2CurrentHandler(null);
    expect(typeof handler).toBe("function");
  });
});