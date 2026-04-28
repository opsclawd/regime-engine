import { buildApp, verifyPgConnection } from "./app.js";
import { createDb } from "./ledger/pg/db.js";

const port = Number(process.env.PORT ?? 8787);
// Default to 0.0.0.0 for local dev. Production deploys (Railway) must set HOST=::
// so Fastify binds dual-stack and is reachable over Railway private networking.
const host = process.env.HOST ?? "0.0.0.0";
const SHUTDOWN_TIMEOUT_MS = 10_000;

const start = async (): Promise<void> => {
  const pgConnectionString = process.env.DATABASE_URL ?? "";

  if (pgConnectionString) {
    try {
      const { db: pg, client } = createDb(pgConnectionString);
      await verifyPgConnection(pg);
      await client.end();
    } catch (error) {
      console.error("FATAL: Postgres connection failed at startup. Exiting.", error);
      process.exit(1);
    }
  }

  const app = buildApp();
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const gracefulShutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down gracefully`);
    const forceExit = setTimeout(() => {
      app.log.error("Forcing exit after shutdown timeout");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await app.close();
      app.log.info("Shutdown complete");
      process.exit(0);
    } catch (err) {
      app.log.error(err, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
};

void start();
