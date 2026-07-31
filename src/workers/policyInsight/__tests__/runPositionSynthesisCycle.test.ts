import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPositionPolicyInsightSynthesisCycle } from "../runPositionSynthesisCycle.js";
import type { PositionPolicyInsightSynthesisQueuePort } from "../../../application/ports/positionPolicyInsightSynthesisQueuePort.js";
import type {
  PlanLedgerReadPort,
  StoredPositionPlan
} from "../../../application/ports/planLedgerPort.js";
import type { SynthesizePolicyInsightUseCase } from "../../../application/use-cases/synthesizePolicyInsightUseCase.js";
import type { PolicyInsightSynthesisWorkerConfig } from "../config.js";
import type { WorkerLogger } from "../../gecko/logger.js";
import type { ClockPort } from "../../../application/ports/clock.js";
import type { PolicyInsightRead } from "../../../contract/policyInsight/v1/types.generated.js";
import type { PlanRequest, PlanResponse } from "../../../contract/v1/types.js";
import {
  PolicyInsightStoreUnavailableError,
  PolicyInsightValidationError
} from "../../../application/errors/policyInsightErrors.js";
import { EvidenceStoreUnavailableError } from "../../../application/errors/evidenceErrors.js";
import { RegimeCandlesNotFoundError } from "../../../application/errors/regimeErrors.js";
import { evidenceScopeKey } from "../../../application/ports/evidenceBundleRepositoryPort.js";

