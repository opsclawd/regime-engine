import { describe, expect, it } from "vitest";
import { ContractValidationError, ERROR_CODES } from "../errors.js";
import {
  parseExecutionResultRequest,
  parsePlanRequest,
  parseSrLevelBriefRequest
} from "../validation.js";
import { SCHEMA_VERSION, type PlanRequest } from "../types.js";

const validPlanRequestFixture: PlanRequest = {
  schemaVersion: SCHEMA_VERSION,
  asOfUnixMs: 1_762_591_200_000,
  market: {
    symbol: "SOL/USDC",
    source: "geckoterminal",
    network: "solana",
    poolAddress: "PoolAbc123",
    timeframe: "1h"
  },
  position: {
    positionId: "pos-001",
    observedAtUnixMs: 1_762_591_200_000,
    lowerBoundPrice: 95,
    upperBoundPrice: 110,
    currentPrice: 100,
    rangeState: "in-range",
    breachQualified: false
  },
  portfolio: { navUsd: 10_000, solUnits: 20, usdcUnits: 6_000 },
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
      confirmBars: 2,
      minHoldBars: 3,
      enterUpTrend: 0.6,
      exitUpTrend: 0.4,
      enterDownTrend: -0.6,
      exitDownTrend: -0.4,
      chopVolRatioMax: 1.25
    },
    allocation: {
      upSolBps: 7_500,
      downSolBps: 2_000,
      chopSolBps: 5_000,
      maxDeltaExposureBpsPerDay: 1_500,
      maxTurnoverPerDayBps: 2_000
    },
    churn: {
      maxStopouts24h: 2,
      maxRedeploys24h: 2,
      cooldownMsAfterStopout: 86_400_000,
      standDownTriggerStrikes: 2
    },
    baselines: {
      dcaIntervalDays: 7,
      dcaAmountUsd: 250,
      usdcCarryApr: 0.06
    }
  }
};

const validExecutionResultFixture = {
  schemaVersion: SCHEMA_VERSION,
  planId: "plan-0001",
  planHash: "abc123hash",
  asOfUnixMs: 1_762_591_200_000,
  actionResults: [
    {
      actionType: "REQUEST_REBALANCE",
      status: "SUCCESS"
    }
  ],
  costs: {
    txFeesUsd: 0.05,
    priorityFeesUsd: 0.01,
    slippageUsd: 0.12
  },
  portfolioAfter: {
    navUsd: 10_050,
    solUnits: 21,
    usdcUnits: 5_820
  }
} as const;

const validSrLevelBriefFixture = {
  schemaVersion: SCHEMA_VERSION,
  source: "clmm-analyzer",
  symbol: "SOLUSDC",
  brief: {
    briefId: "brief-001",
    sourceRecordedAtIso: "2025-04-17T12:00:00Z",
    summary: "Test S/R levels"
  },
  levels: [
    { levelType: "support", price: 140.5 },
    { levelType: "resistance", price: 180.25, rank: "strong", timeframe: "1h" }
  ]
} as const;

const captureValidationError = (operation: () => unknown) => {
  try {
    operation();
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return error.response;
    }

    throw error;
  }

  throw new Error("Expected ContractValidationError");
};

