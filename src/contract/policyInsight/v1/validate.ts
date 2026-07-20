import AjvModule from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { ErrorObject } from "ajv/dist/2020.js";
import __schema from "../../../../contracts/policy-insight/v1/policy-insight.schema.json" with { type: "json" };
import type {
  PolicyInsightContent,
  PolicyInsightHistoryResponse,
  PolicyInsightRead,
  ReasonCode
} from "./types.generated.js";

const Ajv2020 = AjvModule.Ajv2020;
const addFormats = addFormatsModule.default || addFormatsModule;

export type PolicyInsightValidationIssue = {
  path: string;
  code: "STRUCTURAL" | "SEMANTIC" | "UNSUPPORTED_SCHEMA_VERSION";
  message: string;
};

export type PolicyInsightValidationResult =
  | { ok: true; value: PolicyInsightRead }
  | { ok: false; issues: PolicyInsightValidationIssue[] };

export type PolicyInsightContentValidationResult =
  | { ok: true; value: PolicyInsightContent }
  | { ok: false; issues: PolicyInsightValidationIssue[] };

export class PolicyInsightValidationError extends Error {
  constructor(public readonly issues: PolicyInsightValidationIssue[]) {
    super(`PolicyInsight validation failed: ${issues.length} issue(s)`);
    this.name = "PolicyInsightValidationError";
  }
}

const ajv = new Ajv2020({
  allErrors: true
});
addFormats(ajv);
const validateAgainstSchema = ajv.compile(__schema);

const contentSchema = { ...__schema, $ref: "#/$defs/PolicyInsightContent", $id: undefined };
const validateContent = ajv.compile(contentSchema);

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

const POSITION_REQUIRING_ACTIONS = new Set([
  "EXIT_TO_SOL",
  "EXIT_TO_USDC",
  "MONITOR_LOWER_BOUND",
  "MONITOR_UPPER_BOUND"
]);

const REASON_CODE_PRECEDENCE: ReasonCode[] = [
  "CHURN_STAND_DOWN_ACTIVE",
  "CHURN_COOLDOWN_ACTIVE",
  "DATA_HARD_STALE",
  "DATA_INSUFFICIENT_SAMPLES",
  "CLMM_BREACH_LOWER",
  "CLMM_BREACH_UPPER",
  "MARKET_REGIME_UP",
  "MARKET_REGIME_DOWN",
  "MARKET_REGIME_CHOP",
  "NO_ELIGIBLE_PRICE_LEVELS",
  "FEATURE_THRESHOLD_BREACHED",
  "CONTEXTUAL_EVIDENCE_VOTE",
  "RESEARCH_BRIEF_ANALYSIS",
  "ADVISORY_ONLY"
];

function compareReasonCodes(a: ReasonCode, b: ReasonCode): number {
  const aIdx = REASON_CODE_PRECEDENCE.indexOf(a);
  const bIdx = REASON_CODE_PRECEDENCE.indexOf(b);
  if (aIdx !== bIdx) {
    return aIdx - bIdx;
  }
  return a.localeCompare(b);
}

function compareDecimalStrings(a: string, b: string): number {
  const aParts = a.split(".");
  const bParts = b.split(".");

  const aInt = BigInt(aParts[0]);
  const bInt = BigInt(bParts[0]);

  if (aInt !== bInt) {
    return aInt < bInt ? -1 : 1;
  }

  const aDec = aParts[1] ?? "";
  const bDec = bParts[1] ?? "";

  const maxLen = Math.max(aDec.length, bDec.length);
  const aDecPadded = aDec.padEnd(maxLen, "0");
  const bDecPadded = bDec.padEnd(maxLen, "0");

  return aDecPadded.localeCompare(bDecPadded);
}

function isUniqueAndSorted<T>(arr: T[], cmp: (a: T, b: T) => number): boolean {
  for (let i = 0; i < arr.length - 1; i++) {
    if (cmp(arr[i], arr[i + 1]) >= 0) {
      return false;
    }
  }
  return true;
}

function isUniqueAndSortedDescending<T>(arr: T[], cmp: (a: T, b: T) => number): boolean {
  for (let i = 0; i < arr.length - 1; i++) {
    if (cmp(arr[i], arr[i + 1]) <= 0) {
      return false;
    }
  }
  return true;
}

function mapAjvErrors(errors: ErrorObject[]): PolicyInsightValidationIssue[] {
  return errors.map((err) => {
    const rawPath = err.instancePath;
    let path: string;
    if (!rawPath || rawPath === "/") {
      path = "$";
    } else {
      path = rawPath;
    }
    return {
      path,
      code: "STRUCTURAL" as const,
      message: err.message ?? "Validation error"
    };
  });
}

