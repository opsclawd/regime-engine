import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const buildAssets = [
  {
    source: "src/ledger/schema.sql",
    destination: "dist/src/ledger/schema.sql"
  }
];

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
