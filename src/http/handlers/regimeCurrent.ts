import type { FastifyReply, FastifyRequest } from "fastify";
import { parseRegimeCurrentQuery } from "../../contract/v1/validation.js";
import { candlesNotFoundError, ContractValidationError } from "../errors.js";
import type { CandleReadPort } from "../../application/ports/candlePorts.js";
import {
  MARKET_REGIME_CONFIG,
  MARKET_REGIME_CONFIG_VERSION
} from "../../engine/marketRegime/config.js";
import { buildRegimeCurrent } from "../../engine/marketRegime/buildRegimeCurrent.js";
import { buildRegimeCandleReadPlan } from "../../engine/marketRegime/regimeCandleReadPlan.js";
import { aggregate15mTo1h } from "../../engine/candles/aggregateCandles.js";

export const createRegimeCurrentHandler = (candleReadPort: CandleReadPort) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = parseRegimeCurrentQuery(request.query);
      const config = MARKET_REGIME_CONFIG[query.timeframe];

      const nowUnixMs = Date.now();
      const plan = buildRegimeCandleReadPlan({
        requestedTimeframe: query.timeframe,
        nowUnixMs
      });

      const sourceCandles = await candleReadPort.getLatestCandlesForFeed({
        symbol: query.symbol,
        source: query.source,
        network: query.network,
        poolAddress: query.poolAddress,
        timeframe: plan.sourceTimeframe,
        closedCandleCutoffUnixMs: plan.sourceCutoffUnixMs,
        limit: plan.sourceLimit
      });

      if (sourceCandles.length === 0) {
        throw candlesNotFoundError(
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
        candlesToClassify = aggregated.filter(
          (candle) => candle.unixMs <= plan.derivedCutoffUnixMs
        );
        if (candlesToClassify.length === 0) {
          throw candlesNotFoundError(
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

      const response = buildRegimeCurrent({
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
        engineVersion: process.env.npm_package_version ?? "0.0.0",
        metadata: {
          ...plan.sourceMetadata,
          sourceCandleCount: sourceCandles.length
        }
      });

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      request.log.error(error, "Unhandled error in GET /v1/regime/current");
      return reply.code(500).send({
        schemaVersion: "1.0",
        error: { code: "INTERNAL_ERROR", message: "Internal server error", details: [] }
      });
    }
  };
};
