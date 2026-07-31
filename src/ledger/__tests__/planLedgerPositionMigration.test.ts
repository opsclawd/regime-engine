import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type PlanRequest, type PlanResponse } from "../../contract/v1/types.js";
import { planHashFromPlan } from "../../contract/v1/hash.js";
import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { createLedgerStore } from "../store.js";
import { writePlanLedgerEntry } from "../writer.js";

const makeFixture = (overrides?: {
  positionId?: string;
  walletId?: string;
  poolAddress?: string;
  asOfUnixMs?: number;
}) => {
  const asOfUnixMs = overrides?.asOfUnixMs ?? 1700000000000;
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
      walletId: overrides?.walletId ?? "wallet-1",
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
    planId: `plan-${asOfUnixMs}`,
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

describe("Plan Ledger Position Migration & Store", () => {
  const tempFiles: string[] = [];

  const getTempDbPath = () => {
    const p = join(tmpdir(), `test-ledger-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    tempFiles.push(p);
    return p;
  };

  afterEach(() => {
    for (const file of tempFiles) {
      try {
        rmSync(file, { force: true });
        rmSync(`${file}-wal`, { force: true });
        rmSync(`${file}-shm`, { force: true });
      } catch {
        // ignore cleanup error
      }
    }
    tempFiles.length = 0;
  });

  it("migrates an existing plan ledger and backfills position lookup columns from canonical request JSON", () => {
    const dbPath = getTempDbPath();

    // Construct legacy database with old schema
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec(`
      CREATE TABLE plan_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT NOT NULL,
        as_of_unix_ms INTEGER NOT NULL,
        request_hash TEXT NOT NULL,
        request_json TEXT NOT NULL,
        created_at_unix_ms INTEGER NOT NULL
      );
      CREATE TABLE plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plan_id TEXT NOT NULL,
        plan_hash TEXT NOT NULL,
        as_of_unix_ms INTEGER NOT NULL,
        plan_json TEXT NOT NULL,
        created_at_unix_ms INTEGER NOT NULL
      );
    `);

    const { planRequest, planResponse } = makeFixture({
      positionId: "legacy-pos-1",
      walletId: "legacy-wallet-1",
      poolAddress: "legacy-pool-1"
    });

    const canonicalReq = toCanonicalJson(planRequest);
    rawDb
      .prepare(
        `INSERT INTO plan_requests (plan_id, as_of_unix_ms, request_hash, request_json, created_at_unix_ms)
         VALUES (?, ?, 'hash', ?, ?)`
      )
      .run(planResponse.planId, planRequest.asOfUnixMs, canonicalReq, Date.now());
    rawDb.close();

    // Reopen through createLedgerStore
    const store = createLedgerStore(dbPath);

    try {
      const columns = store.db.prepare("PRAGMA table_info(plan_requests)").all() as Array<{
        name: string;
      }>;
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain("position_id");
      expect(colNames).toContain("wallet_id");
      expect(colNames).toContain("pool_address");

      const row = store.db
        .prepare("SELECT position_id, wallet_id, pool_address FROM plan_requests WHERE plan_id = ?")
        .get(planResponse.planId) as {
        position_id: string;
        wallet_id: string;
        pool_address: string;
      };

      expect(row.position_id).toBe("legacy-pos-1");
      expect(row.wallet_id).toBe("legacy-wallet-1");
      expect(row.pool_address).toBe("legacy-pool-1");

      const explain = store.db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT * FROM plan_requests WHERE position_id = ? AND wallet_id = ? AND pool_address = ? ORDER BY as_of_unix_ms DESC, id DESC"
        )
        .all();

      const explainText = JSON.stringify(explain);
      expect(explainText).toContain("idx_plan_requests_position_lookup");
    } finally {
      store.close();
    }
  });

  it("enables WAL for a file-backed ledger used by the HTTP process and worker", () => {
    const dbPath = getTempDbPath();
    const fileStore = createLedgerStore(dbPath);

    try {
      const modeRow = fileStore.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      expect(modeRow.journal_mode.toLowerCase()).toBe("wal");
    } finally {
      fileStore.close();
    }

    const memStore = createLedgerStore(":memory:");
    try {
      const memMode = memStore.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      expect(memMode.journal_mode.toLowerCase()).toBe("memory");
    } finally {
      memStore.close();
    }
  });

  it("writes denormalized position identity with the canonical request and plan in one transaction", () => {
    const store = createLedgerStore(":memory:");
    try {
      const { planRequest, planResponse } = makeFixture({
        positionId: "pos-atomic",
        walletId: "wallet-atomic",
        poolAddress: "pool-atomic"
      });

      writePlanLedgerEntry(store, { planRequest, planResponse });

      const reqRow = store.db
        .prepare("SELECT position_id, wallet_id, pool_address FROM plan_requests WHERE plan_id = ?")
        .get(planResponse.planId) as {
        position_id: string;
        wallet_id: string;
        pool_address: string;
      };

      expect(reqRow).toBeDefined();
      expect(reqRow.position_id).toBe("pos-atomic");
      expect(reqRow.wallet_id).toBe("wallet-atomic");
      expect(reqRow.pool_address).toBe("pool-atomic");

      const planRow = store.db
        .prepare("SELECT plan_id FROM plans WHERE plan_id = ?")
        .get(planResponse.planId);
      expect(planRow).toBeDefined();
    } finally {
      store.close();
    }
  });
});
