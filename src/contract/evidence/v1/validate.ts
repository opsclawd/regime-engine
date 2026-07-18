import AjvModule from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ErrorObject } from "ajv/dist/2020.js";
const Ajv2020 = AjvModule.Ajv2020;
const addFormats = addFormatsModule.default || addFormatsModule;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvidenceBundleV1 } from "./types.generated.js";

const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const __schemaPath = resolve(
  __repoRoot,
  "contracts/evidence-bundle/v1/evidence-bundle.schema.json"
);
const __schema = JSON.parse(readFileSync(__schemaPath, "utf-8"));

export type EvidenceValidationIssue = {
  path: string;
  code: "STRUCTURAL" | "SEMANTIC" | "UNSUPPORTED_SCHEMA_VERSION";
  message: string;
};

export type EvidenceValidationResult =
  | { ok: true; value: EvidenceBundleV1 }
  | { ok: false; issues: EvidenceValidationIssue[] };

export class EvidenceBundleValidationError extends Error {
  constructor(public readonly issues: EvidenceValidationIssue[]) {
    super(`EvidenceBundle validation failed: ${issues.length} issue(s)`);
    this.name = "EvidenceBundleValidationError";
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: false
});
addFormats(ajv);
const validateAgainstSchema = ajv.compile(__schema);

const CANONICAL_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isCanonicalTimestamp(value: string): boolean {
  if (!CANONICAL_TIMESTAMP_REGEX.test(value)) {
    return false;
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return false;
  }
  return date.toISOString() === value;
}

function parseCanonicalTimestamp(value: string): Date | null {
  if (!isCanonicalTimestamp(value)) {
    return null;
  }
  return new Date(value);
}

interface FeatureIdSet {
  featureIds: Set<string>;
  evidenceIds: Set<string>;
  referenceIds: Set<string>;
}

function collectIds(bundle: EvidenceBundleV1): FeatureIdSet {
  const featureIds = new Set<string>();
  const evidenceIds = new Set<string>();
  const referenceIds = new Set<string>();

  for (const feature of bundle.deterministicFeatures) {
    featureIds.add(feature.featureId);
  }

  const ctx = bundle.contextualEvidence;
  for (const claim of ctx.supportResistance) {
    evidenceIds.add(claim.evidenceId);
  }
  for (const claim of ctx.flows) {
    evidenceIds.add(claim.evidenceId);
  }
  for (const claim of ctx.derivatives) {
    evidenceIds.add(claim.evidenceId);
  }
  for (const claim of ctx.events) {
    evidenceIds.add(claim.evidenceId);
  }
  for (const claim of ctx.newsRegulatory) {
    evidenceIds.add(claim.evidenceId);
  }

  for (const ref of bundle.sourceReferences) {
    referenceIds.add(ref.referenceId);
  }

  return { featureIds, evidenceIds, referenceIds };
}

function checkUniqueIds(bundle: EvidenceBundleV1, issues: EvidenceValidationIssue[]): void {
  const featureIds = bundle.deterministicFeatures.map((f) => f.featureId);
  const uniqueFeatureIds = new Set(featureIds);
  if (featureIds.length !== uniqueFeatureIds.size) {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of featureIds) {
      if (seen.has(id)) {
        duplicates.push(id);
      }
      seen.add(id);
    }
    issues.push({
      path: "/deterministicFeatures",
      code: "SEMANTIC",
      message: `Duplicate feature IDs: ${[...new Set(duplicates)].join(", ")}`
    });
  }

  const ctx = bundle.contextualEvidence;
  const allEvidenceIds = [
    ...ctx.supportResistance.map((e) => e.evidenceId),
    ...ctx.flows.map((e) => e.evidenceId),
    ...ctx.derivatives.map((e) => e.evidenceId),
    ...ctx.events.map((e) => e.evidenceId),
    ...ctx.newsRegulatory.map((e) => e.evidenceId)
  ];
  const uniqueEvidenceIds = new Set(allEvidenceIds);
  if (allEvidenceIds.length !== uniqueEvidenceIds.size) {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of allEvidenceIds) {
      if (seen.has(id)) {
        duplicates.push(id);
      }
      seen.add(id);
    }
    issues.push({
      path: "/contextualEvidence",
      code: "SEMANTIC",
      message: `Duplicate evidence IDs: ${[...new Set(duplicates)].join(", ")}`
    });
  }

  const refIds = bundle.sourceReferences.map((r) => r.referenceId);
  const uniqueRefIds = new Set(refIds);
  if (refIds.length !== uniqueRefIds.size) {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const id of refIds) {
      if (seen.has(id)) {
        duplicates.push(id);
      }
      seen.add(id);
    }
    issues.push({
      path: "/sourceReferences",
      code: "SEMANTIC",
      message: `Duplicate reference IDs: ${[...new Set(duplicates)].join(", ")}`
    });
  }
}

