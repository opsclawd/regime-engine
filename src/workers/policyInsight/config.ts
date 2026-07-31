import type { SynthesizePolicyInsightInput } from "../../application/use-cases/synthesizePolicyInsightUseCase.js";

export interface PolicyInsightSynthesisWorkerConfig {
  marketSelector: SynthesizePolicyInsightInput["marketSelector"] & {
    source: "geckoterminal";
    network: "solana";
    poolAddress: string;
    timeframe: "1h";
  };
  pollIntervalMs: number;
  leaseMs: number;
  retryMs: number;
  maxAttempts: number;
}

function readRequired(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

function readPoolAddress(env: Record<string, string | undefined>, key: string): string {
  const value = readRequired(env, key);
  if (/<|>/.test(value)) {
    throw new Error(`${key} contains placeholder characters: ${value}`);
  }
  return value;
}

function readPositiveInteger(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number
): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${key} must be a positive integer, got: ${raw}`);
  }
  return n;
}

export function parsePolicyInsightSynthesisWorkerConfig(
  env: Record<string, string | undefined>
): PolicyInsightSynthesisWorkerConfig {
  const poolAddress = readPoolAddress(env, "CANONICAL_SOL_USDC_POOL_ADDRESS");
  const pollIntervalMs = readPositiveInteger(
    env,
    "POLICY_INSIGHT_SYNTHESIS_POLL_INTERVAL_MS",
    5000
  );
  const leaseMs = readPositiveInteger(env, "POLICY_INSIGHT_SYNTHESIS_LEASE_MS", 60000);
  const retryMs = readPositiveInteger(env, "POLICY_INSIGHT_SYNTHESIS_RETRY_MS", 5000);
  const maxAttempts = readPositiveInteger(env, "POLICY_INSIGHT_SYNTHESIS_MAX_ATTEMPTS", 5);

  if (retryMs > leaseMs) {
    throw new Error(
      `POLICY_INSIGHT_SYNTHESIS_RETRY_MS (${retryMs}) cannot exceed POLICY_INSIGHT_SYNTHESIS_LEASE_MS (${leaseMs})`
    );
  }

  return {
    marketSelector: {
      source: "geckoterminal",
      network: "solana",
      poolAddress,
      timeframe: "1h"
    },
    pollIntervalMs,
    leaseMs,
    retryMs,
    maxAttempts
  };
}
