import { realpathSync } from "node:fs";
import type { GeckoCollectorConfig } from "./gecko/config.js";
import { parseGeckoCollectorConfig } from "./gecko/config.js";
import type { WorkerLogger } from "./gecko/logger.js";
import { consoleLogger } from "./gecko/logger.js";
import { withRetry, createRateLimiter, type RetryDeps } from "./gecko/retry.js";
import { normalizeGeckoOhlcv, shouldPostNormalizedBatch } from "./gecko/normalize.js";
import { fetchGeckoOhlcv } from "./gecko/geckoClient.js";
import { postCandles } from "./gecko/ingestClient.js";

function sleepWithSignal(signal?: AbortSignal): (ms: number) => Promise<void> {
  return (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
}

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
      () =>
        (deps?.fetchGeckoOhlcv ?? fetchGeckoOhlcv)(config, {
          waitForProviderPermit: deps?.waitForProviderPermit
        }),
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

export type CollectorLoopDeps = GeckoCollectorDeps & {
  signal?: AbortSignal;
  runOneCycleFn?: (config: GeckoCollectorConfig, deps?: GeckoCollectorDeps) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
};

export async function runCollector(
  config?: GeckoCollectorConfig,
  loopDeps?: CollectorLoopDeps
): Promise<void> {
  const resolvedConfig = config ?? parseGeckoCollectorConfig(process.env);
  const logger = loopDeps?.logger ?? consoleLogger;
  const cycleFn = loopDeps?.runOneCycleFn ?? runOneCycle;

  const controller = new AbortController();
  const signal = loopDeps?.signal ?? controller.signal;
  const defaultSleepFn = sleepWithSignal(signal);
  const sleepFn = loopDeps?.sleep ?? defaultSleepFn;
  const shutdown = () => {
    if (!signal.aborted) {
      if (signal === controller.signal) {
        controller.abort();
      }
      logger.info("shutdown_requested");
    }
  };

  if (signal === controller.signal) {
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  const rateLimiter = createRateLimiter(resolvedConfig.geckoMaxCallsPerMinute, {
    sleep: (ms: number) => sleepFn(ms)
  });

  let cycleError: unknown;
  try {
    while (!signal.aborted) {
      try {
        await cycleFn(resolvedConfig, {
          ...loopDeps,
          logger,
          retrySignal: signal,
          shouldContinue: () => !signal.aborted,
          waitForProviderPermit: () => rateLimiter.waitForPermit()
        });
      } catch (err: unknown) {
        logger.error("cycle_error", {
          error: err instanceof Error ? err.message : String(err)
        });
        cycleError = err;
        break;
      }

      if (signal.aborted) break;

      try {
        await sleepFn(resolvedConfig.geckoPollIntervalMs);
      } catch {
        break;
      }
    }
  } finally {
    if (signal === controller.signal) {
      process.removeListener("SIGTERM", shutdown);
      process.removeListener("SIGINT", shutdown);
    }
    logger.info("shutdown_complete");
  }

  if (cycleError !== undefined) {
    throw cycleError;
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
