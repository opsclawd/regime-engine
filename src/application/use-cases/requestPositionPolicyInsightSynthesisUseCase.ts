import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type {
  PositionPolicyInsightSynthesisQueuePort,
  PositionPolicyInsightSynthesisStatus
} from "../ports/positionPolicyInsightSynthesisQueuePort.js";
import type { EvidenceBundleRepositoryPort } from "../ports/evidenceBundleRepositoryPort.js";
import { evidenceScopeKey } from "../ports/evidenceBundleRepositoryPort.js";
import type { PlanLedgerReadPort, PositionPlanScope } from "../ports/planLedgerPort.js";
import type { ClockPort } from "../ports/clock.js";
import type { PolicyRuleset } from "../../engine/policy/ruleset.js";
import { SOL_USDC_POLICY_V1 } from "../../engine/policy/ruleset.js";
import type {
  SelectEvidenceInput,
  SelectedEvidenceSummary
} from "../../engine/evidence/selectEvidence.js";
import { selectEvidence } from "../../engine/evidence/selectEvidence.js";
import { EVIDENCE_SELECTION_POLICY_V1 } from "../../engine/evidence/selectionPolicy.js";
import type { EvidenceSelectionPolicy } from "../../engine/evidence/selectionPolicy.js";
import { computeEvidenceSelectionHash } from "./policyInsightFingerprints.js";

export interface PositionScopeInput {
  readonly positionId: string;
  readonly poolAddress: string;
  readonly walletAddress?: string;
}

export type ConcretePositionScope = Extract<Scope, { kind: "position" }>;

export interface RequestPositionPolicyInsightSynthesisInput {
  readonly scope?: Scope | PositionScopeInput;
  readonly wakeUpIdentity?: string;
  readonly selectedAtUnixMs?: number;
  readonly mode?: "single" | "startup";
}

export interface RequestPositionPolicyInsightSynthesisResult {
  readonly requestId: number;
  readonly status: PositionPolicyInsightSynthesisStatus;
  readonly selectionHash: string | null;
  readonly planHash: string | null;
  readonly freshEvidenceRequired: boolean;
}

export interface RequestPositionPolicyInsightSynthesisStartupResult {
  readonly reconciledCount: number;
  readonly results: readonly RequestPositionPolicyInsightSynthesisResult[];
}

export interface RequestPositionPolicyInsightSynthesisUseCase {
  (
    input?: RequestPositionPolicyInsightSynthesisInput
  ): Promise<
    RequestPositionPolicyInsightSynthesisResult | RequestPositionPolicyInsightSynthesisStartupResult
  >;
  reconcileStartup(): Promise<RequestPositionPolicyInsightSynthesisStartupResult>;
}

