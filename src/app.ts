import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm/sql";
import { registerRoutes } from "./http/routes.js";
import type { StoreContext } from "./ledger/storeContext.js";
import type { Db } from "./ledger/pg/db.js";

export const verifyPgConnection = async (pg: Db): Promise<void> => {
  await pg.execute(sql`SELECT 1`);
};

export const buildApp = (): FastifyInstance & { storeContext?: StoreContext | null } => {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true
  });
  const storeContext = registerRoutes(app);
  (app as FastifyInstance & { storeContext?: StoreContext | null }).storeContext = storeContext;

  return app;
};
