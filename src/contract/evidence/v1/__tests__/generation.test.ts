import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../..");

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
});
