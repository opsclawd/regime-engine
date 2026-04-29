import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "../routes.js";

describe("GET /health - SQLite branches", () => {
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

  it("returns 503 with sqlite=unavailable when SQLite probe fails", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;

    app = Fastify({ logger: false });
    const storeContext = registerRoutes(app);

    if (storeContext) {
      storeContext.ledger.close();
    } else {
      return;
    }

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
    const body = response.json();
    expect(body.ok).toBe(false);
    expect(body.sqlite).toBe("unavailable");
  });
});