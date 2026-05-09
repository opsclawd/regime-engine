import { z } from "zod";
import {
  ContractValidationError,
  batchTooLargeError,
  breachQualifiedAtRequiredError,
  duplicateCandleInBatchError,
  invalidBreachQualifiedAtError,
  invalidPositionObservedAtError,
  malformedCandleError,
  unsupportedSchemaVersionError,
  validationErrorFromZod
} from "./errors.js";
import {
  SCHEMA_VERSION,
  type CandleIngestRequest,
  type CandleIngestTimeframe,
  type ClmmExecutionEventRequest,
  type ExecutionResultRequest,
  type PlanRequest,
  type RegimeReadTimeframe,
  type SrLevelBriefRequest
} from "./types.js";

const unixMsSchema = z.number().int().nonnegative();
const nonNegativeNumberSchema = z.number().nonnegative();
const bpsSchema = z.number().int().min(0).max(10_000);
const regimeSchema = z.enum(["UP", "DOWN", "CHOP"]);

const RANGE_STATES = ["in-range", "below-range", "above-range"] as const;
const PLAN_TIMEFRAMES = ["15m", "1h"] as const;
const finitePositiveNumber = z
  .number()
  .refine((value) => Number.isFinite(value) && value > 0, "must be finite positive");

const planRequestPositionSchema = z
  .object({
    positionId: z.string().min(1),
    walletId: z.string().min(1).optional(),
    observedAtUnixMs: unixMsSchema,
    breachQualifiedAtUnixMs: unixMsSchema.optional(),
    lowerBoundPrice: finitePositiveNumber,
    upperBoundPrice: finitePositiveNumber,
    currentPrice: finitePositiveNumber,
    rangeState: z.enum(RANGE_STATES),
    breachQualified: z.boolean(),
    distanceToLowerPct: z.number().optional(),
    distanceToUpperPct: z.number().optional(),
    liquidityUsd: nonNegativeNumberSchema.optional(),
    unclaimedFeesUsd: nonNegativeNumberSchema.optional(),
    inventorySkewSolPct: z.number().optional(),
    inventorySkewUsdcPct: z.number().optional()
  })
  .strict()
  .superRefine((position, ctx) => {
    if (position.lowerBoundPrice >= position.upperBoundPrice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lowerBoundPrice"],
        message: "lowerBoundPrice must be less than upperBoundPrice"
      });
    }
  });

const planRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    asOfUnixMs: unixMsSchema,
    market: z
      .object({
        symbol: z.string().min(1),
        source: z.string().min(1),
        network: z.string().min(1),
        poolAddress: z.string().min(1),
        timeframe: z.enum(PLAN_TIMEFRAMES)
      })
      .strict(),
    position: planRequestPositionSchema,
    portfolio: z
      .object({
        navUsd: nonNegativeNumberSchema,
        solUnits: nonNegativeNumberSchema,
        usdcUnits: nonNegativeNumberSchema
      })
      .strict(),
    autopilotState: z
      .object({
        activeClmm: z.boolean(),
        stopouts24h: z.number().int().nonnegative(),
        redeploys24h: z.number().int().nonnegative(),
        cooldownUntilUnixMs: unixMsSchema,
        standDownUntilUnixMs: unixMsSchema,
        strikeCount: z.number().int().nonnegative()
      })
      .strict(),
    regimeState: z
      .object({
        current: regimeSchema,
        barsInRegime: z.number().int().nonnegative(),
        pending: regimeSchema.nullable(),
        pendingBars: z.number().int().nonnegative()
      })
      .strict()
      .optional(),
    config: z
      .object({
        regime: z
          .object({
            confirmBars: z.number().int().min(1),
            minHoldBars: z.number().int().nonnegative(),
            enterUpTrend: z.number(),
            exitUpTrend: z.number(),
            enterDownTrend: z.number(),
            exitDownTrend: z.number(),
            chopVolRatioMax: z.number().positive()
          })
          .strict(),
        allocation: z
          .object({
            upSolBps: bpsSchema,
            downSolBps: bpsSchema,
            chopSolBps: bpsSchema,
            maxDeltaExposureBpsPerDay: z.number().int().nonnegative(),
            maxTurnoverPerDayBps: z.number().int().nonnegative()
          })
          .strict(),
        churn: z
          .object({
            maxStopouts24h: z.number().int().nonnegative(),
            maxRedeploys24h: z.number().int().nonnegative(),
            cooldownMsAfterStopout: z.number().int().nonnegative(),
            standDownTriggerStrikes: z.number().int().min(1)
          })
          .strict(),
        baselines: z
          .object({
            dcaIntervalDays: z.number().int().min(1),
            dcaAmountUsd: nonNegativeNumberSchema,
            usdcCarryApr: nonNegativeNumberSchema
          })
          .strict()
      })
      .strict()
  })
  .strict();

const executionResultRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    planId: z.string().min(1),
    planHash: z.string().min(1),
    asOfUnixMs: unixMsSchema,
    actionResults: z
      .array(
        z
          .object({
            actionType: z.enum([
              "REQUEST_REBALANCE",
              "REQUEST_ENTER_CLMM",
              "REQUEST_EXIT_CLMM",
              "HOLD",
              "STAND_DOWN"
            ]),
            status: z.enum(["SUCCESS", "FAILED", "SKIPPED"]),
            note: z.string().min(1).optional()
          })
          .strict()
      )
      .min(1),
    costs: z
      .object({
        txFeesUsd: nonNegativeNumberSchema,
        priorityFeesUsd: nonNegativeNumberSchema,
        slippageUsd: nonNegativeNumberSchema
      })
      .strict(),
    portfolioAfter: z
      .object({
        navUsd: nonNegativeNumberSchema,
        solUnits: nonNegativeNumberSchema,
        usdcUnits: nonNegativeNumberSchema
      })
      .strict()
  })
  .strict();

const maybeUnsupportedVersionError = (raw: unknown): ContractValidationError | null => {
  const schemaVersionProbe = z.object({ schemaVersion: z.string() }).passthrough().safeParse(raw);

  if (!schemaVersionProbe.success) {
    return null;
  }

  if (schemaVersionProbe.data.schemaVersion === SCHEMA_VERSION) {
    return null;
  }

  return unsupportedSchemaVersionError(schemaVersionProbe.data.schemaVersion);
};

const parseWithSchema = <T>(raw: unknown, schema: z.ZodType<T>, message: string): T => {
  const unsupportedVersion = maybeUnsupportedVersionError(raw);
  if (unsupportedVersion) {
    throw unsupportedVersion;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw validationErrorFromZod(message, parsed.error.issues);
  }

  return parsed.data;
};

export const parsePlanRequest = (raw: unknown): PlanRequest => {
  const parsed = parseWithSchema(raw, planRequestSchema, "Invalid /v1/plan request body");

  if (parsed.position.observedAtUnixMs > parsed.asOfUnixMs) {
    throw invalidPositionObservedAtError(
      `position.observedAtUnixMs (${parsed.position.observedAtUnixMs}) must not exceed ` +
        `asOfUnixMs (${parsed.asOfUnixMs})`,
      [
        {
          path: "$.position.observedAtUnixMs",
          code: "INVALID_VALUE",
          message: "observedAtUnixMs is in the future relative to asOfUnixMs"
        }
      ]
    );
  }

  if (parsed.position.breachQualified && parsed.position.breachQualifiedAtUnixMs === undefined) {
    throw breachQualifiedAtRequiredError(
      "position.breachQualified=true requires position.breachQualifiedAtUnixMs",
      [
        {
          path: "$.position.breachQualifiedAtUnixMs",
          code: "REQUIRED",
          message: "breachQualifiedAtUnixMs is required when breachQualified is true"
        }
      ]
    );
  }

  if (
    parsed.position.breachQualifiedAtUnixMs !== undefined &&
    parsed.position.breachQualifiedAtUnixMs > parsed.asOfUnixMs
  ) {
    throw invalidBreachQualifiedAtError(
      `position.breachQualifiedAtUnixMs (${parsed.position.breachQualifiedAtUnixMs}) must not ` +
        `exceed asOfUnixMs (${parsed.asOfUnixMs})`,
      [
        {
          path: "$.position.breachQualifiedAtUnixMs",
          code: "INVALID_VALUE",
          message: "breachQualifiedAtUnixMs is in the future relative to asOfUnixMs"
        }
      ]
    );
  }

  return parsed;
};

