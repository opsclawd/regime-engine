import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApplication } from "../buildApplication.js";
import { createLedgerStore } from "../../ledger/store.js";
import type { RuntimeStoreContext } from "../buildStoreContext.js";
import type { Db } from "../../ledger/pg/db.js";
import { verifyPolicyInsightsTable } from "../../ledger/pg/db.js";

describe("policyInsightWiring", () => {
  let store: ReturnType<typeof createLedgerStore>;

  beforeEach(() => {
    store = createLedgerStore(":memory:");
  });

  afterEach(() => {
    store.close();
    vi.restoreAllMocks();
  });

  it("wires policy insight capabilities only when postgres is configured", () => {
    // 1. Without Postgres
    const ctxNoPg: RuntimeStoreContext = {
      ledger: store,
      pg: null,
      candleStore: null,
      srThesesV2Store: null,
      close: async () => {}
    };

    const depsNoPg = buildApplication(ctxNoPg);
    expect(depsNoPg.synthesizePolicyInsight).toBeNull();
    expect(depsNoPg.getCurrentPolicyInsight).toBeNull();
    expect(depsNoPg.getPolicyInsightHistory).toBeNull();

    // 2. With Postgres
    const dbDouble = {} as unknown as Db;
    const ctxWithPg: RuntimeStoreContext = {
      ledger: store,
      pg: dbDouble,
      candleStore: null,
      srThesesV2Store: null,
      close: async () => {}
    };

    const depsWithPg = buildApplication(ctxWithPg);
    expect(depsWithPg.synthesizePolicyInsight).not.toBeNull();
    expect(depsWithPg.getCurrentPolicyInsight).not.toBeNull();
    expect(depsWithPg.getPolicyInsightHistory).not.toBeNull();
    expect(typeof depsWithPg.synthesizePolicyInsight).toBe("function");
    expect(typeof depsWithPg.getCurrentPolicyInsight).toBe("function");
    expect(typeof depsWithPg.getPolicyInsightHistory).toBe("function");
  });

  it("does not expose a legacy insightsStore in runtime composition", () => {
    const ctxNoPg: RuntimeStoreContext = {
      ledger: store,
      pg: null,
      candleStore: null,
      srThesesV2Store: null,
      close: async () => {}
    };
    const depsNoPg = buildApplication(ctxNoPg);

    const dbDouble = {} as unknown as Db;
    const ctxWithPg: RuntimeStoreContext = {
      ledger: store,
      pg: dbDouble,
      candleStore: null,
      srThesesV2Store: null,
      close: async () => {}
    };
    const depsWithPg = buildApplication(ctxWithPg);

    expect("insightsStore" in depsNoPg).toBe(false);
    expect("insightsStore" in depsWithPg).toBe(false);
  });

  it("fails startup verification when policy_insights is missing", async () => {
    const mockDb = {
      execute: async () => []
    } as unknown as Db;

    await expect(verifyPolicyInsightsTable(mockDb)).rejects.toThrow(
      "FATAL: policy_insights table not found in regime_engine schema — run migrations first"
    );
  });
});
