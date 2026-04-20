import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

let app = buildApp();

afterEach(async () => {
  await app.close();
  app = buildApp();
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});

describe("GET /version", () => {
  it("returns service identity", async () => {
    const response = await app.inject({ method: "GET", url: "/version" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { name: string; version: string; commit?: string };
    expect(body.name).toBe("regime-engine");
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });

  it("includes commit SHA when COMMIT_SHA is set", async () => {
    const previous = process.env.COMMIT_SHA;
    process.env.COMMIT_SHA = "abcdef0";
    try {
      await app.close();
      app = buildApp();
      const response = await app.inject({ method: "GET", url: "/version" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ commit: "abcdef0" });
    } finally {
      if (previous === undefined) {
        delete process.env.COMMIT_SHA;
      } else {
        process.env.COMMIT_SHA = previous;
      }
    }
  });
});

describe("GET /v1/openapi.json", () => {
  it("advertises the documented public surface", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const doc = response.json() as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toMatch(/^3\./);
    const paths = Object.keys(doc.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/health",
        "/version",
        "/v1/plan",
        "/v1/execution-result",
        "/v1/clmm-execution-result",
        "/v1/report/weekly",
        "/v1/sr-levels",
        "/v1/sr-levels/current"
      ])
    );
  });
});

describe("server HOST handling", () => {
  it("boots when HOST is set to dual-stack '::'", async () => {
    const previous = process.env.HOST;
    process.env.HOST = "::";
    try {
      const fresh = buildApp();
      const response = await fresh.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
      await fresh.close();
    } finally {
      if (previous === undefined) {
        delete process.env.HOST;
      } else {
        process.env.HOST = previous;
      }
    }
  });
});
