import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type { PlanRequestPosition, PlanResponse } from "../../contract/v1/types.js";
import type { ClockPort } from "../ports/clock.js";
import type { GetCurrentRegimeUseCase } from "./getCurrentRegimeUseCase.js";
import type { SelectEvidenceForSynthesisUseCase } from "./selectEvidenceForSynthesisUseCase.js";
import type { SrThesesReadPort } from "../ports/srThesesReadPort.js";
import type { SrLevelsV2CurrentResponse } from "../../contract/v2/srLevels.js";
import type {
  PolicyInsightRepositoryPort,
  StoredPolicyInsight,
  NewPolicyInsightRecord
} from "../ports/policyInsightRepositoryPort.js";
import type { PolicyRuleset } from "../../engine/policy/ruleset.js";
import {
  PolicyInsightStoreUnavailableError,
  PolicyInsightValidationError
} from "../errors/policyInsightErrors.js";
import {
  computePolicyInsightFingerprints,
  computeEvidenceSelectionHash
} from "./policyInsightFingerprints.js";
import {
  synthesizePolicyInsightV1,
  type PolicySynthesisEnvelope,
  type PolicySynthesisSrThesis
} from "../../engine/policy/synthesizePolicyInsight.js";
import { sha256Hex } from "../../contract/v1/hash.js";
import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { evidenceScopeKey } from "../ports/evidenceBundleRepositoryPort.js";
import { parsePolicyInsightContent } from "../../contract/policyInsight/v1/validate.js";
import { computePolicyInsightContentCanonicalAndHash } from "../../contract/policyInsight/v1/canonical.js";
import {
  type PolicyInsightContent,
  type PolicyInsightRead,
  POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256
} from "../../contract/policyInsight/v1/types.generated.js";
import { projectPolicyInsightRead } from "../../contract/policyInsight/v1/project.js";

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
  readonly expectedSelectionHash?: string;
}

export type SynthesizePolicyInsightUseCase = (
  input: SynthesizePolicyInsightInput
) => Promise<PolicyInsightRead>;