export const parseExecutionResultRequest = (raw: unknown): ExecutionResultRequest => {
  return parseWithSchema(
    raw,
    executionResultRequestSchema,
    "Invalid /v1/execution-result request body"
  );
};

const srLevelBriefRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    source: z.string().min(1),
    symbol: z.string().min(1),
    brief: z
      .object({
        briefId: z.string().min(1),
        sourceRecordedAtIso: z.string().datetime().optional(),
        summary: z.string().optional()
      })
      .strict(),
    levels: z
      .array(
        z
          .object({
            levelType: z.enum(["support", "resistance"]),
            price: z.number().nonnegative(),
            timeframe: z.string().optional(),
            rank: z.string().optional(),
            invalidation: z.number().nonnegative().optional(),
            notes: z.string().optional()
          })
          .strict()
      )
      .min(1)
  })
  .strict();

export const parseSrLevelBriefRequest = (raw: unknown): SrLevelBriefRequest => {
  return parseWithSchema(raw, srLevelBriefRequestSchema, "Invalid /v1/sr-levels request body");
};

const clmmExecutionEventRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    correlationId: z.string().min(1),
    positionId: z.string().min(1),
    breachDirection: z.enum(["LowerBoundBreach", "UpperBoundBreach"]),
    reconciledAtIso: z.string().datetime(),
    txSignature: z.string().min(1),
    tokenOut: z.enum(["SOL", "USDC"]),
    status: z.enum(["confirmed", "failed"]),
    episodeId: z.string().min(1).optional(),
    previewId: z.string().min(1).optional(),
    detectedAtIso: z.string().datetime().optional(),
    amountOutRaw: z.string().min(1).optional(),
    txFeesUsd: z.number().nonnegative().optional(),
    priorityFeesUsd: z.number().nonnegative().optional(),
    slippageUsd: z.number().nonnegative().optional()
  })
  .strict()
  .refine(
    (data) => {
      if (data.breachDirection === "LowerBoundBreach" && data.tokenOut !== "USDC") return false;
      if (data.breachDirection === "UpperBoundBreach" && data.tokenOut !== "SOL") return false;
      return true;
    },
    {
      message:
        "breachDirection/tokenOut mismatch: LowerBoundBreach requires tokenOut USDC, UpperBoundBreach requires tokenOut SOL"
    }
  );

export const parseClmmExecutionEventRequest = (raw: unknown): ClmmExecutionEventRequest => {
  return parseWithSchema(
    raw,
    clmmExecutionEventRequestSchema,
    "Invalid /v1/clmm-execution-result request body"
  );
};

const CANDLE_INGEST_TIMEFRAMES = ["15m"] as const;
const REGIME_READ_TIMEFRAMES = ["15m", "1h"] as const;

const CANDLE_INGEST_TIMEFRAME_TO_MS: Record<CandleIngestTimeframe, number> = {
  "15m": 15 * 60 * 1000
};

const candleIngestCandleSchema = z
  .object({
    unixMs: z.number().int().nonnegative(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z.number()
  })
  .strict();

const candleIngestRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    source: z.string().min(1),
    network: z.string().min(1),
    poolAddress: z.string().min(1),
    symbol: z.string().min(1),
    timeframe: z.enum(CANDLE_INGEST_TIMEFRAMES),
    sourceRecordedAtIso: z.string().datetime(),
    candles: z.array(candleIngestCandleSchema).min(1)
  })
  .strict();

