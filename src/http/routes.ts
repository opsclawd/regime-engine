import type { FastifyInstance } from "fastify";
import { buildOpenApiDocument } from "./openapi.js";
import { createLedgerStore } from "../ledger/store.js";
import { createExecutionResultHandler } from "./handlers/executionResult.js";
import { createPlanHandler } from "./handlers/plan.js";
import { createWeeklyReportHandler } from "./handlers/report.js";

export const registerRoutes = (app: FastifyInstance): void => {
  const databasePath =
    process.env.LEDGER_DB_PATH ??
    (process.env.NODE_ENV === "test" ? ":memory:" : "tmp/ledger.sqlite");
  const ledgerStore = createLedgerStore(databasePath);

  app.addHook("onClose", async () => {
    ledgerStore.close();
  });

  app.get("/health", async () => {
    return { ok: true };
  });

  app.get("/version", async () => {
    const response: { name: string; version: string; commit?: string } = {
      name: "regime-engine",
      version: process.env.npm_package_version ?? "0.1.0"
    };

    if (process.env.COMMIT_SHA) {
      response.commit = process.env.COMMIT_SHA;
    }

    return response;
  });

  app.get("/v1/openapi.json", async () => {
    return buildOpenApiDocument();
  });

  app.post("/v1/plan", createPlanHandler(ledgerStore));
  app.post("/v1/execution-result", createExecutionResultHandler(ledgerStore));
  app.get("/v1/report/weekly", createWeeklyReportHandler(ledgerStore));
};
