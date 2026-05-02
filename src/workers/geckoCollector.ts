import { realpathSync } from "node:fs";
import type { GeckoCollectorConfig } from "./gecko/config.js";
import { parseGeckoCollectorConfig } from "./gecko/config.js";
import type { WorkerLogger } from "./gecko/logger.js";
import { consoleLogger } from "./gecko/logger.js";
import { withRetry, createRateLimiter, type RetryDeps } from "./gecko/retry.js";
import { normalizeGeckoOhlcv, shouldPostNormalizedBatch } from "./gecko/normalize.js";
import { fetchGeckoOhlcv } from "./gecko/geckoClient.js";
import { postCandles } from "./gecko/ingestClient.js";

export function isMainModule(importMetaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  try {
    const metaReal = realpathSync(new URL(importMetaUrl).pathname);
    const argvReal = realpathSync(argvPath);
    return metaReal === argvReal;
  } catch {
    return false;
  }
}

export type GeckoCollectorDeps = {
  fetchGeckoOhlcv?: (
    config: GeckoCollectorConfig,
    deps?: import("./gecko/geckoClient.js").GeckoClientDeps
  ) => Promise<unknown>;
  postCandles?: (
    config: GeckoCollectorConfig,
    candles: import("../contract/v1/types.js").Candle[],
    sourceRecordedAtIso: string,
    deps?: import("./gecko/ingestClient.js").IngestClientDeps
  ) => Promise<import("../contract/v1/types.js").CandleIngestResponse>;
  logger?: WorkerLogger;
  nowIso?: () => string;
  jitterMs?: (attempt: number) => number;
  retrySignal?: AbortSignal;
  shouldContinue?: () => boolean;
  waitForProviderPermit?: () => Promise<void>;
};

export async function runOneCycle(
  config: GeckoCollectorConfig,
  deps?: GeckoCollectorDeps
): Promise<void> {
  const logger = deps?.logger ?? consoleLogger;
  const nowIso = deps?.nowIso ?? (() => new Date().toISOString());
  const shouldContinue = deps?.shouldContinue ?? (() => true);

  logger.info("cycle_started");

  const retryDeps: RetryDeps = {
    signal: deps?.retrySignal,
    shouldContinue: deps?.shouldContinue
  };

  let payload: unknown;
  try {
    payload = await withRetry(
      (() =>
        (deps?.fetchGeckoOhlcv ?? fetchGeckoOhlcv)(config, {
          waitForProviderPermit: deps?.waitForProviderPermit
        })) as (attempt: number) => Promise<unknown>,
      retryDeps
    );
    logger.info("fetch_succeeded");
  } catch (err: unknown) {
    logger.error("fetch_failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  if (!shouldContinue()) return;

  const { candles, stats } = normalizeGeckoOhlcv(payload, config);
  logger.info("normalized", {
    validCount: stats.validCount,
    totalDroppedCount: stats.totalDroppedCount
  });

  if (!shouldContinue()) return;

  const guardReason = shouldPostNormalizedBatch(stats, config);
  if (guardReason) {
    logger.warn("batch_guarded", {
      reason: guardReason,
      validCount: stats.validCount,
      providerRowCount: stats.providerRowCount
    });
    return;
  }

  const sourceRecordedAtIso = nowIso();
  try {
    const result = await withRetry(
      () => (deps?.postCandles ?? postCandles)(config, candles, sourceRecordedAtIso),
      retryDeps
    );
    logger.info("ingest_succeeded", {
      insertedCount: result.insertedCount,
      revisedCount: result.revisedCount,
      idempotentCount: result.idempotentCount,
      rejectedCount: result.rejectedCount
    });
  } catch (err: unknown) {
    logger.error("ingest_failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  logger.info("cycle_completed");
}

export async function runCollector(config?: GeckoCollectorConfig): Promise<void> {
  const resolvedConfig = config ?? parseGeckoCollectorConfig(process.env);
  const logger = consoleLogger;

  const controller = new AbortController();
  const shutdown = () => {
    if (!controller.signal.aborted) {
      controller.abort();
      logger.info("shutdown_requested");
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const rateLimiter = createRateLimiter(resolvedConfig.geckoMaxCallsPerMinute);

  try {
    while (!controller.signal.aborted) {
      try {
        await runOneCycle(resolvedConfig, {
          logger,
          retrySignal: controller.signal,
          shouldContinue: () => !controller.signal.aborted,
          waitForProviderPermit: () => rateLimiter.waitForPermit()
        });
      } catch {
        break;
      }

      if (controller.signal.aborted) break;

      try {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, resolvedConfig.geckoPollIntervalMs);
          controller.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true }
          );
        });
      } catch {
        break;
      }
    }
  } finally {
    logger.info("shutdown_complete");
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  runCollector().catch((err) => {
    console.error(
      JSON.stringify({
        level: "fatal",
        event: "collector_fatal",
        error: err instanceof Error ? err.message : String(err)
      })
    );
    process.exit(1);
  });
}
