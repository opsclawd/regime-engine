import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import type { EvidenceBundleRow } from "../evidenceBundles.js";

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

const EXPECTED_COLUMN_COUNT = 18;

describe("evidenceBundles shape test", () => {
  it("asserts the exact 18 columns are defined in the schema", () => {
    type EvidenceBundleColumnNames = keyof EvidenceBundleRow;
    const columns: EvidenceBundleColumnNames[] = [
      "id",
      "schemaVersion",
      "sourcePublisher",
      "sourceId",
      "runId",
      "pair",
      "scopeKey",
      "correlationId",
      "asOfUnixMs",
      "createdAtUnixMs",
      "receivedAtUnixMs",
      "freshUntilUnixMs",
      "expiresAtUnixMs",
      "evidenceJson",
      "evidenceCanonical",
      "evidenceHash",
      "ingestedAtUnixMs",
      "processedAtUnixMs"
    ];
    expect(columns.length).toBe(EXPECTED_COLUMN_COUNT);
  });

  it("asserts the unique idempotency index is defined in the schema", () => {
    const schemaSrc = readFileSync(resolve(import.meta.dirname, "../evidenceBundles.ts"), "utf-8");
    expect(schemaSrc).toContain('uniqueIndex("uniq_evidence_bundles_source_run")');
  });

  it("asserts the three indexes are defined in the schema", () => {
    const schemaSrc = readFileSync(resolve(import.meta.dirname, "../evidenceBundles.ts"), "utf-8");
    expect(schemaSrc).toContain('index("idx_evidence_bundles_current")');
    expect(schemaSrc).toContain('index("idx_evidence_bundles_history")');
    expect(schemaSrc).toContain('index("idx_evidence_bundles_correlation")');
  });

  it("asserts no application code updates or deletes evidence_bundles rows (append-only)", () => {
    const srcRoot = resolve(import.meta.dirname, "../../../..");
    const tsFiles = listTsFiles(srcRoot).filter((file) => !file.endsWith(".shape.test.ts"));
    const offenders = tsFiles.filter((file) => {
      const contents = readFileSync(file, "utf-8");
      if (!contents.includes("evidenceBundles")) return false;
      return (
        /\.update\s*\(\s*evidenceBundles\b/.test(contents) ||
        /\.delete\s*\(\s*evidenceBundles\b/.test(contents)
      );
    });
    expect(offenders).toEqual([]);
  });
});
