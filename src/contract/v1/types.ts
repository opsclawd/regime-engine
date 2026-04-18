export const SCHEMA_VERSION = "1.0" as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

export type Regime = "UP" | "DOWN" | "CHOP";

export type ReasonSeverity = "INFO" | "WARN" | "ERROR";

export type PlanActionType =
  | "REQUEST_REBALANCE"
  | "REQUEST_ENTER_CLMM"
  | "REQUEST_EXIT_CLMM"
  | "HOLD"
  | "STAND_DOWN";

export type ExecutionActionStatus = "SUCCESS" | "FAILED" | "SKIPPED";

export interface Candle {
  unixMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PlanRequestConfig {
  regime: {
    confirmBars: number;
    minHoldBars: number;
    enterUpTrend: number;
    exitUpTrend: number;
    enterDownTrend: number;
    exitDownTrend: number;
    chopVolRatioMax: number;
  };
  allocation: {
    upSolBps: number;
    downSolBps: number;
    chopSolBps: number;
    maxDeltaExposureBpsPerDay: number;
    maxTurnoverPerDayBps: number;
  };
  churn: {
    maxStopouts24h: number;
    maxRedeploys24h: number;
    cooldownMsAfterStopout: number;
    standDownTriggerStrikes: number;
  };
  baselines: {
    dcaIntervalDays: number;
    dcaAmountUsd: number;
    usdcCarryApr: number;
  };
}

export interface RegimeState {
  current: Regime;
  barsInRegime: number;
  pending: Regime | null;
  pendingBars: number;
}

export interface PlanRequest {
  schemaVersion: SchemaVersion;
  asOfUnixMs: number;
  market: {
    symbol: string;
    timeframe: string;
    candles: Candle[];
  };
  portfolio: {
    navUsd: number;
    solUnits: number;
    usdcUnits: number;
  };
  autopilotState: {
    activeClmm: boolean;
    stopouts24h: number;
    redeploys24h: number;
    cooldownUntilUnixMs: number;
    standDownUntilUnixMs: number;
    strikeCount: number;
  };
  regimeState?: RegimeState;
  config: PlanRequestConfig;
}

export interface PlanReason {
  code: string;
  severity: ReasonSeverity;
  message: string;
}

export interface PlanAction {
  type: PlanActionType;
  reasonCode: string;
}

export interface PlanResponse {
  schemaVersion: SchemaVersion;
  planId: string;
  planHash: string;
  asOfUnixMs: number;
  regime: Regime;
  targets: {
    solBps: number;
    usdcBps: number;
    allowClmm: boolean;
  };
  actions: PlanAction[];
  constraints: {
    cooldownUntilUnixMs: number;
    standDownUntilUnixMs: number;
    notes: string[];
  };
  nextRegimeState: RegimeState;
  reasons: PlanReason[];
  telemetry: Record<string, number | string | boolean>;
}

export interface ExecutionResultRequest {
  schemaVersion: SchemaVersion;
  planId: string;
  planHash: string;
  asOfUnixMs: number;
  actionResults: Array<{
    actionType: PlanActionType;
    status: ExecutionActionStatus;
    note?: string;
  }>;
  costs: {
    txFeesUsd: number;
    priorityFeesUsd: number;
    slippageUsd: number;
  };
  portfolioAfter: {
    navUsd: number;
    solUnits: number;
    usdcUnits: number;
  };
}

export interface ExecutionResultResponse {
  schemaVersion: SchemaVersion;
  ok: true;
  linkedPlanId: string;
  linkedPlanHash: string;
  idempotent?: boolean;
}

export interface SrLevelBriefRequest {
  source: string;
  symbol: string;
  brief: {
    briefId: string;
    sourceRecordedAtIso?: string;
    summary?: string;
  };
  levels: Array<{
    levelType: "support" | "resistance";
    price: number;
    timeframe?: string;
    rank?: string;
    invalidation?: number;
    notes?: string;
  }>;
}

export interface SrLevelBriefIngestResponse {
  briefId: string;
  insertedCount: number;
  status?: "already_ingested";
}

export interface ClmmExecutionEventRequest {
  schemaVersion: SchemaVersion;
  correlationId: string;
  positionId: string;
  breachDirection: "LowerBoundBreach" | "UpperBoundBreach";
  reconciledAtIso: string;
  txSignature: string;
  tokenOut: "SOL" | "USDC";
  status: "confirmed" | "failed";
  episodeId?: string;
  previewId?: string;
  detectedAtIso?: string;
  amountOutRaw?: string;
  txFeesUsd?: number;
  priorityFeesUsd?: number;
  slippageUsd?: number;
}

export interface ClmmExecutionEventResponse {
  ok: true;
  correlationId: string;
  idempotent?: boolean;
}

export interface SrLevelResponse {
  price: number;
  rank?: string;
  timeframe?: string;
  invalidation?: number;
  notes?: string;
}

export interface SrLevelsCurrentResponse {
  schemaVersion: SchemaVersion;
  source: string;
  symbol: string;
  briefId: string;
  sourceRecordedAtIso: string | null;
  summary: string | null;
  capturedAtIso: string;
  supports: SrLevelResponse[];
  resistances: SrLevelResponse[];
}