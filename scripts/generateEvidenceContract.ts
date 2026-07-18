import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import prettier from "prettier";

const __repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCHEMA_PATH = resolve(__repoRoot, "contracts/evidence-bundle/v1/evidence-bundle.schema.json");
const TYPES_PATH = resolve(__repoRoot, "src/contract/evidence/v1/types.generated.ts");
const SHA256_PATH = resolve(__repoRoot, "contracts/evidence-bundle/v1/schema.sha256");
const VECTORS_PATH = resolve(__repoRoot, "contracts/evidence-bundle/v1/hash-vectors.json");
const SCHEMA_RELATIVE = "contracts/evidence-bundle/v1/evidence-bundle.schema.json";
const FIXTURES_DIR = resolve(__repoRoot, "contracts/evidence-bundle/v1/fixtures");
const DOCS_PATH =
  process.env.DOCS_PATH ?? resolve(__repoRoot, "docs/contracts/evidence-bundle.v1.md");
const DOCS_SCHEMA_MARKER = /<!-- schema-sha256:([a-f0-9]{64}) -->/;
const DOCS_VISIBLE_SCHEMA_DIGEST = /\*\*Schema SHA-256\*\*:\s*`([a-f0-9]{64})`/;

interface CliArgs {
  mode: "--write" | "--check";
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("Usage: generateEvidenceContract.ts --write | --check");
    process.exit(1);
  }
  const mode = args[0] as "--write" | "--check";
  if (mode !== "--write" && mode !== "--check") {
    console.error("Usage: generateEvidenceContract.ts --write | --check");
    process.exit(1);
  }
  return { mode };
}

async function generateTypes(schemaContent: string, digest: string): Promise<string> {
  const header = `// Generated from contracts/evidence-bundle/v1/evidence-bundle.schema.json (sha256: ${digest}). Do not edit.
`;

  const compiled = await compile(JSON.parse(schemaContent), "EvidenceBundleV1", {
    bannerComment: "",
    style: {
      singleQuote: false
    }
  });

  const unformatted = header + compiled;
  const formatted = await prettier.format(unformatted, {
    parser: "typescript",
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    singleQuote: false,
    semi: true,
    trailingComma: "none"
  });

  return formatted;
}

function computeSchemaDigest(schemaBytes: Buffer): string {
  return createHash("sha256").update(schemaBytes).digest("hex");
}

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

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical JSON does not support non-finite numbers.");
  }

  const normalized = Object.is(value, -0) ? 0 : value;
  return JSON.stringify(normalized);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const canonicalize = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "number") {
    return formatNumber(value);
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(",")}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(
    `Canonical JSON only supports plain objects, arrays, primitives, and null. Received ${typeof value}.`
  );
};

const toCanonicalJson = (value: unknown): string => {
  return canonicalize(value);
};

const sha256Hex = (input: string): string => {
  return createHash("sha256").update(input, "utf8").digest("hex");
};

const createVector = (name: string, payload: unknown, schemaDigest: string): EvidenceHashVector => {
  const canonical = toCanonicalJson(payload);
  const utf8ByteLength = Buffer.byteLength(canonical, "utf8");
  const sha256 = sha256Hex(canonical);

  return {
    name,
    payload,
    canonical,
    utf8ByteLength,
    sha256,
    schemaSha256: schemaDigest
  };
};

const loadFixture = (path: string): unknown => {
  return JSON.parse(readFileSync(path, "utf-8"));
};

function buildEmptyContextPayload(contextualPayload: unknown): Record<string, unknown> {
  const source = contextualPayload as Record<string, unknown>;
  const assessment = source.assessment as Record<string, unknown>;
  const coverage = assessment.coverage as Record<string, unknown>;
  const researchBrief = source.researchBrief as Record<string, unknown>;

  return {
    ...source,
    contextualEvidence: {
      supportResistance: [],
      flows: [],
      derivatives: [],
      events: [],
      newsRegulatory: []
    },
    researchBrief: {
      ...researchBrief,
      sourceEvidenceIds: ["feat-price-001", "feat-vol-001"]
    },
    assessment: {
      ...assessment,
      quality: "degraded",
      coverage: {
        ...coverage,
        supportResistance: "unavailable",
        flows: "unavailable",
        derivatives: "unavailable",
        events: "unavailable",
        newsRegulatory: "unavailable"
      },
      warnings: [
        {
          code: "CONTEXTUAL_EVIDENCE_UNAVAILABLE",
          message: "All contextual evidence families are unavailable",
          affectedFamilies: [
            "supportResistance",
            "flows",
            "derivatives",
            "events",
            "newsRegulatory"
          ]
        }
      ]
    }
  };
}

