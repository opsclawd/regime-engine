import { describe, expect, it } from "vitest";
import {
  verifyPgConnection,
  verifyCandleRevisionsTable,
  verifyClmmInsightsTable
} from "../ledger/pg/db.js";

describe("verifyPgConnection", () => {
  it("resolves without error when pg is reachable", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return;
    }

    const { createDb } = await import("../ledger/pg/db.js");
    const { db, client } = createDb(connectionString);

    await expect(verifyPgConnection(db)).resolves.toBeUndefined();

    await client.end();
  });

  it("throws when pg is unreachable", async () => {
    const { createDb } = await import("../ledger/pg/db.js");
    const { db, client } = createDb("postgres://invalid:invalid@localhost:9999/invalid");

    await expect(verifyPgConnection(db)).rejects.toThrow();

    try {
      await client.end();
    } catch {
      // connection may already be dead
    }
  });
});

describe("verifyCandleRevisionsTable", () => {
  it("resolves when the table exists in regime_engine schema", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return;
    }

    const { createDb } = await import("../ledger/pg/db.js");
    const { db, client } = createDb(connectionString);

    await expect(verifyCandleRevisionsTable(db)).resolves.toBeUndefined();

    await client.end();
  });
});

describe("verifyClmmInsightsTable", () => {
  it("resolves when the table exists in regime_engine schema", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      return;
    }

    const { createDb } = await import("../ledger/pg/db.js");
    const { db, client } = createDb(connectionString);

    await expect(verifyClmmInsightsTable(db)).resolves.toBeUndefined();

    await client.end();
  });
});
