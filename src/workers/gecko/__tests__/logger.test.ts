import { describe, it, expect } from "vitest";
import { redactLogContext } from "../logger.js";

describe("redactLogContext", () => {
  it("redacts top-level keys matching secret pattern", () => {
    const result = redactLogContext({
      token: "abc123",
      status: "ok"
    });
    expect(result).toEqual({
      token: "[REDACTED]",
      status: "ok"
    });
  });

  it("redacts nested keys matching secret pattern", () => {
    const result = redactLogContext({
      responseBody: { data: "sensitive" },
      metadata: { authorization: "Bearer xyz", count: 5 }
    });
    expect(result).toEqual({
      responseBody: "[REDACTED]",
      metadata: {
        authorization: "[REDACTED]",
        count: 5
      }
    });
  });

  it("does not redact keys that do not match", () => {
    const result = redactLogContext({
      candles: 42,
      network: "solana"
    });
    expect(result).toEqual({
      candles: 42,
      network: "solana"
    });
  });
});
