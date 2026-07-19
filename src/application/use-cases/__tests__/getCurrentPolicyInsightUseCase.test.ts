import { describe, expect, it, vi } from "vitest";
import {
  createGetCurrentPolicyInsightUseCase,
  PolicyInsightNotFoundError
} from "../getCurrentPolicyInsightUseCase.js";
import type {
  PolicyInsightRepositoryPort,
  StoredPolicyInsight
} from "../../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../../ports/clock.js";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import type { InsightIngestRequest } from "../../../contract/v1/insights.js";

describe("getCurrentPolicyInsightUseCase", () => {
  const mockClock: ClockPort = {
    nowUnixMs: () => 1700000000000
  };

  const dummyRecord: StoredPolicyInsight = {
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
    selectionPolicyVersion: "policy-v1",
    synthesisInputJson: {} as unknown as PolicySynthesisEnvelope,
    synthesisOutputJson: {} as unknown as InsightIngestRequest,
    payloadCanonical: "canonical-payload-json",
    payloadHash: "hash-payload",
    selectedLineageJson: [],
    excludedLineageJson: []
  };

  it("throws PolicyInsightNotFoundError when repository returns null", async () => {
    const mockRepo: PolicyInsightRepositoryPort = {
      findBySynthesisInputHash: vi.fn(),
      insertOrGet: vi.fn(),
      getCurrent: vi.fn().mockResolvedValue(null)
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
      scopeKey: "pair"
    });
  });

  it("returns queriedAtUnixMs and StoredPolicyInsight on success", async () => {
    const mockRepo: PolicyInsightRepositoryPort = {
      findBySynthesisInputHash: vi.fn(),
      insertOrGet: vi.fn(),
      getCurrent: vi.fn().mockResolvedValue(dummyRecord)
    };

    const useCase = createGetCurrentPolicyInsightUseCase({
      repository: mockRepo,
      clock: mockClock
    });

    const result = await useCase({ pair: "SOL/USDC", scopeKey: "pair" });

    expect(result).toEqual({
      queriedAtUnixMs: 1700000000000,
      record: dummyRecord
    });
  });
});
