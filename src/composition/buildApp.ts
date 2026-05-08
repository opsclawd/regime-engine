import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "../http/routes.js";
import { buildStoreContext } from "./buildStoreContext.js";
import { buildApplication } from "./buildApplication.js";

export const buildApp = (): FastifyInstance => {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true
  });

  const ctx = buildStoreContext();
  const deps = buildApplication(ctx);

  registerRoutes(app, deps);

  app.addHook("onClose", async () => {
    await ctx.close();
  });

  return app;
};
