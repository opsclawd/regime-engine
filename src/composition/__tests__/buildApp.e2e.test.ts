import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../buildApp.js";

describe("buildApp composition", () => {
  afterEach(() => {
    delete process.env.LEDGER_DB_PATH;
    delete process.env.DATABASE_URL;
    delete process.env.COMMIT_SHA;
  });

  it("serves /health when DATABASE_URL is unset (SQLite-only fallback)", async () => {
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

  it("serves /version with name and version", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";

    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/version" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { name: string; version: string; commit?: string };
    expect(body.name).toBe("regime-engine");
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);

    await app.close();
  });

  it("includes commit on /version when COMMIT_SHA is set", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";
    process.env.COMMIT_SHA = "abcdef0";

    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/version" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ commit: "abcdef0" });

    await app.close();
  });

  it("serves /v1/openapi.json", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";

    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const doc = response.json() as { openapi: string; paths?: Record<string, unknown> };
    expect(doc.openapi).toMatch(/^3\./);

    const weeklySummary =
      (doc.paths?.["/v1/report/weekly"] as { get?: { summary?: string } })?.get?.summary ?? "";
    expect(weeklySummary).toMatch(/ledger/i);
    expect(weeklySummary).toMatch(/candle/i);

    await app.close();
  });

  it("closes the runtime store context once via onClose", async () => {
    process.env.LEDGER_DB_PATH = ":memory:";

    const app = buildApp();
    await app.close();

    await expect(app.inject({ method: "GET", url: "/health" })).rejects.toBeTruthy();
  });
});
