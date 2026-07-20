import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import prettier from "prettier";

const __repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCHEMA_PATH = resolve(__repoRoot, "contracts/policy-insight/v1/policy-insight.schema.json");
const TYPES_PATH = resolve(__repoRoot, "src/contract/policyInsight/v1/types.generated.ts");
const SHA256_PATH = resolve(__repoRoot, "contracts/policy-insight/v1/schema.sha256");
const FIXTURES_DIR = resolve(__repoRoot, "contracts/policy-insight/v1/fixtures");
const SCHEMA_RELATIVE = "contracts/policy-insight/v1/policy-insight.schema.json";

interface CliArgs {
  mode: "--write" | "--check";
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("Usage: generatePolicyInsightContract.ts --write | --check");
    process.exit(1);
  }
  const mode = args[0] as "--write" | "--check";
  if (mode !== "--write" && mode !== "--check") {
    console.error("Usage: generatePolicyInsightContract.ts --write | --check");
    process.exit(1);
  }
  return { mode };
}

function createCompilationSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const defs = schema.$defs as Record<string, unknown>;
  const policyInsightHistoryResponse = defs.PolicyInsightHistoryResponse as Record<string, unknown>;

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    ...policyInsightHistoryResponse,
    $defs: defs
  };
}

async function generateTypes(schemaContent: string, digest: string): Promise<string> {
  const header = `// Generated from contracts/policy-insight/v1/policy-insight.schema.json (sha256: ${digest}). Do not edit.
`;

  const schema = JSON.parse(schemaContent);
  const compileSchema = createCompilationSchema(schema) as Record<string, unknown>;

  const compiledHistory = await compile(compileSchema, "PolicyInsightHistoryResponse", {
    bannerComment: "",
    style: {
      singleQuote: false
    }
  });

  const contentInterface = `export type PolicyInsightContent = Omit<PolicyInsightRead, "freshness">;
export type PolicyInsightFreshness = Freshness;
`;

  const allCompiled = [compiledHistory, "\n", contentInterface].join("\n");
  const unformatted = header + allCompiled;
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

async function formatFixtures(fixturesDir: string): Promise<void> {
  const validDirs = ["valid", "invalid"];
  for (const dir of validDirs) {
    const dirPath = resolve(fixturesDir, dir);
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json")) {
          const filePath = resolve(dirPath, entry.name);
          const content = readFileSync(filePath, "utf-8");
          const formatted = await prettier.format(content, {
            parser: "json",
            printWidth: 100,
            tabWidth: 2,
            useTabs: false,
            singleQuote: false,
            semi: false,
            trailingComma: "none"
          });
          writeFileSync(filePath, formatted);
          console.log(`FORMATTED: ${filePath}`);
        }
      }
    } catch {
      // Skip directories that don't exist
    }
  }
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

    await formatFixtures(FIXTURES_DIR);

    return;
  }
}

main();
