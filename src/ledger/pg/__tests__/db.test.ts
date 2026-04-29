import { describe, expect, it } from "vitest";
import { createDb, verifyPgSchema, type Db } from "../db.js";

describe("createDb", () => {
  it("exports Db type and createDb function", () => {
    expect(typeof createDb).toBe("function");
    const dbType: Db = {} as Db;
    expect(dbType).toBeDefined();
  });
});

describe("verifyPgSchema", () => {
  it("throws with descriptive error when schema not found", async () => {
    const mockDb = {
      execute: async () => []
    } as never;

    await expect(verifyPgSchema(mockDb)).rejects.toThrow(
      "FATAL: regime_engine schema not found in Postgres"
    );
  });

  it("resolves without error when schema exists", async () => {
    const mockDb = {
      execute: async () => [{ nspname: "regime_engine" }]
    } as never;

    await expect(verifyPgSchema(mockDb)).resolves.toBeUndefined();
  });
});