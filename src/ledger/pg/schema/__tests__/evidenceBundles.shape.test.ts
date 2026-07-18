import { describe, expect, it } from "vitest";
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
});
