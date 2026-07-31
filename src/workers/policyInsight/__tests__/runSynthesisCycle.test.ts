import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPolicyInsightSynthesisCycle } from "../runSynthesisCycle.js";
import type { PolicyInsightSynthesisTriggerPort } from "../../../application/ports/policyInsightSynthesisTriggerPort.js";
import type { SynthesizePolicyInsightUseCase } from "../../../application/use-cases/synthesizePolicyInsightUseCase.js";
import type { PolicyInsightSynthesisWorkerConfig } from "../config.js";
import type { WorkerLogger } from "../../gecko/logger.js";
import type { ClockPort } from "../../../application/ports/clock.js";
import type { PolicyInsightRead } from "../../../contract/policyInsight/v1/types.generated.js";
import {
  PolicyInsightStoreUnavailableError,
  PolicyInsightValidationError
} from "../../../application/errors/policyInsightErrors.js";
import { EvidenceStoreUnavailableError } from "../../../application/errors/evidenceErrors.js";
import { RegimeCandlesNotFoundError } from "../../../application/errors/regimeErrors.js";

describe("runPolicyInsightSynthesisCycle", () => {
  let triggerPort: PolicyInsightSynthesisTriggerPort;
  let synthesizePolicyInsight: SynthesizePolicyInsightUseCase;
  let config: PolicyInsightSynthesisWorkerConfig;
  let logger: WorkerLogger;
  let clock: ClockPort;
  const leaseOwner = "worker-node-1";

  const mockInsightRead: PolicyInsightRead = {
    schemaVersion: "policy-insight.v1",
    insightId: "a1b2c3d4e5f60789a1b2c3d4e5f60789a1b2c3d4e5f60789a1b2c3d4e5f60789",
    rulesetVersion: "ruleset-v1.0",
    pair: "SOL/USDC",
    position: null,
    generatedAt: "2026-07-31T08:00:00.000Z",
    asOf: "2026-07-31T08:00:00.000Z",
    expiresAt: "2026-07-31T09:00:00.000Z",
    marketRegime: "CHOP",
    fundamentalRegime: "NEUTRAL",
    posture: "NEUTRAL",
    recommendedAction: "HOLD",
    riskLevel: "NORMAL",
    clmmPolicy: {
      rangeBias: "MEDIUM",
      rebalanceSensitivity: "NORMAL",
      maxCapitalDeploymentBps: 5000
    },
    levels: {
      supportsUsdcPerSol: ["130.00"],
      resistancesUsdcPerSol: ["150.00"]
    },
    evidence: {
      selectionStatus: "FULL",
      selectionPolicyVersion: "sel-v1",
      selectedBundleRefs: [],
      selectedSourceRefs: []
    },
    confidenceBps: 8000,
    dataQuality: "COMPLETE",
    reasonCodes: ["ADVISORY_ONLY"],
    reasoning: "Test insight reasoning",
    warnings: [],
    freshness: {
      status: "FRESH",
      evaluatedAt: "2026-07-31T08:00:00.000Z",
      ageSeconds: 0
    }
  };

  beforeEach(() => {
    triggerPort = {
      claimLatestPairEvidence: vi.fn(),
      complete: vi.fn(),
      releaseForRetry: vi.fn()
    };
    synthesizePolicyInsight = vi.fn();
    config = {
      marketSelector: {
        source: "geckoterminal",
        network: "solana",
        poolAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
        timeframe: "1h"
      },
      pollIntervalMs: 5000,
      leaseMs: 60000,
      retryMs: 5000,
      maxAttempts: 5
    };
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    clock = {
      nowUnixMs: vi.fn().mockReturnValue(1700000000000)
    };
  });

  it("returns idle without calling synthesis when no receipt is claimable", async () => {
    vi.mocked(triggerPort.claimLatestPairEvidence).mockResolvedValue(null);

    const result = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(result).toEqual({ outcome: "idle" });
    expect(triggerPort.claimLatestPairEvidence).toHaveBeenCalledWith({
      cursorKey: "pair",
      leaseOwner,
      leaseDurationMs: config.leaseMs,
      nowUnixMs: 1700000000000
    });
    expect(synthesizePolicyInsight).not.toHaveBeenCalled();
    expect(triggerPort.complete).not.toHaveBeenCalled();
    expect(triggerPort.releaseForRetry).not.toHaveBeenCalled();
  });

  it("synthesizes pair scope with the canonical market selector", async () => {
    vi.mocked(triggerPort.claimLatestPairEvidence).mockResolvedValue({
      cursorKey: "pair",
      targetReceiptId: 42,
      attemptCount: 1,
      leaseOwner,
      leaseExpiresAtUnixMs: 1700000060000,
      lastProcessedReceiptId: 41
    });
    vi.mocked(synthesizePolicyInsight).mockResolvedValue(mockInsightRead);
    vi.mocked(triggerPort.complete).mockResolvedValue(true);

    await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(synthesizePolicyInsight).toHaveBeenCalledTimes(1);
    expect(synthesizePolicyInsight).toHaveBeenCalledWith({
      scope: { kind: "pair" },
      marketSelector: config.marketSelector,
      positionPlan: null
    });
  });

  it("logs required identifiers and duration before completing success", async () => {
    vi.mocked(triggerPort.claimLatestPairEvidence).mockResolvedValue({
      cursorKey: "pair",
      targetReceiptId: 42,
      attemptCount: 1,
      leaseOwner,
      leaseExpiresAtUnixMs: 1700000060000,
      lastProcessedReceiptId: 41
    });
    vi.mocked(synthesizePolicyInsight).mockResolvedValue(mockInsightRead);
    vi.mocked(triggerPort.complete).mockResolvedValue(true);

    let callCount = 0;
    vi.mocked(clock.nowUnixMs).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? 1700000000000 : 1700000000150;
    });

    const result = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(triggerPort.complete).toHaveBeenCalledWith({
      cursorKey: "pair",
      leaseOwner,
      targetReceiptId: 42,
      nowUnixMs: 1700000000150,
      outcome: "success"
    });

    expect(logger.info).toHaveBeenCalledWith(
      "policy_insight_synthesis_succeeded",
      expect.objectContaining({
        receiptId: 42,
        scope: "pair",
        synthesisInputHash: mockInsightRead.insightId,
        insightId: mockInsightRead.insightId,
        durationMs: 150,
        attemptCount: 1,
        outcome: "success"
      })
    );

    expect(result).toEqual({
      outcome: "succeeded",
      receiptId: 42,
      insightId: mockInsightRead.insightId,
      synthesisInputHash: mockInsightRead.insightId,
      durationMs: 150
    });
  });

  it("classifies validation failure as permanent and advances the cursor", async () => {
    vi.mocked(triggerPort.claimLatestPairEvidence).mockResolvedValue({
      cursorKey: "pair",
      targetReceiptId: 42,
      attemptCount: 1,
      leaseOwner,
      leaseExpiresAtUnixMs: 1700000060000,
      lastProcessedReceiptId: 41
    });
    vi.mocked(synthesizePolicyInsight).mockRejectedValue(
      new PolicyInsightValidationError("Position plan missing")
    );
    vi.mocked(triggerPort.complete).mockResolvedValue(true);

    const result = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(triggerPort.complete).toHaveBeenCalledWith({
      cursorKey: "pair",
      leaseOwner,
      targetReceiptId: 42,
      nowUnixMs: 1700000000000,
      outcome: "permanent_failure",
      errorCode: "PolicyInsightValidationError",
      errorMessage: "Position plan missing"
    });
    expect(triggerPort.releaseForRetry).not.toHaveBeenCalled();

    expect(result).toEqual({
      outcome: "permanent_failure",
      receiptId: 42,
      errorCode: "PolicyInsightValidationError",
      errorMessage: "Position plan missing"
    });
  });

  it("classifies store and regime availability failures as transient without advancing when below max attempts", async () => {
    vi.mocked(triggerPort.claimLatestPairEvidence).mockResolvedValue({
      cursorKey: "pair",
      targetReceiptId: 42,
      attemptCount: 2,
      leaseOwner,
      leaseExpiresAtUnixMs: 1700000060000,
      lastProcessedReceiptId: 41
    });
    vi.mocked(synthesizePolicyInsight).mockRejectedValue(
      new PolicyInsightStoreUnavailableError("DB connection pool exhausted")
    );
    vi.mocked(triggerPort.releaseForRetry).mockResolvedValue(true);

    const result = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(triggerPort.releaseForRetry).toHaveBeenCalledWith({
      cursorKey: "pair",
      leaseOwner,
      targetReceiptId: 42,
      nowUnixMs: 1700000000000,
      classification: "PolicyInsightStoreUnavailableError",
      sanitizedMessage: "DB connection pool exhausted",
      retryAtUnixMs: 1700000005000
    });
    expect(triggerPort.complete).not.toHaveBeenCalled();

    expect(result).toEqual({
      outcome: "transient_failure",
      receiptId: 42,
      errorCode: "PolicyInsightStoreUnavailableError",
      errorMessage: "DB connection pool exhausted"
    });

    vi.mocked(synthesizePolicyInsight).mockRejectedValue(
      new RegimeCandlesNotFoundError("Candles missing for timeframe 1h", [])
    );
    vi.mocked(triggerPort.releaseForRetry).mockResolvedValue(true);

    const result2 = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(triggerPort.releaseForRetry).toHaveBeenCalledWith({
      cursorKey: "pair",
      leaseOwner,
      targetReceiptId: 42,
      nowUnixMs: 1700000000000,
      classification: "RegimeCandlesNotFoundError",
      sanitizedMessage: "Candles missing for timeframe 1h",
      retryAtUnixMs: 1700000005000
    });

    expect(result2).toEqual({
      outcome: "transient_failure",
      receiptId: 42,
      errorCode: "RegimeCandlesNotFoundError",
      errorMessage: "Candles missing for timeframe 1h"
    });
  });

  it("converts transient failure to permanent failure when attempt count reaches max attempts budget", async () => {
    vi.mocked(triggerPort.claimLatestPairEvidence).mockResolvedValue({
      cursorKey: "pair",
      targetReceiptId: 42,
      attemptCount: 5,
      leaseOwner,
      leaseExpiresAtUnixMs: 1700000060000,
      lastProcessedReceiptId: 41
    });
    vi.mocked(synthesizePolicyInsight).mockRejectedValue(
      new EvidenceStoreUnavailableError("Evidence database unreachable")
    );
    vi.mocked(triggerPort.complete).mockResolvedValue(true);

    const result = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(logger.error).toHaveBeenCalledWith(
      "policy_insight_synthesis_retry_budget_exhausted",
      expect.objectContaining({
        receiptId: 42,
        maxAttempts: 5,
        attemptCount: 5
      })
    );

    expect(triggerPort.complete).toHaveBeenCalledWith({
      cursorKey: "pair",
      leaseOwner,
      targetReceiptId: 42,
      nowUnixMs: 1700000000000,
      outcome: "permanent_failure",
      errorCode: "EvidenceStoreUnavailableError",
      errorMessage: "Evidence database unreachable"
    });
    expect(triggerPort.releaseForRetry).not.toHaveBeenCalled();

    expect(result).toEqual({
      outcome: "permanent_failure",
      receiptId: 42,
      errorCode: "EvidenceStoreUnavailableError",
      errorMessage: "Evidence database unreachable"
    });
  });

  it("classifies an unknown operational error as transient", async () => {
    vi.mocked(triggerPort.claimLatestPairEvidence).mockResolvedValue({
      cursorKey: "pair",
      targetReceiptId: 42,
      attemptCount: 1,
      leaseOwner,
      leaseExpiresAtUnixMs: 1700000060000,
      lastProcessedReceiptId: 41
    });
    vi.mocked(synthesizePolicyInsight).mockRejectedValue(
      new Error("Unexpected network socket reset")
    );
    vi.mocked(triggerPort.releaseForRetry).mockResolvedValue(true);

    const result = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(triggerPort.releaseForRetry).toHaveBeenCalledWith({
      cursorKey: "pair",
      leaseOwner,
      targetReceiptId: 42,
      nowUnixMs: 1700000000000,
      classification: "Error",
      sanitizedMessage: "Unexpected network socket reset",
      retryAtUnixMs: 1700000005000
    });
    expect(triggerPort.complete).not.toHaveBeenCalled();

    expect(result).toEqual({
      outcome: "transient_failure",
      receiptId: 42,
      errorCode: "Error",
      errorMessage: "Unexpected network socket reset"
    });
  });

  it("does not advance when completion compare-and-set loses ownership", async () => {
    vi.mocked(triggerPort.claimLatestPairEvidence).mockResolvedValue({
      cursorKey: "pair",
      targetReceiptId: 42,
      attemptCount: 1,
      leaseOwner,
      leaseExpiresAtUnixMs: 1700000060000,
      lastProcessedReceiptId: 41
    });
    vi.mocked(synthesizePolicyInsight).mockResolvedValue(mockInsightRead);
    vi.mocked(triggerPort.complete).mockResolvedValue(false);

    const result = await runPolicyInsightSynthesisCycle({
      triggerPort,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(result).toEqual({
      outcome: "lease_lost",
      receiptId: 42
    });
  });
});
