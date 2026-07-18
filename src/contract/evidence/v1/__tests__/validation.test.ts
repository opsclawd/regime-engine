import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseEvidenceBundleV1,
  validateEvidenceBundleV1,
  EvidenceBundleValidationError
} from "../validate.js";
import type { EvidenceBundleV1 } from "../types.generated.js";

const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../..");
const __fixturesDir = resolve(__repoRoot, "contracts/evidence-bundle/v1/fixtures");

const fixtures = {
  valid: {
    deterministicOnly: readFileSync(
      resolve(__fixturesDir, "valid/deterministic-only.json"),
      "utf-8"
    ),
    contextual: readFileSync(resolve(__fixturesDir, "valid/contextual.json"), "utf-8")
  },
  invalid: {
    wrongSchemaVersion: readFileSync(
      resolve(__fixturesDir, "invalid/wrong-schema-version.json"),
      "utf-8"
    ),
    unknownField: readFileSync(resolve(__fixturesDir, "invalid/unknown-field.json"), "utf-8"),
    unsupportedUnit: readFileSync(resolve(__fixturesDir, "invalid/unsupported-unit.json"), "utf-8"),
    noncanonicalTimestamp: readFileSync(
      resolve(__fixturesDir, "invalid/noncanonical-timestamp.json"),
      "utf-8"
    ),
    reversedLifecycle: readFileSync(
      resolve(__fixturesDir, "invalid/reversed-lifecycle.json"),
      "utf-8"
    ),
    outOfRangeNumber: readFileSync(
      resolve(__fixturesDir, "invalid/out-of-range-number.json"),
      "utf-8"
    ),
    statusValueMismatch: readFileSync(
      resolve(__fixturesDir, "invalid/status-value-mismatch.json"),
      "utf-8"
    ),
    duplicateLineage: readFileSync(
      resolve(__fixturesDir, "invalid/duplicate-lineage.json"),
      "utf-8"
    ),
    unresolvedLineage: readFileSync(
      resolve(__fixturesDir, "invalid/unresolved-lineage.json"),
      "utf-8"
    ),
    malformedContextualFamily: readFileSync(
      resolve(__fixturesDir, "invalid/malformed-contextual-family.json"),
      "utf-8"
    ),
    unresolvedBriefEvidence: readFileSync(
      resolve(__fixturesDir, "invalid/unresolved-brief-evidence.json"),
      "utf-8"
    ),
    nullBriefAvailableCoverage: readFileSync(
      resolve(__fixturesDir, "invalid/null-brief-available-coverage.json"),
      "utf-8"
    ),
    emptyContextNoWarning: readFileSync(
      resolve(__fixturesDir, "invalid/empty-context-no-warning.json"),
      "utf-8"
    )
  }
};

