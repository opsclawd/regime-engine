import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm/sql";
import { buildOpenApiDocument } from "./openapi.js";
import { closeStoreContext, createStoreContext, type StoreContext } from "../ledger/storeContext.js";
import { createLedgerStore } from "../ledger/store.js";
import { createClmmExecutionResultHandler } from "./handlers/clmmExecutionResult.js";
import { createExecutionResultHandler } from "./handlers/executionResult.js";
import { createPlanHandler } from "./handlers/plan.js";
import { createWeeklyReportHandler } from "./handlers/report.js";
import { createCandlesIngestHandler } from "./handlers/candlesIngest.js";
import { createRegimeCurrentHandler } from "./handlers/regimeCurrent.js";
import { createSrLevelsIngestHandler } from "./handlers/srLevelsIngest.js";
import { createSrLevelsCurrentHandler } from "./handlers/srLevelsCurrent.js";

export const registerRoutes = (app: FastifyInstance): StoreContext | null => {
  const databasePath =
    process.env.LEDGER_DB_PATH ??
    (process.env.NODE_ENV === "test" ? ":memory:" : "tmp/ledger.sqlite");

  const pgConnectionString = process.env.DATABASE_URL ?? "";

  let storeContext: StoreContext | null = null;
  let standaloneLedger: ReturnType<typeof createLedgerStore> | null = null;

  if (pgConnectionString) {
    storeContext = createStoreContext(databasePath, pgConnectionString);
  } else {
    standaloneLedger = createLedgerStore(databasePath);
  }

  app.addHook("onClose", async () => {
    if (storeContext) {
      await closeStoreContext(storeContext);
    } else if (standaloneLedger) {
      standaloneLedger.close();
    }
  });

  const ledger = storeContext?.ledger ?? standaloneLedger!;
  const pg = storeContext?.pg ?? null;

  app.get("/health", async () => {
    let sqliteOk = true;
    try {
      ledger.db.prepare("SELECT 1").get();
    } catch {
      sqliteOk = false;
    }

    let postgresStatus: string = pg ? "ok" : "not_configured";

    if (pg) {
      try {
        await pg.execute(sql`SELECT 1`);
        postgresStatus = "ok";
      } catch {
        postgresStatus = "unavailable";
      }
    }

    return {
      ok: sqliteOk && postgresStatus !== "unavailable",
      postgres: postgresStatus,
      sqlite: sqliteOk ? "ok" : "unavailable"
    };
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

  app.post("/v1/plan", createPlanHandler(ledger));
  app.post("/v1/execution-result", createExecutionResultHandler(ledger));
  app.post("/v1/clmm-execution-result", createClmmExecutionResultHandler(ledger));
  app.get("/v1/report/weekly", createWeeklyReportHandler(ledger));
  app.post("/v1/sr-levels", createSrLevelsIngestHandler(ledger));
  app.get("/v1/sr-levels/current", createSrLevelsCurrentHandler(ledger));
  app.post("/v1/candles", createCandlesIngestHandler(ledger));
  app.get("/v1/regime/current", createRegimeCurrentHandler(ledger));

  return storeContext;
};
