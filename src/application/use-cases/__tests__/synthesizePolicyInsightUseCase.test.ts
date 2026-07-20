import { describe, expect, it, vi } from "vitest";
import type {
  RegimeCurrentResponse,
  PlanResponse,
  PlanRequestPosition,
  PlanMarketData
} from "../../../contract/v1/types.js";
import type { SelectedEvidenceSummary } from "../../../engine/evidence/selectEvidence.js";
import type {
  PolicyInsightRepositoryPort,
  NewPolicyInsightRecord,
  StoredPolicyInsight,
  PolicyInsightHistoryCursor
} from "../../ports/policyInsightRepositoryPort.js";
import {
  createSynthesizePolicyInsightUseCase,
  type SynthesizePolicyInsightInput
} from "../synthesizePolicyInsightUseCase.js";
import { SOL_USDC_POLICY_V1 } from "../../../engine/policy/ruleset.js";
import { PolicyInsightValidationError } from "../../errors/policyInsightErrors.js";

// Mock Repository
class FakePolicyInsightRepository implements PolicyInsightRepositoryPort {
  public findCalls: Array<{
    readonly schemaVersion: string;
    readonly wireContractSha256: string;
    readonly rulesetVersion: string;
    readonly synthesisInputHash: string;
  }> = [];
  public insertCalls: NewPolicyInsightRecord[] = [];
  public findHits: Map<string, StoredPolicyInsight> = new Map();
  public nextId = 1;

  async findBySynthesisInputHash(input: {
    readonly schemaVersion: string;
    readonly wireContractSha256: string;
    readonly rulesetVersion: string;
    readonly synthesisInputHash: string;
  }): Promise<StoredPolicyInsight | null> {
    this.findCalls.push(input);
    return this.findHits.get(input.synthesisInputHash) || null;
  }

  async insertOrGet(input: NewPolicyInsightRecord): Promise<{
    readonly status: "created" | "already_exists";
    readonly record: StoredPolicyInsight;
  }> {
    this.insertCalls.push(input);
    const existing = this.findHits.get(input.synthesisInputHash);
    if (existing) {
      return { status: "already_exists", record: existing };
    }
    const record = { ...input, id: this.nextId++ } as StoredPolicyInsight;
    this.findHits.set(input.synthesisInputHash, record);
    return { status: "created", record };
  }

