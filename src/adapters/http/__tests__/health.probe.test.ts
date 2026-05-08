import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../../../app.js";
import { checkSqliteHealth } from "../../../ledger/health.js";

describe("GET /health - happy path", () => {
  afterEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.LEDGER_DB_PATH;
  });

  it("returns 200 with postgres=not_configured, sqlite=ok when no DATABASE_URL", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;

    const app = buildApp();

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      postgres: "not_configured",
      sqlite: "ok"
    });

    await app.close();
  });
});

describe("checkSqliteHealth — 503 branch coverage", () => {
  it("returns unavailable for a closed database", () => {
    const db = new DatabaseSync(":memory:");
    const store = {
      db,
      path: ":memory:",
      close: () => {
        db.close();
      }
    };

    const healthy = checkSqliteHealth(store as never);
    expect(healthy).toEqual({ ok: true, status: "ok" });

    db.close();
    const degraded = checkSqliteHealth(store as never);
    expect(degraded).toEqual({ ok: false, status: "unavailable" });
  });
});
