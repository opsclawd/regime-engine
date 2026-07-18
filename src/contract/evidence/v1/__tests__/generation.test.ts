import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";

const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../..");

function areDirectoryContentsIdentical(sourceDir: string, destDir: string): boolean {
  const sourceEntries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of sourceEntries) {
    const sourcePath = join(sourceDir, entry.name);
    const destPath = join(destDir, entry.name);

    if (entry.isDirectory()) {
      if (!statSync(destPath).isDirectory()) return false;
      if (!areDirectoryContentsIdentical(sourcePath, destPath)) return false;
    } else {
      const sourceContent = readFileSync(sourcePath);
      const destContent = readFileSync(destPath);
      if (!sourceContent.equals(destContent)) return false;
    }
  }
  return true;
}

describe("EvidenceBundle v1 generation", () => {
  it("keeps generated types and schema digest reproducible", async () => {
    const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
      execFile(
        "pnpm",
        ["run", "contract:evidence:check"],
        { cwd: __repoRoot },
        (error, _stdout, stderr) => {
          resolve({ code: (error?.code as number) ?? 0, stderr });
        }
      );
    });
    expect(result.code).toBe(0);
  });

  it("records the exact schema byte hash in every generated authority marker", () => {
    const schemaPath = resolve(
      __repoRoot,
      "contracts/evidence-bundle/v1/evidence-bundle.schema.json"
    );
    const sha256Path = resolve(__repoRoot, "contracts/evidence-bundle/v1/schema.sha256");
    const typesPath = resolve(__repoRoot, "src/contract/evidence/v1/types.generated.ts");

    const schemaBytes = readFileSync(schemaPath);
    const computedDigest = createHash("sha256").update(schemaBytes).digest("hex");

    const sha256Content = readFileSync(sha256Path, "utf-8").trim();
    const [expectedDigest, expectedPath] = sha256Content.split(/\s+/);
    expect(expectedPath).toBe("contracts/evidence-bundle/v1/evidence-bundle.schema.json");

    const typesContent = readFileSync(typesPath, "utf-8");
    const headerMatch = typesContent.match(/sha256:\s*([a-f0-9]{64})/);
    expect(headerMatch).not.toBeNull();
    const headerDigest = headerMatch![1];

    expect(computedDigest).toBe(expectedDigest.toLowerCase());
    expect(headerDigest).toBe(computedDigest.toLowerCase());
  });

  it("publishes every EvidenceBundle artifact with the documented schema digest", async () => {
    const buildResult = await new Promise<{ code: number; stderr: string }>((resolve) => {
      execFile("pnpm", ["run", "build"], { cwd: __repoRoot }, (error, _stdout, stderr) => {
        resolve({ code: (error?.code as number) ?? 0, stderr });
      });
    });
    expect(buildResult.code).toBe(0);

    const distEvidenceRoot = resolve(__repoRoot, "dist/contracts/evidence-bundle/v1");
    const sourceEvidenceRoot = resolve(__repoRoot, "contracts/evidence-bundle/v1");

    const schemaPath = resolve(distEvidenceRoot, "evidence-bundle.schema.json");
    const sha256Path = resolve(distEvidenceRoot, "schema.sha256");
    const vectorsPath = resolve(distEvidenceRoot, "hash-vectors.json");
    const fixturesDir = resolve(distEvidenceRoot, "fixtures");

    expect(statSync(schemaPath).isFile(), "schema.json must exist in dist").toBe(true);
    expect(statSync(sha256Path).isFile(), "schema.sha256 must exist in dist").toBe(true);
    expect(statSync(vectorsPath).isFile(), "hash-vectors.json must exist in dist").toBe(true);
    expect(statSync(fixturesDir).isDirectory(), "fixtures directory must exist in dist").toBe(true);

    expect(areDirectoryContentsIdentical(sourceEvidenceRoot, distEvidenceRoot)).toBe(true);
  });

  it("rejects stale EvidenceBundle documentation metadata", async () => {
    const staleDocPath = resolve(tmpdir(), `stale-evidence-doc-${randomUUID()}.md`);
    const realDocPath = resolve(__repoRoot, "docs/contracts/evidence-bundle.v1.md");

    const realDocContent = readFileSync(realDocPath, "utf-8");
    const staleContent = realDocContent.replace(
      /<!-- schema-sha256:[a-f0-9]{64} -->/,
      "<!-- schema-sha256:0000000000000000000000000000000000000000000000000000000000000000 -->"
    );
    writeFileSync(staleDocPath, staleContent);

    try {
      const checkResult = await new Promise<{ code: number; stderr: string }>((resolve) => {
        execFile(
          "pnpm",
          ["run", "contract:evidence:check"],
          { cwd: __repoRoot },
          (error, _stdout, stderr) => {
            resolve({ code: (error?.code as number) ?? 0, stderr });
          }
        );
      });

      expect(checkResult.code).not.toBe(0);
      expect(checkResult.stderr).toContain(realDocPath);
    } finally {
      unlinkSync(staleDocPath);
    }
  });
});
