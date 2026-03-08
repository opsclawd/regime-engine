import { describe, expect, it } from "vitest";
import {
  ContractValidationError,
  ERROR_CODES
} from "../../../http/errors.js";
import {
  parseExecutionResultRequest,
  parsePlanRequest
} from "../validation.js";
import { SCHEMA_VERSION, type PlanRequest } from "../types.js";

const validPlanRequestFixture: PlanRequest = {
  schemaVersion: SCHEMA_VERSION,
  asOfUnixMs: 1_762_591_200_000,
  market: {
    symbol: "SOLUSDC",
    timeframe: "1h",
    candles: [
      {
        unixMs: 1_762_591_200_000,
        open: 200,
        high: 210,
        low: 195,
        close: 205,
        volume: 1_200
      }
    ]
  },
  portfolio: {
    navUsd: 10_000,
    solUnits: 20,
    usdcUnits: 6_000
  },
  autopilotState: {
    activeClmm: false,
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

  it("returns deterministic sorted validation details for invalid /v1/plan payloads", () => {
    const invalidPayload = {
      ...validPlanRequestFixture,
      market: {
        ...validPlanRequestFixture.market,
        symbol: "",
        candles: []
      },
      portfolio: {
        ...validPlanRequestFixture.portfolio,
        navUsd: -1
      },
      config: {
        ...validPlanRequestFixture.config,
        allocation: {
          ...validPlanRequestFixture.config.allocation,
          upSolBps: 10_001
        }
      },
      unknownField: true
    };

    const first = captureValidationError(() => parsePlanRequest(invalidPayload));
    const second = captureValidationError(() => parsePlanRequest(invalidPayload));

    expect(first).toEqual(second);
    expect(first).toEqual({
      schemaVersion: SCHEMA_VERSION,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Invalid /v1/plan request body",
        details: [
          {
            path: "$.config.allocation.upSolBps",
            code: "OUT_OF_RANGE",
            message: "Value is out of range"
          },
          {
            path: "$.market.candles",
            code: "OUT_OF_RANGE",
            message: "Value is out of range"
          },
          {
            path: "$.market.symbol",
            code: "OUT_OF_RANGE",
            message: "Value is out of range"
          },
          {
            path: "$.portfolio.navUsd",
            code: "OUT_OF_RANGE",
            message: "Value is out of range"
          },
          {
            path: "$.unknownField",
            code: "UNKNOWN_KEY",
            message: "Unexpected key: unknownField"
          }
        ]
      }
    });
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
