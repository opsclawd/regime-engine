export const POLICY_CONFIDENCE_ORDER = ["low", "medium", "high"] as const;
export const POLICY_RISK_ORDER = ["normal", "elevated", "critical"] as const;
export const POLICY_POSTURE_ORDER = [
  "aggressive",
  "moderately_aggressive",
  "neutral",
  "defensive",
  "paused"
] as const;
export const POLICY_RANGE_BIAS_ORDER = ["tight", "medium", "wide", "passive"] as const;
export const POLICY_REBALANCE_SENSITIVITY_ORDER = ["low", "normal", "high", "paused"] as const;

export const POLICY_RULESET_VERSION = "sol-usdc-policy.v1" as const;

export interface PolicyFeatureBinding {
  readonly bindingId: string;
  readonly family: string;
  readonly featureId: string;
  readonly calculatorName: string;
  readonly calculatorVersion: string;
  readonly kind: "number";
  readonly unit: string;
  readonly tighten: "risk" | "confidence" | "capital" | "range" | "support" | "resistance";
  readonly threshold: number;
}

export interface PolicyRuleset {
  readonly version: typeof POLICY_RULESET_VERSION;
  readonly maxInsightLifetimeMs: number;
  readonly positionMaxAgeMs: number;
  readonly degradedSafetyTtlMs: number;
  readonly confidenceOrder: readonly string[];
  readonly riskOrder: readonly string[];
  readonly postureOrder: readonly string[];
  readonly rangeBiasOrder: readonly string[];
  readonly reasonOrder: Readonly<Record<string, number>>;
  readonly featureBindings: readonly PolicyFeatureBinding[];
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const prop = (obj as Record<string, unknown>)[key];
    if (prop !== null && (typeof prop === "object" || typeof prop === "function")) {
      deepFreeze(prop);
    }
  }
  return obj;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

const ALLOWED_UNITS = ["pct", "bps", "usd", "price", "raw", "ratio"];

export function validatePolicyRuleset(candidate: PolicyRuleset): PolicyRuleset {
  if (candidate.version !== POLICY_RULESET_VERSION) {
    throw new Error(`Invalid policy ruleset version: ${candidate.version}`);
  }

  if (candidate.degradedSafetyTtlMs <= 0) {
    throw new Error("degradedSafetyTtlMs must be positive");
  }

  // Validate confidenceOrder
  if (
    candidate.confidenceOrder.length !== POLICY_CONFIDENCE_ORDER.length ||
    !candidate.confidenceOrder.every((val, idx) => val === POLICY_CONFIDENCE_ORDER[idx])
  ) {
    throw new Error("Invalid confidence order");
  }

  // Validate riskOrder
  if (
    candidate.riskOrder.length !== POLICY_RISK_ORDER.length ||
    !candidate.riskOrder.every((val, idx) => val === POLICY_RISK_ORDER[idx])
  ) {
    throw new Error("Invalid risk order");
  }

  // Validate postureOrder
  if (
    candidate.postureOrder.length !== POLICY_POSTURE_ORDER.length ||
    !candidate.postureOrder.every((val, idx) => val === POLICY_POSTURE_ORDER[idx])
  ) {
    throw new Error("Invalid posture order");
  }

  // Validate rangeBiasOrder
  if (
    candidate.rangeBiasOrder.length !== POLICY_RANGE_BIAS_ORDER.length ||
    !candidate.rangeBiasOrder.every((val, idx) => val === POLICY_RANGE_BIAS_ORDER[idx])
  ) {
    throw new Error("Invalid range bias order");
  }

  // Validate unique values in reasonOrder
  const values = Object.values(candidate.reasonOrder);
  const uniqueValues = new Set(values);
  if (uniqueValues.size !== values.length) {
    throw new Error("Duplicate reason precedence");
  }

  // Validate featureBindings
  for (const binding of candidate.featureBindings) {
    if (binding.kind !== "number") {
      throw new Error("Unsupported binding kind");
    }
    if (!ALLOWED_UNITS.includes(binding.unit)) {
      throw new Error("Unsupported binding unit");
    }
  }

  // Deep clone and freeze to ensure deep immutability
  const clone = deepClone(candidate);
  return deepFreeze(clone);
}

export const SOL_USDC_POLICY_V1: PolicyRuleset = {
  version: POLICY_RULESET_VERSION,
  maxInsightLifetimeMs: 3600000, // 1 hour
  positionMaxAgeMs: 86400000, // 24 hours
  degradedSafetyTtlMs: 300000, // 5 minutes
  confidenceOrder: [...POLICY_CONFIDENCE_ORDER],
  riskOrder: [...POLICY_RISK_ORDER],
  postureOrder: [...POLICY_POSTURE_ORDER],
  rangeBiasOrder: [...POLICY_RANGE_BIAS_ORDER],
  reasonOrder: {
    // Stage 1
    DATA_HARD_STALE: 10,
    DATA_INSUFFICIENT_SAMPLES: 20,
    // Stage 2
    CLMM_BREACH_LOWER: 30,
    CLMM_BREACH_UPPER: 40,
    // Stage 3
    CHURN_STAND_DOWN_ACTIVE: 50,
    CHURN_COOLDOWN_ACTIVE: 60,
    // Stage 4
    MARKET_REGIME_UP: 70,
    MARKET_REGIME_DOWN: 80,
    MARKET_REGIME_CHOP: 90,
    // Stage 5
    FEATURE_THRESHOLD_BREACHED: 100,
    // Stage 6
    CONTEXTUAL_EVIDENCE_VOTE: 110,
    // Stage 7
    RESEARCH_BRIEF_ANALYSIS: 120
  },
  featureBindings: [
    {
      bindingId: "sol-usdc-vol-1h-tighten-risk",
      family: "volatility",
      featureId: "vol_1h",
      calculatorName: "std-vol",
      calculatorVersion: "1.0.0",
      kind: "number",
      unit: "pct",
      tighten: "risk",
      threshold: 5.0
    }
  ]
};
