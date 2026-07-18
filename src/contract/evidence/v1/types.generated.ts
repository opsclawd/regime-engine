// Generated from contracts/evidence-bundle/v1/evidence-bundle.schema.json (sha256: 0146b073cc607b47e52c615f6299294b1fd8f133d8a4b128bd2a95dc20f77b17). Do not edit.
export type SchemaVersion = "evidence-bundle.v1";
export type Pair = "SOL/USDC";
export type Scope =
  | {
      kind: "pair";
    }
  | {
      kind: "whirlpool";
      network: "solana-mainnet";
      whirlpoolAddress: string;
    }
  | {
      kind: "wallet";
      network: "solana-mainnet";
      walletAddress: string;
    }
  | {
      kind: "position";
      network: "solana-mainnet";
      walletAddress: string;
      whirlpoolAddress: string;
      positionId: string;
    };
export type Identifier128 = string;
export type Identifier256 = string;
export type CanonicalTimestamp = string;
export type DeterministicFeature =
  | DeterministicFeatureAvailableNumber
  | DeterministicFeatureAvailableBoolean
  | DeterministicFeatureAvailableCategory
  | DeterministicFeatureUnavailable
  | DeterministicFeatureInvalid;
export type FeatureKindNumber = "number";
export type StatusAvailable = "available";
export type NumericUnit =
  | "usd"
  | "sol"
  | "usdc"
  | "percent"
  | "basis_points"
  | "ratio"
  | "seconds"
  | "milliseconds"
  | "count"
  | "price_usdc_per_sol";
export type ConfidenceBps = number;
export type FeatureKindBoolean = "boolean";
export type BooleanUnit = "boolean";
export type FeatureKindCategory = "category";
export type CategoryUnit = "category";
export type StatusUnavailable = "unavailable";
export type StatusInvalid = "invalid";
export type Hex64 = string;
export type QualityLevel = "complete" | "partial" | "degraded";
export type CoverageStatus = "available" | "partial" | "unavailable" | "not_applicable";

