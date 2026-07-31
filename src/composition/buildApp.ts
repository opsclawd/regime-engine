import Fastify, { type FastifyInstance } from "fastify";
import { registerRoutes } from "../adapters/http/routes.js";
import type { RuntimeStoreContext } from "./buildStoreContext.js";
import { buildStoreContext } from "./buildStoreContext.js";
import type { ApplicationDependencies } from "./buildApplication.js";
import { buildApplication } from "./buildApplication.js";
import type { PositionPolicyInsightSynthesizerDeps } from "../workers/positionPolicyInsightSynthesizer.js";
import { runPositionPolicyInsightSynthesizer } from "../workers/positionPolicyInsightSynthesizer.js";

export interface BuildAppOptions {
  storeContext?: RuntimeStoreContext;
  deps?: ApplicationDependencies;
  positionSynthesizerDeps?: PositionPolicyInsightSynthesizerDeps;
  disablePositionWorker?: boolean;
}

export const buildApp = (options?: BuildAppOptions): FastifyInstance => {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : true
  });

  const ctx = options?.storeContext ?? buildStoreContext();
  const deps = options?.deps ?? buildApplication(ctx);

  registerRoutes(app, deps);

  let positionWorkerController: AbortController | null = null;
  let positionWorkerPromise: Promise<void> | null = null;

  if (
    !options?.disablePositionWorker &&
    ctx.pg !== null &&
    deps.positionPolicyInsightSynthesisQueue !== null &&
    deps.synthesizePolicyInsight !== null &&
    deps.requestPositionPolicyInsightSynthesis !== null
  ) {
    positionWorkerController = new AbortController();
    positionWorkerPromise = runPositionPolicyInsightSynthesizer(undefined, {
      storeContext: ctx,
      app: deps,
      queue: deps.positionPolicyInsightSynthesisQueue ?? undefined,
      planLedger: deps.planLedgerReadPort ?? undefined,
      synthesizePolicyInsight: deps.synthesizePolicyInsight ?? undefined,
      requestPositionSynthesis: deps.requestPositionPolicyInsightSynthesis ?? undefined,
      signal: positionWorkerController.signal,
      logger: options?.positionSynthesizerDeps?.logger,
      ...options?.positionSynthesizerDeps
    }).catch((err) => {
      app.log.error(err, "Position policy insight synthesizer crashed");
    });
  }

  app.addHook("onClose", async () => {
    if (positionWorkerController) {
      positionWorkerController.abort();
    }
    if (positionWorkerPromise) {
      await positionWorkerPromise;
    }
    await ctx.close();
  });

  return app;
};
