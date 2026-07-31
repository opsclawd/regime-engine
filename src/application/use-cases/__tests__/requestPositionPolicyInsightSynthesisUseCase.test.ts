import { describe, test, expect, beforeEach } from "vitest";
import type { Scope } from "../../../contract/evidence/v1/types.generated.js";
import type {
  PositionPolicyInsightSynthesisQueuePort,
  PositionPolicyInsightSynthesisRequest,
  PositionPolicyInsightSynthesisStatus,
  EnqueueOrReconcileInput,
  FailPositionPolicyInsightSynthesisInput,
  FailWaitingForPlanInput,
  PositionPolicyInsightSynthesisClaim
} from "../../ports/positionPolicyInsightSynthesisQueuePort.js";
import type {
  EvidenceBundleRepositoryPort,
  EvidenceSourceFilter
} from "../../ports/evidenceBundleRepositoryPort.js";
import { evidenceScopeKey } from "../../ports/evidenceBundleRepositoryPort.js";
import type {
  PlanLedgerReadPort,
  PositionPlanScope,
  StoredPositionPlan
} from "../../ports/planLedgerPort.js";
import type { ClockPort } from "../../ports/clock.js";
import type { EvidenceBundleRecord } from "../../../engine/evidence/selectEvidence.js";
import type { EvidenceBundleV1 } from "../../../contract/evidence/v1/types.generated.js";
import type { PlanRequest, PlanResponse } from "../../../contract/v1/types.js";
import { sha256Hex } from "../../../contract/v1/hash.js";
import { toCanonicalJson } from "../../../contract/v1/canonical.js";
import {
  createRequestPositionPolicyInsightSynthesisUseCase,
  parsePositionScopeKey,
  type RequestPositionPolicyInsightSynthesisUseCase,
  type RequestPositionPolicyInsightSynthesisResult,
  type RequestPositionPolicyInsightSynthesisStartupResult
} from "../requestPositionPolicyInsightSynthesisUseCase.js";

class FakeQueue implements PositionPolicyInsightSynthesisQueuePort {
  public requests: PositionPolicyInsightSynthesisRequest[] = [];
  private nextId = 1;
  public waitingScopes: string[] = [];
  public eligiblePositionScopes: string[] = [];