function checkLineageResolution(
  bundle: EvidenceBundleV1,
  featureIds: Set<string>,
  evidenceIds: Set<string>,
  referenceIds: Set<string>,
  issues: EvidenceValidationIssue[]
): void {
  for (const feature of bundle.deterministicFeatures) {
    for (const lineageId of feature.inputLineage) {
      if (lineageId === feature.featureId) {
        issues.push({
          path: `/deterministicFeatures/${feature.featureId}/inputLineage`,
          code: "SEMANTIC",
          message: `Feature ${feature.featureId} references itself in inputLineage`
        });
        continue;
      }
      if (!featureIds.has(lineageId) && !referenceIds.has(lineageId)) {
        issues.push({
          path: `/deterministicFeatures/${feature.featureId}/inputLineage`,
          code: "SEMANTIC",
          message: `Feature ${feature.featureId} references unresolved lineage ID: ${lineageId}`
        });
      }
    }
  }

  const ctx = bundle.contextualEvidence;
  const allEvidenceClaims = [
    ...ctx.supportResistance,
    ...ctx.flows,
    ...ctx.derivatives,
    ...ctx.events,
    ...ctx.newsRegulatory
  ];
  for (const claim of allEvidenceClaims) {
    for (const refId of claim.sourceReferenceIds) {
      if (!referenceIds.has(refId)) {
        issues.push({
          path: `/${claim.kind}/${claim.evidenceId}/sourceReferenceIds`,
          code: "SEMANTIC",
          message: `Evidence ${claim.evidenceId} references unresolved source reference: ${refId}`
        });
      }
    }
  }

  if (bundle.researchBrief) {
    const brief = bundle.researchBrief;
    for (const evidenceId of brief.sourceEvidenceIds) {
      if (!featureIds.has(evidenceId) && !evidenceIds.has(evidenceId)) {
        issues.push({
          path: `/researchBrief/sourceEvidenceIds`,
          code: "SEMANTIC",
          message: `Brief references unresolved evidence ID: ${evidenceId}`
        });
      }
    }
  }
}

function checkTimestampOrdering(bundle: EvidenceBundleV1, issues: EvidenceValidationIssue[]): void {
  const createdAt = parseCanonicalTimestamp(bundle.createdAt);
  const asOf = parseCanonicalTimestamp(bundle.asOf);
  const freshUntil = parseCanonicalTimestamp(bundle.freshUntil);
  const expiresAt = parseCanonicalTimestamp(bundle.expiresAt);

  if (createdAt && asOf && createdAt > asOf) {
    issues.push({
      path: "/createdAt",
      code: "SEMANTIC",
      message: `createdAt (${bundle.createdAt}) must not be after asOf (${bundle.asOf})`
    });
  }

  if (asOf && freshUntil && asOf > freshUntil) {
    issues.push({
      path: "/freshUntil",
      code: "SEMANTIC",
      message: `asOf (${bundle.asOf}) must not be after freshUntil (${bundle.freshUntil})`
    });
  }

  if (freshUntil && expiresAt && freshUntil > expiresAt) {
    issues.push({
      path: "/expiresAt",
      code: "SEMANTIC",
      message: `freshUntil (${bundle.freshUntil}) must not be after expiresAt (${bundle.expiresAt})`
    });
  }

  for (const feature of bundle.deterministicFeatures) {
    if (feature.status !== "available") continue;
    if (!feature.observedAt || !feature.freshUntil) continue;

    const observedAt = parseCanonicalTimestamp(feature.observedAt);
    const featureFreshUntil = parseCanonicalTimestamp(feature.freshUntil);

    if (observedAt && featureFreshUntil && observedAt > featureFreshUntil) {
      issues.push({
        path: `/deterministicFeatures/${feature.featureId}/freshUntil`,
        code: "SEMANTIC",
        message: `Feature observedAt (${feature.observedAt}) must not be after freshUntil (${feature.freshUntil})`
      });
    }
  }
}

