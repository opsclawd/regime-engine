import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { planHashFromPlan, sha256Hex } from "../../contract/v1/hash.js";
import type {
  ClmmSuitabilityReason,
  ClmmSuitabilityStatus,
  MarketReason,
  PlanAction,
  PlanReason,
  PlanRequest,
  PlanRequestPosition,
  PlanResponse,
  Regime,
  RegimeCurrentFreshness,
  RegimeReadTimeframe,
  RegimeState
} from "../../contract/v1/types.js";
import { applyChurnGovernor } from "../churn/governor.js";
import type { IndicatorTelemetry } from "../features/indicators.js";

export interface PositionPlanMarketContext {
  feed: {
    symbol: string;
    source: string;
    network: string;
    poolAddress: string;
    requestedTimeframe: RegimeReadTimeframe;
  };
  regime: Regime;
  telemetry: IndicatorTelemetry;
  freshness: RegimeCurrentFreshness;
  clmmSuitability: { status: ClmmSuitabilityStatus; reasons: ClmmSuitabilityReason[] };
  marketReasons?: MarketReason[];
  candleCount: number;
  sourceCandleCount: number;
  sourceTimeframe: string;
  derivedTimeframe?: string;
  aggregationVersion?: string;
}

export interface PositionPlanInput {
  asOfUnixMs: number;
  position: PlanRequestPosition;
  portfolio: PlanRequest["portfolio"];
  autopilotState: PlanRequest["autopilotState"];
  nextRegimeState: RegimeState;
  config: PlanRequest["config"];
  market: PositionPlanMarketContext;
  schemaVersion?: PlanRequest["schemaVersion"];
}

const REASON = {
  EXIT_RANGE_BREACH: "POSITION_RANGE_BREACH_QUALIFIED",
  EXIT_BLOCKED_ACTIVE: "CLMM_BLOCKED_ACTIVE_POSITION",
  STAND_DOWN: "CHURN_STAND_DOWN",
  HOLD_DEFAULT: "POSITION_HOLD",
  HOLD_OUT_OF_RANGE_NOT_QUALIFIED: "POSITION_OUT_OF_RANGE_NOT_QUALIFIED",
  HOLD_DATA_QUALITY: "POSITION_HOLD_DATA_QUALITY"
} as const;

const buildActions = (input: {
  position: PlanRequestPosition;
  suitabilityStatus: ClmmSuitabilityStatus;
  activeClmm: boolean;
  shouldStandDown: boolean;
}): PlanAction[] => {
  const { position, suitabilityStatus, activeClmm, shouldStandDown } = input;

  if (
    (position.rangeState === "below-range" || position.rangeState === "above-range") &&
    position.breachQualified
  ) {
    return [{ type: "REQUEST_EXIT_CLMM", reasonCode: REASON.EXIT_RANGE_BREACH }];
  }

  if (suitabilityStatus === "BLOCKED" && activeClmm) {
    return [{ type: "REQUEST_EXIT_CLMM", reasonCode: REASON.EXIT_BLOCKED_ACTIVE }];
  }

  if (shouldStandDown) {
    return [{ type: "STAND_DOWN", reasonCode: REASON.STAND_DOWN }];
  }

  if (
    (position.rangeState === "below-range" || position.rangeState === "above-range") &&
    !position.breachQualified
  ) {
    return [{ type: "HOLD", reasonCode: REASON.HOLD_OUT_OF_RANGE_NOT_QUALIFIED }];
  }

  if (suitabilityStatus === "UNKNOWN") {
    return [{ type: "HOLD", reasonCode: REASON.HOLD_DATA_QUALITY }];
  }

  return [{ type: "HOLD", reasonCode: REASON.HOLD_DEFAULT }];
};

const buildReasons = (input: {
  market: PositionPlanMarketContext;
  position: PlanRequestPosition;
  churnReasons: PlanReason[];
}): PlanReason[] => {
  const reasons: PlanReason[] = [];
  for (const r of input.market.marketReasons ?? []) {
    reasons.push({ code: r.code, severity: r.severity, message: r.message });
  }
  for (const r of input.market.clmmSuitability.reasons) {
    reasons.push({ code: r.code, severity: r.severity, message: r.message });
  }
  reasons.push(...input.churnReasons);

  if (
    (input.position.rangeState === "below-range" || input.position.rangeState === "above-range") &&
    !input.position.breachQualified
  ) {
    reasons.push({
      code: "POSITION_OUT_OF_RANGE_NOT_QUALIFIED",
      severity: "WARN",
      message: `Position is ${input.position.rangeState} but breach is not yet qualified.`
    });
  }
  return reasons;
};

