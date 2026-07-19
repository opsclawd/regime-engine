import type { Scope } from "../../../contract/evidence/v1/types.generated.js";
import type { SelectedEvidenceSummary } from "../../evidence/selectEvidence.js";
import type {
  RegimeCurrentResponse,
  PlanRequestPosition,
  PlanResponse,
  Regime
} from "../../../contract/v1/types.js";

export const makeMockEvidenceSummary = (
  overrides?: Partial<SelectedEvidenceSummary>
): SelectedEvidenceSummary => ({
  selectionPolicyVersion: "evidence-selection.v1",
  selectedAtUnixMs: Date.now(),
  pair: "SOL/USDC",
  scope: { kind: "pair" } as Scope,
  authority: "ADVISORY_ONLY",
  mode: "DEGRADED_NO_RESEARCH",
  selected: {
    deterministicFeatures: [],
    contextualEvidence: {
      supportResistance: [],
      flows: [],
      derivatives: [],
      events: [],
      newsRegulatory: []
    },
    researchBrief: null
  },
  familyCoverage: {
    deterministicCount: 0,
    supportResistanceCount: 0,
    flowsCount: 0,
    derivativesCount: 0,
    eventsCount: 0,
    newsRegulatoryCount: 0,
    researchBriefCount: 0
  },
  deterministicEvidenceCoverage: {
    availableCount: 0,
    unavailableCount: 0,
    invalidCount: 0
  },
  conflicts: [],
  warnings: [],
  sourceReferences: [],
  bundles: [],
  decisions: [],
  ...overrides
});

export const makeMockMarketResponse = (
  overrides?: Partial<RegimeCurrentResponse>
): RegimeCurrentResponse => ({
  schemaVersion: "1.0",
  symbol: "SOL/USDC",
  source: "geckoterminal",
  network: "solana",
  poolAddress: "PoolA",
  timeframe: "1h",
  regime: "CHOP",
  telemetry: {
    realizedVolShort: 0.01,
    realizedVolLong: 0.01,
    volRatio: 1.0,
    trendStrength: 0.0,
    compression: 0.5
  },
  clmmSuitability: {
    status: "ALLOWED",
    reasons: []
  },
  marketReasons: [],
  freshness: {
    generatedAtIso: new Date().toISOString(),
    lastCandleOpenUnixMs: Date.now() - 3600000,
    lastCandleOpenIso: new Date(Date.now() - 3600000).toISOString(),
    lastCandleCloseUnixMs: Date.now() - 60000,
    lastCandleCloseIso: new Date(Date.now() - 60000).toISOString(),
    ageSeconds: 60,
    softStale: false,
    hardStale: false,
    softStaleSeconds: 1500,
    hardStaleSeconds: 2100
  },
  metadata: {
    engineVersion: "1.0.0",
    configVersion: "1.0.0",
    candleCount: 50,
    sourceTimeframe: "15m",
    sourceCandleCount: 200
  },
  ...overrides
});

export const makeMockPosition = (
  overrides?: Partial<PlanRequestPosition>
): PlanRequestPosition => ({
  positionId: "pos-1",
  observedAtUnixMs: Date.now(),
  lowerBoundPrice: 95,
  upperBoundPrice: 110,
  currentPrice: 100,
  rangeState: "in-range",
  breachQualified: false,
  ...overrides
});

export const makeMockPlan = (overrides?: Partial<PlanResponse>): PlanResponse => ({
  schemaVersion: "1.0",
  planId: "plan-1",
  planHash: "plan-hash-1",
  asOfUnixMs: Date.now(),
  scope: {
    kind: "position",
    positionId: "pos-1",
    poolAddress: "PoolA",
    symbol: "SOL/USDC"
  },
  regime: "CHOP",
  targets: {
    solBps: 5000,
    usdcBps: 5000,
    allowClmm: true
  },
  actions: [{ type: "HOLD", reasonCode: "POSITION_HOLD" }],
  constraints: {
    cooldownUntilUnixMs: 0,
    standDownUntilUnixMs: 0,
    notes: []
  },
  nextRegimeState: {
    current: "CHOP" as Regime,
    barsInRegime: 5,
    pending: null,
    pendingBars: 0
  },
  reasons: [],
  telemetry: {},
  marketData: {
    source: "geckoterminal",
    network: "solana",
    poolAddress: "PoolA",
    requestedTimeframe: "1h",
    sourceTimeframe: "15m",
    candleCount: 50,
    sourceCandleCount: 200,
    freshness: {
      generatedAtIso: new Date().toISOString(),
      lastCandleOpenUnixMs: Date.now() - 3600000,
      lastCandleOpenIso: new Date(Date.now() - 3600000).toISOString(),
      lastCandleCloseUnixMs: Date.now() - 60000,
      lastCandleCloseIso: new Date(Date.now() - 60000).toISOString(),
      ageSeconds: 60,
      softStale: false,
      hardStale: false,
      softStaleSeconds: 1500,
      hardStaleSeconds: 2100
    }
  },
  ...overrides
});

// Pre-defined fixtures for evidence and market conditions
export const calmChopMarket = makeMockMarketResponse({
  regime: "CHOP",
  telemetry: {
    realizedVolShort: 0.01,
    realizedVolLong: 0.01,
    volRatio: 1.0,
    trendStrength: 0.0,
    compression: 0.1
  }
});

export const upwardMarket = makeMockMarketResponse({
  regime: "UP"
});

export const downwardMarket = makeMockMarketResponse({
  regime: "DOWN"
});

export const stressedMarket = makeMockMarketResponse({
  regime: "CHOP",
  telemetry: {
    realizedVolShort: 0.08,
    realizedVolLong: 0.02,
    volRatio: 4.0,
    trendStrength: 0.1,
    compression: 0.8
  }
});

export const poorPriceQualityMarket = makeMockMarketResponse({
  freshness: {
    generatedAtIso: new Date(Date.now() - 3000000).toISOString(),
    lastCandleOpenUnixMs: Date.now() - 3600000,
    lastCandleOpenIso: new Date(Date.now() - 3600000).toISOString(),
    lastCandleCloseUnixMs: Date.now() - 600000,
    lastCandleCloseIso: new Date(Date.now() - 600000).toISOString(),
    ageSeconds: 3000,
    softStale: true,
    hardStale: true,
    softStaleSeconds: 1500,
    hardStaleSeconds: 2100
  }
});

export const sparseEvidenceSummary = makeMockEvidenceSummary({
  mode: "DEGRADED_NO_RESEARCH",
  selected: {
    deterministicFeatures: [],
    contextualEvidence: {
      supportResistance: [],
      flows: [],
      derivatives: [],
      events: [],
      newsRegulatory: []
    },
    researchBrief: null
  }
});
