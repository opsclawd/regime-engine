import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type PlanRequest, type PlanResponse } from "../../../contract/v1/types.js";
import { planHashFromPlan } from "../../../contract/v1/hash.js";
import { createLedgerStore } from "../../../ledger/store.js";
import { writePlanLedgerEntry } from "../../../ledger/writer.js";
import { SqlitePlanLedgerReadAdapter } from "../sqlitePlanLedgerReadAdapter.js";

const makeFixture = (overrides?: {
  positionId?: string;
  walletId?: string;
  poolAddress?: string;
  asOfUnixMs?: number;
  planIdSuffix?: string;
}) => {
  const asOfUnixMs = overrides?.asOfUnixMs ?? 1700000000000;
  const suffix = overrides?.planIdSuffix ?? "";
  const planRequest: PlanRequest = {
    schemaVersion: SCHEMA_VERSION,
    asOfUnixMs,
    market: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: overrides?.poolAddress ?? "pool-1",
      timeframe: "15m"
    },
    position: {
      positionId: overrides?.positionId ?? "pos-1",
      ...(overrides?.walletId !== undefined ? { walletId: overrides.walletId } : {}),
      observedAtUnixMs: asOfUnixMs,
      lowerBoundPrice: 90,
      upperBoundPrice: 110,
      currentPrice: 100,
      rangeState: "in-range",
      breachQualified: false
    },
    portfolio: { navUsd: 10000, solUnits: 50, usdcUnits: 5000 },
    autopilotState: {
      activeClmm: true,
      stopouts24h: 0,
      redeploys24h: 0,
      cooldownUntilUnixMs: 0,
      standDownUntilUnixMs: 0,
      strikeCount: 0
    },
    config: {
      regime: {
        confirmBars: 2,
        minHoldBars: 3,
        enterUpTrend: 0.6,
        exitUpTrend: 0.4,
        enterDownTrend: -0.6,
        exitDownTrend: -0.4,
        chopVolRatioMax: 1.25
      },
      allocation: {
        upSolBps: 7500,
        downSolBps: 2000,
        chopSolBps: 5000,
        maxDeltaExposureBpsPerDay: 1500,
        maxTurnoverPerDayBps: 2000
      },
      churn: {
        maxStopouts24h: 2,
        maxRedeploys24h: 2,
        cooldownMsAfterStopout: 86400000,
        standDownTriggerStrikes: 2
      },
      baselines: {
        dcaIntervalDays: 7,
        dcaAmountUsd: 250,
        usdcCarryApr: 0.06
      }
    }
  };

  const basePlanResponse: Omit<PlanResponse, "planHash"> = {
    schemaVersion: SCHEMA_VERSION,
    planId: `plan-${asOfUnixMs}${suffix}`,
    asOfUnixMs,
    scope: {
      kind: "position",
      positionId: overrides?.positionId ?? "pos-1",
      poolAddress: overrides?.poolAddress ?? "pool-1",
      symbol: "SOL/USDC"
    },
    regime: "CHOP",
    targets: { solBps: 5000, usdcBps: 5000, allowClmm: true },
    actions: [{ type: "HOLD", reasonCode: "IN_RANGE" }],
    constraints: { cooldownUntilUnixMs: 0, standDownUntilUnixMs: 0, notes: [] },
    nextRegimeState: { current: "CHOP", barsInRegime: 5, pending: null, pendingBars: 0 },
    reasons: [{ code: "IN_RANGE", severity: "INFO", message: "In range" }],
    telemetry: { volRatio: 1.0 },
    marketData: {
      source: "geckoterminal",
      network: "solana",
      poolAddress: overrides?.poolAddress ?? "pool-1",
      requestedTimeframe: "15m",
      sourceTimeframe: "15m",
      candleCount: 100,
      sourceCandleCount: 100,
      freshness: {
        generatedAtIso: "2026-01-01T00:00:00.000Z",
        lastCandleOpenUnixMs: asOfUnixMs - 900000,
        lastCandleOpenIso: "2026-01-01T00:00:00.000Z",
        lastCandleCloseUnixMs: asOfUnixMs,
        lastCandleCloseIso: "2026-01-01T00:15:00.000Z",
        ageSeconds: 0,
        softStale: false,
        hardStale: false,
        softStaleSeconds: 300,
        hardStaleSeconds: 900
      }
    }
  };

  const planResponse: PlanResponse = {
    ...basePlanResponse,
    planHash: planHashFromPlan(basePlanResponse)
  };

  return { planRequest, planResponse };
};

