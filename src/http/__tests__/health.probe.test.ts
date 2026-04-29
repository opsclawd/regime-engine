import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { DatabaseSync } from "node:sqlite";
import { registerRoutes } from "../routes.js";
import { checkSqliteHealth } from "../../ledger/health.js";

describe("GET /health - happy path", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    delete process.env.DATABASE_URL;
    delete process.env.LEDGER_DB_PATH;
  });

  it("returns 200 with postgres=not_configured, sqlite=ok when no DATABASE_URL", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;

    app = Fastify({ logger: false });
    registerRoutes(app);

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      postgres: "not_configured",
      sqlite: "ok"
    });
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