  async enqueueOrReconcile(
    input: EnqueueOrReconcileInput
  ): Promise<PositionPolicyInsightSynthesisRequest> {
    const { scopeKey, selectionHash = null, planHash = null, rulesetVersion, nowUnixMs } = input;

    if (selectionHash && planHash) {
      const existingReady = this.requests.find(
        (r) =>
          r.scopeKey === scopeKey &&
          r.selectionHash === selectionHash &&
          r.planHash === planHash &&
          r.rulesetVersion === rulesetVersion
      );
      if (existingReady) {
        this.requests = this.requests.filter(
          (r) =>
            !(
              r.scopeKey === scopeKey &&
              r.rulesetVersion === rulesetVersion &&
              ((r.selectionHash === selectionHash && r.status === "waiting_for_plan") ||
                (r.planHash === planHash && r.status === "waiting_for_evidence"))
            )
        );
        return existingReady;
      }

      const existingWaitingPlan = this.requests.find(
        (r) =>
          r.scopeKey === scopeKey &&
          r.selectionHash === selectionHash &&
          r.rulesetVersion === rulesetVersion &&
          r.status === "waiting_for_plan"
      );
      if (existingWaitingPlan) {
        existingWaitingPlan.planHash = planHash;
        existingWaitingPlan.status = "pending";
        existingWaitingPlan.updatedAtUnixMs = nowUnixMs;
        this.requests = this.requests.filter(
          (r) =>
            !(
              r.scopeKey === scopeKey &&
              r.planHash === planHash &&
              r.rulesetVersion === rulesetVersion &&
              r.status === "waiting_for_evidence"
            )
        );
        return existingWaitingPlan;
      }

      const existingWaitingEvidence = this.requests.find(
        (r) =>
          r.scopeKey === scopeKey &&
          r.planHash === planHash &&
          r.rulesetVersion === rulesetVersion &&
          r.status === "waiting_for_evidence"
      );
      if (existingWaitingEvidence) {
        existingWaitingEvidence.selectionHash = selectionHash;
        existingWaitingEvidence.status = "pending";
        existingWaitingEvidence.updatedAtUnixMs = nowUnixMs;
        this.requests = this.requests.filter(
          (r) =>
            !(
              r.scopeKey === scopeKey &&
              r.selectionHash === selectionHash &&
              r.rulesetVersion === rulesetVersion &&
              r.status === "waiting_for_plan"
            )
        );
        return existingWaitingEvidence;
      }

      const req: PositionPolicyInsightSynthesisRequest = {
        id: this.nextId++,
        scopeKey,
        selectionHash,
        planHash,
        rulesetVersion,
        status: "pending",
        attemptCount: 0,
        nextAttemptAtUnixMs: null,
        leaseOwner: null,
        leaseExpiresAtUnixMs: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAtUnixMs: nowUnixMs,
        updatedAtUnixMs: nowUnixMs
      };
      this.requests.push(req);
      return req;
    }

    if (selectionHash && !planHash) {
      const existing = this.requests.find(
        (r) =>
          r.scopeKey === scopeKey &&
          r.selectionHash === selectionHash &&
          r.rulesetVersion === rulesetVersion
      );
      if (existing) return existing;

      const req: PositionPolicyInsightSynthesisRequest = {
        id: this.nextId++,
        scopeKey,
        selectionHash,
        planHash: null,
        rulesetVersion,
        status: "waiting_for_plan",
        attemptCount: 0,
        nextAttemptAtUnixMs: null,
        leaseOwner: null,
        leaseExpiresAtUnixMs: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAtUnixMs: nowUnixMs,
        updatedAtUnixMs: nowUnixMs
      };
      this.requests.push(req);
      return req;
    }

    if (!selectionHash && planHash) {
      const existing = this.requests.find(
        (r) =>
          r.scopeKey === scopeKey && r.planHash === planHash && r.rulesetVersion === rulesetVersion
      );
      if (existing) return existing;

      const req: PositionPolicyInsightSynthesisRequest = {
        id: this.nextId++,
        scopeKey,
        selectionHash: null,
        planHash,
        rulesetVersion,
        status: "waiting_for_evidence",
        attemptCount: 0,
        nextAttemptAtUnixMs: null,
        leaseOwner: null,
        leaseExpiresAtUnixMs: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        createdAtUnixMs: nowUnixMs,
        updatedAtUnixMs: nowUnixMs
      };
      this.requests.push(req);
      return req;
    }

    throw new Error("Either selectionHash or planHash required");
  }

  async listWaitingScopes(status?: PositionPolicyInsightSynthesisStatus): Promise<string[]> {
    const scopes = Array.from(
      new Set(
        this.requests
          .filter((r) =>
            status
              ? r.status === status
              : r.status === "waiting_for_plan" || r.status === "waiting_for_evidence"
          )
          .map((r) => r.scopeKey)
      )
    );
    if (status) return scopes;
    return Array.from(new Set([...scopes, ...this.waitingScopes]));
  }

  async hasWaitingRequest(
    scopeKey: string,
    status?: PositionPolicyInsightSynthesisStatus
  ): Promise<boolean> {
    return this.requests.some((r) => {
      if (r.scopeKey !== scopeKey) return false;
      if (status) return r.status === status;
      return r.status === "waiting_for_plan" || r.status === "waiting_for_evidence";
    });
  }

  async listEligiblePositionScopes(): Promise<string[]> {
    return this.eligiblePositionScopes;
  }

  async getById(id: number): Promise<PositionPolicyInsightSynthesisRequest | null> {
    return this.requests.find((r) => r.id === id) ?? null;
  }

  async fail(input: FailPositionPolicyInsightSynthesisInput): Promise<boolean> {
    const req = this.requests.find(
      (r) => r.id === input.id && r.status === "processing" && r.leaseOwner === input.leaseOwner
    );
    if (req) {
      req.status = "failed";
      req.leaseOwner = null;
      req.leaseExpiresAtUnixMs = null;
      req.lastErrorCode = input.errorCode;
      req.lastErrorMessage = input.errorMessage;
      req.updatedAtUnixMs = input.nowUnixMs;
      return true;
    }
    return false;
  }

