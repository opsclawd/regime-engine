// Generated from contracts/policy-insight/v1/policy-insight.schema.json (sha256: 80487b0a9374d0b535accf535ef9819f2b2de00e1d65980deb73c97afaa02800). Do not edit.
export type SchemaVersion = "policy-insight.v1";
export type Pair = "SOL/USDC";
export type Hex64 = string;
export type Identifier = string;
export type CanonicalTimestamp = string;
export type MarketRegime = "UP" | "DOWN" | "CHOP";
export type FundamentalRegime = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
export type Posture = "AGGRESSIVE" | "MODERATELY_AGGRESSIVE" | "NEUTRAL" | "DEFENSIVE" | "PAUSED";
export type RecommendedAction =
  | "HOLD"
  | "MONITOR_LOWER_BOUND"
  | "MONITOR_UPPER_BOUND"
  | "EXIT_TO_USDC"
  | "EXIT_TO_SOL"
  | "STAND_DOWN";
export type RiskLevel = "NORMAL" | "ELEVATED" | "CRITICAL";
export type RangeBias = "TIGHT" | "MEDIUM" | "WIDE" | "PASSIVE";
export type RebalanceSensitivity = "LOW" | "NORMAL" | "HIGH" | "PAUSED";
export type MaxCapitalDeploymentBps = number;
export type PositiveDecimalString = string;
export type SelectionStatus = "FULL" | "PARTIAL" | "DEGRADED";
export type ConfidenceBps = number;
export type DataQuality = "COMPLETE" | "PARTIAL" | "STALE";
export type ReasonCode =
  | "ADVISORY_ONLY"
  | "DATA_HARD_STALE"
  | "DATA_INSUFFICIENT_SAMPLES"
  | "CLMM_BREACH_LOWER"
  | "CLMM_BREACH_UPPER"
  | "CHURN_STAND_DOWN_ACTIVE"
  | "CHURN_COOLDOWN_ACTIVE"
  | "MARKET_REGIME_UP"
  | "MARKET_REGIME_DOWN"
  | "MARKET_REGIME_CHOP"
  | "FEATURE_THRESHOLD_BREACHED"
  | "CONTEXTUAL_EVIDENCE_VOTE"
  | "RESEARCH_BRIEF_ANALYSIS"
  | "NO_ELIGIBLE_PRICE_LEVELS";
export type WarningCode =
  | "MARKET_DATA_HARD_STALE"
  | "EVIDENCE_STALE_INPUT"
  | "EVIDENCE_MISSING_FAMILY"
  | "EVIDENCE_REJECTED_FAMILY"
  | "EVIDENCE_CONFLICTED_FAMILY"
  | "EVIDENCE_NO_SELECTED_RESEARCH"
  | "NO_ELIGIBLE_PRICE_LEVELS";

/**
 * Paginated history response containing PolicyInsightRead items in reverse chronological order (newest first). Use nextCursor from last item to fetch next page.
 */
export interface PolicyInsightHistoryResponse {
  schemaVersion: SchemaVersion;
  pair: Pair;
  /**
   * Server timestamp when this history query was executed.
   */
  queriedAt: string;
  /**
   * Maximum number of items requested. Actual items may be fewer if fewer exist.
   */
  limit: number;
  /**
   * Array of PolicyInsightRead items, ordered newest-first by generatedAt.
   */
  items: PolicyInsightRead[];
  /**
   * Opaque cursor for fetching next page. Null when no more items exist.
   */
  nextCursor: string | null;
}
/**
 * Complete policy insight read projection with content and freshness. This is the immutable content plus read-time freshness evaluation. Content portion is hashable; freshness is not included in hash.
 */
