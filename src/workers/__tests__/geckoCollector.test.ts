import { describe, it, expect, vi } from "vitest";
import { isMainModule, runOneCycle } from "../geckoCollector.js";
import type { CollectorLoopDeps, GeckoCollectorDeps } from "../geckoCollector.js";
import type { GeckoCollectorConfig } from "../gecko/config.js";
import type { WorkerLogger } from "../gecko/logger.js";
import type { CandleIngestResponse } from "../../contract/v1/types.js";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { readFileSync } from "node:fs";

const BASE_CONFIG: GeckoCollectorConfig = {
  regimeEngineUrl: new URL("https://regime-engine.example"),
  candlesIngestToken: "tok_abc123",
  geckoSource: "geckoterminal",
  geckoNetwork: "solana",
  geckoPoolAddress: "pool123",
  geckoSymbol: "SOL/USDC",
  geckoTimeframe: "1h",
  geckoLookback: 10,
  geckoPollIntervalMs: 300000,
  geckoMaxCallsPerMinute: 6,
  geckoRequestTimeoutMs: 10000
};

const VALID_PAYLOAD = {
  data: {
    attributes: {
      ohlcv_list: [[1714536000, 100, 105, 98, 102, 1000]]
    }
  }
};

const VALID_INGEST_RESPONSE: CandleIngestResponse = {
  schemaVersion: SCHEMA_VERSION,
  insertedCount: 1,
  revisedCount: 0,
  idempotentCount: 0,
  rejectedCount: 0,
  rejections: []
};

describe("isMainModule", () => {
  it("returns false for different paths", () => {
    expect(isMainModule("file:///a/b/c.ts", "/x/y/z.ts")).toBe(false);
  });

  it("returns true for same real file", () => {
    expect(isMainModule(import.meta.url, process.argv[1])).toBe(
      import.meta.url === `file://${process.argv[1]}`
    );
  });
});

describe("runOneCycle", () => {
  it("fetches, normalizes and posts candles with logging", async () => {
    const logs: { level: string; event: string }[] = [];
    const logger = {
      info: (event: string) => logs.push({ level: "info", event }),
      warn: () => {},
      error: () => {}
    };

    const deps: GeckoCollectorDeps = {
      fetchGeckoOhlcv: vi.fn(async () => VALID_PAYLOAD),
      postCandles: vi.fn(async () => VALID_INGEST_RESPONSE),
      logger: logger as WorkerLogger,
      nowIso: () => "2026-05-01T00:00:00.000Z"
    };

    await runOneCycle(BASE_CONFIG, deps);

    expect(deps.fetchGeckoOhlcv).toHaveBeenCalledTimes(1);
    expect(deps.postCandles).toHaveBeenCalledTimes(1);
    expect(logs.map((l) => l.event)).toEqual([
      "cycle_started",
      "fetch_succeeded",
      "normalized",
      "ingest_succeeded",
      "cycle_completed"
    ]);
  });

  it("skips ingest after shutdown during fetch phase", async () => {
    let shouldContinue = true;
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {}
    };

    const deps: GeckoCollectorDeps = {
      fetchGeckoOhlcv: vi.fn(async () => {
        shouldContinue = false;
        return VALID_PAYLOAD;
      }),
      postCandles: vi.fn(async () => VALID_INGEST_RESPONSE),
      logger: logger as WorkerLogger,
      nowIso: () => "2026-05-01T00:00:00.000Z",
      shouldContinue: () => shouldContinue
    };

    await runOneCycle(BASE_CONFIG, deps);

    expect(deps.fetchGeckoOhlcv).toHaveBeenCalledTimes(1);
    expect(deps.postCandles).toHaveBeenCalledTimes(0);
  });

  it("blocks on zero valid with warning", async () => {
    const warns: { event: string; reason?: string }[] = [];
    const logger = {
      info: () => {},
      warn: (event: string, ctx?: Record<string, unknown>) =>
        warns.push({ event, reason: ctx?.reason as string | undefined }),
      error: () => {}
    };

    const emptyPayload = { data: { attributes: { ohlcv_list: [] } } };

    const deps: GeckoCollectorDeps = {
      fetchGeckoOhlcv: vi.fn(async () => emptyPayload),
      postCandles: vi.fn(async () => VALID_INGEST_RESPONSE),
      logger: logger as WorkerLogger,
      nowIso: () => "2026-05-01T00:00:00.000Z"
    };

    await runOneCycle(BASE_CONFIG, deps);

    expect(deps.postCandles).toHaveBeenCalledTimes(0);
    expect(warns).toHaveLength(1);
    expect(warns[0].reason).toBe("zero_valid");
  });

  it("completes in-flight ingest before shutdown check", async () => {
    let shouldContinueFlag = true;
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {}
    };

    const deps: GeckoCollectorDeps = {
      fetchGeckoOhlcv: vi.fn(async () => VALID_PAYLOAD),
      postCandles: vi.fn(async () => {
        shouldContinueFlag = false;
        return VALID_INGEST_RESPONSE;
      }),
      logger: logger as WorkerLogger,
      nowIso: () => "2026-05-01T00:00:00.000Z",
      shouldContinue: () => shouldContinueFlag
    };

    await runOneCycle(BASE_CONFIG, deps);

    expect(deps.postCandles).toHaveBeenCalledTimes(1);
  });

  it("logs ingest failure before rethrow", async () => {
    const errors: string[] = [];
    const logger = {
      info: () => {},
      warn: () => {},
      error: (event: string, ctx?: Record<string, unknown>) => errors.push(ctx?.error as string)
    };

    const deps: GeckoCollectorDeps = {
      fetchGeckoOhlcv: vi.fn(async () => VALID_PAYLOAD),
      postCandles: vi.fn(async () => {
        throw new Error("server down");
      }),
      logger: logger as WorkerLogger,
      nowIso: () => "2026-05-01T00:00:00.000Z"
    };

    await expect(runOneCycle(BASE_CONFIG, deps)).rejects.toThrow("server down");
    expect(errors).toContain("server down");
  });
});

