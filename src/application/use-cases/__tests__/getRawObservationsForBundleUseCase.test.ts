import { describe, expect, it } from "vitest";
import type { EvidenceBundleRepositoryPort } from "../../ports/evidenceBundleRepositoryPort.js";
import type {
  RawObservationsReadPort,
  RawObservation
} from "../../ports/rawObservationsReadPort.js";
import {
  RawObservationIdentifierValidationError,
  EvidenceBundleNotFoundError,
  RawObservationsNotFoundError
} from "../../errors/evidenceErrors.js";
import { createGetRawObservationsForBundleUseCase } from "../getRawObservationsForBundleUseCase.js";

class FakeEvidenceBundleRepositoryPort implements EvidenceBundleRepositoryPort {
  public getRunIdByIdCalls: number[] = [];
  public runIdMap: Record<number, string | null> = {};

  async getRunIdById(id: number): Promise<string | null> {
    this.getRunIdByIdCalls.push(id);
    return this.runIdMap[id] ?? null;
  }

  async append(): Promise<never> {
    throw new Error("Not implemented");
  }

  async getLatest(): Promise<never> {
    throw new Error("Not implemented");
  }

  async getHistory(): Promise<never> {
    throw new Error("Not implemented");
  }
}

class FakeRawObservationsReadPort implements RawObservationsReadPort {
  public getByRunIdCalls: string[] = [];
  public observationsMap: Record<string, RawObservation[]> = {};

  async getByRunId(runId: string): Promise<readonly RawObservation[]> {
    this.getByRunIdCalls.push(runId);
    return this.observationsMap[runId] ?? [];
  }
}

describe("getRawObservationsForBundleUseCase", () => {
  it("resolves a numeric identifier through the evidence bundle before reading observations", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const rawObs = new FakeRawObservationsReadPort();
    repo.runIdMap[42] = "run-42";
    const items: RawObservation[] = [{ price: 100, volume: 50 }];
    rawObs.observationsMap["run-42"] = items;

    const useCase = createGetRawObservationsForBundleUseCase({
      evidenceRepository: repo,
      rawObservations: rawObs
    });

    const result = await useCase({ identifier: "42" });

    expect(repo.getRunIdByIdCalls).toEqual([42]);
    expect(rawObs.getByRunIdCalls).toEqual(["run-42"]);
    expect(result).toEqual({ runId: "run-42", items });
  });

  it("uses a nonnumeric identifier directly as the pipeline run id", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const rawObs = new FakeRawObservationsReadPort();
    const items: RawObservation[] = [{ id: "obs-1" }];
    rawObs.observationsMap["pipeline-run-99"] = items;

    const useCase = createGetRawObservationsForBundleUseCase({
      evidenceRepository: repo,
      rawObservations: rawObs
    });

    const result = await useCase({ identifier: "pipeline-run-99" });

    expect(repo.getRunIdByIdCalls).toEqual([]);
    expect(rawObs.getByRunIdCalls).toEqual(["pipeline-run-99"]);
    expect(result).toEqual({ runId: "pipeline-run-99", items });
  });

  it("rejects invalid numeric bundle identifiers before accessing either port", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const rawObs = new FakeRawObservationsReadPort();
    const useCase = createGetRawObservationsForBundleUseCase({
      evidenceRepository: repo,
      rawObservations: rawObs
    });

    const invalidNumericIdentifiers = ["0", "0123", "9007199254740993"];

    for (const id of invalidNumericIdentifiers) {
      await expect(useCase({ identifier: id })).rejects.toThrow(
        RawObservationIdentifierValidationError
      );
    }

    expect(repo.getRunIdByIdCalls).toEqual([]);
    expect(rawObs.getByRunIdCalls).toEqual([]);
  });

  it("rejects empty or overlong run identifiers before accessing either port", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const rawObs = new FakeRawObservationsReadPort();
    const useCase = createGetRawObservationsForBundleUseCase({
      evidenceRepository: repo,
      rawObservations: rawObs
    });

    const invalidRunIdentifiers = ["", "a".repeat(257)];

    for (const id of invalidRunIdentifiers) {
      await expect(useCase({ identifier: id })).rejects.toThrow(
        RawObservationIdentifierValidationError
      );
    }

    expect(repo.getRunIdByIdCalls).toEqual([]);
    expect(rawObs.getByRunIdCalls).toEqual([]);
  });

  it("reports a missing numeric bundle without querying raw observations", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const rawObs = new FakeRawObservationsReadPort();
    repo.runIdMap[999] = null;

    const useCase = createGetRawObservationsForBundleUseCase({
      evidenceRepository: repo,
      rawObservations: rawObs
    });

    await expect(useCase({ identifier: "999" })).rejects.toThrow(EvidenceBundleNotFoundError);

    expect(repo.getRunIdByIdCalls).toEqual([999]);
    expect(rawObs.getByRunIdCalls).toEqual([]);
  });

  it("reports missing observations for a resolved bundle run id", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const rawObs = new FakeRawObservationsReadPort();
    repo.runIdMap[50] = "run-empty";
    rawObs.observationsMap["run-empty"] = [];

    const useCase = createGetRawObservationsForBundleUseCase({
      evidenceRepository: repo,
      rawObservations: rawObs
    });

    try {
      await useCase({ identifier: "50" });
      expect.fail("Should have thrown RawObservationsNotFoundError");
    } catch (err) {
      expect(err).toBeInstanceOf(RawObservationsNotFoundError);
      expect((err as RawObservationsNotFoundError).runId).toBe("run-empty");
    }

    expect(repo.getRunIdByIdCalls).toEqual([50]);
    expect(rawObs.getByRunIdCalls).toEqual(["run-empty"]);
  });

  it("reports missing observations for a direct run id", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const rawObs = new FakeRawObservationsReadPort();
    rawObs.observationsMap["direct-empty"] = [];

    const useCase = createGetRawObservationsForBundleUseCase({
      evidenceRepository: repo,
      rawObservations: rawObs
    });

    try {
      await useCase({ identifier: "direct-empty" });
      expect.fail("Should have thrown RawObservationsNotFoundError");
    } catch (err) {
      expect(err).toBeInstanceOf(RawObservationsNotFoundError);
      expect((err as RawObservationsNotFoundError).runId).toBe("direct-empty");
    }

    expect(repo.getRunIdByIdCalls).toEqual([]);
    expect(rawObs.getByRunIdCalls).toEqual(["direct-empty"]);
  });

  it("returns the resolved run id with observations without mutating them", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const rawObs = new FakeRawObservationsReadPort();
    repo.runIdMap[10] = "run-10";
    const item1 = { price: 100, timestamp: 1000 };
    const item2 = { price: 105, timestamp: 2000 };
    const items: RawObservation[] = [item1, item2];
    rawObs.observationsMap["run-10"] = items;

    const useCase = createGetRawObservationsForBundleUseCase({
      evidenceRepository: repo,
      rawObservations: rawObs
    });

    const result = await useCase({ identifier: "10" });

    expect(result.runId).toBe("run-10");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toBe(item1);
    expect(result.items[1]).toBe(item2);
  });
});
