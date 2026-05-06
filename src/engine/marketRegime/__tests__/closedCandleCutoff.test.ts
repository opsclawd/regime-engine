import { describe, expect, it } from "vitest";
import { closedCandleCutoffUnixMs } from "../closedCandleCutoff.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

describe("closedCandleCutoffUnixMs", () => {
  it("returns the boundary one full bar before the just-closed bar", () => {
    const now = 13 * ONE_HOUR_MS + 30 * 60 * 1000;
    const cutoff = closedCandleCutoffUnixMs(now, ONE_HOUR_MS, FIVE_MIN_MS);
    expect(cutoff).toBe(12 * ONE_HOUR_MS);
  });

  it("does not promote the just-closed bar within the delay window", () => {
    const now = 13 * ONE_HOUR_MS + 3 * 60 * 1000;
    const cutoff = closedCandleCutoffUnixMs(now, ONE_HOUR_MS, FIVE_MIN_MS);
    expect(cutoff).toBe(11 * ONE_HOUR_MS);
  });

  it("promotes the just-closed bar once delay has elapsed", () => {
    const now = 13 * ONE_HOUR_MS + 6 * 60 * 1000;
    const cutoff = closedCandleCutoffUnixMs(now, ONE_HOUR_MS, FIVE_MIN_MS);
    expect(cutoff).toBe(12 * ONE_HOUR_MS);
  });

  it("aligns cutoff to 15m boundaries with 15m timeframeMs", () => {
    const now = 10 * FIFTEEN_MIN_MS + 7 * 60 * 1000;
    const cutoff = closedCandleCutoffUnixMs(now, FIFTEEN_MIN_MS, FIVE_MIN_MS);
    expect(cutoff).toBe(9 * FIFTEEN_MIN_MS);
  });

  it("does not promote the just-closed 15m bar within the delay window", () => {
    const now = 10 * FIFTEEN_MIN_MS + 2 * 60 * 1000;
    const cutoff = closedCandleCutoffUnixMs(now, FIFTEEN_MIN_MS, FIVE_MIN_MS);
    expect(cutoff).toBe(8 * FIFTEEN_MIN_MS);
  });
});
