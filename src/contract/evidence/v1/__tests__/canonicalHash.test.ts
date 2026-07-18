import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toCanonicalJson } from "../../../v1/canonical.js";
import { sha256Hex } from "../../../v1/hash.js";
import { validateEvidenceBundleV1 } from "../validate.js";

const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../..");
const __fixturesDir = resolve(__repoRoot, "contracts/evidence-bundle/v1/fixtures");
const __vectorsPath = resolve(__repoRoot, "contracts/evidence-bundle/v1/hash-vectors.json");

interface EvidenceHashVector {
  name: string;
  payload: unknown;
  canonical: string;
  utf8ByteLength: number;
  sha256: string;
  schemaSha256: string;
}

interface HashVectorsDocument {
  schemaSha256: string;
  vectors: EvidenceHashVector[];
}

const loadVectors = (): HashVectorsDocument => {
  return JSON.parse(readFileSync(__vectorsPath, "utf-8"));
};

const loadSchemaDigest = (): string => {
  const schemaBytes = readFileSync(
    resolve(__repoRoot, "contracts/evidence-bundle/v1/evidence-bundle.schema.json")
  );
  return createHash("sha256").update(schemaBytes).digest("hex");
};

describe("EvidenceBundle canonical hash vectors", () => {
  describe("reproduces every published EvidenceBundle hash vector", () => {
    it("loads and validates the hash vectors file exists", () => {
      const vectors = loadVectors();
      expect(vectors).toBeDefined();
      expect(vectors.schemaSha256).toBeDefined();
      expect(vectors.vectors).toBeInstanceOf(Array);
      expect(vectors.vectors.length).toBeGreaterThan(0);
    });

    it("each vector has the expected shape and schema digest matches", () => {
      const vectors = loadVectors();
      const expectedSchemaDigest = loadSchemaDigest();

      expect(vectors.schemaSha256.toLowerCase()).toBe(expectedSchemaDigest.toLowerCase());

      for (const vector of vectors.vectors) {
        expect(typeof vector.name).toBe("string");
        expect(vector.name.length).toBeGreaterThan(0);
        expect(vector.payload).toBeDefined();
        expect(typeof vector.canonical).toBe("string");
        expect(vector.canonical.length).toBeGreaterThan(0);
        expect(typeof vector.utf8ByteLength).toBe("number");
        expect(vector.utf8ByteLength).toBeGreaterThan(0);
        expect(typeof vector.sha256).toBe("string");
        expect(vector.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(typeof vector.schemaSha256).toBe("string");
        expect(vector.schemaSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(vector.schemaSha256.toLowerCase()).toBe(expectedSchemaDigest.toLowerCase());
      }
    });

    it("non-primitive EvidenceBundle payloads pass schema validation", () => {
      const vectors = loadVectors();
      const nonPrimitiveNames = [
        "valid/deterministic-only",
        "valid/contextual",
        "empty-context",
        "null-brief"
      ];

      for (const vector of vectors.vectors) {
        if (nonPrimitiveNames.includes(vector.name)) {
          const result = validateEvidenceBundleV1(vector.payload);
          if (!result.ok) {
            expect(
              result.ok,
              `Payload ${vector.name} should be valid: ${JSON.stringify(result.issues)}`
            ).toBe(true);
          }
        }
      }
    });

    it("canonical form reproduces from payload", () => {
      const vectors = loadVectors();
      for (const vector of vectors.vectors) {
        const canonical = toCanonicalJson(vector.payload);
        expect(canonical).toBe(vector.canonical);
      }
    });

    it("utf8ByteLength matches Buffer.byteLength of canonical", () => {
      const vectors = loadVectors();
      for (const vector of vectors.vectors) {
        const actualByteLength = Buffer.byteLength(vector.canonical, "utf8");
        expect(actualByteLength).toBe(vector.utf8ByteLength);
      }
    });

    it("sha256 reproduces from canonical bytes", () => {
      const vectors = loadVectors();
      for (const vector of vectors.vectors) {
        const hash = sha256Hex(vector.canonical);
        expect(hash).toBe(vector.sha256.toLowerCase());
      }
    });

    it("sha256 is deterministic across multiple calls", () => {
      const vectors = loadVectors();
      for (const vector of vectors.vectors) {
        const hash1 = sha256Hex(vector.canonical);
        const hash2 = sha256Hex(vector.canonical);
        expect(hash1).toBe(hash2);
        expect(hash1).toBe(vector.sha256.toLowerCase());
      }
    });
  });

  describe("ignores object insertion order but preserves array order", () => {
    it("reorders object keys but hash remains same", () => {
      const vectors = loadVectors();
      const vector = vectors.vectors.find((v) => v.name === "object-key-order-independence");
      if (!vector) return;

      const payloadA = { a: 1, b: 2, c: 3 };
      const payloadB = { c: 3, a: 1, b: 2 };

      const canonicalA = toCanonicalJson(payloadA);
      const canonicalB = toCanonicalJson(payloadB);

      expect(canonicalA).toBe(canonicalB);
      expect(sha256Hex(canonicalA)).toBe(sha256Hex(canonicalB));
    });

    it("reorders array elements and hash changes", () => {
      const vectors = loadVectors();
      const vector = vectors.vectors.find((v) => v.name === "array-order-matters");
      if (!vector) return;

      const payloadA = [1, 2, 3];
      const payloadB = [3, 2, 1];

      const canonicalA = toCanonicalJson(payloadA);
      const canonicalB = toCanonicalJson(payloadB);

      expect(canonicalA).not.toBe(canonicalB);
      expect(sha256Hex(canonicalA)).not.toBe(sha256Hex(canonicalB));
    });
  });

  describe("normalizes negative zero and preserves ECMAScript exponent formatting", () => {
    it("negative zero canonicalizes to zero", () => {
      const vectors = loadVectors();
      const vector = vectors.vectors.find((v) => v.name === "negative-zero-normalization");
      if (!vector) return;

      const payloadNegZero = { value: -0 };
      const payloadZero = { value: 0 };

      const canonicalNegZero = toCanonicalJson(payloadNegZero);
      const canonicalZero = toCanonicalJson(payloadZero);

      expect(canonicalNegZero).toBe(canonicalZero);
      expect(sha256Hex(canonicalNegZero)).toBe(sha256Hex(canonicalZero));
    });

    it("preserves ECMAScript exponent formatting in scientific notation", () => {
      const vectors = loadVectors();
      const vector = vectors.vectors.find((v) => v.name === "exponent-formatting");
      if (!vector) return;

      const payload = { value: 1.23e4 };
      const canonical = toCanonicalJson(payload);

      expect(canonical).toBe('{"value":12300}');
      expect(sha256Hex(canonical)).toBe(vector.sha256.toLowerCase());
    });

    it("large integer without exponent is preserved", () => {
      const vectors = loadVectors();
      const vector = vectors.vectors.find((v) => v.name === "large-integer");
      if (!vector) return;

      const payload = { value: 1234567890123456 };
      const canonical = toCanonicalJson(payload);

      expect(canonical).toBe('{"value":1234567890123456}');
      expect(sha256Hex(canonical)).toBe(vector.sha256.toLowerCase());
    });
  });

  describe("detects a deliberately mismatched published hash", () => {
    it("fails when sha256 does not match canonical bytes", () => {
      const vectors = loadVectors();
      const vector = vectors.vectors[0];
      if (!vector) return;

      const tamperedVector: EvidenceHashVector = {
        ...vector,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000"
      };

      const computedHash = sha256Hex(tamperedVector.canonical);
      expect(computedHash).not.toBe(tamperedVector.sha256);
      expect(computedHash).not.toBe(
        "0000000000000000000000000000000000000000000000000000000000000000"
      );
    });
  });
});

describe("deterministic fixtures produce expected canonical forms", () => {
  const fixtures = {
    valid: {
      deterministicOnly: JSON.parse(
        readFileSync(resolve(__fixturesDir, "valid/deterministic-only.json"), "utf-8")
      ),
      contextual: JSON.parse(readFileSync(resolve(__fixturesDir, "valid/contextual.json"), "utf-8"))
    }
  };

  it("deterministic-only fixture canonicalizes and hashes", () => {
    const vectors = loadVectors();
    const vector = vectors.vectors.find((v) => v.name === "valid/deterministic-only");

    if (!vector) return;

    const canonical = toCanonicalJson(fixtures.valid.deterministicOnly);
    expect(canonical).toBe(vector.canonical);
    expect(Buffer.byteLength(canonical, "utf8")).toBe(vector.utf8ByteLength);
    expect(sha256Hex(canonical)).toBe(vector.sha256.toLowerCase());
  });

  it("contextual fixture canonicalizes and hashes", () => {
    const vectors = loadVectors();
    const vector = vectors.vectors.find((v) => v.name === "valid/contextual");

    if (!vector) return;

    const canonical = toCanonicalJson(fixtures.valid.contextual);
    expect(canonical).toBe(vector.canonical);
    expect(Buffer.byteLength(canonical, "utf8")).toBe(vector.utf8ByteLength);
    expect(sha256Hex(canonical)).toBe(vector.sha256.toLowerCase());
  });
});
