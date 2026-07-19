import { describe, expect, it } from "vitest";
import type {
  PolicyInsightRepositoryPort,
  PolicyInsightHistoryCursor,
  StoredPolicyInsight
} from "../../ports/policyInsightRepositoryPort.js";
import type { ClockPort } from "../../ports/clock.js";
import { createGetPolicyInsightHistoryUseCase } from "../getPolicyInsightHistoryUseCase.js";
import type { PolicySynthesisEnvelope } from "../../../engine/policy/synthesizePolicyInsight.js";
import type { InsightIngestRequest } from "../../../contract/v1/insights.js";

class FakePolicyInsightRepositoryPort implements PolicyInsightRepositoryPort {
  public calls: Array<{
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly limit: number;
    readonly cursor: PolicyInsightHistoryCursor | null;
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

const makeFakeRecord = (id: number): StoredPolicyInsight =>
  ({
    id,
    insightId: `insight-${id}`,
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
    selectionPolicyVersion: "policy",
    synthesisInputJson: {} as unknown as PolicySynthesisEnvelope,
    synthesisOutputJson: {} as unknown as InsightIngestRequest,
    payloadCanonical: "canonical",
    payloadHash: "hash",
    selectedLineageJson: [],
    excludedLineageJson: []
  }) as StoredPolicyInsight;

describe("GetPolicyInsightHistoryUseCase", () => {
  const CLOCK_TIME = 1_700_000_000_000;

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

    expect(result.schemaVersion).toBe("1.0");
    expect(result.pair).toBe("SOL/USDC");
    expect(result.limit).toBe(10);
    expect(result.queriedAtUnixMs).toBe(CLOCK_TIME);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].payloadHash).toBe("hash");
    expect(result.items[0].receivedAtIso).toBe(
      new Date(1_700_000_000_000 + 1 * 1000 + 200).toISOString()
    );
    expect(result.items[1].payloadHash).toBe("hash");
    expect(result.items[1].receivedAtIso).toBe(
      new Date(1_700_000_000_000 + 2 * 1000 + 200).toISOString()
    );
    expect(result.nextCursor).toEqual({ generatedAtUnixMs: 1_700_000_002_000, id: 2 });

    expect(repo.calls).toHaveLength(1);
    const call = repo.calls[0];
    expect(call.pair).toBe("SOL/USDC");
    expect(call.scopeKey).toBe("pair");
    expect(call.limit).toBe(10);
    expect(call.cursor).toBeNull();
  });
});
