import { selectEvidence } from "./src/engine/evidence/selectEvidence.js";
import { EVIDENCE_SELECTION_POLICY_V1 } from "./src/engine/evidence/selectionPolicy.js";

const bundle1 = {
  schemaVersion: "evidence-bundle.v1",
  pair: "SOL/USDC",
  scope: { kind: "pair" },
  source: { publisher: "sol-usdc-clmm-intelligence", sourceId: "s1", sourceVersion: "1" },
  runId: "run1",
  correlationId: "c1",
  createdAt: "2024-01-15T10:00:00Z",
  asOf: "2024-01-15T10:00:00Z",
  freshUntil: "2024-01-15T11:00:00Z",
  expiresAt: "2024-01-15T12:00:00Z",
  deterministicFeatures: [
    {
      featureId: "f1",
      family: "market_state",
      featureKind: "number",
      status: "available",
      value: 1,
      unit: "usd",
      observedAt: "2024-01-15T10:00:00Z",
      freshUntil: "2024-01-15T11:00:00Z",
      confidenceBps: 10000,
      calculator: { name: "c", version: "1" },
      inputLineage: ["ref1"],
      warnings: []
    }
  ],
  contextualEvidence: {
    supportResistance: [],
    flows: [],
    derivatives: [],
    events: [],
    newsRegulatory: []
  },
  researchBrief: {
    briefId: "b1",
    generatedAt: "2024-01-15T10:00:00Z",
    summary: "sum1",
    keyFindings: [],
    uncertainties: [],
    model: { provider: "p", name: "n" },
    promptVersion: "1",
    sourceEvidenceIds: ["ref1"]
  },
  sourceReferences: [
    { referenceId: "ref1", sourceType: "url", locator: "http", observedAt: "2024-01-15T10:00:00Z" }
  ],
  assessment: { scoreBps: 10000, limitations: [] },
  provenance: { generatedBy: "sys", generationTimeMs: 1, signature: "sig" }
};

const bundle2 = JSON.parse(JSON.stringify(bundle1));
bundle2.source.sourceId = "s2";
bundle2.researchBrief.briefId = "b2";
bundle2.deterministicFeatures[0].featureId = "f2";

const res = selectEvidence({
  records: [
    { id: 1, evidenceHash: "hash1", lifecycle: "FRESH", receivedAtUnixMs: 1, bundle: bundle1 },
    { id: 2, evidenceHash: "hash2", lifecycle: "FRESH", receivedAtUnixMs: 2, bundle: bundle2 }
  ],
  selectedAtUnixMs: Date.parse("2024-01-15T10:30:00Z"),
  scope: { kind: "pair" },
  policy: EVIDENCE_SELECTION_POLICY_V1
});

console.log("ResearchBrief selected count:", res.familyCoverage.researchBriefCount);
console.log("Attached brief ID:", res.selected.researchBrief?.briefId);
console.log(
  "Selected brief decisions:",
  res.decisions.filter((d) => d.kind === "research_brief" && d.status === "SELECTED").length
);
