import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import type { PolicyInsightSynthesisRequestRow } from "../policyInsightSynthesisRequests.js";
import * as schemaExports from "../index.js";

const EXPECTED_COLUMN_COUNT = 14;

describe("policyInsightSynthesisRequests shape test", () => {
  it("asserts the exact 14 columns are defined in the schema", () => {
    type ColumnNames = keyof PolicyInsightSynthesisRequestRow;
    const columns: ColumnNames[] = [
      "id",
      "scopeKey",
      "selectionHash",
      "planHash",
      "rulesetVersion",
      "status",
      "attemptCount",
      "nextAttemptAtUnixMs",
      "leaseOwner",
      "leaseExpiresAtUnixMs",
      "lastErrorCode",
      "lastErrorMessage",
      "createdAtUnixMs",
      "updatedAtUnixMs"
    ];
    expect(columns.length).toBe(EXPECTED_COLUMN_COUNT);
  });

  it("exports table and types from index.ts", () => {
    expect(schemaExports).toHaveProperty("policyInsightSynthesisRequests");
  });

  it("asserts the unique constraints and claim index are defined in the schema", () => {
    const schemaSrc = readFileSync(
      resolve(import.meta.dirname, "../policyInsightSynthesisRequests.ts"),
      "utf-8"
    );
    expect(schemaSrc).toContain('uniqueIndex("uniq_synthesis_requests_ready")');
    expect(schemaSrc).toContain('uniqueIndex("uniq_synthesis_requests_waiting_plan")');
    expect(schemaSrc).toContain('uniqueIndex("uniq_synthesis_requests_waiting_evidence")');
    expect(schemaSrc).toContain('index("idx_synthesis_requests_claim")');
  });

  it("asserts check constraints are present in the schema file", () => {
    const schemaSrc = readFileSync(
      resolve(import.meta.dirname, "../policyInsightSynthesisRequests.ts"),
      "utf-8"
    );
    expect(schemaSrc).toContain("chk_synthesis_requests_non_negative");
    expect(schemaSrc).toContain("chk_synthesis_requests_hashes");
    expect(schemaSrc).toContain("chk_synthesis_requests_lease_coherence");
    expect(schemaSrc).toContain("chk_synthesis_requests_hash_format");
  });
});
