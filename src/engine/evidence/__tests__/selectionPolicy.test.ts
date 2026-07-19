import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTION_POLICY_V1,
  EVIDENCE_SELECTION_POLICY_VERSION,
  EvidenceSelectionPolicy,
  evidenceSourceQualityKey,
  validateEvidenceSelectionPolicy
} from "../selectionPolicy.js";

describe("EvidenceSelectionPolicy", () => {
  describe("ships the conservative immutable v1 policy values", () => {
    it("version is evidence-selection.v1", () => {
      expect(EVIDENCE_SELECTION_POLICY_V1.version).toBe("evidence-selection.v1");
      expect(EVIDENCE_SELECTION_POLICY_VERSION).toBe("evidence-selection.v1");
    });

    it("minimum effective score is 2500 bps", () => {
      expect(EVIDENCE_SELECTION_POLICY_V1.minimumEffectiveScoreBps).toBe(2_500);
    });

    it("stale weight is 5000 bps", () => {
      expect(EVIDENCE_SELECTION_POLICY_V1.staleWeightBps).toBe(5_000);
    });

    it("family cap is 16", () => {
      expect(EVIDENCE_SELECTION_POLICY_V1.maxSelectedPerFamily).toBe(16);
    });

    it("default source quality is 5000 bps", () => {
      expect(EVIDENCE_SELECTION_POLICY_V1.defaultSourceQualityBps).toBe(5_000);
    });

    it("provenance weights are correct", () => {
      expect(EVIDENCE_SELECTION_POLICY_V1.provenanceQualityBps["deterministic_calculator"]).toBe(
        10_000
      );
      expect(EVIDENCE_SELECTION_POLICY_V1.provenanceQualityBps["derived"]).toBe(9_000);
      expect(EVIDENCE_SELECTION_POLICY_V1.provenanceQualityBps["collected"]).toBe(8_000);
      expect(EVIDENCE_SELECTION_POLICY_V1.provenanceQualityBps["human_authored"]).toBe(7_000);
    });

    it("reviewed source map is empty", () => {
      expect(Object.keys(EVIDENCE_SELECTION_POLICY_V1.sourceQualityBps)).toHaveLength(0);
    });
  });

  describe("qualifies source quality keys without publisher/source collisions", () => {
    it("encodes publisher and source with length prefixes", () => {
      const key1 = evidenceSourceQualityKey("ab", "c");
      const key2 = evidenceSourceQualityKey("a", "bc");
      expect(key1).not.toBe(key2);
      expect(key1).toBe("2:ab:1:c");
      expect(key2).toBe("1:a:2:bc");
    });

    it("prevents aliasing with delimiter-bearing identities", () => {
      const key1 = evidenceSourceQualityKey("foo:bar", "baz");
      const key2 = evidenceSourceQualityKey("foo", "bar:baz");
      expect(key1).not.toBe(key2);
    });

    it("handles empty strings", () => {
      const key = evidenceSourceQualityKey("", "");
      expect(key).toBe("0::0:");
    });
  });

  describe("rejects non-finite or out-of-range policy basis points", () => {
    const validPolicy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1
    };

    it("rejects negative bps", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          minimumEffectiveScoreBps: -1
        })
      ).toThrow(TypeError);
    });

    it("rejects bps greater than 10000", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          staleWeightBps: 10_001
        })
      ).toThrow(TypeError);
    });

    it("rejects non-integer bps", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          defaultSourceQualityBps: 1.5
        })
      ).toThrow(TypeError);
    });

    it("rejects NaN bps", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          staleWeightBps: NaN
        })
      ).toThrow(TypeError);
    });

    it("rejects Infinity bps", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          minimumEffectiveScoreBps: Infinity
        })
      ).toThrow(TypeError);
    });

    it("rejects negative source quality override", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          sourceQualityBps: { "test:key": -1 }
        })
      ).toThrow(TypeError);
    });

    it("rejects out-of-range source quality override", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          sourceQualityBps: { "test:key": 10_001 }
        })
      ).toThrow(TypeError);
    });

    it("rejects non-integer source quality override", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          sourceQualityBps: { "test:key": 1.5 }
        })
      ).toThrow(TypeError);
    });
  });

  describe("rejects zero or non-integer family limits and blank versions", () => {
    const validPolicy: EvidenceSelectionPolicy = {
      ...EVIDENCE_SELECTION_POLICY_V1
    };

    it("rejects zero family limit", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          maxSelectedPerFamily: 0
        })
      ).toThrow(TypeError);
    });

    it("rejects negative family limit", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          maxSelectedPerFamily: -1
        })
      ).toThrow(TypeError);
    });

    it("rejects non-integer family limit", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          maxSelectedPerFamily: 1.5
        })
      ).toThrow(TypeError);
    });

    it("rejects blank version", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          version: ""
        })
      ).toThrow(TypeError);
    });

    it("rejects whitespace-only version", () => {
      expect(() =>
        validateEvidenceSelectionPolicy({
          ...validPolicy,
          version: "   "
        })
      ).toThrow(TypeError);
    });
  });

  describe("does not permit mutation of the shipped policy", () => {
    function tryMutate(obj: object, prop: string, value: unknown): void {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      (obj as unknown as Record<string, unknown>)[prop] = value;
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }

    it("top-level properties are frozen", () => {
      expect(() => {
        tryMutate(EVIDENCE_SELECTION_POLICY_V1, "version", "hacked");
      }).toThrow();
    });

    it("sourceQualityBps nested map cannot be mutated", () => {
      expect(() => {
        tryMutate(EVIDENCE_SELECTION_POLICY_V1.sourceQualityBps, "evil", 9999);
      }).toThrow();
    });

    it("provenanceQualityBps nested map cannot be mutated", () => {
      expect(() => {
        tryMutate(EVIDENCE_SELECTION_POLICY_V1.provenanceQualityBps, "evil", 9999);
      }).toThrow();
    });

    it("validateEvidenceSelectionPolicy returns an immutable copy", () => {
      const validated = validateEvidenceSelectionPolicy(EVIDENCE_SELECTION_POLICY_V1);
      expect(() => {
        tryMutate(validated, "version", "hacked");
      }).toThrow();
      expect(() => {
        tryMutate(validated.sourceQualityBps, "evil", 9999);
      }).toThrow();
      expect(() => {
        tryMutate(validated.provenanceQualityBps, "evil", 9999);
      }).toThrow();
    });
  });
});
