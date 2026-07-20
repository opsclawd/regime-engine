import { describe, expect, it, vi } from "vitest";
import {
  createGetCurrentPolicyInsightUseCase,
  PolicyInsightNotFoundError
} from "../getCurrentPolicyInsightUseCase.js";
import type { PolicyInsightRepositoryPort } from "../../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../../ports/clock.js";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import type { PolicyInsightContent } from "../../../contract/policyInsight/v1/types.generated.js";
const POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256 =
  "80487b0a9374d0b535accf535ef9819f2b2de00e1d65980deb73c97afaa02800";

describe("getCurrentPolicyInsightUseCase", () => {
  const dummyContent: PolicyInsightContent = {
    schemaVersion: "policy-insight.v1",
    insightId: "a".repeat(64),
    rulesetVersion: "ruleset-1.0.0",
    pair: "SOL/USDC",
    position: null,
    generatedAt: new Date(1700000000000).toISOString(),
    asOf: new Date(1699999999000).toISOString(),
    expiresAt: new Date(1700000005000).toISOString(),
    marketRegime: "UP",
    fundamentalRegime: "BULLISH",
    posture: "AGGRESSIVE",
    recommendedAction: "HOLD",
    riskLevel: "NORMAL",
    clmmPolicy: {
      rangeBias: "MEDIUM",
      rebalanceSensitivity: "NORMAL",
      maxCapitalDeploymentBps: 7500
    },
    levels: {
      supportsUsdcPerSol: [],
      resistancesUsdcPerSol: []
    },
    evidence: {
      selectionStatus: "FULL",
      selectionPolicyVersion: "selector.v1.2026-07",
      selectedBundleRefs: [],
      selectedSourceRefs: []
    },
    confidenceBps: 7500,
    dataQuality: "COMPLETE",
    reasonCodes: ["MARKET_REGIME_UP"],
    reasoning: "Test reasoning",
    warnings: []
  };

  const dummyRecord = {
    id: 42,
    insightId: "a".repeat(64),
    schemaVersion: "policy-insight.v1",
    rulesetVersion: "ruleset-1.0.0",
    pair: "SOL/USDC",
    scopeKey: "pair",
    positionId: null,
    generatedAtUnixMs: 1700000000000,
    asOfUnixMs: 1700000000000,
    expiresAtUnixMs: 1700000005000,
    persistedAtUnixMs: 1700000001000,
    marketHash: "b".repeat(64),
    positionHash: "c".repeat(64),
    selectionHash: "d".repeat(64),
    synthesisInputHash: "e".repeat(64),
    wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256,
    selectionPolicyVersion: "policy-v1",
    synthesisInputJson: {} as unknown as PolicySynthesisEnvelope,
    synthesisOutputJson: dummyContent,
    payloadCanonical: "canonical-payload-json",
    payloadHash: "hash-payload",
    selectedLineageJson: [],
    excludedLineageJson: []
  };

  it("throws PolicyInsightNotFoundError when repository returns null", async () => {
    const mockClock: ClockPort = {
      nowUnixMs: () => 1700000000000
    };
    const mockRepo: PolicyInsightRepositoryPort = {
      findBySynthesisInputHash: vi.fn(),
      insertOrGet: vi.fn(),
      getCurrent: vi.fn().mockResolvedValue(null),
      getHistory: vi.fn()
    };

    const useCase = createGetCurrentPolicyInsightUseCase({
      repository: mockRepo,
      clock: mockClock
    });

    await expect(useCase({ pair: "SOL/USDC", scopeKey: "pair" })).rejects.toThrow(
      PolicyInsightNotFoundError
    );

    expect(mockRepo.getCurrent).toHaveBeenCalledWith({
      pair: "SOL/USDC",
      scopeKey: "pair",
      wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
    });
  });

  it("uses the injected current-read instant for evaluatedAt status and ageSeconds", async () => {
    const mockClock: ClockPort = {
      nowUnixMs: () => 1700000002000 // 2 seconds after asOf
    };
    const mockRepo: PolicyInsightRepositoryPort = {
      findBySynthesisInputHash: vi.fn(),
      insertOrGet: vi.fn(),
      getCurrent: vi.fn().mockResolvedValue(dummyRecord),
      getHistory: vi.fn()
    };

    const useCase = createGetCurrentPolicyInsightUseCase({
      repository: mockRepo,
      clock: mockClock
    });

    const result = await useCase({ pair: "SOL/USDC", scopeKey: "pair" });

    expect(result.freshness.evaluatedAt).toBe(new Date(1700000002000).toISOString());
    expect(result.freshness.status).toBe("FRESH");
    expect(result.freshness.ageSeconds).toBe(3);
  });

  it("marks current and history items stale at the exact expiry boundary", async () => {
    // Exact expiry boundary: evaluatedAt is exactly expiresAt Unix Ms (1700000005000)
    const mockClockStale: ClockPort = {
      nowUnixMs: () => 1700000005000
    };
    const mockClockFresh: ClockPort = {
      nowUnixMs: () => 1700000004999
    };

    const mockRepo: PolicyInsightRepositoryPort = {
      findBySynthesisInputHash: vi.fn(),
      insertOrGet: vi.fn(),
      getCurrent: vi.fn().mockResolvedValue(dummyRecord),
      getHistory: vi.fn()
    };

    const useCaseStale = createGetCurrentPolicyInsightUseCase({
      repository: mockRepo,
      clock: mockClockStale
    });
    const resultStale = await useCaseStale({ pair: "SOL/USDC", scopeKey: "pair" });
    expect(resultStale.freshness.status).toBe("STALE");

    const useCaseFresh = createGetCurrentPolicyInsightUseCase({
      repository: mockRepo,
      clock: mockClockFresh
    });
    const resultFresh = await useCaseFresh({ pair: "SOL/USDC", scopeKey: "pair" });
    expect(resultFresh.freshness.status).toBe("FRESH");
  });
});
