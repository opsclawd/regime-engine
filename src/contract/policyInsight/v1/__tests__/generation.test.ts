import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../../");

describe("PolicyInsight v1 generation", () => {
  it("keeps generated PolicyInsight v1 artifacts reproducible", async () => {
    const result = await new Promise<{ code: number; stderr: string }>((resolve) => {
      execFile(
        "pnpm",
        ["run", "contract:policy-insight:check"],
        { cwd: __repoRoot },
        (error, _stdout, stderr) => {
          resolve({ code: (error?.code as number) ?? 0, stderr });
        }
      );
    });
    expect(result.code).toBe(0);
  });

  it("publishes the exact schema path version and sha256", () => {
    const schemaPath = resolve(
      __repoRoot,
      "contracts/policy-insight/v1/policy-insight.schema.json"
    );
    const sha256Path = resolve(__repoRoot, "contracts/policy-insight/v1/schema.sha256");
    const typesPath = resolve(__repoRoot, "src/contract/policyInsight/v1/types.generated.ts");

    const schemaBytes = readFileSync(schemaPath);
    const computedDigest = createHash("sha256").update(schemaBytes).digest("hex");

    const sha256Content = readFileSync(sha256Path, "utf-8").trim();
    const [expectedDigest, expectedPath] = sha256Content.split(/\s+/);
    expect(expectedPath).toBe("contracts/policy-insight/v1/policy-insight.schema.json");

    const typesContent = readFileSync(typesPath, "utf-8");
    const headerMatch = typesContent.match(/sha256:\s*([a-f0-9]{64})/);
    expect(headerMatch).not.toBeNull();
    const headerDigest = headerMatch![1];

    expect(computedDigest).toBe(expectedDigest.toLowerCase());
    expect(headerDigest).toBe(computedDigest.toLowerCase());
  });

  it("provides pair position and history valid fixtures", () => {
    const fixturesDir = resolve(__repoRoot, "contracts/policy-insight/v1/fixtures");

    const currentPairPath = resolve(fixturesDir, "valid/current-pair.json");
    const currentPositionPath = resolve(fixturesDir, "valid/current-position.json");
    const historyPath = resolve(fixturesDir, "valid/history.json");

    expect(() => readFileSync(currentPairPath, "utf-8")).not.toThrow();
    expect(() => readFileSync(currentPositionPath, "utf-8")).not.toThrow();
    expect(() => readFileSync(historyPath, "utf-8")).not.toThrow();

    const currentPair = JSON.parse(readFileSync(currentPairPath, "utf-8"));
    const currentPosition = JSON.parse(readFileSync(currentPositionPath, "utf-8"));
    const history = JSON.parse(readFileSync(historyPath, "utf-8"));

    expect(currentPair.schemaVersion).toBe("policy-insight.v1");
    expect(currentPair.pair).toBe("SOL/USDC");
    expect(currentPair.position).toBeNull();

    expect(currentPosition.schemaVersion).toBe("policy-insight.v1");
    expect(currentPosition.pair).toBe("SOL/USDC");
    expect(currentPosition.position).not.toBeNull();
    expect(currentPosition.position.network).toBe("solana-mainnet");

    expect(history.schemaVersion).toBe("policy-insight.v1");
    expect(history.pair).toBe("SOL/USDC");
    expect(Array.isArray(history.items)).toBe(true);
    expect(history.items.length).toBe(2);
    expect(history.nextCursor).toBeNull();
  });

  it("provides named invalid cases for every documented drift class", () => {
    const fixturesDir = resolve(__repoRoot, "contracts/policy-insight/v1/fixtures/invalid");

    const fieldsAndEnumsPath = resolve(fixturesDir, "fields-and-enums.json");
    const numbersAndLevelsPath = resolve(fixturesDir, "numbers-and-levels.json");
    const timestampsAndFreshnessPath = resolve(fixturesDir, "timestamps-and-freshness.json");
    const orderingAndDuplicatesPath = resolve(fixturesDir, "ordering-and-duplicates.json");
    const actionPositionAndVersionPath = resolve(fixturesDir, "action-position-and-version.json");

    expect(() => readFileSync(fieldsAndEnumsPath, "utf-8")).not.toThrow();
    expect(() => readFileSync(numbersAndLevelsPath, "utf-8")).not.toThrow();
    expect(() => readFileSync(timestampsAndFreshnessPath, "utf-8")).not.toThrow();
    expect(() => readFileSync(orderingAndDuplicatesPath, "utf-8")).not.toThrow();
    expect(() => readFileSync(actionPositionAndVersionPath, "utf-8")).not.toThrow();

    const fieldsAndEnums = JSON.parse(readFileSync(fieldsAndEnumsPath, "utf-8"));
    const numbersAndLevels = JSON.parse(readFileSync(numbersAndLevelsPath, "utf-8"));
    const timestampsAndFreshness = JSON.parse(readFileSync(timestampsAndFreshnessPath, "utf-8"));
    const orderingAndDuplicates = JSON.parse(readFileSync(orderingAndDuplicatesPath, "utf-8"));
    const actionPositionAndVersion = JSON.parse(
      readFileSync(actionPositionAndVersionPath, "utf-8")
    );

    const invalidCases = [
      { name: "fields-and-enums", data: fieldsAndEnums },
      { name: "numbers-and-levels", data: numbersAndLevels },
      { name: "timestamps-and-freshness", data: timestampsAndFreshness },
      { name: "ordering-and-duplicates", data: orderingAndDuplicates },
      { name: "action-position-and-version", data: actionPositionAndVersion }
    ];

    for (const { name, data } of invalidCases) {
      expect(data, `Invalid case ${name} must have entries`).toBeDefined();
      expect(
        Array.isArray(data) || typeof data === "object",
        `Invalid case ${name} must be array or object`
      ).toBe(true);
    }

    for (const entry of invalidCases) {
      const items = Array.isArray(entry.data) ? entry.data : [entry.data];
      for (const item of items) {
        expect(item.name, `${entry.name}: each entry must have a name`).toBeDefined();
        expect(item.payload, `${entry.name}: each entry must have a payload`).toBeDefined();
        expect(item.expectedPath, `${entry.name}: each entry must have expectedPath`).toBeDefined();
        expect(item.expectedCode, `${entry.name}: each entry must have expectedCode`).toBeDefined();
      }
    }
  });
});
