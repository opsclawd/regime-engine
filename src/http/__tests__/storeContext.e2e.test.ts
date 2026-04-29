import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";

describe("StoreContext integration /health", () => {
  afterEach(() => {
    delete process.env.LEDGER_DB_PATH;
    delete process.env.DATABASE_URL;
  });

  it("/health returns ok with postgres=not_configured when DATABASE_URL is not set", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    delete process.env.DATABASE_URL;

    const app = buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { ok: boolean; postgres: string; sqlite: string };
    expect(body.ok).toBe(true);
    expect(body.postgres).toBe("not_configured");
    expect(body.sqlite).toBe("ok");

    await app.close();
  });
});
