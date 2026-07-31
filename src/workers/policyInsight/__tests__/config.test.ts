import { describe, it, expect } from "vitest";
import { parsePolicyInsightSynthesisWorkerConfig } from "../config.js";

const VALID_POOL = "5KKvmojT2x22F43yVf9p2f1111111111111111111111";

describe("parsePolicyInsightSynthesisWorkerConfig", () => {
  it("rejects a missing canonical SOL/USDC pool address", () => {
    expect(() => parsePolicyInsightSynthesisWorkerConfig({})).toThrow(
      "Missing required env: CANONICAL_SOL_USDC_POOL_ADDRESS"
    );
    expect(() =>
      parsePolicyInsightSynthesisWorkerConfig({ CANONICAL_SOL_USDC_POOL_ADDRESS: "" })
    ).toThrow("Missing required env: CANONICAL_SOL_USDC_POOL_ADDRESS");
  });

  it("rejects placeholder pool addresses", () => {
    expect(() =>
      parsePolicyInsightSynthesisWorkerConfig({
        CANONICAL_SOL_USDC_POOL_ADDRESS: "<SOL_USDC_POOL_ADDRESS>"
      })
    ).toThrow("contains placeholder characters");

    expect(() =>
      parsePolicyInsightSynthesisWorkerConfig({
        CANONICAL_SOL_USDC_POOL_ADDRESS: "SOL_USDC_POOL_ADDRESS_HERE>"
      })
    ).toThrow("contains placeholder characters");
  });

  it("returns the canonical pair market selector", () => {
    const config = parsePolicyInsightSynthesisWorkerConfig({
      CANONICAL_SOL_USDC_POOL_ADDRESS: VALID_POOL
    });

    expect(config.marketSelector).toEqual({
      source: "geckoterminal",
      network: "solana",
      poolAddress: VALID_POOL,
      timeframe: "1h"
    });
    expect(config.pollIntervalMs).toBe(5000);
    expect(config.leaseMs).toBe(60000);
    expect(config.retryMs).toBe(5000);
    expect(config.maxAttempts).toBe(5);
  });

  it("validates positive poll lease retry intervals and max attempts budget", () => {
    const custom = parsePolicyInsightSynthesisWorkerConfig({
      CANONICAL_SOL_USDC_POOL_ADDRESS: VALID_POOL,
      POLICY_INSIGHT_SYNTHESIS_POLL_INTERVAL_MS: "10000",
      POLICY_INSIGHT_SYNTHESIS_LEASE_MS: "30000",
      POLICY_INSIGHT_SYNTHESIS_RETRY_MS: "15000",
      POLICY_INSIGHT_SYNTHESIS_MAX_ATTEMPTS: "10"
    });

    expect(custom.pollIntervalMs).toBe(10000);
    expect(custom.leaseMs).toBe(30000);
    expect(custom.retryMs).toBe(15000);
    expect(custom.maxAttempts).toBe(10);

    expect(() =>
      parsePolicyInsightSynthesisWorkerConfig({
        CANONICAL_SOL_USDC_POOL_ADDRESS: VALID_POOL,
        POLICY_INSIGHT_SYNTHESIS_POLL_INTERVAL_MS: "0"
      })
    ).toThrow("must be a positive integer");

    expect(() =>
      parsePolicyInsightSynthesisWorkerConfig({
        CANONICAL_SOL_USDC_POOL_ADDRESS: VALID_POOL,
        POLICY_INSIGHT_SYNTHESIS_LEASE_MS: "-100"
      })
    ).toThrow("must be a positive integer");

    expect(() =>
      parsePolicyInsightSynthesisWorkerConfig({
        CANONICAL_SOL_USDC_POOL_ADDRESS: VALID_POOL,
        POLICY_INSIGHT_SYNTHESIS_RETRY_MS: "abc"
      })
    ).toThrow("must be a positive integer");

    expect(() =>
      parsePolicyInsightSynthesisWorkerConfig({
        CANONICAL_SOL_USDC_POOL_ADDRESS: VALID_POOL,
        POLICY_INSIGHT_SYNTHESIS_MAX_ATTEMPTS: "0"
      })
    ).toThrow("must be a positive integer");

    expect(() =>
      parsePolicyInsightSynthesisWorkerConfig({
        CANONICAL_SOL_USDC_POOL_ADDRESS: VALID_POOL,
        POLICY_INSIGHT_SYNTHESIS_LEASE_MS: "10000",
        POLICY_INSIGHT_SYNTHESIS_RETRY_MS: "20000"
      })
    ).toThrow("cannot exceed");
  });
});
