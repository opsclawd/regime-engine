import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { createEvidenceIngestHandler } from "../evidenceIngest.js";
import { createIngestEvidenceBundleUseCase } from "../../../../application/use-cases/ingestEvidenceBundleUseCase.js";
import { PolicyInsightStoreUnavailableError } from "../../../../application/errors/policyInsightErrors.js";
import type {
  EvidenceBundleRepositoryPort,
  EvidenceBundleReceipt
} from "../../../../application/ports/evidenceBundleRepositoryPort.js";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../..");
const __fixturesDir = resolve(__repoRoot, "contracts/evidence-bundle/v1/fixtures");
const DETERMINISTIC_ONLY_FIXTURE = JSON.parse(
  readFileSync(resolve(__fixturesDir, "valid/deterministic-only.json"), "utf-8")
);

const VALID_POSITION_BUNDLE = {
  ...DETERMINISTIC_ONLY_FIXTURE,
  scope: {
    kind: "position",
    network: "solana-mainnet",
    walletAddress: "wallet12345678",
    whirlpoolAddress: "whirlpool123456789",
    positionId: "position123"
  }
};

describe("evidenceIngest position synthesis handler", () => {
  it("a queue outage after source persistence returns a retryable 503 and replay closes the wake-up gap", async () => {
    process.env.EVIDENCE_INGEST_TOKEN = "test-token";

    const receipt: EvidenceBundleReceipt = {
      id: 101,
      evidenceHash: "0146b073cc607b47e52c615f6299294b1fd8f133d8a4b128bd2a95dc20f77b17",
      receivedAtUnixMs: 1700000000000,
      scopeKey: "position:15:wallet12345678:19:whirlpool123456789:10:position123"
    };

    let appendCallCount = 0;
    const fakeRepo: EvidenceBundleRepositoryPort = {
      append: vi.fn().mockImplementation(async () => {
        appendCallCount += 1;
        if (appendCallCount === 1) {
          return { status: "created", receipt };
        }
        return { status: "already_ingested", receipt };
      }),
      getLatest: vi.fn(),
      getHistory: vi.fn(),
      getRunIdById: vi.fn().mockResolvedValue(null)
    };

    let synthesisCallCount = 0;
    const requestPositionSynthesisFn = vi.fn().mockImplementation(async () => {
      synthesisCallCount += 1;
      if (synthesisCallCount === 1) {
        throw new PolicyInsightStoreUnavailableError(
          "Queue is temporarily unavailable",
          "POLICY_STORE_UNAVAILABLE"
        );
      }
      return {
        requestId: 42,
        status: "pending",
        selectionHash: "sel-hash",
        planHash: "plan-hash",
        freshEvidenceRequired: false
      };
    });
    const requestPositionSynthesis = Object.assign(requestPositionSynthesisFn, {
      reconcileStartup: vi.fn()
    });

    const useCase = createIngestEvidenceBundleUseCase({
      repository: fakeRepo,
      clock: { nowUnixMs: () => 1700000000000 },
      requestPositionSynthesis
    });

    const app = Fastify();
    app.post("/v1/evidence/ingest", createEvidenceIngestHandler(useCase));

    // 1st request: Evidence persists, but queue synthesis fails with PolicyInsightStoreUnavailableError
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/evidence/ingest",
      headers: { "X-Evidence-Ingest-Token": "test-token" },
      payload: VALID_POSITION_BUNDLE
    });

    expect(res1.statusCode).toBe(503);
    const body1 = res1.json();
    expect(body1.schemaVersion).toBe("evidence-bundle.v1");
    expect(body1.error.code).toBe("POLICY_STORE_UNAVAILABLE");

    // Source data WAS persisted
    expect(fakeRepo.append).toHaveBeenCalledTimes(1);
    expect(requestPositionSynthesis).toHaveBeenCalledTimes(1);

    // 2nd request (Replay by client): Evidence is already ingested, queue is back online
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/evidence/ingest",
      headers: { "X-Evidence-Ingest-Token": "test-token" },
      payload: VALID_POSITION_BUNDLE
    });

    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.status).toBe("already_ingested");
    expect(body2.receiptId).toBe(101);

    expect(fakeRepo.append).toHaveBeenCalledTimes(2);
    expect(requestPositionSynthesis).toHaveBeenCalledTimes(2);
  });
});
