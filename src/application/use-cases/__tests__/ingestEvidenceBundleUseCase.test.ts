import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createIngestEvidenceBundleUseCase } from "../ingestEvidenceBundleUseCase.js";
import type {
  EvidenceBundleRepositoryPort,
  EvidenceBundleReceipt
} from "../../ports/evidenceBundleRepositoryPort.js";
import { EvidenceRunConflictError } from "../../ports/evidenceBundleRepositoryPort.js";
import type { ClockPort } from "../../ports/clock.js";
const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const __fixturesDir = resolve(__repoRoot, "contracts/evidence-bundle/v1/fixtures");
const __vectorsPath = resolve(__repoRoot, "contracts/evidence-bundle/v1/hash-vectors.json");

const DETERMINISTIC_ONLY_FIXTURE = JSON.parse(
  readFileSync(resolve(__fixturesDir, "valid/deterministic-only.json"), "utf-8")
);

interface EvidenceHashVector {
  name: string;
  payload: unknown;
  canonical: string;
  utf8ByteLength: number;
  sha256: string;
  schemaSha256: string;
}

interface HashVectorsDocument {
  schemaSha256: string;
  vectors: EvidenceHashVector[];
}

const loadVectors = (): HashVectorsDocument => {
  return JSON.parse(readFileSync(__vectorsPath, "utf-8"));
};

const getDeterministicOnlyVector = (): EvidenceHashVector => {
  const vectors = loadVectors();
  const vector = vectors.vectors.find((v) => v.name === "valid/deterministic-only");
  if (!vector) throw new Error("deterministic-only vector not found");
  return vector;
};

class FakeEvidenceBundleRepositoryPort implements EvidenceBundleRepositoryPort {
  public calls: Array<{
    bundle: unknown;
    payloadCanonical: string;
    payloadHash: string;
    receivedAtUnixMs: number;
  }> = [];

  public nextOutcome:
    | { status: "created"; receipt: EvidenceBundleReceipt }
    | { status: "already_ingested"; receipt: EvidenceBundleReceipt }
    | { throw: Error }
    | null = null;

  async append(input: {
    bundle: unknown;
    payloadCanonical: string;
    payloadHash: string;
    receivedAtUnixMs: number;
  }): Promise<
    | { status: "created"; receipt: EvidenceBundleReceipt }
    | { status: "already_ingested"; receipt: EvidenceBundleReceipt }
  > {
    this.calls.push(input);
    if (this.nextOutcome === null) {
      throw new Error("No outcome configured");
    }
    if ("throw" in this.nextOutcome) {
      throw this.nextOutcome.throw;
    }
    return this.nextOutcome;
  }

  async getLatest(): Promise<never> {
    throw new Error("Not implemented");
  }

  async getHistory(): Promise<never> {
    throw new Error("Not implemented");
  }
}

class FakeClockPort implements ClockPort {
  public constructor(private readonly fixedNowUnixMs: number) {}

  nowUnixMs(): number {
    return this.fixedNowUnixMs;
  }
}

describe("IngestEvidenceBundleUseCase", () => {
  const CLOCK_TIME = 1_700_000_000_000;
  const vector = getDeterministicOnlyVector();

  it("validates and hashes before append", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    repo.nextOutcome = {
      status: "created",
      receipt: {
        id: 1,
        evidenceHash: vector.sha256,
        receivedAtUnixMs: CLOCK_TIME,
        scopeKey: "pair"
      }
    };
    const clock = new FakeClockPort(CLOCK_TIME);
    const useCase = createIngestEvidenceBundleUseCase({ repository: repo, clock });

    const result = await useCase(DETERMINISTIC_ONLY_FIXTURE);

    expect(result.status).toBe("created");
    expect(result.runId).toBe("run-deterministic-only-001");
    expect(result.evidenceHash).toBe(vector.sha256);

    expect(repo.calls).toHaveLength(1);
    const appendCall = repo.calls[0];
    expect(appendCall.bundle).toEqual(DETERMINISTIC_ONLY_FIXTURE);
    expect(appendCall.payloadCanonical).toBe(vector.canonical);
    expect(appendCall.payloadHash).toBe(vector.sha256.toLowerCase());
    expect(appendCall.receivedAtUnixMs).toBe(CLOCK_TIME);
  });

  it("invalid evidence never reaches append", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    repo.nextOutcome = {
      status: "created",
      receipt: {
        id: 1,
        evidenceHash: vector.sha256,
        receivedAtUnixMs: CLOCK_TIME,
        scopeKey: "pair"
      }
    };
    const clock = new FakeClockPort(CLOCK_TIME);
    const useCase = createIngestEvidenceBundleUseCase({ repository: repo, clock });

    await expect(useCase({ schemaVersion: "invalid" })).rejects.toThrow();
    expect(repo.calls).toHaveLength(0);
  });

  it("preserves the original receipt on exact replay", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const existingReceipt: EvidenceBundleReceipt = {
      id: 42,
      evidenceHash: vector.sha256.toLowerCase(),
      receivedAtUnixMs: CLOCK_TIME - 1000,
      scopeKey: "pair"
    };
    repo.nextOutcome = { status: "already_ingested", receipt: existingReceipt };
    const clock = new FakeClockPort(CLOCK_TIME);
    const useCase = createIngestEvidenceBundleUseCase({ repository: repo, clock });

    const result = await useCase(DETERMINISTIC_ONLY_FIXTURE);

    expect(result.status).toBe("already_ingested");
    expect(result.receipt).toBe(existingReceipt);
    expect(result.receipt.id).toBe(42);
  });

  it("propagates evidence run conflicts", async () => {
    const repo = new FakeEvidenceBundleRepositoryPort();
    const conflictError = new EvidenceRunConflictError(
      "Run ID already exists",
      "existing-hash",
      "incoming-hash"
    );
    repo.nextOutcome = { throw: conflictError };
    const clock = new FakeClockPort(CLOCK_TIME);
    const useCase = createIngestEvidenceBundleUseCase({ repository: repo, clock });

    await expect(useCase(DETERMINISTIC_ONLY_FIXTURE)).rejects.toThrow(EvidenceRunConflictError);
    await expect(useCase(DETERMINISTIC_ONLY_FIXTURE)).rejects.toThrow("Run ID already exists");
  });
});
