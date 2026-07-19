import type { CandleReadPort } from "../ports/candlePorts.js";
import type { ClockPort } from "../ports/clock.js";
import type { RegimeCurrentQuery, RegimeCurrentResponse } from "../../contract/v1/types.js";
import {
  MARKET_REGIME_CONFIG,
  MARKET_REGIME_CONFIG_VERSION
} from "../../engine/marketRegime/config.js";
import { buildRegimeCurrent } from "../../engine/marketRegime/buildRegimeCurrent.js";
import { buildRegimeCandleReadPlan } from "../../engine/marketRegime/regimeCandleReadPlan.js";
import { aggregate15mTo1h } from "../../engine/candles/aggregateCandles.js";
import { RegimeCandlesNotFoundError } from "../errors/regimeErrors.js";

export type GetCurrentRegimeUseCase = (
  query: RegimeCurrentQuery,
  observedAtUnixMs?: number
) => Promise<RegimeCurrentResponse>;

export interface GetCurrentRegimeUseCaseDeps {
  candleReadPort: CandleReadPort;
  clock: ClockPort;
  engineVersion: string;
}

export const createGetCurrentRegimeUseCase = (
  deps: GetCurrentRegimeUseCaseDeps
): GetCurrentRegimeUseCase => {
  return async (query, observedAtUnixMs) => {
    if (observedAtUnixMs !== undefined) {
      if (
        typeof observedAtUnixMs !== "number" ||
        !Number.isFinite(observedAtUnixMs) ||
        !Number.isInteger(observedAtUnixMs) ||
        observedAtUnixMs < 0
      ) {
        throw new Error("observedAtUnixMs must be a non-negative finite integer");
      }
    }
    const config = MARKET_REGIME_CONFIG[query.timeframe];
    const nowUnixMs = observedAtUnixMs ?? deps.clock.nowUnixMs();
    const plan = buildRegimeCandleReadPlan({
      requestedTimeframe: query.timeframe,
      nowUnixMs
    });

    const sourceCandles = await deps.candleReadPort.getLatestCandlesForFeed({
      symbol: query.symbol,
      source: query.source,
      network: query.network,
      poolAddress: query.poolAddress,
      timeframe: plan.sourceTimeframe,
      closedCandleCutoffUnixMs: plan.sourceCutoffUnixMs,
      limit: plan.sourceLimit
    });

    if (sourceCandles.length === 0) {
      throw new RegimeCandlesNotFoundError(
        `No closed candles found for symbol="${query.symbol}", source="${query.source}", ` +
          `network="${query.network}", poolAddress="${query.poolAddress}", ` +
          `sourceTimeframe="${plan.sourceTimeframe}", requestedTimeframe="${query.timeframe}".`,
        [
          {
            code: "NO_SOURCE_CANDLES",
            path: "$.sourceTimeframe",
            message: "No source candles found before the freshness cutoff"
          }
        ]
      );
    }

    let candlesToClassify = sourceCandles;

    if (plan.mode === "derived") {
      const { candles: aggregated, telemetry } = aggregate15mTo1h(sourceCandles);
      candlesToClassify = aggregated.filter((candle) => candle.unixMs <= plan.derivedCutoffUnixMs);
      if (candlesToClassify.length === 0) {
        throw new RegimeCandlesNotFoundError(
          `No complete derived 1h candles available before the 1h freshness cutoff for ` +
            `symbol="${query.symbol}", source="${query.source}", network="${query.network}", ` +
            `poolAddress="${query.poolAddress}".`,
          [
            {
              code: "NO_DERIVED_CANDLES_AFTER_AGGREGATION",
              path: "$.derivedTimeframe",
              message:
                `Aggregation produced ${telemetry.completeBuckets} complete 1h buckets but none before the cutoff. ` +
                `Skipped: ${telemetry.skippedIncomplete} incomplete, ${telemetry.skippedGapInBucket} gaps, ` +
                `${telemetry.skippedMisaligned} misaligned, ${telemetry.skippedNonInteger} non-integer`
            }
          ]
        );
      }
    }

    return buildRegimeCurrent({
      feed: {
        symbol: query.symbol,
        source: query.source,
        network: query.network,
        poolAddress: query.poolAddress,
        timeframe: query.timeframe
      },
      candles: candlesToClassify,
      nowUnixMs,
      config,
      configVersion: MARKET_REGIME_CONFIG_VERSION,
      engineVersion: deps.engineVersion,
      metadata: {
        ...plan.sourceMetadata,
        sourceCandleCount: sourceCandles.length
      }
    });
  };
};
