import type { FastifyReply, FastifyRequest } from "fastify";
import { parseRegimeCurrentQuery } from "../../contract/v1/validation.js";
import {
  candlesNotFoundError,
  ContractValidationError
} from "../errors.js";
import type { LedgerStore } from "../../ledger/store.js";
import { getLatestCandlesForFeed } from "../../ledger/candlesWriter.js";
import {
  MARKET_REGIME_CONFIG,
  MARKET_REGIME_CONFIG_VERSION
} from "../../engine/marketRegime/config.js";
import { closedCandleCutoffUnixMs } from "../../engine/marketRegime/closedCandleCutoff.js";
import { buildRegimeCurrent } from "../../engine/marketRegime/buildRegimeCurrent.js";

const READ_BUFFER = 50;

export const createRegimeCurrentHandler = (store: LedgerStore) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const query = parseRegimeCurrentQuery(request.query);
      const config = MARKET_REGIME_CONFIG[query.timeframe];

      const nowUnixMs = Date.now();
      const cutoff = closedCandleCutoffUnixMs(
        nowUnixMs,
        config.timeframeMs,
        config.freshness.closedCandleDelayMs
      );
      const limit = Math.max(config.indicators.volLongWindow, config.suitability.minCandles)
        + READ_BUFFER;

      const candles = getLatestCandlesForFeed(store, {
        symbol: query.symbol,
        source: query.source,
        network: query.network,
        poolAddress: query.poolAddress,
        timeframe: query.timeframe,
        closedCandleCutoffUnixMs: cutoff,
        limit
      });

      if (candles.length === 0) {
        throw candlesNotFoundError(
          `No closed candles found for symbol="${query.symbol}", source="${query.source}", ` +
          `network="${query.network}", poolAddress="${query.poolAddress}", ` +
          `timeframe="${query.timeframe}".`
        );
      }

      const response = buildRegimeCurrent({
        feed: {
          symbol: query.symbol,
          source: query.source,
          network: query.network,
          poolAddress: query.poolAddress,
          timeframe: query.timeframe
        },
        candles,
        nowUnixMs,
        config,
        configVersion: MARKET_REGIME_CONFIG_VERSION,
        engineVersion: process.env.npm_package_version ?? "0.0.0"
      });

      return reply.code(200).send(response);
    } catch (error) {
      if (error instanceof ContractValidationError) {
        return reply.code(error.statusCode).send(error.response);
      }
      throw error;
    }
  };
};