import { describe, expect, it } from "vitest";
import { verifyPgConnection } from "../ledger/pg/db.js";

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