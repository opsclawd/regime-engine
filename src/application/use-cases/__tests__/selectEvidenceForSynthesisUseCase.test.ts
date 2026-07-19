import { describe, expect, it, vi } from "vitest";
import { EvidenceStoreUnavailableError } from "../../../application/errors/evidenceErrors.js";
import type {
  EvidenceBundleRecord,
  EvidenceBundleRepositoryPort,
  EvidenceSourceFilter
} from "../../../application/ports/evidenceBundleRepositoryPort.js";
import type { ClockPort } from "../../../application/ports/clock.js";
import type { Scope, EvidenceBundleV1 } from "../../../contract/evidence/v1/types.generated.js";
import type { EvidenceSelectionPolicy } from "../../../engine/evidence/selectionPolicy.js";
import type { SelectedEvidenceSummary } from "../../../engine/evidence/selectEvidence.js";
import { createSelectEvidenceForSynthesisUseCase } from "../selectEvidenceForSynthesisUseCase.js";

class FakeEvidenceBundleRepositoryPort implements EvidenceBundleRepositoryPort {
  public getLatestCalls: Array<{
    pair: "SOL/USDC";
    scope: Scope;
    source: EvidenceSourceFilter | null;
    nowUnixMs: number;
  }> = [];

  public nextRecords: EvidenceBundleRecord[] = [];
  public errorToThrow: Error | null = null;

  async getLatest(input: {
    pair: "SOL/USDC";
    scope: Scope;
    source: EvidenceSourceFilter | null;
    nowUnixMs: number;
  }): Promise<EvidenceBundleRecord[]> {
    this.getLatestCalls.push(input);
    if (this.errorToThrow) {
      throw this.errorToThrow;
    }
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
  public callsCount = 0;
  public constructor(private readonly fixedNowUnixMs: number) {}

  nowUnixMs(): number {
    this.callsCount++;
    return this.fixedNowUnixMs;
  }
}

const makeFakeRecord = (id: number): EvidenceBundleRecord =>
  ({
    id,
    bundle: {
      schemaVersion: "evidence-bundle.v1"
    } as unknown as EvidenceBundleV1,
    evidenceHash: `hash-${id}`,
    receivedAtUnixMs: 1_700_000_000_000,
    lifecycle: "FRESH"
  }) as EvidenceBundleRecord;

describe("SelectEvidenceForSynthesisUseCase", () => {
  it("captures the clock once and reads all current sources for the exact scope", async () => {
    const clock = new FakeClockPort(123456789);
    const repository = new FakeEvidenceBundleRepositoryPort();
    const scope: Scope = { kind: "pair" };
    const fakeRecords = [makeFakeRecord(1)];
    repository.nextRecords = fakeRecords;

    const selectorSpy = vi.fn().mockResolvedValue({} as SelectedEvidenceSummary);

    const useCase = createSelectEvidenceForSynthesisUseCase({
      clock,
      repository,
      selector: selectorSpy
    });

    await useCase({ scope });

    expect(clock.callsCount).toBe(1);
    expect(repository.getLatestCalls).toHaveLength(1);
    expect(repository.getLatestCalls[0]).toEqual({
      pair: "SOL/USDC",
      scope,
      source: null,
      nowUnixMs: 123456789
    });
  });

  it("passes the same records instant scope and configured policy to the selector", async () => {
    const clock = new FakeClockPort(123456789);
    const repository = new FakeEvidenceBundleRepositoryPort();
    const scope: Scope = { kind: "pair" };
    const fakeRecords = [makeFakeRecord(1)];
    repository.nextRecords = fakeRecords;

    const policy: EvidenceSelectionPolicy = {
      version: "test-policy",
      minimumEffectiveScoreBps: 1000,
      staleWeightBps: 2000,
      maxSelectedPerFamily: 5,
      defaultSourceQualityBps: 5000,
      sourceQualityBps: {},
      provenanceQualityBps: {
        deterministic_calculator: 1000,
        derived: 1000,
        collected: 1000,
        human_authored: 1000
      }
    };

    const selectorSpy = vi.fn().mockReturnValue({ dummy: true });

    const useCase = createSelectEvidenceForSynthesisUseCase({
      clock,
      repository,
      selector: selectorSpy,
      policy
    });

    const result = await useCase({ scope });

    expect(result).toEqual({ dummy: true });
    expect(selectorSpy).toHaveBeenCalledTimes(1);
    expect(selectorSpy).toHaveBeenCalledWith({
      records: fakeRecords,
      selectedAtUnixMs: 123456789,
      scope,
      policy
    });
  });

  it("returns degraded success when the repository returns no records", async () => {
    const clock = new FakeClockPort(123456789);
    const repository = new FakeEvidenceBundleRepositoryPort();
    const scope: Scope = { kind: "pair" };
    repository.nextRecords = [];

    const selectorSpy = vi.fn().mockReturnValue({ dummyDegraded: true });

    const useCase = createSelectEvidenceForSynthesisUseCase({
      clock,
      repository,
      selector: selectorSpy
    });

    const result = await useCase({ scope });

    expect(result).toEqual({ dummyDegraded: true });
    expect(selectorSpy).toHaveBeenCalledTimes(1);
    expect(selectorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        records: []
      })
    );
  });

  it("propagates EvidenceStoreUnavailableError unchanged without retry", async () => {
    const clock = new FakeClockPort(123456789);
    const repository = new FakeEvidenceBundleRepositoryPort();
    const scope: Scope = { kind: "pair" };
    const error = new EvidenceStoreUnavailableError("Store is down");
    repository.errorToThrow = error;

    const selectorSpy = vi.fn();

    const useCase = createSelectEvidenceForSynthesisUseCase({
      clock,
      repository,
      selector: selectorSpy
    });

    await expect(useCase({ scope })).rejects.toThrow(error);
    expect(selectorSpy).not.toHaveBeenCalled();
  });

  it("does not invoke history writes candles regime plan ledger or HTTP dependencies", async () => {
    // Assert dependency isolation by checking the type definition and usage:
    // The dependency surface has only repository, clock, selector, and policy.
    // In TDD test, we verify that when it runs, it doesn't try to access any other methods
    // since repository mock only has getLatest (other methods throw "Not implemented" or errors)
    const clock = new FakeClockPort(123456789);
    const repository = new FakeEvidenceBundleRepositoryPort();
    const scope: Scope = { kind: "pair" };
    repository.nextRecords = [];

    const selectorSpy = vi.fn().mockReturnValue({ isolated: true });

    const useCase = createSelectEvidenceForSynthesisUseCase({
      clock,
      repository,
      selector: selectorSpy
    });

    const result = await useCase({ scope });
    expect(result).toEqual({ isolated: true });
  });
});