function generateVectors(schemaDigest: string): HashVectorsDocument {
  const deterministicOnlyPayload = loadFixture(
    resolve(FIXTURES_DIR, "valid/deterministic-only.json")
  );
  const contextualPayload = loadFixture(resolve(FIXTURES_DIR, "valid/contextual.json"));

  const vectors: EvidenceHashVector[] = [
    createVector("valid/deterministic-only", deterministicOnlyPayload, schemaDigest),
    createVector("valid/contextual", contextualPayload, schemaDigest),

    createVector("empty-context", buildEmptyContextPayload(contextualPayload), schemaDigest),
    createVector("null-brief", deterministicOnlyPayload, schemaDigest),

    createVector("object-key-order-independence", { a: 1, b: 2, c: 3 }, schemaDigest),
    createVector("array-order-matters", [1, 2, 3], schemaDigest),

    createVector("negative-zero-normalization", { value: -0 }, schemaDigest),
    createVector("exponent-formatting", { value: 1.23e4 }, schemaDigest),
    createVector("large-integer", { value: 1234567890123456 }, schemaDigest),

    createVector("non-ASCII-string", { text: "こんにちは世界" }, schemaDigest),
    createVector("emoji-in-string", { text: "Hello 👋 World 🌍" }, schemaDigest),
    createVector("mixed-unicode", { text: "café_résumé_₿" }, schemaDigest),

    createVector("empty-object", {}, schemaDigest),
    createVector("empty-array", [], schemaDigest),
    createVector("nested-empty-structures", { a: {}, b: [], c: { d: {} } }, schemaDigest),

    createVector("boolean-true", true, schemaDigest),
    createVector("boolean-false", false, schemaDigest),
    createVector("null-value", null, schemaDigest),
    createVector("zero", 0, schemaDigest),
    createVector("positive-integer", 42, schemaDigest),
    createVector("negative-integer", -42, schemaDigest),
    createVector("positive-float", 3.14159, schemaDigest),
    createVector("negative-float", -3.14159, schemaDigest),

    createVector("string-with-newline", { text: "line1\nline2" }, schemaDigest),
    createVector("string-with-tab", { text: "col1\tcol2" }, schemaDigest),
    createVector("string-with-backslash", { text: "path\\to\\file" }, schemaDigest),
    createVector("string-with-quote", { text: 'say "hello"' }, schemaDigest),

    createVector("array-with-mixed-types", [1, "two", true, null, { key: "value" }], schemaDigest),
    createVector("deeply-nested-object", { a: { b: { c: { d: { e: 1 } } } } }, schemaDigest),
    createVector("wide-object", { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }, schemaDigest)
  ];

  return {
    schemaSha256: schemaDigest,
    vectors
  };
}

async function generateVectorsFormatted(vectors: HashVectorsDocument): Promise<string> {
  const content = JSON.stringify(vectors, null, 2) + "\n";
  const formatted = await prettier.format(content, {
    parser: "json",
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    singleQuote: false,
    semi: false,
    trailingComma: "none"
  });
  return formatted;
}