export interface RequestPositionPolicyInsightSynthesisUseCaseDeps {
  readonly queue: PositionPolicyInsightSynthesisQueuePort;
  readonly evidenceRepository: EvidenceBundleRepositoryPort;
  readonly planLedger: PlanLedgerReadPort;
  readonly clock: ClockPort;
  readonly selector?: (input: SelectEvidenceInput) => SelectedEvidenceSummary;
  readonly ruleset?: PolicyRuleset;
  readonly selectionPolicy?: EvidenceSelectionPolicy;
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let index = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function parsePositionScopeKey(scopeKey: string): ConcretePositionScope | null {
  if (!scopeKey.startsWith("position:")) {
    return null;
  }
  const rest = scopeKey.slice("position:".length);
  let pos = 0;
  const parsePrefix = (): string | null => {
    const colonIdx = rest.indexOf(":", pos);
    if (colonIdx === -1) return null;
    const lenStr = rest.slice(pos, colonIdx);
    const len = parseInt(lenStr, 10);
    if (isNaN(len) || len < 0 || String(len) !== lenStr) return null;
    const start = colonIdx + 1;
    const val = rest.slice(start, start + len);
    if (val.length !== len) return null;
    pos = start + len;
    return val;
  };
  const walletAddress = parsePrefix();
  const whirlpoolAddress = parsePrefix();
  const positionId = parsePrefix();
  if (
    walletAddress === null ||
    whirlpoolAddress === null ||
    positionId === null ||
    pos !== rest.length
  ) {
    return null;
  }
  return {
    kind: "position",
    network: "solana-mainnet",
    positionId,
    whirlpoolAddress,
    walletAddress
  };
}

export function toScope(scopeInput: Scope | PositionScopeInput): ConcretePositionScope {
  if ("kind" in scopeInput) {
    if (scopeInput.kind !== "position") {
      throw new Error("Only position scope is supported for position policy insight synthesis");
    }
    return scopeInput;
  }
  return {
    kind: "position",
    network: "solana-mainnet",
    positionId: scopeInput.positionId,
    whirlpoolAddress: scopeInput.poolAddress,
    walletAddress: scopeInput.walletAddress ?? ""
  };
}

export const createRequestPositionPolicyInsightSynthesisUseCase = (
  deps: RequestPositionPolicyInsightSynthesisUseCaseDeps
): RequestPositionPolicyInsightSynthesisUseCase => {
  const rulesetVersion = (deps.ruleset ?? SOL_USDC_POLICY_V1).version;
  const selectorFn = deps.selector ?? selectEvidence;
  const selectionPolicy = deps.selectionPolicy ?? EVIDENCE_SELECTION_POLICY_V1;

  const reconcileSingle = async (
    scopeInput: Scope | PositionScopeInput,
    selectedAtUnixMsOverride?: number,
    waitingScopeSet?: Set<string>
  ): Promise<RequestPositionPolicyInsightSynthesisResult | null> => {
    const scope = toScope(scopeInput);
    const scopeKey = evidenceScopeKey(scope);
    const nowUnixMs = selectedAtUnixMsOverride ?? deps.clock.nowUnixMs();

    const planScope: PositionPlanScope = {
      positionId: scope.positionId,
      poolAddress: scope.whirlpoolAddress,
      walletId: scope.walletAddress || undefined
    };

    // Load latest plan
    const storedPlan = await deps.planLedger.getLatestPositionPlan(planScope);

    let validPlanHash: string | null = null;
    let planAsOfUnixMs: number | null = null;

    if (storedPlan) {
      const planRespScope = storedPlan.planResponse.scope;
      const planReqPos = storedPlan.planRequest.position;

      const matchesPosition = planRespScope.positionId === scope.positionId;
      const matchesPool = planRespScope.poolAddress === scope.whirlpoolAddress;
      const matchesWallet =
        !scope.walletAddress || !planReqPos.walletId || scope.walletAddress === planReqPos.walletId;

      if (matchesPosition && matchesPool && matchesWallet) {
        validPlanHash = storedPlan.planResponse.planHash;
        planAsOfUnixMs = storedPlan.planResponse.asOfUnixMs;
      }
    }

    // Invariant 6 check: if plan arrives when an expired waiting evidence request exists
    if (validPlanHash) {
      const isWaitingForPlan = waitingScopeSet
        ? waitingScopeSet.has(scopeKey)
        : await deps.queue.hasWaitingRequest(scopeKey, "waiting_for_plan");

      if (isWaitingForPlan) {
        // Query evidence without 5-minute restriction to see if evidence exists but is expired or purged
        const allRecordsForScope = await deps.evidenceRepository.getLatest({
          pair: "SOL/USDC",
          scope,
          source: null,
          nowUnixMs
        });
        const hasScopeRecords = allRecordsForScope.length > 0;
        const allScopeRecordsExpired =
          hasScopeRecords &&
          allRecordsForScope.every(
            (r) => r.lifecycle === "EXPIRED" || Date.parse(r.bundle.expiresAt) < nowUnixMs
          );

        if (!hasScopeRecords || allScopeRecordsExpired) {
          await deps.queue.failWaitingForPlan({
            scopeKey,
            rulesetVersion,
            nowUnixMs,
            errorCode: "POSITION_STALE",
            errorMessage: "Evidence expired before plan arrived"
          });
        }
      }
    }

    // Compute 5-minute inclusive bounds if plan exists
    const fromAsOfUnixMs = planAsOfUnixMs !== null ? planAsOfUnixMs - 300_000 : undefined;
    const toAsOfUnixMs = planAsOfUnixMs !== null ? planAsOfUnixMs + 300_000 : undefined;

    // Load evidence
    const records = await deps.evidenceRepository.getLatest({
      pair: "SOL/USDC",
      scope,
      source: null,
      nowUnixMs,
      fromAsOfUnixMs,
      toAsOfUnixMs
    });

    const hasRecords = records.length > 0;
    const allExpired =
      hasRecords &&
      records.every((r) => r.lifecycle === "EXPIRED" || Date.parse(r.bundle.expiresAt) < nowUnixMs);

    let selectionHash: string | null = null;

    if (hasRecords && !allExpired) {
      const summary = selectorFn({
        records,
        selectedAtUnixMs: nowUnixMs,
        scope,
        policy: selectionPolicy
      });

      const hasIncluded = summary.decisions.some((d) => d.status === "INCLUDED");
      const hasAccepted = summary.bundles.some((b) => b.status === "ACCEPTED");
      if (hasIncluded || hasAccepted) {
        selectionHash = computeEvidenceSelectionHash(summary);
      }
    }

    if (!selectionHash && !validPlanHash) {
      return null;
    }

    // Enqueue or reconcile with queue
    const request = await deps.queue.enqueueOrReconcile({
      scopeKey,
      selectionHash,
      planHash: validPlanHash,
      rulesetVersion,
      nowUnixMs
    });

    const freshEvidenceRequired =
      request.status === "waiting_for_evidence" || (!selectionHash && !!validPlanHash);

    return {
      requestId: request.id,
      status: request.status,
      selectionHash: request.selectionHash,
      planHash: request.planHash,
      freshEvidenceRequired
    };
  };

  const reconcileStartup =
    async (): Promise<RequestPositionPolicyInsightSynthesisStartupResult> => {
      const nowUnixMs = deps.clock.nowUnixMs();

      const waitingScopes = await deps.queue.listWaitingScopes();
      const waitingScopeSet = new Set(waitingScopes);
      const eligibleScopes = await deps.queue.listEligiblePositionScopes(nowUnixMs);
      const latestPlans = await deps.planLedger.listLatestPositionPlans();

      const scopeMap = new Map<string, ConcretePositionScope>();

      for (const scopeKey of waitingScopes) {
        const parsed = parsePositionScopeKey(scopeKey);
        if (parsed) scopeMap.set(scopeKey, parsed);
      }

      for (const scopeKey of eligibleScopes) {
        const parsed = parsePositionScopeKey(scopeKey);
        if (parsed) scopeMap.set(scopeKey, parsed);
      }

      for (const plan of latestPlans) {
        const scope: ConcretePositionScope = {
          kind: "position",
          network: "solana-mainnet",
          positionId: plan.planResponse.scope.positionId,
          whirlpoolAddress: plan.planResponse.scope.poolAddress,
          walletAddress: plan.planRequest.position.walletId ?? ""
        };
        const key = evidenceScopeKey(scope);
        if (!scopeMap.has(key)) {
          scopeMap.set(key, scope);
        }
      }

      const scopes = Array.from(scopeMap.values());
      const rawResults = await mapConcurrent(scopes, 10, (scope) =>
        reconcileSingle(scope, nowUnixMs, waitingScopeSet)
      );
      const results = rawResults.filter(
        (res): res is RequestPositionPolicyInsightSynthesisResult => res !== null
      );

      return {
        reconciledCount: results.length,
        results
      };
    };

  const useCase = (async (
    input?: RequestPositionPolicyInsightSynthesisInput
  ): Promise<
    RequestPositionPolicyInsightSynthesisResult | RequestPositionPolicyInsightSynthesisStartupResult
  > => {
    if (!input || input.mode === "startup") {
      return await reconcileStartup();
    }
    if (!input.scope) {
      throw new Error("scope is required for single position policy insight synthesis request");
    }
    const res = await reconcileSingle(input.scope, input.selectedAtUnixMs);
    if (!res) {
      throw new Error("No evidence or plan available to reconcile for scope");
    }
    return res;
  }) as RequestPositionPolicyInsightSynthesisUseCase;

  useCase.reconcileStartup = reconcileStartup;

  return useCase;
};
