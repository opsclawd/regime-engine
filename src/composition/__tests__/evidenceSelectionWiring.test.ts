import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApplication } from "../buildApplication.js";
import { buildApp } from "../buildApp.js";
import { createLedgerStore } from "../../ledger/store.js";
import type { RuntimeStoreContext } from "../buildStoreContext.js";
import type { Db } from "../../ledger/pg/db.js";

describe("evidenceSelectionWiring", () => {
  let store: ReturnType<typeof createLedgerStore>;

  beforeEach(() => {
    store = createLedgerStore(":memory:");
  });

  afterEach(() => {
    store.close();
    vi.restoreAllMocks();
  });

  it("exposes null selection when PostgreSQL evidence storage is not configured", () => {
    const ctx: RuntimeStoreContext = {
      ledger: store,
      pg: null,
      candleStore: null,
      srThesesV2Store: null,
      close: async () => {}
    };

    const appDeps = buildApplication(ctx);

    expect(appDeps.selectEvidenceForSynthesis).toBeNull();
    expect(appDeps.ingestEvidenceBundle).toBeNull();
    expect(appDeps.getCurrentEvidence).toBeNull();
    expect(appDeps.getEvidenceHistory).toBeNull();

    expect(appDeps.getCurrentRegime).toBeDefined();
    expect(appDeps.generatePlan).toBeDefined();
    expect(appDeps.ingestCandles).toBeDefined();
  });

  it("exposes selection beside existing evidence use cases when PostgreSQL is configured", () => {
    const dbDouble = {} as unknown as Db;
    const ctx: RuntimeStoreContext = {
      ledger: store,
      pg: dbDouble,
      candleStore: null,
      srThesesV2Store: null,
      close: async () => {}
    };

    const appDeps = buildApplication(ctx);

    expect(appDeps.selectEvidenceForSynthesis).not.toBeNull();
    expect(appDeps.ingestEvidenceBundle).not.toBeNull();
    expect(appDeps.getCurrentEvidence).not.toBeNull();
    expect(appDeps.getEvidenceHistory).not.toBeNull();
  });

  it("does not wire selection into regime or plan generation", () => {
    const ctx: RuntimeStoreContext = {
      ledger: store,
      pg: null,
      candleStore: null,
      srThesesV2Store: null,
      close: async () => {}
    };

    const appDeps = buildApplication(ctx);

    expect(appDeps.selectEvidenceForSynthesis).toBeNull();
    expect(typeof appDeps.getCurrentRegime).toBe("function");
    expect(typeof appDeps.generatePlan).toBe("function");
  });

  it("does not register a selection HTTP route", async () => {
    vi.stubEnv("LEDGER_DB_PATH", ":memory:");
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const doc = response.json() as { paths?: Record<string, unknown> };
    const paths = Object.keys(doc.paths ?? {});

    for (const path of paths) {
      expect(path).not.toContain("selection");
      expect(path).not.toContain("synthesis");
    }

    await app.close();
  });
});
