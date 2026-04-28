import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp } from "../app.js";
import {
  parseSrLevelBriefRequest,
  parseClmmExecutionEventRequest
} from "../contract/v1/validation.js";

let app = buildApp();

afterEach(async () => {
  await app.close();
  app = buildApp();
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      postgres: "not_configured",
      sqlite: "ok"
    });
  });
});

describe("GET /version", () => {
  it("returns service identity without commit when COMMIT_SHA unset", async () => {
    const previous = process.env.COMMIT_SHA;
    delete process.env.COMMIT_SHA;
    try {
      const fresh = buildApp();
      const response = await fresh.inject({ method: "GET", url: "/version" });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { name: string; version: string; commit?: string };
      expect(body.name).toBe("regime-engine");
      expect(typeof body.version).toBe("string");
      expect(body.version.length).toBeGreaterThan(0);
      expect(body).not.toHaveProperty("commit");
      await fresh.close();
    } finally {
      if (previous !== undefined) {
        process.env.COMMIT_SHA = previous;
      }
    }
  });

  it("includes commit SHA when COMMIT_SHA is set", async () => {
    const previous = process.env.COMMIT_SHA;
    process.env.COMMIT_SHA = "abcdef0";
    try {
      const fresh = buildApp();
      const response = await fresh.inject({ method: "GET", url: "/version" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ commit: "abcdef0" });
      await fresh.close();
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
    expect(paths).toHaveLength(11);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/health",
        "/version",
        "/v1/openapi.json",
        "/v1/plan",
        "/v1/execution-result",
        "/v1/clmm-execution-result",
        "/v1/report/weekly",
        "/v1/sr-levels",
        "/v1/sr-levels/current",
        "/v1/candles",
        "/v1/regime/current"
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

describe("fixture files validate against Zod schemas", () => {
  const fixturesDir = join(import.meta.dirname, "../../fixtures");

  it("sr-levels-brief.json parses through parseSrLevelBriefRequest", () => {
    const raw = JSON.parse(readFileSync(join(fixturesDir, "sr-levels-brief.json"), "utf8"));
    const result = parseSrLevelBriefRequest(raw);
    expect(result.source).toBe("mco");
    expect(result.levels).toHaveLength(4);
  });

  it("clmm-execution-event.json parses through parseClmmExecutionEventRequest", () => {
    const raw = JSON.parse(readFileSync(join(fixturesDir, "clmm-execution-event.json"), "utf8"));
    const result = parseClmmExecutionEventRequest(raw);
    expect(result.status).toBe("confirmed");
    expect(result.correlationId).toBe("runbook-attempt-2026-04-19-001");
  });
});