export interface PolicyInsightRead {
  schemaVersion: SchemaVersion;
  insightId: Hex64;
  rulesetVersion: Identifier;
  pair: Pair;
  position: PositionScope | null;
  generatedAt: CanonicalTimestamp;
  asOf: CanonicalTimestamp;
  expiresAt: CanonicalTimestamp;
  marketRegime: MarketRegime;
  fundamentalRegime: FundamentalRegime;
  posture: Posture;
  recommendedAction: RecommendedAction;
  riskLevel: RiskLevel;
  clmmPolicy: ClmmPolicy;
  levels: Levels;
  evidence: Evidence;
  confidenceBps: ConfidenceBps;
  dataQuality: DataQuality;
  /**
   * @minItems 1
   * @maxItems 16
   */
  reasonCodes:
    | [ReasonCode]
    | [ReasonCode, ReasonCode]
    | [ReasonCode, ReasonCode, ReasonCode]
    | [ReasonCode, ReasonCode, ReasonCode, ReasonCode]
    | [ReasonCode, ReasonCode, ReasonCode, ReasonCode, ReasonCode]
    | [ReasonCode, ReasonCode, ReasonCode, ReasonCode, ReasonCode, ReasonCode]
    | [ReasonCode, ReasonCode, ReasonCode, ReasonCode, ReasonCode, ReasonCode, ReasonCode]
    | [
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode
      ]
    | [
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode
      ]
    | [
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode
      ]
    | [
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode
      ]
    | [
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode
      ]
    | [
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode
      ]
    | [
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode
      ]
    | [
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode
      ]
    | [
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode,
        ReasonCode
      ];
  reasoning: string;
  /**
   * @maxItems 16
   */
  warnings:
    | []
    | [Warning]
    | [Warning, Warning]
    | [Warning, Warning, Warning]
    | [Warning, Warning, Warning, Warning]
    | [Warning, Warning, Warning, Warning, Warning]
    | [Warning, Warning, Warning, Warning, Warning, Warning]
    | [Warning, Warning, Warning, Warning, Warning, Warning, Warning]
    | [Warning, Warning, Warning, Warning, Warning, Warning, Warning, Warning]
    | [Warning, Warning, Warning, Warning, Warning, Warning, Warning, Warning, Warning]
    | [Warning, Warning, Warning, Warning, Warning, Warning, Warning, Warning, Warning, Warning]
    | [
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning
      ]
    | [
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning
      ]
    | [
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning
      ]
    | [
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning
      ]
    | [
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning
      ]
    | [
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning,
        Warning
      ];
  freshness: Freshness;
}
export interface PositionScope {
  network: "solana-mainnet";
  walletAddress: Identifier;
  whirlpoolAddress: Identifier;
  positionId: Identifier;
}
export interface ClmmPolicy {
  rangeBias: RangeBias;
  rebalanceSensitivity: RebalanceSensitivity;
  maxCapitalDeploymentBps: MaxCapitalDeploymentBps;
}
export interface Levels {
  /**
   * @maxItems 16
   */
  supportsUsdcPerSol:
    | []
    | [PositiveDecimalString]
    | [PositiveDecimalString, PositiveDecimalString]
    | [PositiveDecimalString, PositiveDecimalString, PositiveDecimalString]
    | [PositiveDecimalString, PositiveDecimalString, PositiveDecimalString, PositiveDecimalString]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ];
  /**
   * @maxItems 16
   */
  resistancesUsdcPerSol:
    | []
    | [PositiveDecimalString]
    | [PositiveDecimalString, PositiveDecimalString]
    | [PositiveDecimalString, PositiveDecimalString, PositiveDecimalString]
    | [PositiveDecimalString, PositiveDecimalString, PositiveDecimalString, PositiveDecimalString]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ]
    | [
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString,
        PositiveDecimalString
      ];
}
export interface Evidence {
  selectionStatus: SelectionStatus;
  selectionPolicyVersion: Identifier;
  selectedBundleRefs: BundleRef[];
  selectedSourceRefs: SourceRef[];
}
export interface BundleRef {
  bundleHash: Hex64;
  publisher: Identifier;
  sourceId: Identifier;
  runId: Identifier;
}
export interface SourceRef {
  referenceId: Identifier;
  sourceType: "api" | "database" | "chain" | "document" | "internal_bundle";
  locator: string;
  observedAt: CanonicalTimestamp;
}
export interface Warning {
  code: WarningCode;
  message: string;
}
/**
 * Read-time freshness projection. ageSeconds is computed as: floor((evaluatedAtUnixMs - asOfUnixMs) / 1000). Status FRESH indicates ageSeconds < staleness threshold; STALE otherwise. This structure is explicitly excluded from content hashing since ageSeconds varies on every read.
 */
export interface Freshness {
  /**
   * FRESH if ageSeconds is below staleness threshold, STALE otherwise.
   */
  status: "FRESH" | "STALE";
  /**
   * Timestamp when freshness was evaluated. Typically the current server time.
   */
  evaluatedAt: string;
  /**
   * Age in seconds since asOf timestamp: floor((evaluatedAt - asOf) / 1000). Always >= 0.
   */
  ageSeconds: number;
}

export type PolicyInsightContent = Omit<PolicyInsightRead, "freshness">;
export type PolicyInsightFreshness = Freshness;