  async getCurrent(_input: {
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly wireContractSha256: string;
  }): Promise<StoredPolicyInsight | null> {
    return (
      Array.from(this.findHits.values())
        .filter((r) => r.pair === _input.pair && r.scopeKey === _input.scopeKey)
        .sort((a, b) => b.generatedAtUnixMs - a.generatedAtUnixMs || b.id - a.id)[0] || null
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getHistory(_: {
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly limit: number;
    readonly cursor: PolicyInsightHistoryCursor | null;
    readonly wireContractSha256: string;
  }): Promise<{
    readonly records: readonly StoredPolicyInsight[];
    readonly nextCursor: PolicyInsightHistoryCursor | null;
  }> {
    return { records: [], nextCursor: null };
  }
}

const makeDummyMarket = (nowUnixMs: number, poolAddress = "Pool123"): RegimeCurrentResponse => ({
  schemaVersion: "1.0",
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress,
  timeframe: "15m",
  regime: "CHOP",
  telemetry: {
    volRatio: 1,
    realizedVolLong: 0.1,
    realizedVolShort: 0.1,
    trendStrength: 0,
    compression: 1
  },
  freshness: {
    lastCandleOpenUnixMs: nowUnixMs - 2000,
    lastCandleOpenIso: new Date(nowUnixMs - 2000).toISOString(),
    lastCandleCloseUnixMs: nowUnixMs - 1000,
    lastCandleCloseIso: new Date(nowUnixMs - 1000).toISOString(),
    ageSeconds: 0,
    softStale: false,
    hardStale: false,
    softStaleSeconds: 300,
    hardStaleSeconds: 600,
    generatedAtIso: new Date(nowUnixMs - 1000).toISOString()
  },
  clmmSuitability: {
    status: "ALLOWED",
    reasons: []
  },
  marketReasons: [],
  metadata: {
    engineVersion: "1.0",
    configVersion: "1.0",
    candleCount: 100,
    sourceTimeframe: "15m",
    sourceCandleCount: 100
  }
});

const dummyEvidence = (selectedAtUnixMs: number): SelectedEvidenceSummary => ({
  selectionPolicyVersion: "evidence-policy-v1",
  selectedAtUnixMs,
  pair: "SOL/USDC",
  scope: { kind: "pair" },
  authority: "ADVISORY_ONLY",
  mode: "FULL",
  selected: {
    deterministicFeatures: [],
    contextualEvidence: {
      supportResistance: [],
      flows: [],
      derivatives: [],
      events: [],
      newsRegulatory: []
    },
    researchBrief: null
  },
  familyCoverage: {
    deterministicCount: 0,
    supportResistanceCount: 0,
    flowsCount: 0,
    derivativesCount: 0,
    eventsCount: 0,
    newsRegulatoryCount: 0,
    researchBriefCount: 0
  },
  deterministicEvidenceCoverage: {
    availableCount: 0,
    unavailableCount: 0,
    invalidCount: 0
  },
  conflicts: [],
  warnings: [],
  sourceReferences: [],
  bundles: [],
  decisions: []
});

describe("SynthesizePolicyInsightUseCase Invariants", () => {
  it("one synthesis instant is shared by every time-sensitive collaborator", async () => {
    const fixedTime = 123456789;
    const clock = { nowUnixMs: vi.fn().mockReturnValue(fixedTime) };
    const getCurrentRegime = vi.fn().mockResolvedValue(makeDummyMarket(fixedTime));
    const selectEvidence = vi.fn().mockResolvedValue(dummyEvidence(fixedTime));
    const repository = new FakePolicyInsightRepository();

    const useCase = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    await useCase({
      scope: { kind: "pair" },
      marketSelector: {
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool123",
        timeframe: "15m"
      }
    });

    expect(clock.nowUnixMs).toHaveBeenCalledTimes(1);
    expect(getCurrentRegime).toHaveBeenCalledWith(
      expect.objectContaining({
        poolAddress: "Pool123"
      }),
      fixedTime
    );
    expect(selectEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedAtUnixMs: fixedTime
      })
    );
  });

  it("pair scope selection time and position plan hash mismatches persist nothing", async () => {
    const fixedTime = 123456789;
    const clock = { nowUnixMs: vi.fn().mockReturnValue(fixedTime) };
    const getCurrentRegime = vi.fn().mockResolvedValue(makeDummyMarket(fixedTime));
    const selectEvidence = vi.fn().mockResolvedValue(dummyEvidence(fixedTime + 1000)); // Mismatch selection time
    const repository = new FakePolicyInsightRepository();

    const useCase = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    const input: SynthesizePolicyInsightInput = {
      scope: { kind: "pair" },
      marketSelector: {
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool123",
        timeframe: "15m"
      }
    };

    // 1. Selection time mismatch
    await expect(useCase(input)).rejects.toThrow(PolicyInsightValidationError);
    expect(repository.insertCalls).toHaveLength(0);

    // 2. Position/plan scope mismatch: supply positionPlan for pair scope
    const dummyPosition: PlanRequestPosition = {
      positionId: "pos-1",
      walletId: "wallet-1",
      observedAtUnixMs: fixedTime,
      lowerBoundPrice: 90,
      upperBoundPrice: 110,
      currentPrice: 100,
      rangeState: "in-range",
      breachQualified: false
    };
    const dummyPlan: PlanResponse = {
      schemaVersion: "1.0",
      planId: "plan-1",
      planHash: "wrong-hash",
      asOfUnixMs: fixedTime,
      scope: { kind: "position", positionId: "pos-1", poolAddress: "Pool123", symbol: "SOL/USDC" },
      regime: "CHOP",
      targets: { solBps: 5000, usdcBps: 5000, allowClmm: true },
      actions: [],
      constraints: { cooldownUntilUnixMs: 0, standDownUntilUnixMs: 0, notes: [] },
      nextRegimeState: { current: "CHOP", barsInRegime: 5, pending: null, pendingBars: 0 },
      reasons: [],
      telemetry: {},
      marketData: {} as unknown as PlanMarketData
    };

    const inputWithMismatchedPlan: SynthesizePolicyInsightInput = {
      ...input,
      positionPlan: {
        position: dummyPosition,
        plan: dummyPlan
      }
    };

    const selectEvidenceOk = vi.fn().mockResolvedValue(dummyEvidence(fixedTime));
    const useCase2 = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence: selectEvidenceOk,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    await expect(useCase2(inputWithMismatchedPlan)).rejects.toThrow(PolicyInsightValidationError);
    expect(repository.insertCalls).toHaveLength(0);
  });

  it("exact replay returns the stored canonical winner without reducing again", async () => {
    const fixedTime = 123456789;
    const clock = { nowUnixMs: vi.fn().mockReturnValue(fixedTime) };
    const getCurrentRegime = vi.fn().mockResolvedValue(makeDummyMarket(fixedTime));
    const selectEvidence = vi.fn().mockResolvedValue(dummyEvidence(fixedTime));
    const repository = new FakePolicyInsightRepository();

    const useCase = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    const input: SynthesizePolicyInsightInput = {
      scope: { kind: "pair" },
      marketSelector: {
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool123",
        timeframe: "15m"
      }
    };

    // First call
    const firstResult = await useCase(input);
    expect(repository.insertCalls).toHaveLength(1);

    // Second call (exact replay)
    const secondResult = await useCase(input);
    expect(repository.insertCalls).toHaveLength(1); // No new insert
    expect(firstResult.insightId).toBe(secondResult.insightId);
  });

  it("meaningful input or ruleset changes produce distinct history", async () => {
    const fixedTime = 123456789;
    const clock = { nowUnixMs: vi.fn().mockReturnValue(fixedTime) };
    const getCurrentRegime = vi
      .fn()
      .mockImplementation(async (q) => makeDummyMarket(fixedTime, q.poolAddress));
    const selectEvidence = vi.fn().mockResolvedValue(dummyEvidence(fixedTime));
    const repository = new FakePolicyInsightRepository();

    const useCase = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    const input1: SynthesizePolicyInsightInput = {
      scope: { kind: "pair" },
      marketSelector: {
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool123",
        timeframe: "15m"
      }
    };

    const firstResult = await useCase(input1);

    // Change marketSelector poolAddress
    const input2: SynthesizePolicyInsightInput = {
      scope: { kind: "pair" },
      marketSelector: {
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool456",
        timeframe: "15m"
      }
    };

    const secondResult = await useCase(input2);
    expect(firstResult.insightId).not.toBe(secondResult.insightId);
    expect(repository.insertCalls).toHaveLength(2);
  });

  it("runtime contract rejection persists nothing", async () => {
    const fixedTime = 123456789;
    const clock = { nowUnixMs: vi.fn().mockReturnValue(fixedTime) };

    // We will trigger a reducer output that fails zod validation.
    // E.g. we make the market regime "INVALID_REGIME" which doesn't fit standard snake_case label, or similar.
    const invalidMarket = {
      ...makeDummyMarket(fixedTime),
      regime: "INVALID REGIME WRONG CHARS"
    };

    const getCurrentRegime = vi.fn().mockResolvedValue(invalidMarket);
    const selectEvidence = vi.fn().mockResolvedValue(dummyEvidence(fixedTime));
    const repository = new FakePolicyInsightRepository();

    const useCase = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    const input: SynthesizePolicyInsightInput = {
      scope: { kind: "pair" },
      marketSelector: {
        source: "birdeye",
        network: "solana-mainnet",
        poolAddress: "Pool123",
        timeframe: "15m"
      }
    };

    await expect(useCase(input)).rejects.toThrow(PolicyInsightValidationError);
    expect(repository.insertCalls).toHaveLength(0);
  });
});