function checkCalendarValidity(bundle: EvidenceBundleV1, issues: EvidenceValidationIssue[]): void {
  const timestamps = [
    { path: "/createdAt", value: bundle.createdAt },
    { path: "/asOf", value: bundle.asOf },
    { path: "/freshUntil", value: bundle.freshUntil },
    { path: "/expiresAt", value: bundle.expiresAt }
  ];

  for (const ts of timestamps) {
    if (!isCanonicalTimestamp(ts.value)) {
      issues.push({
        path: ts.path,
        code: "STRUCTURAL",
        message: `Invalid canonical timestamp: ${ts.value}`
      });
    }
  }

  for (const feature of bundle.deterministicFeatures) {
    if (feature.status !== "available") continue;
    if (feature.observedAt) {
      if (!isCanonicalTimestamp(feature.observedAt)) {
        issues.push({
          path: `/deterministicFeatures/${feature.featureId}/observedAt`,
          code: "STRUCTURAL",
          message: `Invalid canonical timestamp: ${feature.observedAt}`
        });
      }
    }
    if (feature.freshUntil) {
      if (!isCanonicalTimestamp(feature.freshUntil)) {
        issues.push({
          path: `/deterministicFeatures/${feature.featureId}/freshUntil`,
          code: "STRUCTURAL",
          message: `Invalid canonical timestamp: ${feature.freshUntil}`
        });
      }
    }
  }

  const ctx = bundle.contextualEvidence;
  const allClaims = [
    ...ctx.supportResistance,
    ...ctx.flows,
    ...ctx.derivatives,
    ...ctx.events,
    ...ctx.newsRegulatory
  ];
  for (const claim of allClaims) {
    if (!isCanonicalTimestamp(claim.observedAt)) {
      issues.push({
        path: `/contextualEvidence/${claim.kind}/${claim.evidenceId}/observedAt`,
        code: "STRUCTURAL",
        message: `Invalid canonical timestamp: ${claim.observedAt}`
      });
    }
    if (claim.expiresAt && !isCanonicalTimestamp(claim.expiresAt)) {
      issues.push({
        path: `/contextualEvidence/${claim.kind}/${claim.evidenceId}/expiresAt`,
        code: "STRUCTURAL",
        message: `Invalid canonical timestamp: ${claim.expiresAt}`
      });
    }
  }

  if (bundle.researchBrief) {
    const brief = bundle.researchBrief;
    if (!isCanonicalTimestamp(brief.generatedAt)) {
      issues.push({
        path: "/researchBrief/generatedAt",
        code: "STRUCTURAL",
        message: `Invalid canonical timestamp: ${brief.generatedAt}`
      });
    }
  }

  for (const ref of bundle.sourceReferences) {
    if (!isCanonicalTimestamp(ref.observedAt)) {
      issues.push({
        path: `/sourceReferences/${ref.referenceId}/observedAt`,
        code: "STRUCTURAL",
        message: `Invalid canonical timestamp: ${ref.observedAt}`
      });
    }
    if (ref.publishedAt && !isCanonicalTimestamp(ref.publishedAt)) {
      issues.push({
        path: `/sourceReferences/${ref.referenceId}/publishedAt`,
        code: "STRUCTURAL",
        message: `Invalid canonical timestamp: ${ref.publishedAt}`
      });
    }
  }
}

