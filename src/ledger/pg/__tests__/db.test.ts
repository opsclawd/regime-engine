import { describe, expect, it } from "vitest";
import { createDb, type Db } from "../db.js";

describe("createDb", () => {
  it("exports Db type and createDb function", () => {
    expect(typeof createDb).toBe("function");
    const dbType: Db = {} as Db;
    expect(dbType).toBeDefined();
  });
});