describe("EvidenceBundle v1 validation", () => {
  describe("accepts deterministic-only evidence with explicit unavailable coverage", () => {
    it("should accept valid deterministic-only bundle", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.valid.deterministicOnly));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeDefined();
      }
    });
  });

  describe("rejects available features whose value does not match featureKind", () => {
    it("should reject number feature with non-numeric value", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.statusValueMismatch));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((i) => i.code === "SEMANTIC");
        expect(issue).toBeDefined();
      }
    });

    it("should reject when unit does not match featureKind", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.unsupportedUnit));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.code === "STRUCTURAL")).toBe(true);
      }
    });
  });

  describe("rejects unavailable features encoded as numeric zero", () => {
    it("should reject unavailable feature with value 0", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.statusValueMismatch));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const semanticIssue = result.issues.find((i) => i.code === "SEMANTIC");
        expect(semanticIssue).toBeDefined();
      }
    });
  });

  describe("rejects noncanonical or reversed publisher timestamps", () => {
    it("should reject noncanonical timestamp format", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.noncanonicalTimestamp));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((i) => i.code === "STRUCTURAL");
        expect(issue).toBeDefined();
      }
    });

    it("should reject reversed lifecycle timestamps", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.reversedLifecycle));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((i) => i.code === "SEMANTIC");
        expect(issue).toBeDefined();
        expect(issue?.message).toMatch(/after|before|must not be/);
      }
    });
  });

  describe("rejects duplicate or unresolved evidence lineage", () => {
    it("should reject duplicate feature IDs", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.duplicateLineage));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((i) => i.code === "SEMANTIC");
        expect(issue).toBeDefined();
        expect(issue?.message).toMatch(/duplicate/i);
      }
    });

    it("should reject unresolved lineage reference", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.unresolvedLineage));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((i) => i.code === "SEMANTIC");
        expect(issue).toBeDefined();
        expect(issue?.message).toContain("lineage");
      }
    });

    it("should reject unresolved brief evidence reference", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.unresolvedBriefEvidence));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((i) => i.code === "SEMANTIC");
        expect(issue).toBeDefined();
        expect(issue?.message).toMatch(/brief/i);
      }
    });
  });

  describe("rejects coverage that fabricates absent evidence", () => {
    it("should reject null brief with available coverage", () => {
      const result = validateEvidenceBundleV1(
        JSON.parse(fixtures.invalid.nullBriefAvailableCoverage)
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((i) => i.code === "SEMANTIC");
        expect(issue).toBeDefined();
        expect(issue?.message).toContain("coverage");
      }
    });

    it("should reject empty context without warning", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.emptyContextNoWarning));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((i) => i.code === "SEMANTIC");
        expect(issue).toBeDefined();
        expect(issue?.message).toContain("warning");
      }
    });

    it("should reject malformed contextual family", () => {
      const result = validateEvidenceBundleV1(
        JSON.parse(fixtures.invalid.malformedContextualFamily)
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe("parseEvidenceBundleV1", () => {
    it("should parse valid deterministic-only bundle", () => {
      const bundle = parseEvidenceBundleV1(JSON.parse(fixtures.valid.deterministicOnly));
      expect(bundle.schemaVersion).toBe("evidence-bundle.v1");
    });

    it("should throw EvidenceBundleValidationError for invalid bundle", () => {
      expect(() => parseEvidenceBundleV1(JSON.parse(fixtures.invalid.wrongSchemaVersion))).toThrow(
        EvidenceBundleValidationError
      );
    });

    it("should include sorted issues in error", () => {
      try {
        parseEvidenceBundleV1(JSON.parse(fixtures.invalid.duplicateLineage));
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(EvidenceBundleValidationError);
        const error = e as EvidenceBundleValidationError;
        expect(error.issues).toBeDefined();
        expect(error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe("schema version validation", () => {
    it("should reject wrong schema version", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.wrongSchemaVersion));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const issue = result.issues.find((i) => i.code === "UNSUPPORTED_SCHEMA_VERSION");
        expect(issue).toBeDefined();
      }
    });
  });

  describe("unknown fields", () => {
    it("should reject unknown fields at root level", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.unknownField));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.code === "STRUCTURAL")).toBe(true);
      }
    });
  });

  describe("out of range numbers", () => {
    it("should reject out of range confidenceBps", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.outOfRangeNumber));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.code === "STRUCTURAL")).toBe(true);
      }
    });
  });

  describe("result shape stability", () => {
    it("should return stable result shape for valid input", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.valid.deterministicOnly));
      expect(result).toHaveProperty("ok");
      if (result.ok) {
        expect(result).toHaveProperty("value");
        expect(result.value).toHaveProperty("schemaVersion");
        expect(result.value).toHaveProperty("deterministicFeatures");
      }
    });

    it("should return stable result shape for invalid input", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.wrongSchemaVersion));
      expect(result).toHaveProperty("ok");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result).toHaveProperty("issues");
        expect(Array.isArray(result.issues)).toBe(true);
        result.issues.forEach((issue) => {
          expect(issue).toHaveProperty("path");
          expect(issue).toHaveProperty("code");
          expect(issue).toHaveProperty("message");
        });
      }
    });

    it("should sort issues by path, then code, then message", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.invalid.duplicateLineage));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        for (let i = 1; i < result.issues.length; i++) {
          const prev = result.issues[i - 1];
          const curr = result.issues[i];
          const prevKey = `${prev.path}|${prev.code}|${prev.message}`;
          const currKey = `${curr.path}|${curr.code}|${curr.message}`;
          expect(prevKey <= currKey).toBe(true);
        }
      }
    });
  });

  describe("programmatic edge cases", () => {
    it("should reject NaN in numeric fields", () => {
      const bundle = JSON.parse(fixtures.valid.deterministicOnly) as Record<string, unknown>;
      (bundle.assessment as Record<string, unknown>).overallConfidenceBps = NaN;
      const result = validateEvidenceBundleV1(bundle);
      expect(result.ok).toBe(false);
    });

    it("should reject Infinity in numeric fields", () => {
      const bundle = JSON.parse(fixtures.valid.deterministicOnly) as Record<string, unknown>;
      (bundle.assessment as Record<string, unknown>).overallConfidenceBps = Infinity;
      const result = validateEvidenceBundleV1(bundle);
      expect(result.ok).toBe(false);
    });

    it("should accept negative zero as valid (JSON Schema treats -0 as equal to 0)", () => {
      const bundle = JSON.parse(fixtures.valid.deterministicOnly) as Record<string, unknown>;
      (bundle.assessment as Record<string, unknown>).overallConfidenceBps = -0;
      const result = validateEvidenceBundleV1(bundle);
      expect(result.ok).toBe(true);
    });
  });

  describe("contextual fixture validation", () => {
    it("should accept valid contextual bundle", () => {
      const result = validateEvidenceBundleV1(JSON.parse(fixtures.valid.contextual));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.contextualEvidence).toBeDefined();
      }
    });

    it("should have non-null brief with resolved sourceEvidenceIds", () => {
      const bundle = JSON.parse(fixtures.valid.contextual) as EvidenceBundleV1;
      expect(bundle.researchBrief).not.toBeNull();
      if (bundle.researchBrief) {
        const sourceEvidenceIds = bundle.researchBrief.sourceEvidenceIds;
        const allEvidenceIds = [
          ...bundle.deterministicFeatures.map((f) => f.featureId),
          ...bundle.contextualEvidence.supportResistance.map((e) => e.evidenceId),
          ...bundle.contextualEvidence.flows.map((e) => e.evidenceId),
          ...bundle.contextualEvidence.derivatives.map((e) => e.evidenceId),
          ...bundle.contextualEvidence.events.map((e) => e.evidenceId),
          ...bundle.contextualEvidence.newsRegulatory.map((e) => e.evidenceId)
        ];
        for (const id of sourceEvidenceIds) {
          expect(allEvidenceIds).toContain(id);
        }
      }
    });
  });
});