function checkCoverageAgreement(bundle: EvidenceBundleV1, issues: EvidenceValidationIssue[]): void {
  const ctx = bundle.contextualEvidence;
  const hasContextualEvidence =
    ctx.supportResistance.length > 0 ||
    ctx.flows.length > 0 ||
    ctx.derivatives.length > 0 ||
    ctx.events.length > 0 ||
    ctx.newsRegulatory.length > 0;

  const coverage = bundle.assessment.coverage;

  if (!hasContextualEvidence && coverage.supportResistance !== "unavailable") {
    issues.push({
      path: "/assessment/coverage/supportResistance",
      code: "SEMANTIC",
      message: `supportResistance coverage is ${coverage.supportResistance} but contextual evidence is empty`
    });
  }
  if (!hasContextualEvidence && coverage.flows !== "unavailable") {
    issues.push({
      path: "/assessment/coverage/flows",
      code: "SEMANTIC",
      message: `flows coverage is ${coverage.flows} but contextual evidence is empty`
    });
  }
  if (!hasContextualEvidence && coverage.derivatives !== "unavailable") {
    issues.push({
      path: "/assessment/coverage/derivatives",
      code: "SEMANTIC",
      message: `derivatives coverage is ${coverage.derivatives} but contextual evidence is empty`
    });
  }
  if (!hasContextualEvidence && coverage.events !== "unavailable") {
    issues.push({
      path: "/assessment/coverage/events",
      code: "SEMANTIC",
      message: `events coverage is ${coverage.events} but contextual evidence is empty`
    });
  }
  if (!hasContextualEvidence && coverage.newsRegulatory !== "unavailable") {
    issues.push({
      path: "/assessment/coverage/newsRegulatory",
      code: "SEMANTIC",
      message: `newsRegulatory coverage is ${coverage.newsRegulatory} but contextual evidence is empty`
    });
  }

  if (bundle.researchBrief === null && coverage.researchBrief !== "unavailable") {
    issues.push({
      path: "/assessment/coverage/researchBrief",
      code: "SEMANTIC",
      message: `researchBrief coverage is ${coverage.researchBrief} but researchBrief is null`
    });
  }

  if (bundle.researchBrief !== null && coverage.researchBrief === "unavailable") {
    issues.push({
      path: "/assessment/coverage/researchBrief",
      code: "SEMANTIC",
      message: `researchBrief coverage is unavailable but researchBrief is present`
    });
  }
}

function checkRequiredWarnings(bundle: EvidenceBundleV1, issues: EvidenceValidationIssue[]): void {
  const ctx = bundle.contextualEvidence;
  const hasContextualEvidence =
    ctx.supportResistance.length > 0 ||
    ctx.flows.length > 0 ||
    ctx.derivatives.length > 0 ||
    ctx.events.length > 0 ||
    ctx.newsRegulatory.length > 0;

  const warnings = bundle.assessment.warnings;
  const warningCodes = new Set(warnings.map((w) => w.code));

  if (!hasContextualEvidence && !warningCodes.has("CONTEXTUAL_EVIDENCE_UNAVAILABLE")) {
    issues.push({
      path: "/assessment/warnings",
      code: "SEMANTIC",
      message: `Empty contextual evidence requires CONTEXTUAL_EVIDENCE_UNAVAILABLE warning`
    });
  }

  if (bundle.researchBrief === null && !warningCodes.has("RESEARCH_BRIEF_UNAVAILABLE")) {
    issues.push({
      path: "/assessment/warnings",
      code: "SEMANTIC",
      message: `Null researchBrief requires RESEARCH_BRIEF_UNAVAILABLE warning`
    });
  }
}

function checkQualityCoverageConsistency(
  bundle: EvidenceBundleV1,
  issues: EvidenceValidationIssue[]
): void {
  const coverage = bundle.assessment.coverage;
  const quality = bundle.assessment.quality;

  if (quality === "complete") {
    if (coverage.supportResistance === "unavailable") {
      issues.push({
        path: "/assessment/quality",
        code: "SEMANTIC",
        message: `quality cannot be complete when supportResistance coverage is unavailable`
      });
    }
    if (coverage.flows === "unavailable") {
      issues.push({
        path: "/assessment/quality",
        code: "SEMANTIC",
        message: `quality cannot be complete when flows coverage is unavailable`
      });
    }
    if (coverage.derivatives === "unavailable") {
      issues.push({
        path: "/assessment/quality",
        code: "SEMANTIC",
        message: `quality cannot be complete when derivatives coverage is unavailable`
      });
    }
    if (coverage.events === "unavailable") {
      issues.push({
        path: "/assessment/quality",
        code: "SEMANTIC",
        message: `quality cannot be complete when events coverage is unavailable`
      });
    }
    if (coverage.newsRegulatory === "unavailable") {
      issues.push({
        path: "/assessment/quality",
        code: "SEMANTIC",
        message: `quality cannot be complete when newsRegulatory coverage is unavailable`
      });
    }
    if (coverage.researchBrief === "unavailable") {
      issues.push({
        path: "/assessment/quality",
        code: "SEMANTIC",
        message: `quality cannot be complete when researchBrief coverage is unavailable`
      });
    }
  }
}

