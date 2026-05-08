import type { FastifyInstance, FastifyReply } from "fastify";
import { buildOpenApiDocument } from "../adapters/http/openapi.js";
import { createClmmExecutionResultHandler } from "./handlers/clmmExecutionResult.js";
import { createExecutionResultHandler } from "./handlers/executionResult.js";
import { createPlanHandler } from "./handlers/plan.js";
import { createWeeklyReportHandler } from "./handlers/report.js";
import { createCandlesIngestHandler } from "./handlers/candlesIngest.js";
import { createRegimeCurrentHandler } from "./handlers/regimeCurrent.js";
import { createSrLevelsIngestHandler } from "./handlers/srLevelsIngest.js";
import { createSrLevelsCurrentHandler } from "./handlers/srLevelsCurrent.js";
import { createInsightsIngestHandler } from "./handlers/insightsIngest.js";
import { createInsightsCurrentHandler } from "./handlers/insightsCurrent.js";
import { createInsightsHistoryHandler } from "./handlers/insightsHistory.js";
import { createSrLevelsV2IngestHandler } from "./handlers/srLevelsV2Ingest.js";
import { createSrLevelsV2CurrentHandler } from "./handlers/srLevelsV2Current.js";
import type { ClockPort } from "../application/ports/clock.js";
import type { GetCurrentRegimeUseCase } from "../application/use-cases/getCurrentRegimeUseCase.js";
import type { GeneratePlanUseCase } from "../application/use-cases/generatePlanUseCase.js";
import type { IngestCandlesUseCase } from "../application/use-cases/ingestCandlesUseCase.js";
import type { RecordExecutionResultUseCase } from "../application/use-cases/recordExecutionResultUseCase.js";
import type { RecordClmmExecutionResultUseCase } from "../application/use-cases/recordClmmExecutionResultUseCase.js";
import type { GetWeeklyReportUseCase } from "../application/use-cases/getWeeklyReportUseCase.js";
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

export interface HttpRouteDependencies {
  clock: ClockPort;
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

export const registerRoutes = (app: FastifyInstance, deps: HttpRouteDependencies): void => {
  app.get("/health", async (_req, reply: FastifyReply) => {
    const health = await deps.checkHealth();
    if (!health.ok) {
      reply.code(503);
    }
    return health;
  });

  app.get("/version", async () => {
    return deps.versionInfo;
  });

  app.get("/v1/openapi.json", async () => {
    return buildOpenApiDocument();
  });

  app.post("/v1/plan", createPlanHandler(deps.generatePlan));
  app.post("/v1/execution-result", createExecutionResultHandler(deps.recordExecutionResult));
  app.post(
    "/v1/clmm-execution-result",
    createClmmExecutionResultHandler(deps.recordClmmExecutionResult)
  );
  app.get("/v1/report/weekly", createWeeklyReportHandler(deps.getWeeklyReport));
  app.post("/v1/sr-levels", createSrLevelsIngestHandler(deps.ledgerStore));
  app.get("/v1/sr-levels/current", createSrLevelsCurrentHandler(deps.ledgerStore));
  app.post(
    "/v1/candles",
    createCandlesIngestHandler({ ingestCandles: deps.ingestCandles, clock: deps.clock })
  );
  app.get("/v1/regime/current", createRegimeCurrentHandler(deps.getCurrentRegime));
  app.post("/v1/insights/sol-usdc", createInsightsIngestHandler(deps.insightsStore));
  app.get("/v1/insights/sol-usdc/current", createInsightsCurrentHandler(deps.insightsStore));
  app.get("/v1/insights/sol-usdc/history", createInsightsHistoryHandler(deps.insightsStore));
  app.post("/v2/sr-levels", createSrLevelsV2IngestHandler(deps.srThesesV2Store));
  app.get("/v2/sr-levels/current", createSrLevelsV2CurrentHandler(deps.srThesesV2Store));
};
