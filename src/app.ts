import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "./http/routes.js";

export const buildApp = (): FastifyInstance => {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true
  });
  registerRoutes(app);

  return app;
};
