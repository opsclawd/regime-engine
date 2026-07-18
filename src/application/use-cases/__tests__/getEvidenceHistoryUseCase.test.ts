import { describe, expect, it } from "vitest";
import type {
  EvidenceBundleRecord,
  EvidenceBundleRepositoryPort,
  EvidenceHistoryCursor,
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
    limit?: number;
    cursor: EvidenceHistoryCursor | null;
    nowUnixMs: number;
  }> = [];

  public nextRecords: EvidenceBundleRecord[] = [];
  public nextCursor: EvidenceHistoryCursor | null = null;

  async getLatest(): Promise<never> {
    throw new Error("Not implemented");
  }

  async getHistory(input: {
    pair: "SOL/USDC";
    scope: Scope;
    source: EvidenceSourceFilter | null;
    limit?: number;
    cursor: EvidenceHistoryCursor | null;
    nowUnixMs: number;
  }): Promise<{ records: EvidenceBundleRecord[]; nextCursor: EvidenceHistoryCursor | null }> {
    this.calls.push(input);
    return { records: this.nextRecords, nextCursor: this.nextCursor };
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

describe("GetEvidenceHistoryUseCase", () => {
  const CLOCK_TIME = 1_700_000_000_000;

  describe("queries one bounded history page at one injected instant", () => {
    it("default limit with null cursor and null source for pair scope", async () => {
      const { createGetEvidenceHistoryUseCase } = await import("../getEvidenceHistoryUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      const records = [makeFakeRecord(1, "FRESH"), makeFakeRecord(2, "STALE")];
      repo.nextRecords = records;
      repo.nextCursor = { receivedAtUnixMs: 1_700_000_001_000, id: 2 };
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetEvidenceHistoryUseCase({ repository: repo, clock });

      const scope: Scope = { kind: "pair" };
      const result = await useCase({ scope, source: null, limit: 10, cursor: null });

      expect(result.queriedAtUnixMs).toBe(CLOCK_TIME);
      expect(result.records).toHaveLength(2);
      expect(result.records[0].id).toBe(1);
      expect(result.records[1].id).toBe(2);
      expect(result.nextCursor).toEqual({ receivedAtUnixMs: 1_700_000_001_000, id: 2 });

      expect(repo.calls).toHaveLength(1);
      const call = repo.calls[0];
      expect(call.pair).toBe("SOL/USDC");
      expect(call.scope).toEqual(scope);
      expect(call.source).toBeNull();
      expect(call.limit).toBe(10);
      expect(call.cursor).toBeNull();
      expect(call.nowUnixMs).toBe(CLOCK_TIME);
    });

    it("explicit limit with non-null cursor for whirlpool scope", async () => {
      const { createGetEvidenceHistoryUseCase } = await import("../getEvidenceHistoryUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      const records = [makeFakeRecord(5, "EXPIRED")];
      repo.nextRecords = records;
      repo.nextCursor = null;
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetEvidenceHistoryUseCase({ repository: repo, clock });

      const scope: Scope = {
        kind: "whirlpool",
        network: "solana-mainnet",
        whirlpoolAddress: "ABC123"
      };
      const cursor: EvidenceHistoryCursor = { receivedAtUnixMs: 1_700_000_000_500, id: 3 };
      const source: EvidenceSourceFilter = { publisher: "sol-usdc-clmm-intelligence" };
      const result = await useCase({ scope, source, limit: 25, cursor });

      expect(result.queriedAtUnixMs).toBe(CLOCK_TIME);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].id).toBe(5);
      expect(result.nextCursor).toBeNull();

      expect(repo.calls).toHaveLength(1);
      const call = repo.calls[0];
      expect(call.pair).toBe("SOL/USDC");
      expect(call.scope).toEqual(scope);
      expect(call.source).toEqual(source);
      expect(call.limit).toBe(25);
      expect(call.cursor).toEqual(cursor);
      expect(call.nowUnixMs).toBe(CLOCK_TIME);
    });

    it("wallet scope with sourceId-only source filter", async () => {
      const { createGetEvidenceHistoryUseCase } = await import("../getEvidenceHistoryUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      const records = [makeFakeRecord(10, "STALE"), makeFakeRecord(20, "FRESH")];
      repo.nextRecords = records;
      repo.nextCursor = { receivedAtUnixMs: 1_700_000_002_000, id: 20 };
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetEvidenceHistoryUseCase({ repository: repo, clock });

      const scope: Scope = {
        kind: "wallet",
        network: "solana-mainnet",
        walletAddress: "WalletXYZ"
      };
      const source: EvidenceSourceFilter = { sourceId: "src-001" };
      const result = await useCase({ scope, source, limit: 50, cursor: null });

      expect(result.queriedAtUnixMs).toBe(CLOCK_TIME);
      expect(result.records).toHaveLength(2);
      expect(result.records[0].id).toBe(10);
      expect(result.records[1].id).toBe(20);
      expect(result.nextCursor).toEqual({ receivedAtUnixMs: 1_700_000_002_000, id: 20 });

      expect(repo.calls).toHaveLength(1);
      const call = repo.calls[0];
      expect(call.pair).toBe("SOL/USDC");
      expect(call.scope).toEqual(scope);
      expect(call.source).toEqual(source);
      expect(call.limit).toBe(50);
      expect(call.cursor).toBeNull();
      expect(call.nowUnixMs).toBe(CLOCK_TIME);
    });

    it("position scope with both publisher and sourceId source filter", async () => {
      const { createGetEvidenceHistoryUseCase } = await import("../getEvidenceHistoryUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      const records = [makeFakeRecord(100, "FRESH")];
      repo.nextRecords = records;
      repo.nextCursor = { receivedAtUnixMs: 1_700_000_010_000, id: 100 };
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetEvidenceHistoryUseCase({ repository: repo, clock });

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
      const result = await useCase({ scope, source, limit: 100, cursor: null });

      expect(result.queriedAtUnixMs).toBe(CLOCK_TIME);
      expect(result.records).toHaveLength(1);
      expect(result.records[0].id).toBe(100);
      expect(result.nextCursor).toEqual({ receivedAtUnixMs: 1_700_000_010_000, id: 100 });

      expect(repo.calls).toHaveLength(1);
      const call = repo.calls[0];
      expect(call.pair).toBe("SOL/USDC");
      expect(call.scope).toEqual(scope);
      expect(call.source).toEqual(source);
      expect(call.limit).toBe(100);
      expect(call.cursor).toBeNull();
      expect(call.nowUnixMs).toBe(CLOCK_TIME);
    });

    it("returns records in repository order with stale and expired included", async () => {
      const { createGetEvidenceHistoryUseCase } = await import("../getEvidenceHistoryUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      const records = [
        makeFakeRecord(3, "EXPIRED"),
        makeFakeRecord(1, "STALE"),
        makeFakeRecord(5, "FRESH"),
        makeFakeRecord(2, "EXPIRED")
      ];
      repo.nextRecords = records;
      repo.nextCursor = { receivedAtUnixMs: 1_700_000_000_500, id: 5 };
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetEvidenceHistoryUseCase({ repository: repo, clock });

      const result = await useCase({
        scope: { kind: "pair" },
        source: null,
        limit: 10,
        cursor: null
      });

      expect(result.records).toHaveLength(4);
      expect(result.records[0].id).toBe(3);
      expect(result.records[0].lifecycle).toBe("EXPIRED");
      expect(result.records[1].id).toBe(1);
      expect(result.records[1].lifecycle).toBe("STALE");
      expect(result.records[2].id).toBe(5);
      expect(result.records[2].lifecycle).toBe("FRESH");
      expect(result.records[3].id).toBe(2);
      expect(result.records[3].lifecycle).toBe("EXPIRED");
      expect(result.nextCursor).toEqual({ receivedAtUnixMs: 1_700_000_000_500, id: 5 });
    });

    it("uses clock only once for repository call", async () => {
      const { createGetEvidenceHistoryUseCase } = await import("../getEvidenceHistoryUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      repo.nextRecords = [makeFakeRecord(1, "FRESH")];
      repo.nextCursor = null;
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetEvidenceHistoryUseCase({ repository: repo, clock });

      await useCase({ scope: { kind: "pair" }, source: null, limit: 10, cursor: null });

      expect(repo.calls).toHaveLength(1);
      expect(repo.calls[0].nowUnixMs).toBe(CLOCK_TIME);
    });

    it("nextCursor passes through unchanged when null", async () => {
      const { createGetEvidenceHistoryUseCase } = await import("../getEvidenceHistoryUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      repo.nextRecords = [makeFakeRecord(1, "FRESH")];
      repo.nextCursor = null;
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetEvidenceHistoryUseCase({ repository: repo, clock });

      const result = await useCase({
        scope: { kind: "pair" },
        source: null,
        limit: 10,
        cursor: null
      });

      expect(result.nextCursor).toBeNull();
    });

    it("nextCursor passes through unchanged when non-null", async () => {
      const { createGetEvidenceHistoryUseCase } = await import("../getEvidenceHistoryUseCase.js");
      const repo = new FakeEvidenceBundleRepositoryPort();
      const expectedCursor: EvidenceHistoryCursor = { receivedAtUnixMs: 1_700_000_005_000, id: 50 };
      repo.nextRecords = [makeFakeRecord(1, "FRESH")];
      repo.nextCursor = expectedCursor;
      const clock = new FakeClockPort(CLOCK_TIME);
      const useCase = createGetEvidenceHistoryUseCase({ repository: repo, clock });

      const result = await useCase({
        scope: { kind: "pair" },
        source: null,
        limit: 10,
        cursor: null
      });

      expect(result.nextCursor).toEqual(expectedCursor);
    });
  });
});
