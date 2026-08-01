import { describe, expect, it, vi } from "vitest";
import type { SrLevelsV2CurrentResponse, SrThesisV2 } from "../../../contract/v2/srLevels.js";
import type { Scope } from "../../../contract/evidence/v1/types.generated.js";
import type { RegimeCurrentResponse } from "../../../contract/v1/types.js";
import type { SelectedEvidenceSummary } from "../../../engine/evidence/selectEvidence.js";
import type {
  PolicyInsightRepositoryPort,
  NewPolicyInsightRecord,
  StoredPolicyInsight,
  PolicyInsightHistoryCursor
} from "../../ports/policyInsightRepositoryPort.js";
import type { SrThesesReadPort } from "../../ports/srThesesReadPort.js";
import { createSynthesizePolicyInsightUseCase } from "../synthesizePolicyInsightUseCase.js";
import { SOL_USDC_POLICY_V1 } from "../../../engine/policy/ruleset.js";

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

  public onFind?: (synthesisInputHash: string) => void;
  public onInsert?: (record: NewPolicyInsightRecord) => void;

  async findBySynthesisInputHash(input: {
    readonly schemaVersion: string;
    readonly wireContractSha256: string;
    readonly rulesetVersion: string;
    readonly synthesisInputHash: string;
  }): Promise<StoredPolicyInsight | null> {
    this.findCalls.push(input);
    if (this.onFind) this.onFind(input.synthesisInputHash);
    return this.findHits.get(input.synthesisInputHash) || null;
  }

  async insertOrGet(input: NewPolicyInsightRecord): Promise<{
    readonly status: "created" | "already_exists";
    readonly record: StoredPolicyInsight;
  }> {
    this.insertCalls.push(input);
    if (this.onInsert) this.onInsert(input);
    const existing = this.findHits.get(input.synthesisInputHash);
    if (existing) {
      return { status: "already_exists", record: existing };
    }
    const record = { ...input, id: this.nextId++ } as StoredPolicyInsight;
    this.findHits.set(input.synthesisInputHash, record);
    return { status: "created", record };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getCurrent(_input: {
    readonly pair: "SOL/USDC";
    readonly scopeKey: string;
    readonly wireContractSha256: string;
  }): Promise<StoredPolicyInsight | null> {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getHistory(_input: {
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

const makeDummyMarket = (nowUnixMs: number): RegimeCurrentResponse => ({
  schemaVersion: "1.0",
  symbol: "SOL/USDC",
  source: "birdeye",
  network: "solana-mainnet",
  poolAddress: "Pool123",
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

const makeDummyEvidence = (selectedAtUnixMs: number): SelectedEvidenceSummary => ({
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

const sampleThesis = (override: Partial<SrThesisV2> = {}): SrThesisV2 => ({
  asset: "SOL",
  timeframe: "4h",
  bias: "bullish",
  setupType: "breakout",
  supportLevels: ["140.0"],
  resistanceLevels: ["160.0"],
  entryZone: "145.0",
  targets: ["170.0"],
  invalidation: "135.0",
  trigger: "4h close above 150",
  chartReference: null,
  sourceHandle: "@trader_a",
  sourceChannel: "discord",
  sourceKind: "analyst",
  sourceReliability: "high",
  rawThesisText: "SOL bullish breakout above 150",
  collectedAt: "2026-07-31T00:00:00.000Z",
  publishedAt: "2026-07-31T00:00:00.000Z",
  sourceUrl: null,
  notes: null,
  ...override
});

const sampleBriefResponse = (
  theses: SrThesisV2[],
  source = "mco",
  briefId = "brief-123"
): SrLevelsV2CurrentResponse => ({
  schemaVersion: "2.0",
  source,
  symbol: "SOL/USDC",
  brief: {
    briefId,
    sourceRecordedAtIso: "2026-07-31T00:00:00.000Z",
    summary: "SOL SR Brief"
  },
  capturedAtIso: "2026-07-31T00:00:00.000Z",
  theses
});

describe("synthesizePolicyInsight SrTheses", () => {
  const scope: Scope = { kind: "pair" };
  const marketSelector = {
    source: "birdeye",
    network: "solana-mainnet",
    poolAddress: "Pool123",
    timeframe: "15m" as const
  };

  it("queries the primary mco SR brief for SOL USDC before fingerprint lookup", async () => {
    const events: string[] = [];
    const nowUnixMs = 1_000_000;
    const clock = { nowUnixMs: () => nowUnixMs };
    const getCurrentRegime = vi.fn().mockResolvedValue(makeDummyMarket(nowUnixMs));
    const selectEvidence = vi.fn().mockResolvedValue(makeDummyEvidence(nowUnixMs));
    const repository = new FakePolicyInsightRepository();

    repository.onFind = () => events.push("findBySynthesisInputHash");
    repository.onInsert = () => events.push("insertOrGet");

    const briefResponse = sampleBriefResponse([sampleThesis()]);

    const srThesesReadPort: SrThesesReadPort = {
      getCurrent: vi.fn().mockImplementation(async (symbol: string, source: string) => {
        events.push(`getCurrent:${symbol}:${source}`);
        return briefResponse;
      })
    };

    const useCase = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      srThesesReadPort,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    await useCase({ scope, marketSelector });

    expect(srThesesReadPort.getCurrent).toHaveBeenCalledTimes(1);
    expect(srThesesReadPort.getCurrent).toHaveBeenCalledWith("SOL/USDC", "mco");

    expect(events[0]).toBe("getCurrent:SOL/USDC:mco");
    expect(events[1]).toBe("findBySynthesisInputHash");
    expect(events[2]).toBe("insertOrGet");

    const insertedEnvelope = repository.insertCalls[0].synthesisInputJson;
    expect(insertedEnvelope.srTheses).toEqual([
      {
        ...sampleThesis(),
        source: "mco",
        briefId: "brief-123"
      }
    ]);
  });

  it("canonicalizes SR theses by source brief asset and source handle", async () => {
    const nowUnixMs = 1_000_000;
    const clock = { nowUnixMs: () => nowUnixMs };
    const getCurrentRegime = () => Promise.resolve(makeDummyMarket(nowUnixMs));
    const selectEvidence = () => Promise.resolve(makeDummyEvidence(nowUnixMs));

    const thesis1 = sampleThesis({ asset: "SOL", sourceHandle: "@trader_z" });
    const thesis2 = sampleThesis({ asset: "SOL", sourceHandle: "@trader_a" });
    const thesis3 = sampleThesis({ asset: "USDC", sourceHandle: "@trader_m" });

    // Order A: thesis1, thesis2, thesis3
    const repoA = new FakePolicyInsightRepository();
    const readPortA: SrThesesReadPort = {
      getCurrent: vi.fn().mockResolvedValue(sampleBriefResponse([thesis1, thesis2, thesis3]))
    };
    const useCaseA = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      srThesesReadPort: readPortA,
      repository: repoA,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });
    const resultA = await useCaseA({ scope, marketSelector });

    // Order B: thesis3, thesis1, thesis2
    const repoB = new FakePolicyInsightRepository();
    const readPortB: SrThesesReadPort = {
      getCurrent: vi.fn().mockResolvedValue(sampleBriefResponse([thesis3, thesis1, thesis2]))
    };
    const useCaseB = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      srThesesReadPort: readPortB,
      repository: repoB,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });
    const resultB = await useCaseB({ scope, marketSelector });

    // Both should produce the same canonical order:
    // sorted by (source, briefId, asset, sourceHandle):
    // 1. SOL, @trader_a
    // 2. SOL, @trader_z
    // 3. USDC, @trader_m
    const expectedTheses = [
      { ...thesis2, source: "mco", briefId: "brief-123" },
      { ...thesis1, source: "mco", briefId: "brief-123" },
      { ...thesis3, source: "mco", briefId: "brief-123" }
    ];

    expect(repoA.insertCalls[0].synthesisInputJson.srTheses).toEqual(expectedTheses);
    expect(repoB.insertCalls[0].synthesisInputJson.srTheses).toEqual(expectedTheses);

    expect(resultA.insightId).toBe(resultB.insightId);
    expect(repoA.insertCalls[0].synthesisInputHash).toBe(repoB.insertCalls[0].synthesisInputHash);
  });

  it("treats a missing current SR brief as a canonical empty input", async () => {
    const nowUnixMs = 1_000_000;
    const clock = { nowUnixMs: () => nowUnixMs };
    const getCurrentRegime = () => Promise.resolve(makeDummyMarket(nowUnixMs));
    const selectEvidence = () => Promise.resolve(makeDummyEvidence(nowUnixMs));
    const repository = new FakePolicyInsightRepository();

    const srThesesReadPort: SrThesesReadPort = {
      getCurrent: vi.fn().mockResolvedValue(null)
    };

    const useCase = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      srThesesReadPort,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    const result = await useCase({ scope, marketSelector });

    expect(result).toBeDefined();
    expect(repository.insertCalls[0].synthesisInputJson.srTheses).toEqual([]);
    expect(repository.insertCalls[0].synthesisInputHash).toBeDefined();
  });

  it("changes synthesis replay identity when SR thesis content changes", async () => {
    const nowUnixMs = 1_000_000;
    const clock = { nowUnixMs: () => nowUnixMs };
    const getCurrentRegime = () => Promise.resolve(makeDummyMarket(nowUnixMs));
    const selectEvidence = () => Promise.resolve(makeDummyEvidence(nowUnixMs));

    const repo1 = new FakePolicyInsightRepository();
    const readPort1: SrThesesReadPort = {
      getCurrent: vi
        .fn()
        .mockResolvedValue(sampleBriefResponse([sampleThesis({ bias: "bullish" })]))
    };
    const useCase1 = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      srThesesReadPort: readPort1,
      repository: repo1,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });
    const result1 = await useCase1({ scope, marketSelector });

    const repo2 = new FakePolicyInsightRepository();
    const readPort2: SrThesesReadPort = {
      getCurrent: vi
        .fn()
        .mockResolvedValue(sampleBriefResponse([sampleThesis({ bias: "bearish" })]))
    };
    const useCase2 = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      srThesesReadPort: readPort2,
      repository: repo2,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });
    const result2 = await useCase2({ scope, marketSelector });

    expect(result1.insightId).not.toBe(result2.insightId);
    expect(repo1.insertCalls[0].synthesisInputHash).not.toBe(
      repo2.insertCalls[0].synthesisInputHash
    );
  });

  it("exact SR replay returns the stored canonical winner", async () => {
    const nowUnixMs = 1_000_000;
    const clock = { nowUnixMs: () => nowUnixMs };
    const getCurrentRegime = () => Promise.resolve(makeDummyMarket(nowUnixMs));
    const selectEvidence = () => Promise.resolve(makeDummyEvidence(nowUnixMs));
    const repository = new FakePolicyInsightRepository();

    const briefResponse = sampleBriefResponse([sampleThesis()]);
    const srThesesReadPort: SrThesesReadPort = {
      getCurrent: vi.fn().mockResolvedValue(briefResponse)
    };

    const useCase = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      srThesesReadPort,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    const result1 = await useCase({ scope, marketSelector });
    expect(repository.insertCalls.length).toBe(1);

    const result2 = await useCase({ scope, marketSelector });
    expect(repository.insertCalls.length).toBe(1);
    expect(repository.findCalls.length).toBe(2);

    expect(result1).toEqual(result2);
  });

  it("does not persist or replay when the SR store read fails", async () => {
    const nowUnixMs = 1_000_000;
    const clock = { nowUnixMs: () => nowUnixMs };
    const getCurrentRegime = () => Promise.resolve(makeDummyMarket(nowUnixMs));
    const selectEvidence = () => Promise.resolve(makeDummyEvidence(nowUnixMs));
    const repository = new FakePolicyInsightRepository();

    const srThesesReadPort: SrThesesReadPort = {
      getCurrent: vi.fn().mockRejectedValue(new Error("Database connection error"))
    };

    const useCase = createSynthesizePolicyInsightUseCase({
      getCurrentRegime,
      selectEvidence,
      srThesesReadPort,
      repository,
      clock,
      ruleset: SOL_USDC_POLICY_V1
    });

    await expect(useCase({ scope, marketSelector })).rejects.toThrow("Database connection error");

    expect(repository.findCalls.length).toBe(0);
    expect(repository.insertCalls.length).toBe(0);
  });
});
