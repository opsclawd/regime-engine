import { describe, expect, it } from "vitest";
import type {
  PolicyInsightRepositoryPort,
  PolicyInsightHistoryCursor,
  StoredPolicyInsight
} from "../../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../../ports/clock.js";
import {
  createGetPolicyInsightHistoryUseCase,
  encodeHistoryCursor
} from "../getPolicyInsightHistoryUseCase.js";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import type { PolicyInsightContent } from "../../../contract/policyInsight/v1/types.generated.js";
const POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256 =
  "80487b0a9374d0b535accf535ef9819f2b2de00e1d65980deb73c97afaa02800";
import { PolicyInsightValidationError } from "../../errors/policyInsightErrors.js";

class FakePolicyInsightRepositoryPort implements PolicyInsightRepositoryPort {
  public calls: Array<{
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly limit: number;
    readonly cursor: PolicyInsightHistoryCursor | null;
    readonly wireContractSha256: string;
  }> = [];

  public nextRecords: StoredPolicyInsight[] = [];
  public nextCursor: PolicyInsightHistoryCursor | null = null;

  async findBySynthesisInputHash(): Promise<never> {
    throw new Error("Not implemented");
  }

  async insertOrGet(): Promise<never> {
    throw new Error("Not implemented");
  }

  async getCurrent(): Promise<never> {
    throw new Error("Not implemented");
  }

  async getHistory(input: {
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly limit: number;
    readonly cursor: PolicyInsightHistoryCursor | null;
    readonly wireContractSha256: string;
  }): Promise<{
    readonly records: readonly StoredPolicyInsight[];
    readonly nextCursor: PolicyInsightHistoryCursor | null;
  }> {
    this.calls.push(input);
    return { records: this.nextRecords, nextCursor: this.nextCursor };
  }
}

class FakeClockPort implements ClockPort {
  public constructor(private readonly fixedNowUnixMs: number) {}

  nowUnixMs(): number {
    return this.fixedNowUnixMs;
  }
}

const makeFakeContent = (id: number): PolicyInsightContent => ({
  schemaVersion: "policy-insight.v1",
  insightId: String(id).padStart(64, "0"),
  rulesetVersion: "ruleset-1.0.0",
  pair: "SOL/USDC",
  position: null,
  generatedAt: new Date(1_700_000_000_000 + id * 1000).toISOString(),
  asOf: new Date(1_700_000_000_000 + id * 1000 - 100).toISOString(),
  expiresAt: new Date(1_700_000_000_000 + id * 1000 + 300).toISOString(),
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
});

const makeFakeRecord = (id: number): StoredPolicyInsight => {
  const content = makeFakeContent(id);
  return {
    id,
    insightId: String(id).padStart(64, "0"),
    schemaVersion: "policy-insight.v1",
    rulesetVersion: "ruleset-1.0.0",
    pair: "SOL/USDC",
    scopeKey: "pair",
    positionId: null,
    generatedAtUnixMs: 1_700_000_000_000 + id * 1000,
    asOfUnixMs: 1_700_000_000_000 + id * 1000 - 100,
    expiresAtUnixMs: 1_700_000_000_000 + id * 1000 + 300,
    persistedAtUnixMs: 1_700_000_000_000 + id * 1000 + 200,
    marketHash: "market",
    positionHash: "position",
    selectionHash: "selection",
    synthesisInputHash: "input",
    wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256,
    selectionPolicyVersion: "policy",
    synthesisInputJson: {} as unknown as PolicySynthesisEnvelope,
    synthesisOutputJson: content,
    payloadCanonical: "canonical",
    payloadHash: "hash",
    selectedLineageJson: [],
    excludedLineageJson: []
  };
};

describe("GetPolicyInsightHistoryUseCase Invariants", () => {
  const CLOCK_TIME = 1_700_000_000_000 + 50000; // Injected-clock value far in future of records

  it("queries policy insight history page at captured time", async () => {
    const repo = new FakePolicyInsightRepositoryPort();
    const records = [makeFakeRecord(1), makeFakeRecord(2)];
    repo.nextRecords = records;
    repo.nextCursor = { generatedAtUnixMs: 1_700_000_002_000, id: 2 };
    const clock = new FakeClockPort(CLOCK_TIME);
    const useCase = createGetPolicyInsightHistoryUseCase({ repository: repo, clock });

    const result = await useCase({
      pair: "SOL/USDC",
      scopeKey: "pair",
      limit: 10,
      cursor: null
    });

    expect(result.queriedAt).toBe(new Date(CLOCK_TIME).toISOString());
    expect(result.items).toHaveLength(2);
    expect(result.items[0].insightId).toBe("1".padStart(64, "0"));
    expect(result.items[1].insightId).toBe("2".padStart(64, "0"));
    expect(result.nextCursor).toBe(
      encodeHistoryCursor({ generatedAtUnixMs: 1_700_000_002_000, id: 2 })
    );

    expect(repo.calls).toHaveLength(1);
    const call = repo.calls[0];
    expect(call.pair).toBe("SOL/USDC");
    expect(call.scopeKey).toBe("pair");
    expect(call.limit).toBe(10);
    expect(call.cursor).toBeNull();
    expect(call.wireContractSha256).toBe(POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256);
  });

  it("uses one injected history-read instant for queriedAt and every item freshness", async () => {
    const repo = new FakePolicyInsightRepositoryPort();
    const records = [makeFakeRecord(1), makeFakeRecord(2)];
    repo.nextRecords = records;
    const clock = new FakeClockPort(CLOCK_TIME);
    const useCase = createGetPolicyInsightHistoryUseCase({ repository: repo, clock });

    const result = await useCase({
      pair: "SOL/USDC",
      scopeKey: "pair",
      limit: 10,
      cursor: null
    });

    expect(result.queriedAt).toBe(new Date(CLOCK_TIME).toISOString());
    expect(result.items[0].freshness.evaluatedAt).toBe(new Date(CLOCK_TIME).toISOString());
    expect(result.items[1].freshness.evaluatedAt).toBe(new Date(CLOCK_TIME).toISOString());
  });

  it("accepts history limits through 100 and rejects 101", async () => {
    const repo = new FakePolicyInsightRepositoryPort();
    const clock = new FakeClockPort(CLOCK_TIME);
    const useCase = createGetPolicyInsightHistoryUseCase({ repository: repo, clock });

    await expect(
      useCase({
        pair: "SOL/USDC",
        scopeKey: "pair",
        limit: 100,
        cursor: null
      })
    ).resolves.toBeDefined();

    await expect(
      useCase({
        pair: "SOL/USDC",
        scopeKey: "pair",
        limit: 101,
        cursor: null
      })
    ).rejects.toThrow(PolicyInsightValidationError);
  });
});