const computeTelemetry = (input: {
  indicators: IndicatorTelemetry;
  position: PlanRequestPosition;
}): Record<string, number | string | boolean> => {
  const telemetry: Record<string, number | string | boolean> = {
    realizedVolShort: input.indicators.realizedVolShort,
    realizedVolLong: input.indicators.realizedVolLong,
    volRatio: input.indicators.volRatio,
    trendStrength: input.indicators.trendStrength,
    compression: input.indicators.compression,
    rangeState: input.position.rangeState,
    breachQualified: input.position.breachQualified,
    currentPrice: input.position.currentPrice,
    lowerBoundPrice: input.position.lowerBoundPrice,
    upperBoundPrice: input.position.upperBoundPrice
  };
  if (input.position.distanceToLowerPct !== undefined) {
    telemetry.distanceToLowerPct = input.position.distanceToLowerPct;
  }
  if (input.position.distanceToUpperPct !== undefined) {
    telemetry.distanceToUpperPct = input.position.distanceToUpperPct;
  }
  if (input.position.liquidityUsd !== undefined) {
    telemetry.liquidityUsd = input.position.liquidityUsd;
  }
  if (input.position.unclaimedFeesUsd !== undefined) {
    telemetry.unclaimedFeesUsd = input.position.unclaimedFeesUsd;
  }
  if (input.position.inventorySkewSolPct !== undefined) {
    telemetry.inventorySkewSolPct = input.position.inventorySkewSolPct;
  }
  if (input.position.inventorySkewUsdcPct !== undefined) {
    telemetry.inventorySkewUsdcPct = input.position.inventorySkewUsdcPct;
  }
  return telemetry;
};

export const buildPositionPlan = (input: PositionPlanInput): PlanResponse => {
  const churn = applyChurnGovernor({
    asOfUnixMs: input.asOfUnixMs,
    state: input.autopilotState,
    config: input.config.churn
  });

  const actions = buildActions({
    position: input.position,
    suitabilityStatus: input.market.clmmSuitability.status,
    activeClmm: input.autopilotState.activeClmm,
    shouldStandDown: churn.shouldStandDown
  });

  const allowClmm = input.market.clmmSuitability.status === "ALLOWED" && !churn.shouldStandDown;
  const targets = {
    solBps: 5_000,
    usdcBps: 5_000,
    allowClmm
  };

  const nextRegimeState = input.nextRegimeState;

  const reasons = buildReasons({
    market: input.market,
    position: input.position,
    churnReasons: churn.reasons
  });

  const telemetry = computeTelemetry({
    indicators: input.market.telemetry,
    position: input.position
  });

  const marketData = {
    source: input.market.feed.source,
    network: input.market.feed.network,
    poolAddress: input.market.feed.poolAddress,
    requestedTimeframe: input.market.feed.requestedTimeframe,
    sourceTimeframe: input.market.sourceTimeframe,
    candleCount: input.market.candleCount,
    sourceCandleCount: input.market.sourceCandleCount,
    freshness: input.market.freshness,
    ...(input.market.derivedTimeframe !== undefined
      ? { derivedTimeframe: input.market.derivedTimeframe }
      : {}),
    ...(input.market.aggregationVersion !== undefined
      ? { aggregationVersion: input.market.aggregationVersion }
      : {})
  };

  const stripUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  };

  const requestSignature = {
    asOfUnixMs: input.asOfUnixMs,
    market: input.market.feed,
    position: stripUndefined(input.position as unknown as Record<string, unknown>),
    portfolio: input.portfolio,
    autopilotState: input.autopilotState,
    config: input.config,
    nextRegimeState: input.nextRegimeState
  };
  const requestHash = sha256Hex(toCanonicalJson(requestSignature));
  const planId = `plan-${requestHash.slice(0, 16)}`;

  const basePlan: Omit<PlanResponse, "planHash"> = {
    schemaVersion: input.schemaVersion ?? "1.0",
    planId,
    asOfUnixMs: input.asOfUnixMs,
    scope: {
      kind: "position",
      positionId: input.position.positionId,
      poolAddress: input.market.feed.poolAddress,
      symbol: input.market.feed.symbol
    },
    regime: input.market.regime,
    targets,
    actions,
    constraints: {
      cooldownUntilUnixMs: churn.constraints.cooldownUntilUnixMs,
      standDownUntilUnixMs: churn.constraints.standDownUntilUnixMs,
      notes: churn.constraints.notes
    },
    nextRegimeState,
    reasons,
    telemetry,
    marketData
  };

  return {
    ...basePlan,
    planHash: planHashFromPlan(basePlan)
  };
};