const validateOhlcvInvariants = (
  candles: CandleIngestRequest["candles"],
  timeframeMs: number
): void => {
  for (let index = 0; index < candles.length; index += 1) {
    const c = candles[index];
    const path = `$.candles[${index}]`;

    for (const field of ["open", "high", "low", "close"] as const) {
      const value = c[field];
      if (!Number.isFinite(value) || value <= 0) {
        throw malformedCandleError(`Candle ${index}: ${field} must be a finite positive number`, [
          {
            path: `${path}.${field}`,
            code: "INVALID_VALUE",
            message: `${field} must be finite positive`
          }
        ]);
      }
    }

    if (!Number.isFinite(c.volume) || c.volume < 0) {
      throw malformedCandleError(`Candle ${index}: volume must be finite and non-negative`, [
        {
          path: `${path}.volume`,
          code: "INVALID_VALUE",
          message: "volume must be finite non-negative"
        }
      ]);
    }

    if (c.high < Math.max(c.open, c.close, c.low)) {
      throw malformedCandleError(`Candle ${index}: high must be >= max(open, close, low)`, [
        { path: `${path}.high`, code: "INVALID_VALUE", message: "high < max(open, close, low)" }
      ]);
    }

    if (c.low > Math.min(c.open, c.close, c.high)) {
      throw malformedCandleError(`Candle ${index}: low must be <= min(open, close, high)`, [
        { path: `${path}.low`, code: "INVALID_VALUE", message: "low > min(open, close, high)" }
      ]);
    }

    if (!Number.isInteger(c.unixMs)) {
      throw malformedCandleError(`Candle ${index}: unixMs must be an integer`, [
        { path: `${path}.unixMs`, code: "INVALID_VALUE", message: "unixMs is not an integer" }
      ]);
    }

    if (c.unixMs % timeframeMs !== 0) {
      throw malformedCandleError(
        `Candle ${index}: unixMs must be aligned to timeframeMs (${timeframeMs})`,
        [{ path: `${path}.unixMs`, code: "INVALID_VALUE", message: "unixMs misaligned" }]
      );
    }
  }
};

const checkBatchSize = (count: number): void => {
  if (count > 1000) {
    throw batchTooLargeError(`candles.length must not exceed 1000; received ${count}`, [
      { path: "$.candles", code: "OUT_OF_RANGE", message: `length=${count} exceeds 1000` }
    ]);
  }
};

const checkDuplicateUnixMs = (candles: CandleIngestRequest["candles"]): void => {
  const seen = new Map<number, number>();
  for (let index = 0; index < candles.length; index += 1) {
    const previous = seen.get(candles[index].unixMs);
    if (previous !== undefined) {
      throw duplicateCandleInBatchError(
        `Duplicate unixMs ${candles[index].unixMs} at indexes ${previous} and ${index}`,
        [
          { path: `$.candles[${previous}].unixMs`, code: "INVALID_VALUE", message: "duplicate" },
          { path: `$.candles[${index}].unixMs`, code: "INVALID_VALUE", message: "duplicate" }
        ]
      );
    }
    seen.set(candles[index].unixMs, index);
  }
};

export const parseCandleIngestRequest = (raw: unknown): CandleIngestRequest => {
  const parsed = parseWithSchema(
    raw,
    candleIngestRequestSchema,
    "Invalid /v1/candles request body"
  );

  checkBatchSize(parsed.candles.length);
  checkDuplicateUnixMs(parsed.candles);
  validateOhlcvInvariants(parsed.candles, CANDLE_INGEST_TIMEFRAME_TO_MS[parsed.timeframe]);

  return parsed;
};

const regimeCurrentQuerySchema = z
  .object({
    symbol: z.string().min(1),
    source: z.string().min(1),
    network: z.string().min(1),
    poolAddress: z.string().min(1),
    timeframe: z.enum(REGIME_READ_TIMEFRAMES)
  })
  .strict();

export const parseRegimeCurrentQuery = (
  raw: unknown
): {
  symbol: string;
  source: string;
  network: string;
  poolAddress: string;
  timeframe: RegimeReadTimeframe;
} => {
  const parsed = regimeCurrentQuerySchema.safeParse(raw);
  if (!parsed.success) {
    throw validationErrorFromZod(
      "Invalid /v1/regime/current query parameters",
      parsed.error.issues
    );
  }
  return parsed.data;
};

export const schemas = {
  planRequest: planRequestSchema,
  executionResultRequest: executionResultRequestSchema,
  srLevelBriefRequest: srLevelBriefRequestSchema,
  clmmExecutionEventRequest: clmmExecutionEventRequestSchema,
  candleIngestRequest: candleIngestRequestSchema
} as const;
