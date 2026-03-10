import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const buildAssets = [
  {
    source: "src/ledger/schema.sql",
    destination: "dist/src/ledger/schema.sql"
  }
];

for (const asset of buildAssets) {
  const sourcePath = resolve(projectRoot, asset.source);
  const destinationPath = resolve(projectRoot, asset.destination);

  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}