describe("runPositionPolicyInsightSynthesisCycle", () => {
  let queue: PositionPolicyInsightSynthesisQueuePort;
  let planLedger: PlanLedgerReadPort;
  let synthesizePolicyInsight: SynthesizePolicyInsightUseCase;
  let config: PolicyInsightSynthesisWorkerConfig;
  let logger: WorkerLogger;
  let clock: ClockPort;
  const leaseOwner = "worker-node-1";

  const testScope = {
    kind: "position" as const,
    network: "solana-mainnet" as const,
    positionId: "pos-123",
    whirlpoolAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
    walletAddress: "wallet-456"
  };
  const scopeKey = evidenceScopeKey(testScope);

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

  const samplePlanRequest: PlanRequest = {
    schemaVersion: "1.0",
    asOfUnixMs: 1700000000000,
    market: {
      symbol: "SOL/USDC",
      source: "geckoterminal",
      network: "solana",
      poolAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
      timeframe: "1h"
    },
    position: {
      positionId: "pos-123",
      walletId: "wallet-456",
      observedAtUnixMs: 1700000000000,
      lowerBoundPrice: 100,
      upperBoundPrice: 200,
      currentPrice: 150,
      rangeState: "in-range",
      breachQualified: false
    },
    portfolio: {
      navUsd: 1000,
      solUnits: 5,
      usdcUnits: 500
    },
    autopilotState: {
      activeClmm: true,
      stopouts24h: 0,
      redeploys24h: 0,
      cooldownUntilUnixMs: 0,
      standDownUntilUnixMs: 0,
      strikeCount: 0
    },
    config: {
      regime: {
        confirmBars: 3,
        minHoldBars: 5,
        enterUpTrend: 0.05,
        exitUpTrend: -0.02,
        enterDownTrend: -0.05,
        exitDownTrend: 0.02,
        chopVolRatioMax: 0.01
      },
      allocation: {
        upSolBps: 7000,
        downSolBps: 2000,
        chopSolBps: 5000,
        maxDeltaExposureBpsPerDay: 1000,
        maxTurnoverPerDayBps: 2000
      },
      churn: {
        maxStopouts24h: 2,
        maxRedeploys24h: 2,
        cooldownMsAfterStopout: 3600000,
        standDownTriggerStrikes: 3
      },
      baselines: {
        dcaIntervalDays: 7,
        dcaAmountUsd: 100,
        usdcCarryApr: 0.05
      }
    }
  };

  const samplePlanResponse: PlanResponse = {
    schemaVersion: "1.0",
    planId: "plan-123",
    planHash: "plan-hash-111",
    asOfUnixMs: 1700000000000,
    scope: {
      kind: "position",
      positionId: "pos-123",
      poolAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
      symbol: "SOL/USDC"
    },
    regime: "CHOP",
    targets: {
      solBps: 5000,
      usdcBps: 5000,
      allowClmm: true
    },
    actions: [],
    constraints: {
      cooldownUntilUnixMs: 0,
      standDownUntilUnixMs: 0,
      notes: []
    },
    nextRegimeState: {
      current: "CHOP",
      barsInRegime: 5,
      pending: null,
      pendingBars: 0
    },
    reasons: [],
    telemetry: {},
    marketData: {
      source: "geckoterminal",
      network: "solana",
      poolAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
      requestedTimeframe: "1h",
      sourceTimeframe: "1h",
      candleCount: 100,
      sourceCandleCount: 100,
      freshness: {
        generatedAtIso: "2026-07-31T08:00:00.000Z",
        lastCandleOpenUnixMs: 1700000000000,
        lastCandleOpenIso: "2026-07-31T08:00:00.000Z",
        lastCandleCloseUnixMs: 1700003600000,
        lastCandleCloseIso: "2026-07-31T09:00:00.000Z",
        ageSeconds: 0,
        softStale: false,
        hardStale: false,
        softStaleSeconds: 300,
        hardStaleSeconds: 600
      }
    }
  };

  const sampleStoredPlan: StoredPositionPlan = {
    planRequest: samplePlanRequest,
    planResponse: samplePlanResponse
  };

  beforeEach(() => {
    queue = {
      enqueueOrReconcile: vi.fn(),
      claimBatch: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      failWaitingForPlan: vi.fn(),
      supersede: vi.fn(),
      releaseForRetry: vi.fn(),
      listWaitingScopes: vi.fn(),
      hasWaitingRequest: vi.fn(),
      listEligiblePositionScopes: vi.fn(),
      getById: vi.fn()
    };
    planLedger = {
      getLatestPositionPlan: vi.fn(),
      getPositionPlanByHash: vi.fn(),
      listLatestPositionPlans: vi.fn()
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

  it("returns idle when no request can be claimed", async () => {
    vi.mocked(queue.claimBatch).mockResolvedValue([]);

    const result = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(result).toEqual({ outcome: "idle" });
    expect(queue.claimBatch).toHaveBeenCalledWith({
      leaseOwner,
      leaseDurationMs: config.leaseMs,
      batchSize: 1,
      nowUnixMs: 1700000000000
    });
    expect(synthesizePolicyInsight).not.toHaveBeenCalled();
  });

  it("loads the exact plan by hash and completes one matching request", async () => {
    vi.mocked(queue.claimBatch).mockResolvedValue([
      {
        id: 42,
        scopeKey,
        selectionHash: "sel-hash-111",
        planHash: "plan-hash-111",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 1,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValue(sampleStoredPlan);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValue(sampleStoredPlan);
    vi.mocked(synthesizePolicyInsight).mockResolvedValue(mockInsightRead);
    vi.mocked(queue.complete).mockResolvedValue(true);

    let callCount = 0;
    vi.mocked(clock.nowUnixMs).mockImplementation(() => {
      callCount++;
      return callCount === 1 ? 1700000000000 : 1700000000150;
    });

    const result = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(planLedger.getPositionPlanByHash).toHaveBeenCalledWith(
      {
        positionId: testScope.positionId,
        poolAddress: testScope.whirlpoolAddress,
        walletId: testScope.walletAddress
      },
      "plan-hash-111"
    );

    expect(synthesizePolicyInsight).toHaveBeenCalledWith({
      scope: testScope,
      marketSelector: config.marketSelector,
      positionPlan: {
        position: sampleStoredPlan.planRequest.position,
        plan: sampleStoredPlan.planResponse
      },
      expectedSelectionHash: "sel-hash-111"
    });

    expect(queue.complete).toHaveBeenCalledWith({
      id: 42,
      leaseOwner,
      nowUnixMs: 1700000000150
    });

    expect(result).toEqual({
      outcome: "succeeded",
      requestId: 42,
      insightId: mockInsightRead.insightId,
      synthesisInputHash: mockInsightRead.insightId,
      durationMs: 150
    });
  });

  it("supersedes a claim when a newer eligible plan exists", async () => {
    vi.mocked(queue.claimBatch).mockResolvedValue([
      {
        id: 42,
        scopeKey,
        selectionHash: "sel-hash-111",
        planHash: "plan-hash-111",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 1,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    const newerPlan: StoredPositionPlan = {
      ...sampleStoredPlan,
      planResponse: {
        ...samplePlanResponse,
        planHash: "plan-hash-222",
        asOfUnixMs: 1700000005000
      }
    };
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValue(sampleStoredPlan);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValue(newerPlan);
    vi.mocked(queue.supersede).mockResolvedValue(true);

    const result = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(synthesizePolicyInsight).not.toHaveBeenCalled();
    expect(queue.supersede).toHaveBeenCalledWith({
      id: 42,
      leaseOwner,
      nowUnixMs: 1700000000000,
      errorCode: "POSITION_PLAN_SUPERSEDED",
      errorMessage: expect.any(String)
    });
    expect(result).toEqual({
      outcome: "superseded",
      requestId: 42,
      errorCode: "POSITION_PLAN_SUPERSEDED",
      errorMessage: expect.any(String)
    });
  });

  it("supersedes a claim when recomputed selectionHash differs", async () => {
    vi.mocked(queue.claimBatch).mockResolvedValue([
      {
        id: 42,
        scopeKey,
        selectionHash: "sel-hash-stale",
        planHash: "plan-hash-111",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 1,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValue(sampleStoredPlan);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValue(sampleStoredPlan);
    vi.mocked(synthesizePolicyInsight).mockRejectedValue(
      new PolicyInsightValidationError(
        "Selected evidence set hash does not match expected selection hash",
        "EVIDENCE_SELECTION_SUPERSEDED"
      )
    );
    vi.mocked(queue.supersede).mockResolvedValue(true);

    const result = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(queue.supersede).toHaveBeenCalledWith({
      id: 42,
      leaseOwner,
      nowUnixMs: 1700000000000,
      errorCode: "EVIDENCE_SELECTION_SUPERSEDED",
      errorMessage: expect.stringContaining("Selected evidence set hash")
    });
    expect(result).toEqual({
      outcome: "superseded",
      requestId: 42,
      errorCode: "EVIDENCE_SELECTION_SUPERSEDED",
      errorMessage: expect.stringContaining("Selected evidence set hash")
    });
  });

  it("fails missing plan invalid hash stale evidence and scope mismatch with their structured codes", async () => {
    // Case 1: missing plan in ledger
    vi.mocked(queue.claimBatch).mockResolvedValueOnce([
      {
        id: 101,
        scopeKey,
        selectionHash: "sel-hash-111",
        planHash: "plan-missing-hash",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 1,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValueOnce(null);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValueOnce(null);
    vi.mocked(queue.fail).mockResolvedValueOnce(true);

    const resMissingPlan = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(queue.fail).toHaveBeenCalledWith({
      id: 101,
      leaseOwner,
      nowUnixMs: 1700000000000,
      errorCode: "POSITION_PLAN_MISSING",
      errorMessage: expect.any(String)
    });
    expect(resMissingPlan).toEqual({
      outcome: "permanent_failure",
      requestId: 101,
      errorCode: "POSITION_PLAN_MISSING",
      errorMessage: expect.any(String)
    });

    // Case 2: scope mismatch from synthesis use case
    vi.mocked(queue.claimBatch).mockResolvedValueOnce([
      {
        id: 102,
        scopeKey,
        selectionHash: "sel-hash-111",
        planHash: "plan-hash-111",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 1,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValueOnce(sampleStoredPlan);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValueOnce(sampleStoredPlan);
    vi.mocked(synthesizePolicyInsight).mockRejectedValueOnce(
      new PolicyInsightValidationError(
        "positionId mismatch between scope and positionPlan",
        "POSITION_SCOPE_MISMATCH"
      )
    );
    vi.mocked(queue.fail).mockResolvedValueOnce(true);

    const resScopeMismatch = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(resScopeMismatch).toEqual({
      outcome: "permanent_failure",
      requestId: 102,
      errorCode: "POSITION_SCOPE_MISMATCH",
      errorMessage: "positionId mismatch between scope and positionPlan"
    });

    // Case 3: invalid plan hash from synthesis use case
    vi.mocked(queue.claimBatch).mockResolvedValueOnce([
      {
        id: 103,
        scopeKey,
        selectionHash: "sel-hash-111",
        planHash: "plan-hash-111",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 1,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValueOnce(sampleStoredPlan);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValueOnce(sampleStoredPlan);
    vi.mocked(synthesizePolicyInsight).mockRejectedValueOnce(
      new PolicyInsightValidationError("Plan hash verification failed", "PLAN_HASH_INVALID")
    );
    vi.mocked(queue.fail).mockResolvedValueOnce(true);

    const resInvalidHash = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(resInvalidHash).toEqual({
      outcome: "permanent_failure",
      requestId: 103,
      errorCode: "PLAN_HASH_INVALID",
      errorMessage: "Plan hash verification failed"
    });

    // Case 4: stale position / evidence from synthesis use case
    vi.mocked(queue.claimBatch).mockResolvedValueOnce([
      {
        id: 104,
        scopeKey,
        selectionHash: "sel-hash-111",
        planHash: "plan-hash-111",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 1,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValueOnce(sampleStoredPlan);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValueOnce(sampleStoredPlan);
    vi.mocked(synthesizePolicyInsight).mockRejectedValueOnce(
      new PolicyInsightValidationError("Supplied position is stale", "POSITION_STALE")
    );
    vi.mocked(queue.fail).mockResolvedValueOnce(true);

    const resStale = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(resStale).toEqual({
      outcome: "permanent_failure",
      requestId: 104,
      errorCode: "POSITION_STALE",
      errorMessage: "Supplied position is stale"
    });
  });

  it("retries market evidence and policy store outages without inspecting messages", async () => {
    vi.mocked(queue.claimBatch).mockResolvedValue([
      {
        id: 42,
        scopeKey,
        selectionHash: "sel-hash-111",
        planHash: "plan-hash-111",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 1,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValue(sampleStoredPlan);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValue(sampleStoredPlan);

    // 1. Policy store failure with arbitrary message deliberately unrelated to classification
    vi.mocked(synthesizePolicyInsight).mockRejectedValueOnce(
      new PolicyInsightStoreUnavailableError("Unrelated message: xyz-db-down")
    );
    vi.mocked(queue.releaseForRetry).mockResolvedValueOnce(true);

    const res1 = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(queue.releaseForRetry).toHaveBeenCalledWith({
      id: 42,
      leaseOwner,
      nowUnixMs: 1700000000000,
      retryAtUnixMs: 1700000005000,
      errorCode: "POLICY_STORE_UNAVAILABLE",
      errorMessage: "Unrelated message: xyz-db-down",
      maxAttempts: 5
    });

    expect(res1).toEqual({
      outcome: "transient_failure",
      requestId: 42,
      errorCode: "POLICY_STORE_UNAVAILABLE",
      errorMessage: "Unrelated message: xyz-db-down"
    });

    // 2. Evidence store failure with arbitrary message
    vi.mocked(synthesizePolicyInsight).mockRejectedValueOnce(
      new EvidenceStoreUnavailableError("Unrelated message: abc-evidence-error")
    );
    vi.mocked(queue.releaseForRetry).mockResolvedValueOnce(true);

    const res2 = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(res2).toEqual({
      outcome: "transient_failure",
      requestId: 42,
      errorCode: "EVIDENCE_STORE_UNAVAILABLE",
      errorMessage: "Unrelated message: abc-evidence-error"
    });

    // 3. Market data failure with arbitrary message
    vi.mocked(synthesizePolicyInsight).mockRejectedValueOnce(
      new RegimeCandlesNotFoundError("Unrelated message: market candle offline", [])
    );
    vi.mocked(queue.releaseForRetry).mockResolvedValueOnce(true);

    const res3 = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(res3).toEqual({
      outcome: "transient_failure",
      requestId: 42,
      errorCode: "MARKET_DATA_UNAVAILABLE",
      errorMessage: "Unrelated message: market candle offline"
    });
  });

  it("fails a transient request after the configured retry budget is exhausted", async () => {
    vi.mocked(queue.claimBatch).mockResolvedValue([
      {
        id: 42,
        scopeKey,
        selectionHash: "sel-hash-111",
        planHash: "plan-hash-111",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 5,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValue(sampleStoredPlan);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValue(sampleStoredPlan);
    vi.mocked(synthesizePolicyInsight).mockRejectedValue(
      new EvidenceStoreUnavailableError("Evidence database connection reset")
    );
    vi.mocked(queue.releaseForRetry).mockResolvedValue(true);

    const result = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(logger.error).toHaveBeenCalledWith(
      "position_policy_insight_synthesis_retry_budget_exhausted",
      expect.objectContaining({
        requestId: 42,
        maxAttempts: 5,
        attemptCount: 5
      })
    );

    expect(queue.releaseForRetry).toHaveBeenCalledWith({
      id: 42,
      leaseOwner,
      nowUnixMs: 1700000000000,
      retryAtUnixMs: 1700000005000,
      errorCode: "EVIDENCE_STORE_UNAVAILABLE",
      errorMessage: "Evidence database connection reset",
      maxAttempts: 5
    });
    expect(queue.fail).not.toHaveBeenCalled();

    expect(result).toEqual({
      outcome: "permanent_failure",
      requestId: 42,
      errorCode: "EXHAUSTED_RETRIES",
      errorMessage: "Evidence database connection reset"
    });
  });

  it("returns lease_lost when a stale worker cannot mutate the claimed request", async () => {
    vi.mocked(queue.claimBatch).mockResolvedValue([
      {
        id: 42,
        scopeKey,
        selectionHash: "sel-hash-111",
        planHash: "plan-hash-111",
        rulesetVersion: "ruleset-v1.0",
        attemptCount: 1,
        leaseOwner,
        leaseExpiresAtUnixMs: 1700000060000
      }
    ]);
    vi.mocked(planLedger.getPositionPlanByHash).mockResolvedValue(sampleStoredPlan);
    vi.mocked(planLedger.getLatestPositionPlan).mockResolvedValue(sampleStoredPlan);
    vi.mocked(synthesizePolicyInsight).mockResolvedValue(mockInsightRead);
    vi.mocked(queue.complete).mockResolvedValue(false);

    const result = await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config,
      logger,
      leaseOwner,
      clock
    });

    expect(result).toEqual({
      outcome: "lease_lost",
      requestId: 42
    });
  });

  it("enforces batchSize: 1 in claimBatch even if config.batchSize is greater than 1", async () => {
    vi.mocked(queue.claimBatch).mockResolvedValue([]);

    await runPositionPolicyInsightSynthesisCycle({
      queue,
      planLedger,
      synthesizePolicyInsight,
      config: { ...config, batchSize: 5 },
      logger,
      leaseOwner,
      clock
    });

    expect(queue.claimBatch).toHaveBeenCalledWith({
      leaseOwner,
      leaseDurationMs: config.leaseMs,
      batchSize: 1,
      nowUnixMs: 1700000000000
    });
  });
});
