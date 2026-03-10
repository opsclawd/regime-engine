import { z } from "zod";
import {
  ContractValidationError,
  unsupportedSchemaVersionError,
  validationErrorFromZod
} from "../../http/errors.js";
import {
  SCHEMA_VERSION,
  type ExecutionResultRequest,
  type PlanRequest
} from "./types.js";

const unixMsSchema = z.number().int().nonnegative();
const nonNegativeNumberSchema = z.number().nonnegative();
const bpsSchema = z.number().int().min(0).max(10_000);
const regimeSchema = z.enum(["UP", "DOWN", "CHOP"]);

const candleSchema = z
  .object({
    unixMs: unixMsSchema,
    open: nonNegativeNumberSchema,
    high: nonNegativeNumberSchema,
    low: nonNegativeNumberSchema,
    close: nonNegativeNumberSchema,
    volume: nonNegativeNumberSchema
  })
  .strict();

const planRequestSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    asOfUnixMs: unixMsSchema,
    market: z
      .object({
        symbol: z.string().min(1),
        timeframe: z.string().min(1),
        candles: z.array(candleSchema).min(1)
      })
      .strict(),
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
  .strict()
  .superRefine((payload, context) => {
    payload.market.candles.forEach((candle, index) => {
      if (candle.unixMs <= payload.asOfUnixMs) {
        return;
      }

      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["market", "candles", index, "unixMs"],
        message: "Candle unixMs must be less than or equal to asOfUnixMs"
      });
    });
  });

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

const maybeUnsupportedVersionError = (
  raw: unknown
): ContractValidationError | null => {
  const schemaVersionProbe = z
    .object({ schemaVersion: z.string() })
    .passthrough()
    .safeParse(raw);

  if (!schemaVersionProbe.success) {
    return null;
  }

  if (schemaVersionProbe.data.schemaVersion === SCHEMA_VERSION) {
    return null;
  }

  return unsupportedSchemaVersionError(schemaVersionProbe.data.schemaVersion);
};

const parseWithSchema = <T>(
  raw: unknown,
  schema: z.ZodType<T>,
  message: string
): T => {
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
  return parseWithSchema(raw, planRequestSchema, "Invalid /v1/plan request body");
};

export const parseExecutionResultRequest = (
  raw: unknown
): ExecutionResultRequest => {
  return parseWithSchema(
    raw,
    executionResultRequestSchema,
    "Invalid /v1/execution-result request body"
  );
};

export const schemas = {
  planRequest: planRequestSchema,
  executionResultRequest: executionResultRequestSchema
} as const;
