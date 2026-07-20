import { copyFileSync, mkdirSync, readdirSync, statSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const buildAssets = [
  {
    source: "src/ledger/schema.sql",
    destination: "dist/src/ledger/schema.sql"
  }
];

function computeSha256(filePath) {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function assertFileDigest(filePath, expectedSha256) {
  const actual = computeSha256(filePath);
  if (actual !== expectedSha256) {
    console.error(`DIGEST MISMATCH: ${filePath}`);
    console.error(`  Expected: ${expectedSha256}`);
    console.error(`  Actual:   ${actual}`);
    process.exit(1);
  }
  console.log(`  OK ${filePath} (${actual})`);
}

function assertPolicyInsightAssets() {
  console.log("\n=== Verifying policy-insight v1 contract assets ===");

  const baseSource = resolve(projectRoot, "contracts/policy-insight/v1");
  const baseDest = resolve(projectRoot, "dist/contracts/policy-insight/v1");

  const schemaFile = "policy-insight.schema.json";
  const sha256File = "schema.sha256";

  const schemaSource = resolve(baseSource, schemaFile);
  const schemaDest = resolve(baseDest, schemaFile);
  const sha256Source = resolve(baseSource, sha256File);

  console.log(`Checking ${schemaDest}...`);
  assertFileDigest(schemaDest, computeSha256(schemaSource));

  console.log(`Checking ${resolve(baseDest, sha256File)}...`);
  assertFileDigest(resolve(baseDest, sha256File), computeSha256(sha256Source));

  const fixturesDir = resolve(baseSource, "fixtures");
  const fixtureSuites = ["valid", "invalid"];
  for (const suite of fixtureSuites) {
    const suitePath = resolve(fixturesDir, suite);
    const entries = readdirSync(suitePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        const sourcePath = resolve(suitePath, entry.name);
        const destPath = resolve(baseDest, "fixtures", suite, entry.name);
        console.log(`Checking ${destPath}...`);
        assertFileDigest(destPath, computeSha256(sourcePath));
      }
    }
  }

  console.log("=== All policy-insight v1 contract assets verified ===\n");
}

function copyDirectoryRecursive(sourceDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destPath);
    } else {
      copyFileSync(sourcePath, destPath);
    }
  }
}

for (const asset of buildAssets) {
  const sourcePath = resolve(projectRoot, asset.source);
  const destinationPath = resolve(projectRoot, asset.destination);

  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}

const evidenceSource = resolve(projectRoot, "contracts/evidence-bundle/v1");
const evidenceDest = resolve(projectRoot, "dist/contracts/evidence-bundle/v1");
copyDirectoryRecursive(evidenceSource, evidenceDest);

const policyInsightSource = resolve(projectRoot, "contracts/policy-insight/v1");
const policyInsightDest = resolve(projectRoot, "dist/contracts/policy-insight/v1");
copyDirectoryRecursive(policyInsightSource, policyInsightDest);

assertPolicyInsightAssets();
