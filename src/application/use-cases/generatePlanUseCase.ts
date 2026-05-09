import type { CandleReadPort } from "../ports/candlePorts.js";
import type { PlanLedgerWritePort } from "../ports/planLedgerPort.js";
import type { PlanRequest, PlanResponse } from "../../contract/v1/types.js";
import { MARKET_REGIME_CONFIG } from "../../engine/marketRegime/config.js";
import { aggregate15mTo1h } from "../../engine/candles/aggregateCandles.js";
import { buildRegimeCandleReadPlan } from "../../engine/marketRegime/regimeCandleReadPlan.js";
import { computeIndicators } from "../../engine/features/indicators.js";
import { classifyRegimeForPlan } from "../../engine/marketRegime/classifyRegimeForPlan.js";
import { computeFreshness } from "../../engine/marketRegime/freshness.js";
import { evaluateMarketClmmSuitability } from "../../engine/marketRegime/evaluateMarketClmmSuitability.js";
import { buildPositionPlan } from "../../engine/plan/positionPlan.js";
import {
  PlanMarketDataUnavailableError,
  PlanPositionStateStaleError
} from "../errors/planErrors.js";

export type GeneratePlanUseCase = (body: PlanRequest) => Promise<PlanResponse>;

const POSITION_OBSERVATION_MAX_AGE_MS = 60_000;

export interface GeneratePlanUseCaseDeps {
  candleReadPort: CandleReadPort;
  planLedgerWritePort: PlanLedgerWritePort;
}

export const createGeneratePlanUseCase = (deps: GeneratePlanUseCaseDeps): GeneratePlanUseCase => {
  return async (body) => {
    if (body.asOfUnixMs - body.position.observedAtUnixMs > POSITION_OBSERVATION_MAX_AGE_MS) {
      throw new PlanPositionStateStaleError(
        `Position observation is stale: asOfUnixMs - observedAtUnixMs = ` +
          `${body.asOfUnixMs - body.position.observedAtUnixMs} ms (max ${POSITION_OBSERVATION_MAX_AGE_MS}).`,
        [
          {
            path: "$.position.observedAtUnixMs",
            code: "INVALID_VALUE",
            message: "Position state is stale"
          }
        ]
      );
    }

    const config = MARKET_REGIME_CONFIG[body.market.timeframe];
    const readPlan = buildRegimeCandleReadPlan({
      requestedTimeframe: body.market.timeframe,
      nowUnixMs: body.asOfUnixMs
    });

    const sourceCandles = await deps.candleReadPort.getLatestCandlesForFeed({
      symbol: body.market.symbol,
      source: body.market.source,
      network: body.market.network,
      poolAddress: body.market.poolAddress,
      timeframe: readPlan.sourceTimeframe,
      closedCandleCutoffUnixMs: readPlan.sourceCutoffUnixMs,
      limit: readPlan.sourceLimit
    });

    if (sourceCandles.length === 0) {
      throw new PlanMarketDataUnavailableError(
        "No closed candles available for the requested feed/timeframe.",
        [
          {
            path: "$.market",
            code: "NO_SOURCE_CANDLES",
            message: "No closed candles before the freshness cutoff"
          }
        ]
      );
    }

    let candlesToClassify = sourceCandles;
    if (readPlan.mode === "derived") {
      const { candles: aggregated, telemetry } = aggregate15mTo1h(sourceCandles);
      candlesToClassify = aggregated.filter((c) => c.unixMs <= readPlan.derivedCutoffUnixMs);
      if (candlesToClassify.length === 0) {
        throw new PlanMarketDataUnavailableError(
          "No complete derived 1h candles available for plan generation.",
          [
            {
              path: "$.market.timeframe",
              code: "NO_DERIVED_CANDLES_AFTER_AGGREGATION",
              message: `Aggregation produced ${telemetry.completeBuckets} complete 1h buckets but none before the cutoff.`
            }
          ]
        );
      }
    }

    if (candlesToClassify.length < config.suitability.minCandles) {
      throw new PlanMarketDataUnavailableError(
        `Insufficient closed candles for plan generation: have ${candlesToClassify.length}, need at least ${config.suitability.minCandles}.`,
        [
          {
            path: "$.market",
            code: "INSUFFICIENT_CLOSED_CANDLES",
            message: "Not enough closed candles for the requested timeframe"
          }
        ]
      );
    }

    const indicators = computeIndicators(candlesToClassify, config.indicators);
    const {
      regime,
      nextState: nextRegimeState,
      reasons: regimeReasons
    } = classifyRegimeForPlan(indicators, config.regime, body.regimeState);

    const lastCandleUnixMs = candlesToClassify[candlesToClassify.length - 1].unixMs;
    const freshness = computeFreshness(body.asOfUnixMs, lastCandleUnixMs, {
      softStaleMs: config.freshness.softStaleMs,
      hardStaleMs: config.freshness.hardStaleMs
    });

    if (freshness.hardStale) {
      throw new PlanMarketDataUnavailableError(
        "Market data is hard-stale; plan generation refuses to proceed on stale data.",
        [
          {
            path: "$.market",
            code: "DATA_HARD_STALE",
            message: "Latest candle is older than the hard-stale window"
          }
        ]
      );
    }

    const clmmSuitability = evaluateMarketClmmSuitability({
      regime,
      telemetry: indicators,
      freshness: { hardStale: freshness.hardStale, softStale: freshness.softStale },
      candleCount: candlesToClassify.length,
      config: config.suitability
    });

    const plan = buildPositionPlan({
      asOfUnixMs: body.asOfUnixMs,
      position: body.position,
      portfolio: body.portfolio,
      autopilotState: body.autopilotState,
      nextRegimeState,
      config: body.config,
      schemaVersion: body.schemaVersion,
      market: {
        feed: {
          symbol: body.market.symbol,
          source: body.market.source,
          network: body.market.network,
          poolAddress: body.market.poolAddress,
          requestedTimeframe: body.market.timeframe
        },
        regime,
        telemetry: indicators,
        freshness,
        clmmSuitability,
        marketReasons: regimeReasons,
        candleCount: candlesToClassify.length,
        sourceCandleCount: sourceCandles.length,
        sourceTimeframe: readPlan.sourceMetadata.sourceTimeframe,
        ...(readPlan.mode === "derived"
          ? {
              derivedTimeframe: readPlan.sourceMetadata.derivedTimeframe,
              aggregationVersion: readPlan.sourceMetadata.aggregationVersion
            }
          : {})
      }
    });

    await deps.planLedgerWritePort.writePlan({ planRequest: body, planResponse: plan });
    return plan;
  };
};
