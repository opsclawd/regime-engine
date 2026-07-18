import { describe, expect, it } from "vitest";
import type {
  EvidenceBundleRecord,
  EvidenceBundleRepositoryPort,
  EvidenceSourceFilter
} from "../../ports/evidenceBundleRepositoryPort.js";
import type { ClockPort } from "../../ports/clock.js";
import type { EvidenceBundleV1, Scope } from "../../../contract/evidence/v1/types.generated.js";
import { EvidenceLifecycle } from "../../ports/evidenceBundleRepositoryPort.js";

class FakeEvidenceBundleRepositoryPort implements EvidenceBundleRepositoryPort {
  public calls: Array<{
    pair: "SOL/USDC";
    scope: Scope;
    source: EvidenceSourceFilter | null;
    nowUnixMs: number;
  }> = [];

  public nextRecords: EvidenceBundleRecord[] = [];

  async getLatest(input: {
    pair: "SOL/USDC";
    scope: Scope;
    source: EvidenceSourceFilter | null;
    nowUnixMs: number;
  }): Promise<EvidenceBundleRecord[]> {
    this.calls.push(input);
    return this.nextRecords;
  }

  async getHistory(): Promise<never> {
    throw new Error("Not implemented");
  }

  async append(): Promise<never> {
    throw new Error("Not implemented");
  }
}

class FakeClockPort implements ClockPort {
  public constructor(private readonly fixedNowUnixMs: number) {}

  nowUnixMs(): number {
    return this.fixedNowUnixMs;
  }
}

const makeFakeRecord = (id: number, lifecycle: EvidenceLifecycle): EvidenceBundleRecord =>
  ({
    id,
    bundle: {
      schemaVersion: "evidence-bundle.v1",
      pair: "SOL/USDC",
      scope: { kind: "pair" },
      source: { publisher: "sol-usdc-clmm-intelligence", sourceId: "test", sourceVersion: "1" },
      runId: `run-${id}`,
      correlationId: `corr-${id}`,
      createdAt: "2025-01-01T00:00:00.000Z",
      asOf: "2025-01-01T00:00:00.000Z",
      freshUntil: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-01-02T00:00:00.000Z",
      deterministicFeatures: [],
      contextualEvidence: {
        supportResistance: [],
        flows: [],
        derivatives: [],
        events: [],
        newsRegulatory: []
      },
      researchBrief: null,
      sourceReferences: [],
      assessment: {
        overallConfidenceBps: 0,
        quality: "complete",
        coverage: {
          deterministic: "available",
          supportResistance: "available",
          flows: "available",
          derivatives: "available",
          events: "available",
          newsRegulatory: "available",
          researchBrief: "available"
        },
        warnings: []
      },
      provenance: {
        pipelineVersion: "1.0.0",
        gitCommit: "0".repeat(64),
        environment: "test",
        upstreamRunIds: []
      }
    } as unknown as EvidenceBundleV1,
    evidenceHash: `hash-${id}`,
    receivedAtUnixMs: 1_700_000_000_000 + id * 1000,
    lifecycle
  }) as EvidenceBundleRecord;