async function main() {
  const { mode } = parseArgs();

  const schemaBytes = readFileSync(SCHEMA_PATH);
  const schemaContent = schemaBytes.toString("utf-8");
  const digest = computeSchemaDigest(schemaBytes);

  const expectedSha256Content = `${digest}  ${SCHEMA_RELATIVE}\n`;
  const expectedTypesContent = await generateTypes(schemaContent, digest);
  const expectedVectors = generateVectors(digest);
  const expectedVectorsContent = await generateVectorsFormatted(expectedVectors);

  if (mode === "--check") {
    let hasStale = false;

    try {
      const existingSha256 = readFileSync(SHA256_PATH, "utf-8");
      if (existingSha256 !== expectedSha256Content) {
        console.error(`STALE: ${SHA256_PATH}`);
        hasStale = true;
      }
    } catch {
      console.error(`MISSING: ${SHA256_PATH}`);
      hasStale = true;
    }

    try {
      const existingTypes = readFileSync(TYPES_PATH, "utf-8");
      if (existingTypes !== expectedTypesContent) {
        console.error(`STALE: ${TYPES_PATH}`);
        hasStale = true;
      }
    } catch {
      console.error(`MISSING: ${TYPES_PATH}`);
      hasStale = true;
    }

    try {
      const existingVectorsBytes = readFileSync(VECTORS_PATH);
      if (existingVectorsBytes.toString("utf-8") !== expectedVectorsContent) {
        console.error(`STALE: ${VECTORS_PATH}`);
        hasStale = true;
      }
    } catch {
      console.error(`MISSING: ${VECTORS_PATH}`);
      hasStale = true;
    }

    try {
      const existingDocsContent = readFileSync(DOCS_PATH, "utf-8");
      const match = existingDocsContent.match(DOCS_SCHEMA_MARKER);
      if (!match) {
        console.error(`MISSING: ${DOCS_PATH} schema-sha256 marker`);
        hasStale = true;
      } else if (match[1] !== digest) {
        console.error(`STALE: ${DOCS_PATH} schema marker ${match[1]} does not match ${digest}`);
        hasStale = true;
      }
      const visibleMatch = existingDocsContent.match(DOCS_VISIBLE_SCHEMA_DIGEST);
      if (!visibleMatch) {
        console.error(`MISSING: ${DOCS_PATH} visible schema SHA-256 digest`);
        hasStale = true;
      } else if (visibleMatch[1] !== digest) {
        console.error(
          `STALE: ${DOCS_PATH} visible digest ${visibleMatch[1]} does not match ${digest}`
        );
        hasStale = true;
      }
      const requiredArtifacts = [
        "evidence-bundle.schema.json",
        "schema.sha256",
        "hash-vectors.json",
        "fixtures/valid",
        "fixtures/invalid"
      ];
      for (const artifact of requiredArtifacts) {
        if (!existingDocsContent.includes(artifact)) {
          console.error(`MISSING: ${DOCS_PATH} does not mention artifact ${artifact}`);
          hasStale = true;
        }
      }
    } catch {
      console.error(`MISSING: ${DOCS_PATH}`);
      hasStale = true;
    }

    if (hasStale) {
      process.exit(1);
    }
    return;
  }

  if (mode === "--write") {
    try {
      const existingSha256 = readFileSync(SHA256_PATH, "utf-8");
      if (existingSha256 !== expectedSha256Content) {
        writeFileSync(SHA256_PATH, expectedSha256Content);
        console.log(`WROTE: ${SHA256_PATH}`);
      }
    } catch {
      writeFileSync(SHA256_PATH, expectedSha256Content);
      console.log(`WROTE: ${SHA256_PATH}`);
    }

    try {
      const existingTypes = readFileSync(TYPES_PATH, "utf-8");
      if (existingTypes !== expectedTypesContent) {
        writeFileSync(TYPES_PATH, expectedTypesContent);
        console.log(`WROTE: ${TYPES_PATH}`);
      }
    } catch {
      writeFileSync(TYPES_PATH, expectedTypesContent);
      console.log(`WROTE: ${TYPES_PATH}`);
    }

    try {
      const existingVectorsBytes = readFileSync(VECTORS_PATH);
      if (existingVectorsBytes.toString("utf-8") !== expectedVectorsContent) {
        writeFileSync(VECTORS_PATH, expectedVectorsContent);
        console.log(`WROTE: ${VECTORS_PATH}`);
      }
    } catch {
      writeFileSync(VECTORS_PATH, expectedVectorsContent);
      console.log(`WROTE: ${VECTORS_PATH}`);
    }

    const markerReplacement = `<!-- schema-sha256:${digest} -->`;
    const visibleReplacement = `**Schema SHA-256**: \`${digest}\``;
    try {
      const existingDocsContent = readFileSync(DOCS_PATH, "utf-8");
      let newDocsContent = existingDocsContent.replace(DOCS_SCHEMA_MARKER, markerReplacement);
      newDocsContent = newDocsContent.replace(DOCS_VISIBLE_SCHEMA_DIGEST, visibleReplacement);
      if (newDocsContent !== existingDocsContent) {
        writeFileSync(DOCS_PATH, newDocsContent);
        console.log(`WROTE: ${DOCS_PATH}`);
      }
    } catch {
      writeFileSync(
        DOCS_PATH,
        `# EvidenceBundle v1 Contract Specification\n\n${markerReplacement}\n`
      );
      console.log(`WROTE: ${DOCS_PATH}`);
    }

    return;
  }
}

main();
