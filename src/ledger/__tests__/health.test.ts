import { describe, expect, it } from "vitest";
import { checkSqliteHealth, checkPgHealth } from "../health.js";
import type { LedgerStore } from "../store.js";
import type { Db } from "../pg/db.js";

describe("checkSqliteHealth", () => {
  it("returns ok when SELECT 1 succeeds", () => {
    const ledger: LedgerStore = {
      db: {
        prepare: () => ({ get: () => ({ count: 1 }) })
      } as never,
      path: ":memory:",
      close: () => {}
    };

    const result = checkSqliteHealth(ledger);
    expect(result).toEqual({ ok: true, status: "ok" });
  });

  it("returns unavailable when SELECT 1 throws", () => {
    const ledger: LedgerStore = {
      db: {
        prepare: () => {
          throw new Error("SQLITE_BUSY");
        }
      } as never,
      path: ":memory:",
      close: () => {}
    };

    const result = checkSqliteHealth(ledger);
    expect(result).toEqual({ ok: false, status: "unavailable" });
  });
});

describe("checkPgHealth", () => {
  it("returns not_configured when pg is null", async () => {
    const result = await checkPgHealth(null);
    expect(result).toEqual({ ok: true, status: "not_configured" });
  });

  it("returns ok when pg.execute succeeds", async () => {
    const mockDb = {
      execute: async () => [{}]
    } as unknown as Db;

    const result = await checkPgHealth(mockDb);
    expect(result).toEqual({ ok: true, status: "ok" });
  });

  it("returns unavailable when pg.execute rejects", async () => {
    const mockDb = {
      execute: async () => {
        throw new Error("connection refused");
      }
    } as unknown as Db;

    const result = await checkPgHealth(mockDb);
    expect(result).toEqual({ ok: false, status: "unavailable" });
  });
});