describe("GetCurrentEvidenceUseCase", () => {
  const CLOCK_TIME = 1_700_000_000_000;

  describe("queries current at one injected instant", () => {
    it("pair scope with null source", async () => {
      const { createGetCurrentEvidenceUseCase } = await import("../getCurrentEvidenceUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      repo.nextRecords = [
        makeFakeRecord(1, "FRESH"),
        makeFakeRecord(2, "STALE"),
        makeFakeRecord(3, "EXPIRED")
      ];
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetCurrentEvidenceUseCase({ repository: repo, clock });

      const scope: Scope = { kind: "pair" };
      const result = await useCase({ scope, source: null });

      expect(result.queriedAtUnixMs).toBe(CLOCK_TIME);
      expect(result.records).toHaveLength(3);
      expect(result.records[0].id).toBe(1);
      expect(result.records[1].id).toBe(2);
      expect(result.records[2].id).toBe(3);

      expect(repo.calls).toHaveLength(1);
      const call = repo.calls[0];
      expect(call.pair).toBe("SOL/USDC");
      expect(call.scope).toEqual(scope);
      expect(call.source).toBeNull();
      expect(call.nowUnixMs).toBe(CLOCK_TIME);
    });

    it("whirlpool scope with publisher-only source", async () => {
      const { createGetCurrentEvidenceUseCase } = await import("../getCurrentEvidenceUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      repo.nextRecords = [makeFakeRecord(10, "FRESH")];
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetCurrentEvidenceUseCase({ repository: repo, clock });

      const scope: Scope = {
        kind: "whirlpool",
        network: "solana-mainnet",
        whirlpoolAddress: "ABC123"
      };
      const source: EvidenceSourceFilter = { publisher: "sol-usdc-clmm-intelligence" };
      const result = await useCase({ scope, source });

      expect(result.queriedAtUnixMs).toBe(CLOCK_TIME);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].id).toBe(10);

      expect(repo.calls).toHaveLength(1);
      const call = repo.calls[0];
      expect(call.pair).toBe("SOL/USDC");
      expect(call.scope).toEqual(scope);
      expect(call.source).toEqual(source);
      expect(call.nowUnixMs).toBe(CLOCK_TIME);
    });

    it("wallet scope with sourceId-only source", async () => {
      const { createGetCurrentEvidenceUseCase } = await import("../getCurrentEvidenceUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      repo.nextRecords = [makeFakeRecord(20, "STALE")];
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetCurrentEvidenceUseCase({ repository: repo, clock });

      const scope: Scope = {
        kind: "wallet",
        network: "solana-mainnet",
        walletAddress: "WalletXYZ"
      };
      const source: EvidenceSourceFilter = { sourceId: "src-001" };
      const result = await useCase({ scope, source });

      expect(result.queriedAtUnixMs).toBe(CLOCK_TIME);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].id).toBe(20);
      expect(result.records[0].lifecycle).toBe("STALE");

      expect(repo.calls).toHaveLength(1);
      const call = repo.calls[0];
      expect(call.pair).toBe("SOL/USDC");
      expect(call.scope).toEqual(scope);
      expect(call.source).toEqual(source);
      expect(call.nowUnixMs).toBe(CLOCK_TIME);
    });

    it("position scope with both publisher and sourceId source", async () => {
      const { createGetCurrentEvidenceUseCase } = await import("../getCurrentEvidenceUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      repo.nextRecords = [makeFakeRecord(30, "FRESH"), makeFakeRecord(40, "EXPIRED")];
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetCurrentEvidenceUseCase({ repository: repo, clock });

      const scope: Scope = {
        kind: "position",
        network: "solana-mainnet",
        walletAddress: "WalletABC",
        whirlpoolAddress: "WhirlpoolDEF",
        positionId: "Pos001"
      };
      const source: EvidenceSourceFilter = {
        publisher: "sol-usdc-clmm-intelligence",
        sourceId: "src-002"
      };
      const result = await useCase({ scope, source });

      expect(result.queriedAtUnixMs).toBe(CLOCK_TIME);
      expect(result.records).toHaveLength(2);
      expect(result.records[0].id).toBe(30);
      expect(result.records[1].id).toBe(40);
      expect(result.records[1].lifecycle).toBe("EXPIRED");

      expect(repo.calls).toHaveLength(1);
      const call = repo.calls[0];
      expect(call.pair).toBe("SOL/USDC");
      expect(call.scope).toEqual(scope);
      expect(call.source).toEqual(source);
      expect(call.nowUnixMs).toBe(CLOCK_TIME);
    });

    it("returns records in repository order including stale and expired", async () => {
      const { createGetCurrentEvidenceUseCase } = await import("../getCurrentEvidenceUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      repo.nextRecords = [
        makeFakeRecord(5, "EXPIRED"),
        makeFakeRecord(3, "STALE"),
        makeFakeRecord(1, "FRESH"),
        makeFakeRecord(7, "EXPIRED")
      ];
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetCurrentEvidenceUseCase({ repository: repo, clock });

      const result = await useCase({ scope: { kind: "pair" }, source: null });

      expect(result.records).toHaveLength(4);
      expect(result.records[0].id).toBe(5);
      expect(result.records[0].lifecycle).toBe("EXPIRED");
      expect(result.records[1].id).toBe(3);
      expect(result.records[1].lifecycle).toBe("STALE");
      expect(result.records[2].id).toBe(1);
      expect(result.records[2].lifecycle).toBe("FRESH");
      expect(result.records[3].id).toBe(7);
      expect(result.records[3].lifecycle).toBe("EXPIRED");
    });

    it("uses clock only once for all repository calls", async () => {
      const { createGetCurrentEvidenceUseCase } = await import("../getCurrentEvidenceUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      repo.nextRecords = [makeFakeRecord(1, "FRESH")];
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetCurrentEvidenceUseCase({ repository: repo, clock });

      await useCase({ scope: { kind: "pair" }, source: null });

      expect(repo.calls).toHaveLength(1);
      expect(repo.calls[0].nowUnixMs).toBe(CLOCK_TIME);
    });
  });
});