describe("runCollector", () => {
  it("runs two cycles then shuts down", async () => {
    const shutdownController = new AbortController();
    let cycleCount = 0;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as unknown as WorkerLogger;

    const runOneCycleFn = vi.fn(async () => {
      cycleCount++;
      if (cycleCount >= 2) {
        shutdownController.abort();
      }
    });

    const sleep = vi.fn(async () => {});

    const loopDeps: CollectorLoopDeps = {
      signal: shutdownController.signal,
      logger: logger as WorkerLogger,
      runOneCycleFn,
      sleep
    };

    const { runCollector } = await import("../geckoCollector.js");
    await runCollector(BASE_CONFIG, loopDeps);

    expect(cycleCount).toBeGreaterThanOrEqual(2);
    expect(logger.info).toHaveBeenCalledWith("shutdown_complete");
  });

  it("removes signal handlers on shutdown", async () => {
    const listenersBefore = process.listenerCount("SIGTERM");
    const shutdownController = new AbortController();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    } as unknown as WorkerLogger;

    const runOneCycleFn = vi.fn(async () => {
      shutdownController.abort();
    });

    const sleep = vi.fn(async () => {});

    const loopDeps: CollectorLoopDeps = {
      signal: shutdownController.signal,
      logger: logger as WorkerLogger,
      runOneCycleFn,
      sleep
    };

    const { runCollector } = await import("../geckoCollector.js");
    await runCollector(BASE_CONFIG, loopDeps);

    const listenersAfter = process.listenerCount("SIGTERM");
    expect(listenersAfter).toBe(listenersBefore);
  });
});

describe("package scripts", () => {
  it("points start scripts at dist/src outputs", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.start).toContain("dist/src/server.js");
    expect(packageJson.scripts["dev:gecko"]).toContain("src/workers/geckoCollector.ts");
    expect(packageJson.scripts["start:gecko"]).toContain("dist/src/workers/geckoCollector.js");
  });
});