describe("SqlitePlanLedgerReadAdapter", () => {
  it("returns the exact latest request and response for a matching wallet position and pool", async () => {
    const store = createLedgerStore(":memory:");
    try {
      const adapter = new SqlitePlanLedgerReadAdapter(store);

      const f1 = makeFixture({
        positionId: "pos-1",
        walletId: "w-1",
        poolAddress: "pool-1",
        asOfUnixMs: 1000,
        planIdSuffix: "-a"
      });
      const f2 = makeFixture({
        positionId: "pos-1",
        walletId: "w-1",
        poolAddress: "pool-1",
        asOfUnixMs: 2000,
        planIdSuffix: "-b"
      });
      const f3 = makeFixture({
        positionId: "pos-1",
        walletId: "w-1",
        poolAddress: "pool-1",
        asOfUnixMs: 2000,
        planIdSuffix: "-c"
      });

      writePlanLedgerEntry(store, f1);
      writePlanLedgerEntry(store, f2);
      writePlanLedgerEntry(store, f3);

      const latest = await adapter.getLatestPositionPlan({
        positionId: "pos-1",
        walletId: "w-1",
        poolAddress: "pool-1"
      });

      expect(latest).not.toBeNull();
      // f3 has asOfUnixMs 2000 and higher auto-increment ID than f2
      expect(latest?.planResponse.planId).toBe("plan-2000-c");
      expect(latest?.planRequest.position.positionId).toBe("pos-1");
    } finally {
      store.close();
    }
  });

  it("returns the exact historical plan selected by plan hash", async () => {
    const store = createLedgerStore(":memory:");
    try {
      const adapter = new SqlitePlanLedgerReadAdapter(store);

      const f1 = makeFixture({
        positionId: "pos-hash",
        walletId: "w-hash",
        poolAddress: "pool-hash",
        asOfUnixMs: 1000,
        planIdSuffix: "-old"
      });
      const f2 = makeFixture({
        positionId: "pos-hash",
        walletId: "w-hash",
        poolAddress: "pool-hash",
        asOfUnixMs: 2000,
        planIdSuffix: "-new"
      });

      writePlanLedgerEntry(store, f1);
      writePlanLedgerEntry(store, f2);

      const res = await adapter.getPositionPlanByHash(
        { positionId: "pos-hash", walletId: "w-hash", poolAddress: "pool-hash" },
        f1.planResponse.planHash
      );

      expect(res).not.toBeNull();
      expect(res?.planResponse.planId).toBe("plan-1000-old");
      expect(res?.planResponse.planHash).toBe(f1.planResponse.planHash);
    } finally {
      store.close();
    }
  });

  it("lists one latest wallet identified plan per position and pool for deployment reconciliation", async () => {
    const store = createLedgerStore(":memory:");
    try {
      const adapter = new SqlitePlanLedgerReadAdapter(store);

      // pos1 with wallet w1 (2 plans)
      const f1 = makeFixture({
        positionId: "pos-1",
        walletId: "w-1",
        poolAddress: "pool-1",
        asOfUnixMs: 1000
      });
      const f2 = makeFixture({
        positionId: "pos-1",
        walletId: "w-1",
        poolAddress: "pool-1",
        asOfUnixMs: 2000
      });
      // pos2 with wallet w2 (1 plan)
      const f3 = makeFixture({
        positionId: "pos-2",
        walletId: "w-2",
        poolAddress: "pool-2",
        asOfUnixMs: 1500
      });
      // pos3 without walletId (should NOT be returned in wallet-identified list)
      const f4 = makeFixture({ positionId: "pos-3", poolAddress: "pool-3", asOfUnixMs: 1800 });

      writePlanLedgerEntry(store, f1);
      writePlanLedgerEntry(store, f2);
      writePlanLedgerEntry(store, f3);
      writePlanLedgerEntry(store, f4);

      const list = await adapter.listLatestPositionPlans();
      expect(list).toHaveLength(2);

      const ids = list.map((item) => item.planResponse.planId);
      expect(ids).toContain("plan-2000");
      expect(ids).toContain("plan-1500");
      expect(ids).not.toContain("plan-1000");
      expect(ids).not.toContain("plan-1800");
    } finally {
      store.close();
    }
  });

  it("does not match a missing wallet or a different position or pool", async () => {
    const store = createLedgerStore(":memory:");
    try {
      const adapter = new SqlitePlanLedgerReadAdapter(store);

      const f1 = makeFixture({
        positionId: "pos-exact",
        walletId: "w-exact",
        poolAddress: "pool-exact",
        asOfUnixMs: 1000
      });
      writePlanLedgerEntry(store, f1);

      // Missing walletId in query scope
      const resMissingWallet = await adapter.getLatestPositionPlan({
        positionId: "pos-exact",
        poolAddress: "pool-exact"
      });
      expect(resMissingWallet).toBeNull();

      // Different walletId
      const resDiffWallet = await adapter.getLatestPositionPlan({
        positionId: "pos-exact",
        walletId: "w-other",
        poolAddress: "pool-exact"
      });
      expect(resDiffWallet).toBeNull();

      // Different positionId
      const resDiffPos = await adapter.getLatestPositionPlan({
        positionId: "pos-other",
        walletId: "w-exact",
        poolAddress: "pool-exact"
      });
      expect(resDiffPos).toBeNull();

      // Different poolAddress
      const resDiffPool = await adapter.getLatestPositionPlan({
        positionId: "pos-exact",
        walletId: "w-exact",
        poolAddress: "pool-other"
      });
      expect(resDiffPool).toBeNull();
    } finally {
      store.close();
    }
  });

  it("returns the latest position plan when walletId is null/undefined", async () => {
    const store = createLedgerStore(":memory:");
    try {
      const adapter = new SqlitePlanLedgerReadAdapter(store);

      const f1 = makeFixture({
        positionId: "pos-no-wallet",
        poolAddress: "pool-no-wallet",
        asOfUnixMs: 1000,
        planIdSuffix: "-old"
      });
      const f2 = makeFixture({
        positionId: "pos-no-wallet",
        poolAddress: "pool-no-wallet",
        asOfUnixMs: 2000,
        planIdSuffix: "-new"
      });

      writePlanLedgerEntry(store, f1);
      writePlanLedgerEntry(store, f2);

      const res = await adapter.getLatestPositionPlan({
        positionId: "pos-no-wallet",
        poolAddress: "pool-no-wallet"
      });

      expect(res).not.toBeNull();
      expect(res?.planResponse.planId).toBe("plan-2000-new");
      expect(res?.planRequest.position.walletId).toBeUndefined();
    } finally {
      store.close();
    }
  });

  it("uses optimal indexes for getPositionPlanByHash and listLatestPositionPlans", () => {
    const store = createLedgerStore(":memory:");
    try {
      const hashExplainPlan = store.db
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT pr.request_json, p.plan_json
           FROM plans p INDEXED BY idx_plans_plan_hash
           JOIN plan_requests pr ON pr.plan_id = p.plan_id
           WHERE p.plan_hash = ?
             AND pr.position_id = ?
             AND pr.wallet_id = ?
             AND pr.pool_address = ?
           ORDER BY pr.as_of_unix_ms DESC, pr.id DESC
           LIMIT 1`
        )
        .all();
      expect(JSON.stringify(hashExplainPlan)).toContain("idx_plans_plan_hash");

      const listExplainPlan = store.db
        .prepare(
          `EXPLAIN QUERY PLAN
           WITH RankedPlans AS (
             SELECT
               pr.request_json,
               p.plan_json,
               pr.as_of_unix_ms,
               pr.id,
               ROW_NUMBER() OVER (
                 PARTITION BY pr.wallet_id, pr.position_id, pr.pool_address
                 ORDER BY pr.as_of_unix_ms DESC, pr.id DESC
               ) AS rn
             FROM plan_requests pr
             JOIN plans p ON pr.plan_id = p.plan_id
             WHERE pr.wallet_id IS NOT NULL
           )
           SELECT request_json, plan_json
           FROM RankedPlans
           WHERE rn = 1
           ORDER BY as_of_unix_ms DESC, id DESC`
        )
        .all();
      expect(JSON.stringify(listExplainPlan)).toContain("idx_plan_requests_wallet_position_lookup");
    } finally {
      store.close();
    }
  });
});