export interface EvidenceBundleV1 {
  schemaVersion: SchemaVersion;
  pair: Pair;
  scope: Scope;
  source: SourceIdentity;
  runId: Identifier256;
  correlationId: Identifier256;
  createdAt: CanonicalTimestamp;
  asOf: CanonicalTimestamp;
  freshUntil: CanonicalTimestamp;
  expiresAt: CanonicalTimestamp;
  /**
   * @minItems 1
   * @maxItems 128
   */
  deterministicFeatures: [DeterministicFeature, ...DeterministicFeature[]];
  contextualEvidence: ContextualEvidence;
  researchBrief: ResearchBrief | null;
  /**
   * @minItems 1
   * @maxItems 256
   */
  sourceReferences: [SourceReference, ...SourceReference[]];
  assessment: BundleAssessment;
  provenance: BundleProvenance;
}
export interface SourceIdentity {
  publisher: "sol-usdc-clmm-intelligence";
  sourceId: Identifier128;
  sourceVersion: Identifier128;
}
export interface DeterministicFeatureAvailableNumber {
  featureId: Identifier128;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: FeatureKindNumber;
  status: StatusAvailable;
  value: number;
  unit: NumericUnit;
  observedAt: CanonicalTimestamp;
  freshUntil: CanonicalTimestamp;
  confidenceBps: ConfidenceBps;
  calculator: Calculator;
  /**
   * @minItems 1
   * @maxItems 64
   */
  inputLineage: [Identifier128, ...Identifier128[]];
  /**
   * @maxItems 16
   */
  warnings:
    | []
    | [Identifier128]
    | [Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ];
}
export interface Calculator {
  name: Identifier128;
  version: Identifier128;
}
export interface DeterministicFeatureAvailableBoolean {
  featureId: Identifier128;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: FeatureKindBoolean;
  status: StatusAvailable;
  value: boolean;
  unit: BooleanUnit;
  observedAt: CanonicalTimestamp;
  freshUntil: CanonicalTimestamp;
  confidenceBps: ConfidenceBps;
  calculator: Calculator;
  /**
   * @minItems 1
   * @maxItems 64
   */
  inputLineage: [Identifier128, ...Identifier128[]];
  /**
   * @maxItems 16
   */
  warnings:
    | []
    | [Identifier128]
    | [Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ];
}
export interface DeterministicFeatureAvailableCategory {
  featureId: Identifier128;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: FeatureKindCategory;
  status: StatusAvailable;
  value: string;
  unit: CategoryUnit;
  observedAt: CanonicalTimestamp;
  freshUntil: CanonicalTimestamp;
  confidenceBps: ConfidenceBps;
  calculator: Calculator;
  /**
   * @minItems 1
   * @maxItems 64
   */
  inputLineage: [Identifier128, ...Identifier128[]];
  /**
   * @maxItems 16
   */
  warnings:
    | []
    | [Identifier128]
    | [Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ];
}
export interface DeterministicFeatureUnavailable {
  featureId: Identifier128;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: "number" | "boolean" | "category";
  status: StatusUnavailable;
  value: null;
  unit: null;
  observedAt: null;
  freshUntil: null;
  confidenceBps: 0;
  calculator: Calculator;
  /**
   * @minItems 1
   * @maxItems 64
   */
  inputLineage: [Identifier128, ...Identifier128[]];
  /**
   * @minItems 1
   * @maxItems 16
   */
  warnings:
    | [Identifier128]
    | [Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ];
}
export interface DeterministicFeatureInvalid {
  featureId: Identifier128;
  family:
    | "market_state"
    | "price_quality"
    | "clmm_economics"
    | "position_state"
    | "liquidity"
    | "risk";
  featureKind: "number" | "boolean" | "category";
  status: StatusInvalid;
  value: null;
  unit: null;
  observedAt?: CanonicalTimestamp | null;
  freshUntil?: CanonicalTimestamp | null;
  confidenceBps: 0;
  calculator: Calculator;
  /**
   * @minItems 1
   * @maxItems 64
   */
  inputLineage: [Identifier128, ...Identifier128[]];
  /**
   * @minItems 1
   * @maxItems 16
   */
  warnings:
    | [Identifier128]
    | [Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [Identifier128, Identifier128, Identifier128, Identifier128, Identifier128, Identifier128]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ]
    | [
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128,
        Identifier128
      ];
}
export interface ContextualEvidence {
  /**
   * @maxItems 64
   */
  supportResistance: SupportResistanceClaim[];
  /**
   * @maxItems 64
   */
  flows: FlowClaim[];
  /**
   * @maxItems 64
   */
  derivatives: DerivativesClaim[];
  /**
   * @maxItems 64
   */
  events: EventClaim[];
  /**
   * @maxItems 64
   */
  newsRegulatory: NewsRegulatoryClaim[];
}
export interface SupportResistanceClaim {
  evidenceId: Identifier128;
  kind: "support_zone" | "resistance_zone" | "breakout_level";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: ConfidenceBps;
  observedAt: CanonicalTimestamp;
  expiresAt: CanonicalTimestamp | null;
  /**
   * @minItems 1
   * @maxItems 64
   */
  sourceReferenceIds: [Identifier128, ...Identifier128[]];
  provenanceMethod: "collected" | "derived" | "human_authored";
}
export interface FlowClaim {
  evidenceId: Identifier128;
  kind: "spot_flow" | "stablecoin_flow" | "exchange_flow";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: ConfidenceBps;
  observedAt: CanonicalTimestamp;
  expiresAt: CanonicalTimestamp | null;
  /**
   * @minItems 1
   * @maxItems 64
   */
  sourceReferenceIds: [Identifier128, ...Identifier128[]];
  provenanceMethod: "collected" | "derived" | "human_authored";
}
export interface DerivativesClaim {
  evidenceId: Identifier128;
  kind: "funding" | "open_interest" | "liquidation" | "options_skew";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: ConfidenceBps;
  observedAt: CanonicalTimestamp;
  expiresAt: CanonicalTimestamp | null;
  /**
   * @minItems 1
   * @maxItems 64
   */
  sourceReferenceIds: [Identifier128, ...Identifier128[]];
  provenanceMethod: "collected" | "derived" | "human_authored";
}
export interface EventClaim {
  evidenceId: Identifier128;
  kind: "scheduled_event" | "protocol_incident" | "network_incident";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: ConfidenceBps;
  observedAt: CanonicalTimestamp;
  expiresAt: CanonicalTimestamp | null;
  /**
   * @minItems 1
   * @maxItems 64
   */
  sourceReferenceIds: [Identifier128, ...Identifier128[]];
  provenanceMethod: "collected" | "derived" | "human_authored";
}
export interface NewsRegulatoryClaim {
  evidenceId: Identifier128;
  kind: "ecosystem_news" | "regulatory_update";
  claim: string;
  direction: "bullish" | "bearish" | "neutral" | "mixed" | "unknown";
  confidenceBps: ConfidenceBps;
  observedAt: CanonicalTimestamp;
  expiresAt: CanonicalTimestamp | null;
  /**
   * @minItems 1
   * @maxItems 64
   */
  sourceReferenceIds: [Identifier128, ...Identifier128[]];
  provenanceMethod: "collected" | "derived" | "human_authored";
}
export interface ResearchBrief {
  briefId: Identifier128;
  generatedAt: CanonicalTimestamp;
  summary: string;
  /**
   * @maxItems 32
   */
  keyFindings: string[];
  /**
   * @maxItems 32
   */
  uncertainties: string[];
  model: ModelInfo;
  promptVersion: Identifier128;
  /**
   * @minItems 1
   * @maxItems 256
   */
  sourceEvidenceIds: [Identifier128, ...Identifier128[]];
}
export interface ModelInfo {
  provider: Identifier128;
  modelId: Identifier128;
  modelVersion: Identifier128;
}
export interface SourceReference {
  referenceId: Identifier128;
  sourceType: "api" | "database" | "chain" | "document" | "internal_bundle";
  locator: string;
  publishedAt?: CanonicalTimestamp | null;
  observedAt: CanonicalTimestamp;
  contentHash?: Hex64 | null;
}
export interface BundleAssessment {
  overallConfidenceBps: ConfidenceBps;
  quality: QualityLevel;
  coverage: FamilyCoverage;
  /**
   * @maxItems 64
   */
  warnings: BundleWarning[];
}
export interface FamilyCoverage {
  deterministic: CoverageStatus;
  supportResistance: CoverageStatus;
  flows: CoverageStatus;
  derivatives: CoverageStatus;
  events: CoverageStatus;
  newsRegulatory: CoverageStatus;
  researchBrief: CoverageStatus;
}
export interface BundleWarning {
  code: Identifier128;
  message: string;
  affectedFamilies: string[];
}
export interface BundleProvenance {
  pipelineVersion: Identifier128;
  gitCommit: Hex64;
  environment: "production" | "staging" | "development" | "test";
  /**
   * @maxItems 128
   */
  upstreamRunIds: Identifier128[];
}
