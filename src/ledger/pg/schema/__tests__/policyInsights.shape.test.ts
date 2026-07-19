import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import type { PolicyInsightRow } from "../policyInsights.js";

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      return listTsFiles(fullPath);
    }
    return entry.name.endsWith(".ts") ? [fullPath] : [];
  });
}

const EXPECTED_COLUMN_COUNT = 22;

describe("policyInsights shape test", () => {
  it("asserts the exact 22 columns are defined in the schema", () => {
    type PolicyInsightColumnNames = keyof PolicyInsightRow;
    const columns: PolicyInsightColumnNames[] = [
      "id",
      "insightId",
      "schemaVersion",
      "rulesetVersion",
      "pair",
      "scopeKey",
      "positionId",
      "generatedAtUnixMs",
      "asOfUnixMs",
      "expiresAtUnixMs",
      "persistedAtUnixMs",
      "marketHash",
      "positionHash",
      "selectionHash",
      "synthesisInputHash",
      "selectionPolicyVersion",
      "synthesisInputJson",
      "synthesisOutputJson",
      "payloadCanonical",
      "payloadHash",
      "selectedLineageJson",
      "excludedLineageJson"
    ];
    expect(columns.length).toBe(EXPECTED_COLUMN_COUNT);
  });

  it("asserts the unique constraints/indexes are defined in the schema", () => {
    const schemaSrc = readFileSync(resolve(import.meta.dirname, "../policyInsights.ts"), "utf-8");
    expect(schemaSrc).toContain('uniqueIndex("uniq_policy_insights_insight_id")');
    expect(schemaSrc).toContain('uniqueIndex("uniq_policy_insights_synthesis_input")');
  });

  it("asserts current and history indexes are defined in the schema", () => {
    const schemaSrc = readFileSync(resolve(import.meta.dirname, "../policyInsights.ts"), "utf-8");
    expect(schemaSrc).toContain('index("idx_policy_insights_current")');
    expect(schemaSrc).toContain('index("idx_policy_insights_history")');
  });

  it("asserts no application code updates or deletes policy_insights rows (append-only)", () => {
    const srcRoot = resolve(import.meta.dirname, "../../../..");
    const tsFiles = listTsFiles(srcRoot).filter((file) => !file.endsWith(".shape.test.ts"));
    const offenders = tsFiles.filter((file) => {
      const contents = readFileSync(file, "utf-8");
      if (!contents.includes("policyInsights")) return false;
      return (
        /\.update\s*\(\s*policyInsights\b/.test(contents) ||
        /\.delete\s*\(\s*policyInsights\b/.test(contents)
      );
    });
    expect(offenders).toEqual([]);
  });
});
