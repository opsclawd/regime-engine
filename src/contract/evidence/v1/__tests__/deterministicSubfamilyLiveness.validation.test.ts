import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateEvidenceBundleV1 } from "../validate.js";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../..");
const livenessFixtureRaw = readFileSync(
  resolve(repoRoot, "contracts/evidence-bundle/v1/fixtures/valid/liveness.json"),
  "utf-8"
);

const deterministicSubfamilyLiveness = {
  market_state: { isConfigured: true, lastCollectedAt: "2024-01-15T09:59:00.000Z" },
  price_quality: { isConfigured: true, lastCollectedAt: "2024-01-15T09:58:00.000Z" },
  clmm_economics: { isConfigured: true, lastCollectedAt: "2024-01-15T09:57:00.000Z" },
  position_state: { isConfigured: true, lastCollectedAt: "2024-01-15T09:56:00.000Z" },
  liquidity: { isConfigured: true, lastCollectedAt: "2024-01-15T09:55:00.000Z" },
  risk: { isConfigured: false, lastCollectedAt: "2024-01-15T09:54:00.000Z" }
};

describe("EvidenceBundleV1 deterministic sub-family liveness", () => {
  it("accepts all deterministic sub-family liveness keys alongside legacy deterministic", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness = {
      deterministic: {
        isConfigured: true,
        lastCollectedAt: "2024-01-15T10:00:00.000Z"
      },
      ...deterministicSubfamilyLiveness
    };

    expect(validateEvidenceBundleV1(bundle).ok).toBe(true);
  });

  it("accepts deterministic sub-family liveness without the legacy deterministic key", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness = deterministicSubfamilyLiveness;

    expect(validateEvidenceBundleV1(bundle).ok).toBe(true);
  });
});
