import type {
  PolicyInsightContent,
  PolicyInsightFreshness,
  PolicyInsightHistoryResponse,
  PolicyInsightRead
} from "./types.generated.js";
import { parsePolicyInsightContent } from "./validate.js";

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function computeFreshness(
  content: PolicyInsightContent,
  evaluatedAtUnixMs: number
): PolicyInsightFreshness {
  const asOfMs = new Date(content.asOf).getTime();
  const expiresAtMs = new Date(content.expiresAt).getTime();

  const ageMs = evaluatedAtUnixMs - asOfMs;
  const ageSeconds = Math.floor(ageMs / 1000);

  const status: "FRESH" | "STALE" = evaluatedAtUnixMs < expiresAtMs ? "FRESH" : "STALE";

  return {
    status,
    evaluatedAt: new Date(evaluatedAtUnixMs).toISOString(),
    ageSeconds
  };
}

function formatEvaluatedAt(evaluatedAtUnixMs: number): string {
  return new Date(evaluatedAtUnixMs).toISOString();
}

export type ProjectPolicyInsightReadResult =
  | { ok: true; value: PolicyInsightRead }
  | { ok: false; issues: { path: string; code: string; message: string }[] };

export function projectPolicyInsightRead(
  content: PolicyInsightContent,
  evaluatedAtUnixMs: number
): ProjectPolicyInsightReadResult {
  if (!Number.isFinite(evaluatedAtUnixMs) || !isNonNegativeInteger(evaluatedAtUnixMs)) {
    return {
      ok: false,
      issues: [
        {
          path: "/evaluatedAt",
          code: "INVALID_VALUE",
          message: "evaluatedAtUnixMs must be a non-negative integer"
        }
      ]
    };
  }

  const contentResult = parsePolicyInsightContent(content);
  if (!contentResult.ok) {
    return { ok: false, issues: contentResult.issues };
  }

  const freshness = computeFreshness(content, evaluatedAtUnixMs);

  if (freshness.ageSeconds < 0) {
    return {
      ok: false,
      issues: [
        {
          path: "/evaluatedAt",
          code: "INVALID_VALUE",
          message: "evaluatedAt must be >= asOf"
        }
      ]
    };
  }

  const read: PolicyInsightRead = {
    ...content,
    freshness
  };

  return { ok: true, value: read };
}

export type ProjectPolicyInsightHistoryResponseResult =
  | { ok: true; value: PolicyInsightHistoryResponse }
  | { ok: false; issues: { path: string; code: string; message: string }[] };

export function projectPolicyInsightHistoryResponse(
  contents: PolicyInsightContent[],
  limit: number,
  _cursor: string | null,
  queriedAtUnixMs: number
): ProjectPolicyInsightHistoryResponseResult {
  if (!Number.isFinite(queriedAtUnixMs) || !isNonNegativeInteger(queriedAtUnixMs)) {
    return {
      ok: false,
      issues: [
        {
          path: "/queriedAt",
          code: "INVALID_VALUE",
          message: "queriedAtUnixMs must be a non-negative integer"
        }
      ]
    };
  }

  if (limit < 0) {
    return {
      ok: false,
      issues: [
        {
          path: "/limit",
          code: "INVALID_VALUE",
          message: "limit must be non-negative"
        }
      ]
    };
  }

  const projectedItems: PolicyInsightRead[] = [];

  for (let i = 0; i < contents.length && projectedItems.length < limit; i++) {
    const projectResult = projectPolicyInsightRead(contents[i], queriedAtUnixMs);
    if (!projectResult.ok) {
      return {
        ok: false,
        issues: projectResult.issues.map((issue) => ({
          ...issue,
          path: issue.path.replace(/^\$/, `$.items[${i}]`)
        }))
      };
    }
    projectedItems.push(projectResult.value);
  }

  const historyResponse: PolicyInsightHistoryResponse = {
    schemaVersion: "policy-insight.v1",
    pair: contents[0]?.pair ?? "SOL/USDC",
    queriedAt: formatEvaluatedAt(queriedAtUnixMs),
    limit,
    items: projectedItems,
    nextCursor: null
  };

  return { ok: true, value: historyResponse };
}
