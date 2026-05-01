import { describe, expect, it } from "vitest";
import { isTableMissingError } from "../pgErrors.js";

describe("isTableMissingError", () => {
  it("returns true for Postgres undefined_table error (42P01)", () => {
    const error = Object.assign(new Error('relation "sr_theses_v2" does not exist'), {
      code: "42P01"
    });
    expect(isTableMissingError(error)).toBe(true);
  });

  it("returns false for a standard Error without code", () => {
    const error = new Error("something went wrong");
    expect(isTableMissingError(error)).toBe(false);
  });

  it("returns false for a non-Error thrown value", () => {
    expect(isTableMissingError("string error")).toBe(false);
  });

  it("returns false for an Error with a different code", () => {
    const error = Object.assign(new Error("unique violation"), { code: "23505" });
    expect(isTableMissingError(error)).toBe(false);
  });
});