function checkAvailableFeatureValueKind(
  bundle: EvidenceBundleV1,
  issues: EvidenceValidationIssue[]
): void {
  for (const feature of bundle.deterministicFeatures) {
    if (feature.status !== "available") continue;

    const featureId = feature.featureId;

    if (feature.featureKind === "number") {
      if (typeof feature.value !== "number" || !Number.isFinite(feature.value)) {
        issues.push({
          path: `/deterministicFeatures/${featureId}/value`,
          code: "SEMANTIC",
          message: `Number feature ${featureId} must have finite numeric value`
        });
      }
      if (feature.value === 0) {
        issues.push({
          path: `/deterministicFeatures/${featureId}/value`,
          code: "SEMANTIC",
          message: `Available number feature ${featureId} cannot have zero value (use unavailable status)`
        });
      }
    }

    if (feature.featureKind === "boolean") {
      if (typeof feature.value !== "boolean") {
        issues.push({
          path: `/deterministicFeatures/${featureId}/value`,
          code: "SEMANTIC",
          message: `Boolean feature ${featureId} must have boolean value`
        });
      }
    }

    if (feature.featureKind === "category") {
      if (typeof feature.value !== "string" || feature.value === "") {
        issues.push({
          path: `/deterministicFeatures/${featureId}/value`,
          code: "SEMANTIC",
          message: `Category feature ${featureId} must have non-empty string value`
        });
      }
    }
  }
}

function mapAjvErrors(errors: ErrorObject[]): EvidenceValidationIssue[] {
  return errors.map((error) => ({
    path: error.instancePath || "/",
    code: "STRUCTURAL" as const,
    message: error.message || "Validation error"
  }));
}

function sortIssues(issues: EvidenceValidationIssue[]): EvidenceValidationIssue[] {
  return [...issues].sort((a, b) => {
    const pathCmp = a.path.localeCompare(b.path);
    if (pathCmp !== 0) return pathCmp;
    const codeCmp = a.code.localeCompare(b.code);
    if (codeCmp !== 0) return codeCmp;
    return a.message.localeCompare(b.message);
  });
}

export function validateEvidenceBundleV1(input: unknown): EvidenceValidationResult {
  const issues: EvidenceValidationIssue[] = [];

  if (typeof input !== "object" || input === null) {
    return {
      ok: false,
      issues: [{ path: "/", code: "STRUCTURAL", message: "Input must be an object" }]
    };
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.schemaVersion !== "string") {
    return {
      ok: false,
      issues: [
        {
          path: "/schemaVersion",
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: "schemaVersion must be a string"
        }
      ]
    };
  }

  if (obj.schemaVersion !== "evidence-bundle.v1") {
    return {
      ok: false,
      issues: [
        {
          path: "/schemaVersion",
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: `Unsupported schema version: ${obj.schemaVersion}`
        }
      ]
    };
  }

  const valid = validateAgainstSchema(input);
  if (!valid && validateAgainstSchema.errors) {
    const mapped = mapAjvErrors(validateAgainstSchema.errors);
    issues.push(...mapped);
  }

  if (issues.length > 0) {
    return { ok: false, issues: sortIssues(issues) };
  }

  const bundle = input as EvidenceBundleV1;
  const { featureIds, evidenceIds, referenceIds } = collectIds(bundle);

  checkCalendarValidity(bundle, issues);
  checkTimestampOrdering(bundle, issues);
  checkUniqueIds(bundle, issues);
  checkLineageResolution(bundle, featureIds, evidenceIds, referenceIds, issues);
  checkCoverageAgreement(bundle, issues);
  checkRequiredWarnings(bundle, issues);
  checkQualityCoverageConsistency(bundle, issues);
  checkAvailableFeatureValueKind(bundle, issues);

  if (issues.length > 0) {
    return { ok: false, issues: sortIssues(issues) };
  }

  return { ok: true, value: bundle };
}

export function parseEvidenceBundleV1(input: unknown): EvidenceBundleV1 {
  const result = validateEvidenceBundleV1(input);
  if (!result.ok) {
    throw new EvidenceBundleValidationError(result.issues);
  }
  return result.value;
}
