import { describe, expect, it } from "vitest";
import { createDb, verifyPgSchema, verifyCandleRevisionsTable, type Db } from "../db.js";

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

describe("verifyCandleRevisionsTable", () => {
  it("throws with descriptive error when table not found", async () => {
    const mockDb = {
      execute: async () => []
    } as never;

    await expect(verifyCandleRevisionsTable(mockDb)).rejects.toThrow(
      "candle_revisions table not found in regime_engine schema"
    );
  });

  it("resolves without error when table exists", async () => {
    const mockDb = {
      execute: async () => [{ tablename: "candle_revisions" }]
    } as never;

    await expect(verifyCandleRevisionsTable(mockDb)).resolves.toBeUndefined();
  });
});