  async failWaitingForPlan(
    input: FailWaitingForPlanInput
  ): Promise<PositionPolicyInsightSynthesisRequest | null> {
    const req = this.requests.find(
      (r) =>
        r.scopeKey === input.scopeKey &&
        r.rulesetVersion === input.rulesetVersion &&
        r.status === "waiting_for_plan" &&
        (!input.selectionHash || r.selectionHash === input.selectionHash)
    );
    if (req) {
      req.status = "failed";
      req.lastErrorCode = input.errorCode;
      req.lastErrorMessage = input.errorMessage;
      req.updatedAtUnixMs = input.nowUnixMs;
      return req;
    }
    return null;
  }

  async claimBatch(): Promise<PositionPolicyInsightSynthesisClaim[]> {
    return [];
  }
  async complete(): Promise<boolean> {
    return true;
  }
  async supersede(): Promise<boolean> {
    return true;
  }
  async releaseForRetry(): Promise<boolean> {
    return true;
  }
}

class FakeEvidenceRepository implements EvidenceBundleRepositoryPort {
  public records: EvidenceBundleRecord[] = [];

  async getLatest(input: {
    pair: "SOL/USDC";
    scope: Scope;
    source: EvidenceSourceFilter | null;
    nowUnixMs: number;
    fromAsOfUnixMs?: number;
    toAsOfUnixMs?: number;
  }): Promise<EvidenceBundleRecord[]> {
    const targetScopeKey = evidenceScopeKey(input.scope);
    return this.records.filter((r) => {
      const sKey = evidenceScopeKey(r.bundle.scope);
      if (sKey !== targetScopeKey) return false;

      if (input.fromAsOfUnixMs !== undefined || input.toAsOfUnixMs !== undefined) {
        const asOfMs = Date.parse(r.bundle.asOf);
        if (input.fromAsOfUnixMs !== undefined && asOfMs < input.fromAsOfUnixMs) return false;
        if (input.toAsOfUnixMs !== undefined && asOfMs > input.toAsOfUnixMs) return false;
      }
      return true;
    });
  }

  async append(): Promise<{
    status: "created";
    receipt: { id: number; evidenceHash: string; receivedAtUnixMs: number; scopeKey: string };
  }> {
    throw new Error("Not implemented");
  }
  async getHistory(): Promise<{ records: EvidenceBundleRecord[]; nextCursor: null }> {
    throw new Error("Not implemented");
  }
}

class FakePlanLedgerReader implements PlanLedgerReadPort {
  public plans: StoredPositionPlan[] = [];

  async getLatestPositionPlan(scope: PositionPlanScope): Promise<StoredPositionPlan | null> {
    const matchingPos = this.plans.filter(
      (p) => p.planResponse.scope.positionId === scope.positionId
    );
    if (matchingPos.length > 0) return matchingPos[matchingPos.length - 1];
    return null;
  }

  async getPositionPlanByHash(
    scope: PositionPlanScope,
    planHash: string
  ): Promise<StoredPositionPlan | null> {
    return (
      this.plans.find(
        (p) =>
          p.planResponse.scope.positionId === scope.positionId &&
          p.planResponse.planHash === planHash
      ) ?? null
    );
  }

  async listLatestPositionPlans(): Promise<readonly StoredPositionPlan[]> {
    return this.plans;
  }
}

function makeSampleScope(
  positionId = "pos1",
  walletAddress = "wallet1",
  whirlpoolAddress = "pool1"
): Scope {
  return {
    kind: "position",
    network: "solana-mainnet",
    positionId,
    whirlpoolAddress,
    walletAddress
  };
}

