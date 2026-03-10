import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { planHashFromPlan, sha256Hex } from "../../contract/v1/hash.js";
import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";
import { evaluateChopGate } from "../chopGate.js";
import { computeAllocationTargets } from "../allocation/policy.js";
import { applyVolatilityTargeting } from "../allocation/volTarget.js";
import { applyChurnGovernor } from "../churn/governor.js";
import { sortCandlesByUnixMs } from "../features/candles.js";
import { computeIndicators } from "../features/indicators.js";
import { classifyRegime } from "../regime/classifier.js";
import type { RegimeState } from "../regime/types.js";

const computeCurrentSolBps = (
  request: PlanRequest,
  sortedCandles = sortCandlesByUnixMs(request.market.candles)
): number => {
  if (request.portfolio.navUsd <= 0) {
    return 0;
  }

  const latestClose = sortedCandles[sortedCandles.length - 1]?.close ?? 0;
  const currentSolUsd = request.portfolio.solUnits * latestClose;
  return Math.min(
    10_000,
    Math.max(0, Math.round((currentSolUsd / request.portfolio.navUsd) * 10_000))
  );
};

const buildActions = (input: {
  shouldStandDown: boolean;
  allowClmm: boolean;
  activeClmm: boolean;
  appliedDeltaBps: number;
}) => {
  if (input.shouldStandDown) {
    return [{ type: "STAND_DOWN" as const, reasonCode: "CHURN_STAND_DOWN" }];
  }

  const actions: Array<{ type: PlanResponse["actions"][number]["type"]; reasonCode: string }> = [];
  if (input.appliedDeltaBps !== 0) {
    actions.push({
      type: "REQUEST_REBALANCE",
      reasonCode: "ALLOCATION_ADJUSTMENT"
    });
  }

  if (input.allowClmm && !input.activeClmm) {
    actions.push({
      type: "REQUEST_ENTER_CLMM",
      reasonCode: "CLMM_ALLOWED_CHOP"
    });
  } else if (!input.allowClmm && input.activeClmm) {
    actions.push({
      type: "REQUEST_EXIT_CLMM",
      reasonCode: "CLMM_BLOCKED"
    });
  }

  if (actions.length === 0) {
    actions.push({ type: "HOLD", reasonCode: "NO_ACTION_REQUIRED" });
  }

  return actions;
};

export const buildPlan = (
  request: PlanRequest,
  regimeState?: RegimeState
): PlanResponse => {
  const effectiveRegimeState = regimeState ?? request.regimeState;
  const sortedCandles = sortCandlesByUnixMs(request.market.candles);
  const indicators = computeIndicators(sortedCandles);
  const regime = classifyRegime({
    telemetry: indicators,
    config: request.config.regime,
    state: effectiveRegimeState
  });

  const churn = applyChurnGovernor({
    asOfUnixMs: request.asOfUnixMs,
    state: request.autopilotState,
    config: request.config.churn
  });

  const currentSolBps = computeCurrentSolBps(request, sortedCandles);
  const allocation = computeAllocationTargets({
    regime: regime.regime,
    currentSolBps,
    config: request.config.allocation
  });

  const volTargeted = applyVolatilityTargeting({
    regime: regime.regime,
    currentSolBps,
    targetSolBps: allocation.targets.solBps,
    volRatio: indicators.volRatio,
    maxDeltaExposureBpsPerDay: request.config.allocation.maxDeltaExposureBpsPerDay,
    maxTurnoverPerDayBps: request.config.allocation.maxTurnoverPerDayBps
  });

  const chopGate = evaluateChopGate({
    regime: regime.regime,
    shouldStandDown: churn.shouldStandDown
  });

  const requestHash = sha256Hex(toCanonicalJson(request));
  const planId = `plan-${requestHash.slice(0, 16)}`;
  const actions = buildActions({
    shouldStandDown: churn.shouldStandDown,
    allowClmm: chopGate.allowClmm,
    activeClmm: request.autopilotState.activeClmm,
    appliedDeltaBps: volTargeted.targets.solBps - currentSolBps
  });

  const basePlan: Omit<PlanResponse, "planHash"> = {
    schemaVersion: request.schemaVersion,
    planId,
    asOfUnixMs: request.asOfUnixMs,
    regime: regime.regime,
    targets: {
      solBps: volTargeted.targets.solBps,
      usdcBps: volTargeted.targets.usdcBps,
      allowClmm: chopGate.allowClmm
    },
    actions,
    constraints: {
      cooldownUntilUnixMs: churn.constraints.cooldownUntilUnixMs,
      standDownUntilUnixMs: churn.constraints.standDownUntilUnixMs,
      notes: churn.constraints.notes
    },
    nextRegimeState: regime.nextState,
    reasons: [
      ...regime.reasons,
      ...churn.reasons,
      ...allocation.reasons,
      ...chopGate.reasons
    ],
    telemetry: {
      ...indicators,
      currentSolBps,
      desiredSolBps: allocation.desiredSolBps,
      desiredAfterVolSolBps: volTargeted.desiredAfterVolSolBps,
      volScale: volTargeted.scale
    }
  };

  return {
    ...basePlan,
    planHash: planHashFromPlan(basePlan)
  };
};
