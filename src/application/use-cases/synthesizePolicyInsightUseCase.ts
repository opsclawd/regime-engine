import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type { PlanRequestPosition, PlanResponse } from "../../contract/v1/types.js";
import type { ClockPort } from "../ports/clock.js";
import type { GetCurrentRegimeUseCase } from "./getCurrentRegimeUseCase.js";
import type { SelectEvidenceForSynthesisUseCase } from "./selectEvidenceForSynthesisUseCase.js";
import type {
  PolicyInsightRepositoryPort,
  StoredPolicyInsight,
  NewPolicyInsightRecord
} from "../ports/policyInsightRepositoryPort.js";
import type { PolicyRuleset } from "../../engine/policy/ruleset.js";
import {
  parseInsightIngestRequest,
  computeInsightCanonicalAndHash
} from "../../contract/v1/insights.js";
import {
  PolicyInsightStoreUnavailableError,
  PolicyInsightValidationError
} from "../errors/policyInsightErrors.js";
import { computePolicyInsightFingerprints } from "./policyInsightFingerprints.js";
import {
  synthesizePolicyInsight,
  type PolicySynthesisEnvelope
} from "../../engine/policy/synthesizePolicyInsight.js";
import { sha256Hex } from "../../contract/v1/hash.js";
import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { evidenceScopeKey } from "../ports/evidenceBundleRepositoryPort.js";

export interface SynthesizePolicyInsightInput {
  readonly scope: Scope;
  readonly marketSelector: {
    readonly source: string;
    readonly network: string;
    readonly poolAddress: string;
    readonly timeframe: "15m" | "1h";
  };
  readonly positionPlan?: {
    readonly position: PlanRequestPosition;
    readonly plan: PlanResponse;
  } | null;
}

export type SynthesizePolicyInsightUseCase = (
  input: SynthesizePolicyInsightInput
) => Promise<StoredPolicyInsight>;

export interface SynthesizePolicyInsightUseCaseDeps {
  readonly getCurrentRegime: GetCurrentRegimeUseCase;
  readonly selectEvidence: SelectEvidenceForSynthesisUseCase;
  readonly repository: PolicyInsightRepositoryPort;
  readonly clock: ClockPort;
  readonly ruleset: PolicyRuleset;
}