function makeSampleEvidenceBundleRecord(
  scope: Scope,
  asOfIso = "2026-07-31T12:00:00.000Z",
  expiresAtIso = "2026-07-31T13:00:00.000Z",
  correlationId = "corr-1"
): EvidenceBundleRecord {
  const bundle = {
    schemaVersion: "evidence-bundle.v1",
    asOf: asOfIso,
    freshUntil: expiresAtIso,
    expiresAt: expiresAtIso,
    scope,
    source: {
      publisher: "sol-usdc-clmm-intelligence",
      sourceId: "test-src",
      sourceVersion: "1.0.0"
    },
    runId: "run-1",
    correlationId,
    deterministicFeatures: [
      {
        featureId: "vol_1h",
        family: "market_state",
        featureKind: "number",
        value: 4.2,
        unit: "percent",
        calculator: { name: "test", version: "1.0.0" },
        observedAt: asOfIso,
        freshUntil: expiresAtIso,
        confidenceBps: 9000,
        status: "available",
        inputLineage: ["ref-1"],
        warnings: []
      }
    ],
    contextualEvidence: {
      supportResistance: [],
      flows: [],
      derivatives: [],
      events: [],
      newsRegulatory: []
    },
    researchBrief: null,
    sourceReferences: [
      {
        referenceId: "ref-1",
        sourceType: "chain",
        locator: "loc-1",
        observedAt: asOfIso
      }
    ]
  } as unknown as EvidenceBundleV1;

  const evidenceHash = sha256Hex(toCanonicalJson(bundle));
  return {
    id: 1,
    bundle,
    evidenceHash,
    receivedAtUnixMs: Date.parse(asOfIso),
    lifecycle: "FRESH"
  };
}

function makeSampleStoredPlan(
  positionId = "pos1",
  poolAddress = "pool1",
  walletId = "wallet1",
  asOfUnixMs = Date.parse("2026-07-31T12:00:00.000Z")
): StoredPositionPlan {
  const planRequest = {
    schemaVersion: "1.0",
    asOfUnixMs,
    position: {
      positionId,
      walletId,
      observedAtUnixMs: asOfUnixMs,
      lowerBoundPrice: 95,
      upperBoundPrice: 110,
      currentPrice: 100,
      rangeState: "in-range",
      breachQualified: false
    },
    portfolio: {
      navUsd: 10000,
      solUnits: 100,
      usdcUnits: 200
    },
    autopilotState: {
      activeClmm: true,
      stopouts24h: 0,
      redeploys24h: 0,
      cooldownUntilUnixMs: 0,
      standDownUntilUnixMs: 0,
      strikeCount: 0
    },
    market: {
      symbol: "SOL/USDC",
      source: "pyth",
      network: "solana-mainnet",
      poolAddress,
      timeframe: "1h"
    },
    config: {
      regime: {
        confirmBars: 2,
        minHoldBars: 0,
        enterUpTrend: 0.6,
        exitUpTrend: 0.35,
        enterDownTrend: -0.6,
        exitDownTrend: -0.35,
        chopVolRatioMax: 1.4
      },
      allocation: {
        upSolBps: 7000,
        downSolBps: 1000,
        chopSolBps: 4000,
        maxDeltaExposureBpsPerDay: 2000,
        maxTurnoverPerDayBps: 5000
      },
      churn: {
        maxStopouts24h: 3,
        maxRedeploys24h: 3,
        cooldownMsAfterStopout: 0,
        standDownTriggerStrikes: 3
      },
      baselines: { dcaIntervalDays: 7, dcaAmountUsd: 100, usdcCarryApr: 0.04 }
    }
  } as unknown as PlanRequest;

  const rawPlanResponse = {
    schemaVersion: "1.0",
    planId: "plan-1",
    asOfUnixMs,
    scope: {
      kind: "position",
      symbol: "SOL/USDC",
      positionId,
      poolAddress
    },
    regime: "UP",
    targets: {
      solBps: 5000,
      usdcBps: 5000,
      allowClmm: true
    },
    actions: [
      {
        type: "REQUEST_REBALANCE",
        reasonCode: "ALL_GOOD"
      }
    ],
    constraints: {
      cooldownUntilUnixMs: 0,
      standDownUntilUnixMs: 0,
      notes: []
    },
    nextRegimeState: {
      regime: "UP",
      confirmedAtUnixMs: asOfUnixMs,
      durationCandles: 5
    },
    reasons: [
      {
        code: "MA_CROSS_BULLISH",
        severity: "INFO",
        message: "Bullish MA cross"
      }
    ],
    telemetry: {},
    marketData: {
      source: "pyth",
      network: "solana-mainnet",
      poolAddress,
      requestedTimeframe: "1h",
      sourceTimeframe: "15m",
      candleCount: 100,
      sourceCandleCount: 400,
      freshness: {
        lastCandleOpenUnixMs: asOfUnixMs,
        lastCandleOpenIso: new Date(asOfUnixMs).toISOString(),
        lastCandleCloseUnixMs: asOfUnixMs,
        lastCandleCloseIso: new Date(asOfUnixMs).toISOString(),
        ageSeconds: 10,
        generatedAtIso: new Date(asOfUnixMs).toISOString(),
        softStaleSeconds: 300,
        hardStaleSeconds: 600,
        softStale: false,
        hardStale: false
      }
    }
  };

  const planHash = sha256Hex(toCanonicalJson(rawPlanResponse));
  const planResponse = {
    ...rawPlanResponse,
    planHash
  } as unknown as PlanResponse;

  return {
    planRequest,
    planResponse
  };
}

