import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateEvidenceBundleV1 } from "../validate.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../..");
const livenessSubfamiliesFixtureRaw = readFileSync(
  resolve(repoRoot, "contracts/evidence-bundle/v1/fixtures/valid/liveness-subfamilies.json"),
  "utf-8"
);

describe("EvidenceBundleV1 deterministic sub-family liveness", () => {
  it("validates static fixture containing deterministic sub-family liveness keys", () => {
    const bundle = JSON.parse(livenessSubfamiliesFixtureRaw);
    expect(validateEvidenceBundleV1(bundle).ok).toBe(true);
  });
});
