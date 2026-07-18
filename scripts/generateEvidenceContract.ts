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
const SCHEMA_RELATIVE = "contracts/evidence-bundle/v1/evidence-bundle.schema.json";

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

async function main() {
  const { mode } = parseArgs();

  const schemaBytes = readFileSync(SCHEMA_PATH);
  const schemaContent = schemaBytes.toString("utf-8");
  const digest = computeSchemaDigest(schemaBytes);

  const expectedSha256Content = `${digest}  ${SCHEMA_RELATIVE}\n`;
  const expectedTypesContent = await generateTypes(schemaContent, digest);

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

    return;
  }
}

main();
