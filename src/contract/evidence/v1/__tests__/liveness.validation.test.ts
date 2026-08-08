import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateEvidenceBundleV1 } from "../validate.js";

const __repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../../..");
const __fixturesDir = resolve(__repoRoot, "contracts/evidence-bundle/v1/fixtures");

const deterministicOnlyFixtureRaw = readFileSync(
  resolve(__fixturesDir, "valid/deterministic-only.json"),
  "utf-8"
);
const livenessFixtureRaw = readFileSync(resolve(__fixturesDir, "valid/liveness.json"), "utf-8");

describe("EvidenceBundleV1 Liveness Validation", () => {
  it("accepts a bundle carrying liveness for every evidence family", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(true);
  });

  it("accepts a legacy bundle without assessment liveness", () => {
    const bundle = JSON.parse(deterministicOnlyFixtureRaw);
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(true);
  });

  it("accepts assessment liveness with omitted family entries", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness = {
      deterministic: {
        isConfigured: true,
        lastCollectedAt: "2024-01-15T10:00:00.000Z"
      }
    };
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(true);
  });

  it("accepts null lastCollectedAt in a liveness state", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness = {
      deterministic: {
        isConfigured: true,
        lastCollectedAt: null
      }
    };
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(true);
  });

  it("rejects an impossible liveness lastCollectedAt calendar date", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness.deterministic = {
      isConfigured: true,
      lastCollectedAt: "2024-02-31T10:00:00.000Z"
    };
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown liveness family", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness.unknownFamily = {
      isConfigured: true,
      lastCollectedAt: "2024-01-15T10:00:00.000Z"
    };
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(false);
  });

  it("rejects an incomplete liveness state", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness.deterministic = {
      isConfigured: true
    };
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown liveness state field", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness.deterministic = {
      isConfigured: true,
      lastCollectedAt: "2024-01-15T10:00:00.000Z",
      unexpectedField: "invalid"
    };
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(false);
  });

  it("accepts a historical lastCollectedAt when isConfigured is false", () => {
    // A family that was collecting and has since been switched off keeps its
    // last successful run. That is what separates "recently disabled" from
    // "never configured", and the producer emits it
    // (sol-usdc-clmm-intelligence#166 — "preserves a historical last run when a
    // family is now unconfigured"). Rejecting it here would 400 every bundle
    // containing such a family.
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness.derivatives = {
      isConfigured: false,
      lastCollectedAt: "2024-01-15T10:00:00.000Z"
    };
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(true);
  });

  it("still rejects a malformed lastCollectedAt on an unconfigured family", () => {
    const bundle = JSON.parse(livenessFixtureRaw);
    bundle.assessment.liveness.derivatives = {
      isConfigured: false,
      lastCollectedAt: "not-a-timestamp"
    };
    const result = validateEvidenceBundleV1(bundle);
    expect(result.ok).toBe(false);
  });
});
