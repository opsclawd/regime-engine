import { describe, expect, it } from "vitest";
import { computeFreshness } from "../freshness.js";

const ONE_MIN_MS = 60 * 1000;

const config = {
  softStaleMs: 75 * ONE_MIN_MS,
  hardStaleMs: 90 * ONE_MIN_MS,
  closedCandleDelayMs: 5 * ONE_MIN_MS
};

describe("computeFreshness", () => {
  it("returns fresh status when age is below softStaleMs", () => {
    const lastCandleUnixMs = 0;
    const now = 60 * ONE_MIN_MS;
    const result = computeFreshness(now, lastCandleUnixMs, config);
    expect(result.softStale).toBe(false);
    expect(result.hardStale).toBe(false);
    expect(result.ageSeconds).toBe(60 * 60);
    expect(result.lastCandleUnixMs).toBe(0);
  });

  it("flags softStale exactly at the softStaleMs threshold", () => {
    const lastCandleUnixMs = 0;
    const now = 75 * ONE_MIN_MS;
    const result = computeFreshness(now, lastCandleUnixMs, config);
    expect(result.softStale).toBe(true);
    expect(result.hardStale).toBe(false);
  });

  it("flags hardStale exactly at the hardStaleMs threshold", () => {
    const lastCandleUnixMs = 0;
    const now = 90 * ONE_MIN_MS;
    const result = computeFreshness(now, lastCandleUnixMs, config);
    expect(result.softStale).toBe(true);
    expect(result.hardStale).toBe(true);
  });

  it("includes ISO strings and configured thresholds in the response", () => {
    const lastCandleUnixMs = Date.parse("2026-04-26T12:00:00.000Z");
    const now = lastCandleUnixMs + 30 * ONE_MIN_MS;
    const result = computeFreshness(now, lastCandleUnixMs, config);
    expect(result.lastCandleIso).toBe("2026-04-26T12:00:00.000Z");
    expect(result.generatedAtIso).toBe(new Date(now).toISOString());
    expect(result.softStaleSeconds).toBe(75 * 60);
    expect(result.hardStaleSeconds).toBe(90 * 60);
  });
});