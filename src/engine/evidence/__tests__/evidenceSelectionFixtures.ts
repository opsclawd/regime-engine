import { parseEvidenceBundleV1 } from "../../../contract/evidence/v1/validate.js";
import type {
  EvidenceBundleV1,
  Scope,
  DeterministicFeature,
  SourceReference,
  ContextualEvidence,
  ResearchBrief,
  BundleAssessment,
  BundleProvenance,
  BundleWarning
} from "../../../contract/evidence/v1/types.generated.js";
import type {
  EvidenceBundleRecord,
  EvidenceLifecycle
} from "../../../application/ports/evidenceBundleRepositoryPort.js";

export interface BundleFixtureOverrides {
  scope?: Scope;
  publisher?: string;
  sourceId?: string;
  sourceVersion?: string;
  runId?: string;
  correlationId?: string;
  createdAt?: string;
  asOf?: string;
  freshUntil?: string;
  expiresAt?: string;
  deterministicFeatures?: DeterministicFeature[];
  contextualEvidence?: Partial<ContextualEvidence>;
  researchBrief?: ResearchBrief | null;
  sourceReferences?: SourceReference[];
  assessment?: Partial<BundleAssessment>;
  provenance?: Partial<BundleProvenance>;
}

export function buildEvidenceBundle(overrides: BundleFixtureOverrides = {}): EvidenceBundleV1 {
  const scope = overrides.scope ?? { kind: "pair" };
  const publisher = overrides.publisher ?? "sol-usdc-clmm-intelligence";
  const sourceId = overrides.sourceId ?? "src-det-001";
  const sourceVersion = overrides.sourceVersion ?? "1.0.0";
  const runId = overrides.runId ?? "run-det-001";
  const correlationId = overrides.correlationId ?? "corr-det-001";
  const createdAt = overrides.createdAt ?? "2024-01-15T10:00:00.000Z";
  const asOf = overrides.asOf ?? "2024-01-15T10:00:00.000Z";
  const freshUntil = overrides.freshUntil ?? "2024-01-15T11:00:00.000Z";
  const expiresAt = overrides.expiresAt ?? "2024-01-15T12:00:00.000Z";

  // deterministic features: default to at least one deterministic feature
  const deterministicFeatures: DeterministicFeature[] = overrides.deterministicFeatures ?? [
    {
      featureId: "feat-price-001",
      family: "market_state",
      featureKind: "number",
      status: "available",
      value: 150.25,
      unit: "usd",
      observedAt: asOf,
      freshUntil: freshUntil,
      confidenceBps: 9500,
      calculator: {
        name: "price-aggregator",
        version: "1.0.0"
      },
      inputLineage: ["ref-price-source"],
      warnings: []
    }
  ];

  // source references: default to at least one source reference
  const sourceReferences: SourceReference[] = overrides.sourceReferences ?? [
    {
      referenceId: "ref-price-source",
      sourceType: "api",
      locator: "https://api.example.com/price",
      observedAt: "2024-01-15T09:59:00.000Z"
    }
  ];

  // contextual evidence
  const defaultContextual: ContextualEvidence = {
    supportResistance: [],
    flows: [],
    derivatives: [],
    events: [],
    newsRegulatory: []
  };
  const contextualEvidence = {
    ...defaultContextual,
    ...overrides.contextualEvidence
  };

  const researchBrief = overrides.researchBrief !== undefined ? overrides.researchBrief : null;

  // Let's compute coverage automatically based on features/claims present, or accept override
  const coverage = {
    deterministic:
      deterministicFeatures.length > 0 ? ("available" as const) : ("unavailable" as const),
    supportResistance:
      contextualEvidence.supportResistance.length > 0
        ? ("available" as const)
        : ("unavailable" as const),
    flows: contextualEvidence.flows.length > 0 ? ("available" as const) : ("unavailable" as const),
    derivatives:
      contextualEvidence.derivatives.length > 0 ? ("available" as const) : ("unavailable" as const),
    events:
      contextualEvidence.events.length > 0 ? ("available" as const) : ("unavailable" as const),
    newsRegulatory:
      contextualEvidence.newsRegulatory.length > 0
        ? ("available" as const)
        : ("unavailable" as const),
    researchBrief: researchBrief !== null ? ("available" as const) : ("unavailable" as const)
  };

  // Warnings: must specify warnings based on coverage, to avoid validation failure!
  const warnings: BundleWarning[] = [];
  const unavailableFamilies: string[] = [];
  for (const [fam, status] of Object.entries(coverage)) {
    if (status === "unavailable" && fam !== "deterministic" && fam !== "researchBrief") {
      unavailableFamilies.push(fam);
    }
  }
  if (unavailableFamilies.length > 0) {
    warnings.push({
      code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
      message: "Contextual evidence families are unavailable",
      affectedFamilies: unavailableFamilies
    });
  }
  if (coverage.researchBrief === "unavailable") {
    warnings.push({
      code: "RESEARCH_BRIEF_UNAVAILABLE",
      message: "Research brief is null",
      affectedFamilies: ["researchBrief"]
    });
  }

  const defaultAssessment: BundleAssessment = {
    overallConfidenceBps: 9500,
    quality:
      deterministicFeatures.length > 0 &&
      contextualEvidence.supportResistance.length > 0 &&
      contextualEvidence.flows.length > 0 &&
      contextualEvidence.derivatives.length > 0 &&
      contextualEvidence.events.length > 0 &&
      contextualEvidence.newsRegulatory.length > 0 &&
      researchBrief !== null
        ? ("complete" as const)
        : ("degraded" as const),
    coverage,
    warnings
  };
  const assessment = {
    ...defaultAssessment,
    ...overrides.assessment
  };

  const defaultProvenance: BundleProvenance = {
    pipelineVersion: "1.0.0",
    gitCommit: "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
    environment: "test",
    upstreamRunIds: []
  };
  const provenance = {
    ...defaultProvenance,
    ...overrides.provenance
  };

  const rawBundle = {
    schemaVersion: "evidence-bundle.v1" as const,
    pair: "SOL/USDC" as const,
    scope,
    source: {
      publisher: publisher as "sol-usdc-clmm-intelligence",
      sourceId,
      sourceVersion
    },
    runId,
    correlationId,
    createdAt,
    asOf,
    freshUntil,
    expiresAt,
    deterministicFeatures,
    contextualEvidence,
    researchBrief,
    sourceReferences,
    assessment,
    provenance
  };

  return parseEvidenceBundleV1(rawBundle);
}

export function buildEvidenceRecord(
  bundle: EvidenceBundleV1,
  overrides: {
    id?: number;
    receivedAtUnixMs?: number;
    lifecycle?: EvidenceLifecycle;
    evidenceHash?: string;
  } = {}
): EvidenceBundleRecord {
  return {
    id: overrides.id ?? 1,
    bundle,
    evidenceHash:
      overrides.evidenceHash ?? "0000000000000000000000000000000000000000000000000000000000000000",
    receivedAtUnixMs: overrides.receivedAtUnixMs ?? Date.parse(bundle.asOf),
    lifecycle: overrides.lifecycle ?? "FRESH"
  };
}