function validateSemantic(
  content: PolicyInsightRead,
  issues: PolicyInsightValidationIssue[]
): boolean {
  const asOfDate = parseCanonicalTimestamp(content.asOf);
  const generatedAtDate = parseCanonicalTimestamp(content.generatedAt);
  const expiresAtDate = parseCanonicalTimestamp(content.expiresAt);

  if (!asOfDate || !generatedAtDate || !expiresAtDate) {
    return true;
  }

  if (asOfDate.getTime() > generatedAtDate.getTime()) {
    issues.push({
      path: "",
      code: "SEMANTIC",
      message: "asOf must be strictly before generatedAt"
    });
    return false;
  }

  if (generatedAtDate.getTime() >= expiresAtDate.getTime()) {
    issues.push({
      path: "",
      code: "SEMANTIC",
      message: "generatedAt must be strictly before expiresAt"
    });
    return false;
  }

  if (content.position === null) {
    if (POSITION_REQUIRING_ACTIONS.has(content.recommendedAction)) {
      issues.push({
        path: "",
        code: "SEMANTIC",
        message: `${content.recommendedAction} requires a position identity`
      });
      return false;
    }
  }

  if (!isUniqueAndSorted(content.reasonCodes, compareReasonCodes)) {
    issues.push({
      path: "/reasonCodes",
      code: "SEMANTIC",
      message: "reasonCodes must be unique and in precedence order"
    });
    return false;
  }

  const warningCodes = content.warnings.map((w) => w.code);
  const uniqueWarningCodes = new Set(warningCodes);
  if (warningCodes.length !== uniqueWarningCodes.size) {
    issues.push({
      path: "/warnings",
      code: "SEMANTIC",
      message: "warning codes must be unique"
    });
    return false;
  }

  if (warningCodes.length > 1) {
    const sortedWarnings = [...content.warnings].sort((a, b) => {
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      return a.message.localeCompare(b.message);
    });
    for (let i = 0; i < content.warnings.length; i++) {
      if (
        content.warnings[i].code !== sortedWarnings[i].code ||
        content.warnings[i].message !== sortedWarnings[i].message
      ) {
        issues.push({
          path: "/warnings",
          code: "SEMANTIC",
          message: "warnings must be sorted by code then message"
        });
        return false;
      }
    }
  }

  const supports = content.levels.supportsUsdcPerSol;
  if (!isUniqueAndSortedDescending(supports, compareDecimalStrings)) {
    issues.push({
      path: "",
      code: "SEMANTIC",
      message: "supportsUsdcPerSol must be in strictly descending decimal order"
    });
    return false;
  }

  const resistances = content.levels.resistancesUsdcPerSol;
  if (!isUniqueAndSorted(resistances, compareDecimalStrings)) {
    issues.push({
      path: "",
      code: "SEMANTIC",
      message: "resistancesUsdcPerSol must be in strictly ascending decimal order"
    });
    return false;
  }

  const bundleRefs = content.evidence.selectedBundleRefs;
  const bundleRefStrings = bundleRefs.map((r) =>
    JSON.stringify({
      bundleHash: r.bundleHash,
      publisher: r.publisher,
      runId: r.runId,
      sourceId: r.sourceId
    })
  );
  const uniqueBundleRefStrings = new Set(bundleRefStrings);
  if (bundleRefStrings.length !== uniqueBundleRefStrings.size) {
    issues.push({
      path: "/evidence/selectedBundleRefs",
      code: "SEMANTIC",
      message: "selectedBundleRefs must be unique"
    });
    return false;
  }

  if (bundleRefs.length > 1) {
    const sortedBundleRefStrings = [...bundleRefStrings].sort();
    for (let i = 0; i < bundleRefStrings.length; i++) {
      if (bundleRefStrings[i] !== sortedBundleRefStrings[i]) {
        issues.push({
          path: "/evidence/selectedBundleRefs",
          code: "SEMANTIC",
          message: "selectedBundleRefs must be in lexicographic order"
        });
        return false;
      }
    }
  }

  const sourceRefs = content.evidence.selectedSourceRefs;
  const sourceRefStrings = sourceRefs.map((r) =>
    JSON.stringify({
      locator: r.locator,
      observedAt: r.observedAt,
      referenceId: r.referenceId,
      sourceType: r.sourceType
    })
  );
  const uniqueSourceRefStrings = new Set(sourceRefStrings);
  if (sourceRefStrings.length !== uniqueSourceRefStrings.size) {
    issues.push({
      path: "/evidence/selectedSourceRefs",
      code: "SEMANTIC",
      message: "selectedSourceRefs must be unique"
    });
    return false;
  }

  if (sourceRefs.length > 1) {
    const sortedSourceRefStrings = [...sourceRefStrings].sort();
    for (let i = 0; i < sourceRefStrings.length; i++) {
      if (sourceRefStrings[i] !== sortedSourceRefStrings[i]) {
        issues.push({
          path: "/evidence/selectedSourceRefs",
          code: "SEMANTIC",
          message: "selectedSourceRefs must be in lexicographic order"
        });
        return false;
      }
    }
  }

  return true;
}

