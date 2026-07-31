import type { PositionPolicyInsightSynthesisQueuePort } from "../../application/ports/positionPolicyInsightSynthesisQueuePort.js";
import type {
  PlanLedgerReadPort,
  PositionPlanScope
} from "../../application/ports/planLedgerPort.js";
import type { SynthesizePolicyInsightUseCase } from "../../application/use-cases/synthesizePolicyInsightUseCase.js";
import type { PolicyInsightSynthesisWorkerConfig } from "./config.js";
import type { WorkerLogger } from "../gecko/logger.js";
import type { ClockPort } from "../../application/ports/clock.js";
import { parsePositionScopeKey } from "../../application/use-cases/requestPositionPolicyInsightSynthesisUseCase.js";
import { PolicyInsightValidationError } from "../../application/errors/policyInsightErrors.js";

export interface PositionPolicyInsightSynthesisCycleDeps {
  readonly queue: PositionPolicyInsightSynthesisQueuePort;
  readonly planLedger: PlanLedgerReadPort;
  readonly synthesizePolicyInsight: SynthesizePolicyInsightUseCase;
  readonly config: PolicyInsightSynthesisWorkerConfig & { batchSize?: number };
  readonly logger: WorkerLogger;
  readonly leaseOwner: string;
  readonly clock: ClockPort;
}

export type PositionPolicyInsightSynthesisCycleResult =
  | { outcome: "idle" }
  | {
      outcome: "succeeded";
      requestId: number;
      insightId: string;
      synthesisInputHash: string;
      durationMs: number;
    }
  | {
      outcome: "superseded";
      requestId: number;
      errorCode?: string;
      errorMessage?: string;
    }
  | {
      outcome: "permanent_failure";
      requestId: number;
      errorCode: string;
      errorMessage: string;
    }
  | {
      outcome: "transient_failure";
      requestId: number;
      errorCode: string;
      errorMessage: string;
    }
  | {
      outcome: "lease_lost";
      requestId: number;
    };

function sanitizeErrorMessage(message: string): string {
  let sanitized = message.replace(/(postgres|mysql|mongodb|redis):\/\/[^\s]+/gi, "$1://[REDACTED]");
  sanitized = sanitized.replace(/(token|bearer|key|secret)=([^\s&]+)/gi, "$1=[REDACTED]");
  return sanitized;
}

function findErrorCode(err: unknown): string {
  let current: unknown = err;
  while (current != null && typeof current === "object") {
    if (typeof (current as { errorCode?: unknown }).errorCode === "string") {
      return (current as { errorCode: string }).errorCode;
    }
    if ((current as Error).name === "RegimeCandlesNotFoundError") {
      return "MARKET_DATA_UNAVAILABLE";
    }
    if ((current as Error).name === "EvidenceStoreUnavailableError") {
      return "EVIDENCE_STORE_UNAVAILABLE";
    }
    if ((current as Error).name === "PolicyInsightStoreUnavailableError") {
      return "POLICY_STORE_UNAVAILABLE";
    }
    current = (current as { cause?: unknown }).cause;
  }
  if (err instanceof Error) {
    return err.name || "Error";
  }
  return "UNKNOWN_ERROR";
}

function getErrorInfo(err: unknown): { errorCode: string; errorMessage: string } {
  if (err instanceof Error) {
    return {
      errorCode: findErrorCode(err),
      errorMessage: sanitizeErrorMessage(err.message || "Unknown error")
    };
  }
  return {
    errorCode: findErrorCode(err),
    errorMessage: sanitizeErrorMessage(String(err))
  };
}

function isPermanentValidationCode(errorCode: string): boolean {
  return (
    errorCode === "POSITION_PLAN_MISSING" ||
    errorCode === "POSITION_SCOPE_MISMATCH" ||
    errorCode === "POOL_SCOPE_MISMATCH" ||
    errorCode === "POSITION_STALE" ||
    errorCode === "PLAN_HASH_INVALID" ||
    errorCode === "OUTPUT_SCHEMA_INVALID"
  );
}

function isPermanentError(err: unknown, errorCode: string): boolean {
  if (err instanceof PolicyInsightValidationError) {
    if (errorCode === "EVIDENCE_SELECTION_SUPERSEDED" || errorCode === "POSITION_PLAN_SUPERSEDED") {
      return false;
    }
    return true;
  }
  if (isPermanentValidationCode(errorCode)) {
    return true;
  }
  if (err instanceof TypeError || err instanceof RangeError) {
    return true;
  }
  return false;
}

