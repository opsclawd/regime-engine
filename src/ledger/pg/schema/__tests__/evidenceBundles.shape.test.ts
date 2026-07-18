import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { EvidenceBundleRow } from "../evidenceBundles.js";

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
});