describe("requestPositionPolicyInsightSynthesisUseCase", () => {
  let fakeQueue: FakeQueue;
  let fakeEvidenceRepo: FakeEvidenceRepository;
  let fakePlanLedger: FakePlanLedgerReader;
  let fakeClock: ClockPort;
  let useCase: RequestPositionPolicyInsightSynthesisUseCase;

  const nowUnixMs = Date.parse("2026-07-31T12:00:00.000Z");

  beforeEach(() => {
    fakeQueue = new FakeQueue();
    fakeEvidenceRepo = new FakeEvidenceRepository();
    fakePlanLedger = new FakePlanLedgerReader();
    fakeClock = {
      nowUnixMs: () => nowUnixMs
    };
    useCase = createRequestPositionPolicyInsightSynthesisUseCase({
      queue: fakeQueue,
      evidenceRepository: fakeEvidenceRepo,
      planLedger: fakePlanLedger,
      clock: fakeClock
    });
  });

  test("evidence without a plan returns waiting_for_plan with a durable request id", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    fakeEvidenceRepo.records.push(makeSampleEvidenceBundleRecord(scope));

    const result = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    expect(result).toMatchObject({
      requestId: expect.any(Number),
      status: "waiting_for_plan",
      planHash: null,
      freshEvidenceRequired: false
    });
    expect(result.selectionHash).not.toBeNull();
  });

  test("plan without evidence returns waiting_for_evidence with a durable request id", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    const plan = makeSampleStoredPlan("pos1", "pool1", "wallet1");
    fakePlanLedger.plans.push(plan);

    const result = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    expect(result).toMatchObject({
      requestId: expect.any(Number),
      status: "waiting_for_evidence",
      selectionHash: null,
      planHash: plan.planResponse.planHash,
      freshEvidenceRequired: true
    });
  });

  test("matching evidence and plan enqueue the exact scope selection plan and ruleset identity", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    fakeEvidenceRepo.records.push(makeSampleEvidenceBundleRecord(scope));
    const plan = makeSampleStoredPlan("pos1", "pool1", "wallet1");
    fakePlanLedger.plans.push(plan);

    const result = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    expect(result).toMatchObject({
      requestId: expect.any(Number),
      status: "pending",
      planHash: plan.planResponse.planHash,
      freshEvidenceRequired: false
    });
    expect(result.selectionHash).not.toBeNull();
  });

  test("duplicate reconciliation returns the same request id", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    fakeEvidenceRepo.records.push(makeSampleEvidenceBundleRecord(scope));
    const plan = makeSampleStoredPlan("pos1", "pool1", "wallet1");
    fakePlanLedger.plans.push(plan);

    const res1 = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;
    const res2 = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    expect(res1.requestId).toBe(res2.requestId);
  });

  test("two positions sharing one intelligence correlation reconcile independently", async () => {
    const scope1 = makeSampleScope("pos1", "wallet1", "pool1");
    const scope2 = makeSampleScope("pos2", "wallet2", "pool1");

    fakeEvidenceRepo.records.push(
      makeSampleEvidenceBundleRecord(
        scope1,
        "2026-07-31T12:00:00.000Z",
        "2026-07-31T13:00:00.000Z",
        "shared-corr-1"
      ),
      makeSampleEvidenceBundleRecord(
        scope2,
        "2026-07-31T12:00:00.000Z",
        "2026-07-31T13:00:00.000Z",
        "shared-corr-1"
      )
    );

    const plan1 = makeSampleStoredPlan("pos1", "pool1", "wallet1");
    const plan2 = makeSampleStoredPlan("pos2", "pool1", "wallet2");
    fakePlanLedger.plans.push(plan1, plan2);

    const res1 = (await useCase({ scope: scope1 })) as RequestPositionPolicyInsightSynthesisResult;
    const res2 = (await useCase({ scope: scope2 })) as RequestPositionPolicyInsightSynthesisResult;

    expect(res1.requestId).not.toBe(res2.requestId);
    expect(res1.status).toBe("pending");
    expect(res2.status).toBe("pending");
  });

  test("an expired waiting evidence request fails with POSITION_STALE when a plan arrives, and enqueues a new waiting_for_evidence request", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    const expTimeIso = new Date(nowUnixMs - 1000).toISOString();
    const oldTimeIso = new Date(nowUnixMs - 3600000).toISOString();
    fakeEvidenceRepo.records.push(makeSampleEvidenceBundleRecord(scope, oldTimeIso, expTimeIso));

    const resWaiting = (await useCase({
      scope,
      selectedAtUnixMs: nowUnixMs - 1800000
    })) as RequestPositionPolicyInsightSynthesisResult;
    expect(resWaiting.status).toBe("waiting_for_plan");

    const plan = makeSampleStoredPlan("pos1", "pool1", "wallet1", nowUnixMs);
    fakePlanLedger.plans.push(plan);

    const resPlanArrives = (await useCase({
      scope,
      selectedAtUnixMs: nowUnixMs
    })) as RequestPositionPolicyInsightSynthesisResult;

    const storedReq = await fakeQueue.getById(resWaiting.requestId);
    expect(storedReq?.status).toBe("failed");
    expect(storedReq?.lastErrorCode).toBe("POSITION_STALE");

    expect(resPlanArrives.requestId).not.toBe(resWaiting.requestId);
    expect(resPlanArrives.status).toBe("waiting_for_evidence");
    expect(resPlanArrives.planHash).toBe(plan.planResponse.planHash);
    expect(resPlanArrives.freshEvidenceRequired).toBe(true);
  });

  test("a waiting_for_plan request fails with POSITION_STALE if evidence was purged when a plan arrives", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    const rec = makeSampleEvidenceBundleRecord(scope);
    fakeEvidenceRepo.records.push(rec);

    const resWaiting = (await useCase({
      scope,
      selectedAtUnixMs: nowUnixMs - 1800000
    })) as RequestPositionPolicyInsightSynthesisResult;
    expect(resWaiting.status).toBe("waiting_for_plan");

    // Purge evidence repository completely
    fakeEvidenceRepo.records = [];

    const plan = makeSampleStoredPlan("pos1", "pool1", "wallet1", nowUnixMs);
    fakePlanLedger.plans.push(plan);

    const resPlanArrives = (await useCase({
      scope,
      selectedAtUnixMs: nowUnixMs
    })) as RequestPositionPolicyInsightSynthesisResult;

    const storedReq = await fakeQueue.getById(resWaiting.requestId);
    expect(storedReq?.status).toBe("failed");
    expect(storedReq?.lastErrorCode).toBe("POSITION_STALE");

    expect(resPlanArrives.status).toBe("waiting_for_evidence");
  });

  test("parsePositionScopeKey strictly validates length prefixes and scope bounds", () => {
    expect(parsePositionScopeKey("position:20:short5:pool14:pos1")).toBeNull();
    expect(parsePositionScopeKey("position:7:wallet15:pool14:pos1extra")).toBeNull();
    expect(parsePositionScopeKey("position:invalid:wallet15:pool14:pos1")).toBeNull();
    expect(parsePositionScopeKey("position:-5:wallet15:pool14:pos1")).toBeNull();
    const valid = parsePositionScopeKey("position:7:wallet15:pool14:pos1");
    expect(valid).toEqual({
      kind: "position",
      network: "solana-mainnet",
      positionId: "pos1",
      whirlpoolAddress: "pool1",
      walletAddress: "wallet1"
    });
  });

  test("explicit single-mode request without a scope throws before any queue or repository calls", async () => {
    await expect(useCase({ mode: "single" })).rejects.toThrow(
      "scope is required for single position policy insight synthesis request"
    );
    expect(fakeQueue.requests).toHaveLength(0);
  });

  test("a newer plan creates a distinct ready identity and leaves the older request eligible for supersession", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    fakeEvidenceRepo.records.push(makeSampleEvidenceBundleRecord(scope));

    const plan1 = makeSampleStoredPlan("pos1", "pool1", "wallet1", nowUnixMs - 10000);
    fakePlanLedger.plans.push(plan1);
    const res1 = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    const plan2 = makeSampleStoredPlan("pos1", "pool1", "wallet1", nowUnixMs);
    fakePlanLedger.plans.push(plan2);
    const res2 = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    expect(res1.requestId).not.toBe(res2.requestId);
    expect(res1.planHash).not.toBe(res2.planHash);
    expect(res2.status).toBe("pending");
  });

  test("position id mismatch in plan does not match and request remains waiting_for_plan", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    fakeEvidenceRepo.records.push(makeSampleEvidenceBundleRecord(scope));
    const planMismatchPos = makeSampleStoredPlan("pos2", "pool1", "wallet1", nowUnixMs);
    fakePlanLedger.plans.push(planMismatchPos);

    const result = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    expect(result.status).toBe("waiting_for_plan");
    expect(result.planHash).toBeNull();
  });

  test("pool address mismatch in plan does not match and request remains waiting_for_plan", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    fakeEvidenceRepo.records.push(makeSampleEvidenceBundleRecord(scope));
    const planMismatchPool = makeSampleStoredPlan("pos1", "pool2", "wallet1", nowUnixMs);
    fakePlanLedger.plans.push(planMismatchPool);

    const result = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    expect(result.status).toBe("waiting_for_plan");
    expect(result.planHash).toBeNull();
  });

  test("wallet address mismatch in plan does not match and request remains waiting_for_plan", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    fakeEvidenceRepo.records.push(makeSampleEvidenceBundleRecord(scope));
    const planMismatchWallet = makeSampleStoredPlan("pos1", "pool1", "wallet2", nowUnixMs);
    fakePlanLedger.plans.push(planMismatchWallet);

    const result = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    expect(result.status).toBe("waiting_for_plan");
    expect(result.planHash).toBeNull();
  });

  test("five minute time skew mismatch in plan does not match and request remains waiting_for_evidence", async () => {
    const scope = makeSampleScope("pos1", "wallet1", "pool1");
    fakeEvidenceRepo.records.push(
      makeSampleEvidenceBundleRecord(scope, new Date(nowUnixMs).toISOString())
    );

    const planSkewed = makeSampleStoredPlan("pos1", "pool1", "wallet1", nowUnixMs + 600000);
    fakePlanLedger.plans.push(planSkewed);

    const result = (await useCase({ scope })) as RequestPositionPolicyInsightSynthesisResult;

    expect(result.status).toBe("waiting_for_evidence");
    expect(result.selectionHash).toBeNull();
    expect(result.planHash).toBe(planSkewed.planResponse.planHash);
  });

  test("reconciles startup scopes unioning waiting, eligible, and latest plans", async () => {
    const scope1 = makeSampleScope("pos1", "wallet1", "pool1");
    const scope2 = makeSampleScope("pos2", "wallet2", "pool1");

    fakeEvidenceRepo.records.push(
      makeSampleEvidenceBundleRecord(scope1),
      makeSampleEvidenceBundleRecord(scope2)
    );

    fakeQueue.waitingScopes = [evidenceScopeKey(scope1)];
    fakeQueue.eligiblePositionScopes = [evidenceScopeKey(scope2)];
    const planOnly = makeSampleStoredPlan("pos3", "pool1", "wallet3");
    fakePlanLedger.plans.push(planOnly);

    const startupResult: RequestPositionPolicyInsightSynthesisStartupResult =
      await useCase.reconcileStartup();

    expect(startupResult.reconciledCount).toBe(3);
    const planOnlyResult = startupResult.results.find(
      (r) => r.planHash === planOnly.planResponse.planHash
    );
    expect(planOnlyResult).toBeDefined();
    expect(planOnlyResult?.status).toBe("waiting_for_evidence");
    expect(planOnlyResult?.freshEvidenceRequired).toBe(true);
  });
});
