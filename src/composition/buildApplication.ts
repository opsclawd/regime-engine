import type { ClockPort } from "../application/ports/clock.js";
import type { CandleReadPort, CandleWritePort } from "../application/ports/candlePorts.js";
import type { PlanLedgerWritePort } from "../application/ports/planLedgerPort.js";
import type {
  ClmmExecutionEventLedgerWritePort,
  ExecutionResultLedgerWritePort
} from "../application/ports/executionLedgerPort.js";
import type { WeeklyReportReadPort } from "../application/ports/weeklyReportReadPort.js";
import type { GetCurrentRegimeUseCase } from "../application/use-cases/getCurrentRegimeUseCase.js";
import type { GeneratePlanUseCase } from "../application/use-cases/generatePlanUseCase.js";
import type { IngestCandlesUseCase } from "../application/use-cases/ingestCandlesUseCase.js";
import type { RecordExecutionResultUseCase } from "../application/use-cases/recordExecutionResultUseCase.js";
import type { RecordClmmExecutionResultUseCase } from "../application/use-cases/recordClmmExecutionResultUseCase.js";
import type { GetWeeklyReportUseCase } from "../application/use-cases/getWeeklyReportUseCase.js";
import { createIngestCandlesUseCase } from "../application/use-cases/ingestCandlesUseCase.js";
import { createGetCurrentRegimeUseCase } from "../application/use-cases/getCurrentRegimeUseCase.js";
import { createGeneratePlanUseCase } from "../application/use-cases/generatePlanUseCase.js";
import { createRecordExecutionResultUseCase } from "../application/use-cases/recordExecutionResultUseCase.js";
import { createRecordClmmExecutionResultUseCase } from "../application/use-cases/recordClmmExecutionResultUseCase.js";
import { createGetWeeklyReportUseCase } from "../application/use-cases/getWeeklyReportUseCase.js";
import { createSqliteCandleReadAdapter } from "../adapters/sqlite/sqliteCandleReadAdapter.js";
import { createSqliteCandleRevisionUnitOfWork } from "../adapters/sqlite/sqliteCandleRevisionUnitOfWork.js";
import { createPostgresCandleReadAdapter } from "../adapters/postgres/postgresCandleReadAdapter.js";
import { createPostgresCandleRevisionUnitOfWork } from "../adapters/postgres/postgresCandleRevisionUnitOfWork.js";
import { createSqlitePlanLedgerWriteAdapter } from "../adapters/sqlite/sqlitePlanLedgerWriteAdapter.js";
import {
  createSqliteClmmExecutionEventLedgerWriteAdapter,
  createSqliteExecutionResultLedgerWriteAdapter
} from "../adapters/sqlite/sqliteExecutionLedgerAdapter.js";
import { createSqliteWeeklyReportReadAdapter } from "../adapters/sqlite/sqliteWeeklyReportReadAdapter.js";
import { checkPgHealth, checkSqliteHealth } from "../ledger/health.js";
import type { RuntimeStoreContext } from "./buildStoreContext.js";
import type { LedgerStore } from "../ledger/store.js";
import type { InsightsStore } from "../ledger/insightsStore.js";
import type { SrThesesV2Store } from "../ledger/srThesesV2Store.js";

export interface VersionInfo {
  name: string;
  version: string;
  commit?: string;
}

export interface HealthResult {
  ok: boolean;
  postgres: "ok" | "unavailable" | "not_configured";
  sqlite: "ok" | "unavailable";
}

export interface ApplicationDependencies {
  clock: ClockPort;
  candleReadPort: CandleReadPort;
  candleWritePort: CandleWritePort;
  planLedgerWritePort: PlanLedgerWritePort;
  executionResultLedgerWritePort: ExecutionResultLedgerWritePort;
  clmmExecutionEventLedgerWritePort: ClmmExecutionEventLedgerWritePort;
  weeklyReportReadPort: WeeklyReportReadPort;
  ingestCandles: IngestCandlesUseCase;
  getCurrentRegime: GetCurrentRegimeUseCase;
  generatePlan: GeneratePlanUseCase;
  recordExecutionResult: RecordExecutionResultUseCase;
  recordClmmExecutionResult: RecordClmmExecutionResultUseCase;
  getWeeklyReport: GetWeeklyReportUseCase;
  ledgerStore: LedgerStore;
  insightsStore: InsightsStore | null;
  srThesesV2Store: SrThesesV2Store | null;
  versionInfo: VersionInfo;
  checkHealth(): Promise<HealthResult>;
}

export const buildApplication = (ctx: RuntimeStoreContext): ApplicationDependencies => {
  const clock: ClockPort = { nowUnixMs: () => Date.now() };

  const candleReadPort: CandleReadPort = ctx.pg
    ? createPostgresCandleReadAdapter(ctx.pg)
    : createSqliteCandleReadAdapter(ctx.ledger);

  const candleWritePort: CandleWritePort = ctx.pg
    ? createPostgresCandleRevisionUnitOfWork(ctx.pg)
    : createSqliteCandleRevisionUnitOfWork(ctx.ledger);

  const planLedgerWritePort = createSqlitePlanLedgerWriteAdapter(ctx.ledger);
  const executionResultLedgerWritePort = createSqliteExecutionResultLedgerWriteAdapter(ctx.ledger);
  const clmmExecutionEventLedgerWritePort = createSqliteClmmExecutionEventLedgerWriteAdapter(
    ctx.ledger
  );
  const weeklyReportReadPort = createSqliteWeeklyReportReadAdapter(ctx.ledger);

  const ingestCandles = createIngestCandlesUseCase({ candleWritePort });
  const getCurrentRegime = createGetCurrentRegimeUseCase({
    candleReadPort,
    clock,
    engineVersion: process.env.npm_package_version ?? "0.0.0"
  });
  const engineVersion = process.env.npm_package_version ?? "0.0.0";
  const generatePlan = createGeneratePlanUseCase({
    candleReadPort,
    clock,
    engineVersion,
    planLedgerWritePort
  });
  const recordExecutionResult = createRecordExecutionResultUseCase({
    port: executionResultLedgerWritePort
  });
  const recordClmmExecutionResult = createRecordClmmExecutionResultUseCase({
    port: clmmExecutionEventLedgerWritePort
  });
  const getWeeklyReport = createGetWeeklyReportUseCase({ port: weeklyReportReadPort });

  const versionInfo: VersionInfo = {
    name: "regime-engine",
    version: process.env.npm_package_version ?? "0.1.0",
    ...(process.env.COMMIT_SHA ? { commit: process.env.COMMIT_SHA } : {})
  };

  return {
    clock,
    candleReadPort,
    candleWritePort,
    planLedgerWritePort,
    executionResultLedgerWritePort,
    clmmExecutionEventLedgerWritePort,
    weeklyReportReadPort,
    ingestCandles,
    getCurrentRegime,
    generatePlan,
    recordExecutionResult,
    recordClmmExecutionResult,
    getWeeklyReport,
    ledgerStore: ctx.ledger,
    insightsStore: ctx.insightsStore,
    srThesesV2Store: ctx.srThesesV2Store,
    versionInfo,
    checkHealth: async () => {
      const sqlite = checkSqliteHealth(ctx.ledger);
      const postgres = await checkPgHealth(ctx.pg);
      return {
        ok: sqlite.ok && postgres.ok,
        postgres: postgres.status,
        sqlite: sqlite.status
      };
    }
  };
};