function isSupersededError(errorCode: string): boolean {
  return errorCode === "EVIDENCE_SELECTION_SUPERSEDED" || errorCode === "POSITION_PLAN_SUPERSEDED";
}

export async function runPositionPolicyInsightSynthesisCycle(
  deps: PositionPolicyInsightSynthesisCycleDeps
): Promise<PositionPolicyInsightSynthesisCycleResult> {
  const startMs = deps.clock.nowUnixMs();
  const batchSize = deps.config.batchSize ?? 1;

  const claims = await deps.queue.claimBatch({
    leaseOwner: deps.leaseOwner,
    leaseDurationMs: deps.config.leaseMs,
    batchSize,
    nowUnixMs: startMs
  });

  if (!claims || claims.length === 0) {
    return { outcome: "idle" };
  }

  const claim = claims[0];
  const requestId = claim.id;
  const attemptCount = claim.attemptCount;

  try {
    const scope = parsePositionScopeKey(claim.scopeKey);
    if (!scope) {
      const endMs = deps.clock.nowUnixMs();
      const durationMs = endMs - startMs;
      const errorCode = "POSITION_SCOPE_MISMATCH";
      const errorMessage = `Invalid position scope key: ${claim.scopeKey}`;

      deps.logger.error("position_policy_insight_synthesis_failed", {
        requestId,
        scopeKey: claim.scopeKey,
        planHash: claim.planHash,
        selectionHash: claim.selectionHash,
        attemptCount,
        durationMs,
        outcome: "permanent_failure",
        errorCode,
        errorMessage
      });

      const updated = await deps.queue.fail({
        id: requestId,
        leaseOwner: deps.leaseOwner,
        nowUnixMs: endMs,
        errorCode,
        errorMessage
      });

      if (!updated) {
        return { outcome: "lease_lost", requestId };
      }

      return {
        outcome: "permanent_failure",
        requestId,
        errorCode,
        errorMessage
      };
    }

    const planScope: PositionPlanScope = {
      positionId: scope.positionId,
      poolAddress: scope.whirlpoolAddress,
      walletId: scope.walletAddress || undefined
    };

    const latestPlan = await deps.planLedger.getLatestPositionPlan(planScope);
    const storedPlan = await deps.planLedger.getPositionPlanByHash(planScope, claim.planHash);

    if (latestPlan && latestPlan.planResponse.planHash !== claim.planHash) {
      const endMs = deps.clock.nowUnixMs();
      const durationMs = endMs - startMs;
      const errorCode = "POSITION_PLAN_SUPERSEDED";
      const errorMessage = `A newer position plan (${latestPlan.planResponse.planHash}) exists for position scope`;

      deps.logger.info("position_policy_insight_synthesis_superseded", {
        requestId,
        scopeKey: claim.scopeKey,
        planHash: claim.planHash,
        selectionHash: claim.selectionHash,
        attemptCount,
        durationMs,
        outcome: "superseded",
        errorCode,
        errorMessage
      });

      const updated = await deps.queue.supersede({
        id: requestId,
        leaseOwner: deps.leaseOwner,
        nowUnixMs: endMs,
        errorCode,
        errorMessage
      });

      if (!updated) {
        return { outcome: "lease_lost", requestId };
      }

      return {
        outcome: "superseded",
        requestId,
        errorCode,
        errorMessage
      };
    }

    if (!storedPlan) {
      const endMs = deps.clock.nowUnixMs();
      const durationMs = endMs - startMs;
      const errorCode = "POSITION_PLAN_MISSING";
      const errorMessage = `No stored position plan found for hash: ${claim.planHash}`;

      deps.logger.error("position_policy_insight_synthesis_failed", {
        requestId,
        scopeKey: claim.scopeKey,
        planHash: claim.planHash,
        selectionHash: claim.selectionHash,
        attemptCount,
        durationMs,
        outcome: "permanent_failure",
        errorCode,
        errorMessage
      });

      const updated = await deps.queue.fail({
        id: requestId,
        leaseOwner: deps.leaseOwner,
        nowUnixMs: endMs,
        errorCode,
        errorMessage
      });

      if (!updated) {
        return { outcome: "lease_lost", requestId };
      }

      return {
        outcome: "permanent_failure",
        requestId,
        errorCode,
        errorMessage
      };
    }

    const positionPlan = {
      position: storedPlan.planRequest.position,
      plan: storedPlan.planResponse
    };

    const insight = await deps.synthesizePolicyInsight({
      scope,
      marketSelector: deps.config.marketSelector,
      positionPlan,
      expectedSelectionHash: claim.selectionHash
    });

    const endMs = deps.clock.nowUnixMs();
    const durationMs = endMs - startMs;

    const updated = await deps.queue.complete({
      id: requestId,
      leaseOwner: deps.leaseOwner,
      nowUnixMs: endMs
    });

    if (!updated) {
      return { outcome: "lease_lost", requestId };
    }

    deps.logger.info("position_policy_insight_synthesis_succeeded", {
      requestId,
      scopeKey: claim.scopeKey,
      planHash: claim.planHash,
      selectionHash: claim.selectionHash,
      synthesisInputHash: insight.insightId,
      insightId: insight.insightId,
      durationMs,
      attemptCount,
      outcome: "success"
    });

    return {
      outcome: "succeeded",
      requestId,
      insightId: insight.insightId,
      synthesisInputHash: insight.insightId,
      durationMs
    };
  } catch (err: unknown) {
    const endMs = deps.clock.nowUnixMs();
    const durationMs = endMs - startMs;
    const { errorCode, errorMessage } = getErrorInfo(err);

    if (isSupersededError(errorCode)) {
      deps.logger.info("position_policy_insight_synthesis_superseded", {
        requestId,
        scopeKey: claim.scopeKey,
        planHash: claim.planHash,
        selectionHash: claim.selectionHash,
        attemptCount,
        durationMs,
        outcome: "superseded",
        errorCode,
        errorMessage
      });

      const updated = await deps.queue.supersede({
        id: requestId,
        leaseOwner: deps.leaseOwner,
        nowUnixMs: endMs,
        errorCode,
        errorMessage
      });

      if (!updated) {
        return { outcome: "lease_lost", requestId };
      }

      return {
        outcome: "superseded",
        requestId,
        errorCode,
        errorMessage
      };
    }

    const isPermanent = isPermanentError(err, errorCode);
    const isExhausted = !isPermanent && attemptCount >= deps.config.maxAttempts;

    if (isPermanent || isExhausted) {
      if (isExhausted) {
        deps.logger.error("position_policy_insight_synthesis_retry_budget_exhausted", {
          requestId,
          scopeKey: claim.scopeKey,
          planHash: claim.planHash,
          selectionHash: claim.selectionHash,
          durationMs,
          attemptCount,
          maxAttempts: deps.config.maxAttempts,
          outcome: "permanent_failure",
          errorCode,
          errorMessage
        });
      } else {
        deps.logger.error("position_policy_insight_synthesis_failed", {
          requestId,
          scopeKey: claim.scopeKey,
          planHash: claim.planHash,
          selectionHash: claim.selectionHash,
          durationMs,
          attemptCount,
          outcome: "permanent_failure",
          errorCode,
          errorMessage
        });
      }

      const updated = await deps.queue.fail({
        id: requestId,
        leaseOwner: deps.leaseOwner,
        nowUnixMs: endMs,
        errorCode,
        errorMessage
      });

      if (!updated) {
        return { outcome: "lease_lost", requestId };
      }

      return {
        outcome: "permanent_failure",
        requestId,
        errorCode,
        errorMessage
      };
    } else {
      deps.logger.warn("position_policy_insight_synthesis_transient_failure", {
        requestId,
        scopeKey: claim.scopeKey,
        planHash: claim.planHash,
        selectionHash: claim.selectionHash,
        durationMs,
        attemptCount,
        outcome: "transient_failure",
        errorCode,
        errorMessage
      });

      const updated = await deps.queue.releaseForRetry({
        id: requestId,
        leaseOwner: deps.leaseOwner,
        nowUnixMs: endMs,
        errorCode,
        errorMessage,
        retryAtUnixMs: endMs + deps.config.retryMs,
        maxAttempts: deps.config.maxAttempts
      });

      if (!updated) {
        return { outcome: "lease_lost", requestId };
      }

      return {
        outcome: "transient_failure",
        requestId,
        errorCode,
        errorMessage
      };
    }
  }
}