export interface SynthesizePolicyInsightUseCaseDeps {
  readonly getCurrentRegime: GetCurrentRegimeUseCase;
  readonly selectEvidence: SelectEvidenceForSynthesisUseCase;
  readonly srThesesReadPort: SrThesesReadPort;
  readonly repository: PolicyInsightRepositoryPort;
  readonly clock: ClockPort;
  readonly ruleset: PolicyRuleset;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const projectSrTheses = (current: SrLevelsV2CurrentResponse | null): PolicySynthesisSrThesis[] =>
  current === null
    ? []
    : current.theses
        .map((thesis) => ({
          ...thesis,
          source: current.source,
          briefId: current.brief.briefId
        }))
        .sort(
          (left, right) =>
            compareText(left.source, right.source) ||
            compareText(left.briefId, right.briefId) ||
            compareText(left.asset, right.asset) ||
            compareText(left.sourceHandle, right.sourceHandle)
        );

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
          "positionPlan is required for position-scoped synthesis",
          "POSITION_PLAN_MISSING"
        );
      }
      if (positionPlan.position.positionId !== scope.positionId) {
        throw new PolicyInsightValidationError(
          "positionId mismatch between scope and positionPlan",
          "POSITION_SCOPE_MISMATCH"
        );
      }
      if (positionPlan.plan.scope.positionId !== scope.positionId) {
        throw new PolicyInsightValidationError(
          "positionId mismatch between scope and plan scope",
          "POSITION_SCOPE_MISMATCH"
        );
      }
      if (positionPlan.plan.scope.poolAddress !== scope.whirlpoolAddress) {
        throw new PolicyInsightValidationError(
          "poolAddress mismatch between scope and plan scope",
          "POOL_SCOPE_MISMATCH"
        );
      }
      if (
        scope.walletAddress &&
        positionPlan.position.walletId &&
        scope.walletAddress !== positionPlan.position.walletId
      ) {
        throw new PolicyInsightValidationError(
          "walletId mismatch between scope and position",
          "POSITION_SCOPE_MISMATCH"
        );
      }
      if (scope.whirlpoolAddress !== input.marketSelector.poolAddress) {
        throw new PolicyInsightValidationError(
          "poolAddress mismatch between position scope and marketSelector",
          "POOL_SCOPE_MISMATCH"
        );
      }
    } else {
      if (positionPlan) {
        throw new PolicyInsightValidationError(
          "positionPlan must not be supplied for non-position-scoped synthesis",
          "POSITION_SCOPE_MISMATCH"
        );
      }
    }

    if (scope.kind === "whirlpool") {
      if (scope.whirlpoolAddress !== input.marketSelector.poolAddress) {
        throw new PolicyInsightValidationError(
          "poolAddress mismatch between scope and marketSelector",
          "POOL_SCOPE_MISMATCH"
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
        throw new PolicyInsightValidationError(
          "Supplied position is stale or from the future",
          "POSITION_STALE"
        );
      }

      // Verify plan hash
      const { planHash, ...withoutHash } = positionPlan.plan;
      const verifiedHash = sha256Hex(toCanonicalJson(withoutHash));
      if (planHash !== verifiedHash) {
        throw new PolicyInsightValidationError(
          "Plan hash verification failed",
          "PLAN_HASH_INVALID"
        );
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

    const fromAsOfUnixMs = positionPlan ? positionPlan.plan.asOfUnixMs - 300_000 : undefined;
    const toAsOfUnixMs = positionPlan ? positionPlan.plan.asOfUnixMs + 300_000 : undefined;

    const evidence = await deps.selectEvidence({
      scope,
      selectedAtUnixMs: synthesisAtUnixMs,
      fromAsOfUnixMs,
      toAsOfUnixMs
    });

    // 4. Verify selection-time matches captured instant and optional expectedSelectionHash
    if (evidence.selectedAtUnixMs !== synthesisAtUnixMs) {
      throw new PolicyInsightValidationError(
        "Evidence selection time does not match captured synthesis time",
        "EVIDENCE_SELECTION_SUPERSEDED"
      );
    }

    const computedSelectionHash = computeEvidenceSelectionHash(evidence);
    if (
      input.expectedSelectionHash !== undefined &&
      input.expectedSelectionHash !== computedSelectionHash
    ) {
      throw new PolicyInsightValidationError(
        `Selected evidence set hash (${computedSelectionHash}) does not match expected selection hash (${input.expectedSelectionHash})`,
        "EVIDENCE_SELECTION_SUPERSEDED"
      );
    }

    const srTheses = projectSrTheses(await deps.srThesesReadPort.getCurrent("SOL/USDC", "mco"));

    // 5. Compute fingerprints and check repository for exact replay (short-circuit)
    const fingerprints = computePolicyInsightFingerprints({
      rulesetVersion: deps.ruleset.version,
      pair: "SOL/USDC",
      scope,
      market,
      positionPlan: positionPlan ?? null,
      evidence,
      srTheses
    });

    let existing: StoredPolicyInsight | null = null;
    try {
      existing = await deps.repository.findBySynthesisInputHash({
        schemaVersion: "policy-insight.v1",
        wireContractSha256: POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256,
        rulesetVersion: deps.ruleset.version,
        synthesisInputHash: fingerprints.synthesisInputHash
      });
    } catch (err) {
      throw new PolicyInsightStoreUnavailableError(
        "Failed to query policy insight repository",
        "POLICY_STORE_UNAVAILABLE",
        { cause: err }
      );
    }

    if (existing) {
      const readResult = projectPolicyInsightRead(existing.synthesisOutputJson, synthesisAtUnixMs);
      if (!readResult.ok) {
        throw new PolicyInsightValidationError(
          "Failed to project policy insight: " + JSON.stringify(readResult.issues),
          "OUTPUT_SCHEMA_INVALID"
        );
      }
      return readResult.value;
    }

    // 6. Reduce via policy engine using V1 canonical synthesis
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
      },
      srTheses
    };

    const draft = synthesizePolicyInsightV1(envelope, deps.ruleset);

    const output: PolicyInsightContent = {
      ...draft,
      insightId: fingerprints.synthesisInputHash
    } as PolicyInsightContent;

    // 7. Validate output with PolicyInsightContent schema
    const validationResult = parsePolicyInsightContent(output);
    if (!validationResult.ok) {
      throw new PolicyInsightValidationError(
        `Reducer output rejected by schema validation: ${validationResult.issues.length} issue(s)`,
        "OUTPUT_SCHEMA_INVALID",
        { cause: validationResult.issues }
      );
    }

    // 8. Compute canonical and hash for the output
    const { canonical: payloadCanonical, hash: payloadHash } =
      computePolicyInsightContentCanonicalAndHash(output);

    // 9. Generate wire contract SHA256 (published wire contract)
    const wireContractSha256 = POLICY_INSIGHT_V1_WIRE_CONTRACT_SHA256;

    // 10. Construct NewPolicyInsightRecord and insert
    const record: NewPolicyInsightRecord = {
      insightId: output.insightId,
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
      wireContractSha256,
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
      const readResult = projectPolicyInsightRead(
        result.record.synthesisOutputJson,
        synthesisAtUnixMs
      );
      if (!readResult.ok) {
        throw new PolicyInsightValidationError(
          "Failed to project policy insight: " + JSON.stringify(readResult.issues),
          "OUTPUT_SCHEMA_INVALID"
        );
      }
      return readResult.value;
    } catch (err) {
      if (err instanceof PolicyInsightValidationError) {
        throw err;
      }
      throw new PolicyInsightStoreUnavailableError(
        "Failed to persist synthesized policy insight",
        "POLICY_STORE_UNAVAILABLE",
        { cause: err }
      );
    }
  };
};