export function parsePolicyInsightContent(raw: unknown): PolicyInsightContentValidationResult {
  const issues: PolicyInsightValidationIssue[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, issues: [{ path: "$", code: "STRUCTURAL", message: "Expected object" }] };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.schemaVersion !== "string") {
    return {
      ok: false,
      issues: [{ path: "/schemaVersion", code: "STRUCTURAL", message: "schemaVersion is required" }]
    };
  }

  if (obj.schemaVersion !== "policy-insight.v1") {
    return {
      ok: false,
      issues: [
        {
          path: "/schemaVersion",
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: "Unsupported schema version"
        }
      ]
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { freshness: _, ...contentForValidation } = obj;
  if (!validateContent(contentForValidation)) {
    const mapped = mapAjvErrors(validateContent.errors ?? []);
    issues.push(...mapped);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const read = contentForValidation as unknown as PolicyInsightRead;

  validateSemantic(read, issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: read as PolicyInsightContent };
}

export function parsePolicyInsightRead(raw: unknown): PolicyInsightValidationResult {
  const issues: PolicyInsightValidationIssue[] = [];

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, issues: [{ path: "$", code: "STRUCTURAL", message: "Expected object" }] };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.schemaVersion !== "string") {
    return {
      ok: false,
      issues: [{ path: "/schemaVersion", code: "STRUCTURAL", message: "schemaVersion is required" }]
    };
  }

  if (obj.schemaVersion !== "policy-insight.v1") {
    return {
      ok: false,
      issues: [
        {
          path: "/schemaVersion",
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: "Unsupported schema version"
        }
      ]
    };
  }

  if (!validateAgainstSchema(raw)) {
    const mapped = mapAjvErrors(validateAgainstSchema.errors ?? []);
    issues.push(...mapped);
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const read = raw as PolicyInsightRead;

  if (typeof read.freshness !== "object" || read.freshness === null) {
    return {
      ok: false,
      issues: [{ path: "/freshness", code: "STRUCTURAL", message: "freshness is required" }]
    };
  }

  validateSemantic(read, issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: read };
}

export function parsePolicyInsightHistoryResponse(raw: unknown): {
  ok: boolean;
  issues: PolicyInsightValidationIssue[];
  value?: PolicyInsightHistoryResponse;
} {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, issues: [{ path: "$", code: "STRUCTURAL", message: "Expected object" }] };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.schemaVersion !== "string") {
    return {
      ok: false,
      issues: [{ path: "/schemaVersion", code: "STRUCTURAL", message: "schemaVersion is required" }]
    };
  }

  if (obj.schemaVersion !== "policy-insight.v1") {
    return {
      ok: false,
      issues: [
        {
          path: "/schemaVersion",
          code: "UNSUPPORTED_SCHEMA_VERSION",
          message: "Unsupported schema version"
        }
      ]
    };
  }

  if (!Array.isArray(obj.items) || obj.items.length === 0) {
    if (!Array.isArray(obj.items)) {
      return {
        ok: false,
        issues: [{ path: "/items", code: "STRUCTURAL", message: "items must be an array" }]
      };
    }
    return {
      ok: false,
      issues: [{ path: "/items", code: "STRUCTURAL", message: "items must not be empty" }]
    };
  }

  for (let i = 0; i < obj.items.length - 1; i++) {
    const current = obj.items[i] as PolicyInsightRead;
    const next = obj.items[i + 1] as PolicyInsightRead;

    const currentDate = parseCanonicalTimestamp(current.generatedAt);
    const nextDate = parseCanonicalTimestamp(next.generatedAt);

    if (currentDate && nextDate && currentDate < nextDate) {
      return {
        ok: false,
        issues: [
          {
            path: "/items",
            code: "SEMANTIC",
            message: "items must be ordered newest-first by generatedAt"
          }
        ]
      };
    }
  }

  for (let i = 0; i < obj.items.length; i++) {
    const itemResult = parsePolicyInsightRead(obj.items[i]);
    if (!itemResult.ok) {
      return {
        ok: false,
        issues: itemResult.issues.map((issue) => ({
          ...issue,
          path: issue.path.replace(/^\$/, `$.items[${i}]`)
        }))
      };
    }
  }

  return { ok: true, issues: [], value: raw as PolicyInsightHistoryResponse };
}