describe("v1 validation", () => {
  it("accepts valid /v1/plan fixture", () => {
    const parsed = parsePlanRequest(validPlanRequestFixture);
    expect(parsed).toEqual(validPlanRequestFixture);
  });

  it("accepts optional regimeState on /v1/plan requests", () => {
    const payload: PlanRequest = {
      ...validPlanRequestFixture,
      regimeState: {
        current: "CHOP",
        barsInRegime: 3,
        pending: "UP",
        pendingBars: 1
      }
    };

    const parsed = parsePlanRequest(payload);
    expect(parsed).toEqual(payload);
  });

  it("accepts valid /v1/execution-result fixture", () => {
    const parsed = parseExecutionResultRequest(validExecutionResultFixture);
    expect(parsed).toEqual(validExecutionResultFixture);
  });

  it("accepts valid /v1/sr-levels brief fixture", () => {
    const parsed = parseSrLevelBriefRequest(validSrLevelBriefFixture);
    expect(parsed).toEqual(validSrLevelBriefFixture);
  });

  it("returns canonical error for unsupported schema version", () => {
    const response = captureValidationError(() =>
      parsePlanRequest({ ...validPlanRequestFixture, schemaVersion: "2.0" })
    );

    expect(response).toEqual({
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
        message: 'Unsupported schemaVersion "2.0". Expected "1.0".',
        details: [
          {
            path: "$.schemaVersion",
            code: "INVALID_VALUE",
            message: "Invalid value"
          }
        ]
      }
    });
  });

  it("rejects /v1/plan when required position fields are missing", () => {
    const { position: _omitted, ...withoutPosition } = validPlanRequestFixture;
    void _omitted;
    const response = captureValidationError(() => parsePlanRequest(withoutPosition));

    expect(response.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(response.error.details.some((d) => d.path === "$.position")).toBe(true);
  });

  it("rejects lowerBoundPrice >= upperBoundPrice", () => {
    const response = captureValidationError(() =>
      parsePlanRequest({
        ...validPlanRequestFixture,
        position: {
          ...validPlanRequestFixture.position,
          lowerBoundPrice: 120,
          upperBoundPrice: 110
        }
      })
    );

    expect(response.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(
      response.error.details.some(
        (d) => d.path === "$.position.lowerBoundPrice" || d.path === "$.position.upperBoundPrice"
      )
    ).toBe(true);
  });

  it("rejects observedAtUnixMs greater than asOfUnixMs with INVALID_POSITION_OBSERVED_AT", () => {
    const response = captureValidationError(() =>
      parsePlanRequest({
        ...validPlanRequestFixture,
        position: {
          ...validPlanRequestFixture.position,
          observedAtUnixMs: validPlanRequestFixture.asOfUnixMs + 1
        }
      })
    );

    expect(response.error.code).toBe(ERROR_CODES.INVALID_POSITION_OBSERVED_AT);
    expect(response.error.details.some((d) => d.path === "$.position.observedAtUnixMs")).toBe(true);
  });

  it("rejects breachQualified=true without breachQualifiedAtUnixMs (BREACH_QUALIFIED_AT_REQUIRED)", () => {
    const response = captureValidationError(() =>
      parsePlanRequest({
        ...validPlanRequestFixture,
        position: {
          ...validPlanRequestFixture.position,
          rangeState: "below-range",
          breachQualified: true
        }
      })
    );

    expect(response.error.code).toBe(ERROR_CODES.BREACH_QUALIFIED_AT_REQUIRED);
  });

  it("rejects breachQualifiedAtUnixMs greater than asOfUnixMs (INVALID_BREACH_QUALIFIED_AT)", () => {
    const response = captureValidationError(() =>
      parsePlanRequest({
        ...validPlanRequestFixture,
        position: {
          ...validPlanRequestFixture.position,
          rangeState: "below-range",
          breachQualified: true,
          breachQualifiedAtUnixMs: validPlanRequestFixture.asOfUnixMs + 1
        }
      })
    );

    expect(response.error.code).toBe(ERROR_CODES.INVALID_BREACH_QUALIFIED_AT);
  });

  it("returns canonical type error for invalid /v1/execution-result payload", () => {
    const response = captureValidationError(() =>
      parseExecutionResultRequest({
        ...validExecutionResultFixture,
        costs: {
          ...validExecutionResultFixture.costs,
          txFeesUsd: "0.05"
        }
      })
    );

    expect(response).toEqual({
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Invalid /v1/execution-result request body",
        details: [
          {
            path: "$.costs.txFeesUsd",
            code: "INVALID_TYPE",
            message: "Expected number, received string"
          }
        ]
      }
    });
  });
});