export const createSynthesizePolicyInsightUseCase = (
  deps: SynthesizePolicyInsightUseCaseDeps
): SynthesizePolicyInsightUseCase => {
  return async (input) => {
    const synthesisAtUnixMs = deps.clock.nowUnixMs();

    // 1. Validate supplied instants (captured once)
    if (
      typeof synthesisAtUnixMs !== "number" ||
      !Number.isFinite(synthesisAtUnixMs) ||
      !Number.isInteger(synthesisAtUnixMs) ||
      synthesisAtUnixMs < 0
    ) {
      throw new Error("synthesisAtUnixMs must be a non-negative finite integer");
    }

    // 2. Perform validation checks before database reads/writes (pair/scope & plan/position identity validation)
    const { scope, positionPlan } = input;

    // Scope and positionPlan validation
    if (scope.kind === "position") {
      if (!positionPlan) {
        throw new PolicyInsightValidationError(
          "positionPlan is required for position-scoped synthesis"
        );
      }
      if (positionPlan.position.positionId !== scope.positionId) {
        throw new PolicyInsightValidationError(
          "positionId mismatch between scope and positionPlan"
        );
      }
      if (positionPlan.plan.scope.positionId !== scope.positionId) {
        throw new PolicyInsightValidationError("positionId mismatch between scope and plan scope");
      }
      if (positionPlan.plan.scope.poolAddress !== scope.whirlpoolAddress) {
        throw new PolicyInsightValidationError("poolAddress mismatch between scope and plan scope");
      }
      if (
        scope.walletAddress &&
        positionPlan.position.walletId &&
        scope.walletAddress !== positionPlan.position.walletId
      ) {
        throw new PolicyInsightValidationError("walletId mismatch between scope and position");
      }
      if (scope.whirlpoolAddress !== input.marketSelector.poolAddress) {
        throw new PolicyInsightValidationError(
          "poolAddress mismatch between position scope and marketSelector"
        );
      }
    } else {
      if (positionPlan) {
        throw new PolicyInsightValidationError(
          "positionPlan must not be supplied for non-position-scoped synthesis"
        );
      }
    }

    if (scope.kind === "whirlpool") {
      if (scope.whirlpoolAddress !== input.marketSelector.poolAddress) {
        throw new PolicyInsightValidationError(
          "poolAddress mismatch between scope and marketSelector"
        );
      }
    }

    // Stale position check
    if (positionPlan) {
      const positionAge = synthesisAtUnixMs - positionPlan.position.observedAtUnixMs;
      if (
        positionAge > deps.ruleset.positionMaxAgeMs ||
        positionPlan.position.observedAtUnixMs > synthesisAtUnixMs
      ) {
        throw new PolicyInsightValidationError("Supplied position is stale or from the future");
      }

      // Verify plan hash
      const { planHash, ...withoutHash } = positionPlan.plan;
      const verifiedHash = sha256Hex(toCanonicalJson(withoutHash));
      if (planHash !== verifiedHash) {
        throw new PolicyInsightValidationError("Plan hash verification failed");
      }
    }

    // 3. Load market regime and select evidence using the shared captured timestamp
    const market = await deps.getCurrentRegime(
      {
        symbol: "SOL/USDC",
        source: input.marketSelector.source,
        network: input.marketSelector.network,
        poolAddress: input.marketSelector.poolAddress,
        timeframe: input.marketSelector.timeframe
      },
      synthesisAtUnixMs
    );

    const evidence = await deps.selectEvidence({
      scope,
      selectedAtUnixMs: synthesisAtUnixMs
    });

    // 4. Verify selection-time matches captured instant
    if (evidence.selectedAtUnixMs !== synthesisAtUnixMs) {
      throw new PolicyInsightValidationError(
        "Evidence selection time does not match captured synthesis time"
      );
    }

    // 5. Compute fingerprints and check repository for exact replay (short-circuit)
    const fingerprints = computePolicyInsightFingerprints({
      rulesetVersion: deps.ruleset.version,
      pair: "SOL/USDC",
      scope,
      market,
      positionPlan: positionPlan ?? null,
      evidence
    });

    let existing: StoredPolicyInsight | null = null;
    try {
      existing = await deps.repository.findBySynthesisInputHash({
        schemaVersion: "policy-insight.v1",
        rulesetVersion: deps.ruleset.version,
        synthesisInputHash: fingerprints.synthesisInputHash
      });
    } catch (err) {
      throw new PolicyInsightStoreUnavailableError("Failed to query policy insight repository", {
        cause: err
      });
    }

    if (existing) {
      return existing;
    }

    // 6. Reduce via policy engine
    const envelope: PolicySynthesisEnvelope = {
      synthesisAtUnixMs,
      pair: "SOL/USDC",
      scope,
      market,
      positionPlan: positionPlan ?? null,
      evidence,
      hashes: {
        inputHash: fingerprints.synthesisInputHash,
        rulesetHash: sha256Hex(toCanonicalJson(deps.ruleset))
      }
    };

    const output = synthesizePolicyInsight(envelope, deps.ruleset);

    // 7. Validate output with #63 schemas/rules
    try {
      parseInsightIngestRequest(output);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new PolicyInsightValidationError(
        `Reducer output rejected by schema validation: ${msg}`,
        { cause: err instanceof Error ? err : undefined }
      );
    }

    // 8. Construct NewPolicyInsightRecord and insert
    const { canonical: payloadCanonical, hash: payloadHash } =
      computeInsightCanonicalAndHash(output);

    const record: NewPolicyInsightRecord = {
      insightId: fingerprints.synthesisInputHash,
      schemaVersion: "policy-insight.v1",
      rulesetVersion: deps.ruleset.version,
      pair: "SOL/USDC",
      scopeKey: evidenceScopeKey(scope),
      positionId: positionPlan?.position.positionId ?? null,
      generatedAtUnixMs: synthesisAtUnixMs,
      asOfUnixMs: Date.parse(output.asOf),
      expiresAtUnixMs: Date.parse(output.expiresAt),
      persistedAtUnixMs: synthesisAtUnixMs,
      marketHash: fingerprints.marketHash,
      positionHash: fingerprints.positionHash,
      selectionHash: fingerprints.selectionHash,
      synthesisInputHash: fingerprints.synthesisInputHash,
      selectionPolicyVersion: evidence.selectionPolicyVersion,
      synthesisInputJson: envelope,
      synthesisOutputJson: output,
      payloadCanonical,
      payloadHash,
      selectedLineageJson: evidence.decisions?.filter((d) => d.status === "INCLUDED") ?? [],
      excludedLineageJson: evidence.decisions?.filter((d) => d.status === "EXCLUDED") ?? []
    };

    try {
      const result = await deps.repository.insertOrGet(record);
      return result.record;
    } catch (err) {
      throw new PolicyInsightStoreUnavailableError("Failed to persist synthesized policy insight", {
        cause: err
      });
    }
  };
};
