import { describe, expect, it } from "vitest";
import { closedCandleCutoffUnixMs } from "../closedCandleCutoff.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
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
});