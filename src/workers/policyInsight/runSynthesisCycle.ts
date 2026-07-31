import type { PolicyInsightSynthesisTriggerPort } from "../../application/ports/policyInsightSynthesisTriggerPort.js";
import type { SynthesizePolicyInsightUseCase } from "../../application/use-cases/synthesizePolicyInsightUseCase.js";
import type { PolicyInsightSynthesisWorkerConfig } from "./config.js";
import type { WorkerLogger } from "../gecko/logger.js";
import type { ClockPort } from "../../application/ports/clock.js";
import { PolicyInsightValidationError } from "../../application/errors/policyInsightErrors.js";

export interface PolicyInsightSynthesisCycleDeps {
  readonly triggerPort: PolicyInsightSynthesisTriggerPort;
  readonly synthesizePolicyInsight: SynthesizePolicyInsightUseCase;
  readonly config: PolicyInsightSynthesisWorkerConfig;
  readonly logger: WorkerLogger;
  readonly leaseOwner: string;
  readonly clock: ClockPort;
}

export type PolicyInsightSynthesisCycleResult =
  | { outcome: "idle" }
  | {
      outcome: "succeeded";
      receiptId: number;
      insightId: string;
      synthesisInputHash: string;
      durationMs: number;
    }
  | {
      outcome: "permanent_failure";
      receiptId: number;
      errorCode: string;
      errorMessage: string;
    }
  | {
      outcome: "transient_failure";
      receiptId: number;
      errorCode: string;
      errorMessage: string;
    }
  | {
      outcome: "lease_lost";
      receiptId: number;
    };

function sanitizeErrorMessage(message: string): string {
  let sanitized = message.replace(/(postgres|mysql|mongodb|redis):\/\/[^\s]+/gi, "$1://[REDACTED]");
  sanitized = sanitized.replace(/(token|bearer|key|secret)=([^\s&]+)/gi, "$1=[REDACTED]");
  return sanitized;
}

function getErrorInfo(err: unknown): { errorCode: string; errorMessage: string } {
  if (err instanceof Error) {
    return {
      errorCode: err.name || "Error",
      errorMessage: sanitizeErrorMessage(err.message || "Unknown error")
    };
  }
  return {
    errorCode: "UNKNOWN_ERROR",
    errorMessage: sanitizeErrorMessage(String(err))
  };
}

function isPermanentError(err: unknown): boolean {
  if (err instanceof PolicyInsightValidationError) {
    return true;
  }
  if (err instanceof TypeError || err instanceof RangeError) {
    return true;
  }
  return false;
}

export async function runPolicyInsightSynthesisCycle(
  deps: PolicyInsightSynthesisCycleDeps
): Promise<PolicyInsightSynthesisCycleResult> {
  const startMs = deps.clock.nowUnixMs();

  const claim = await deps.triggerPort.claimLatestPairEvidence({
    cursorKey: "pair",
    leaseOwner: deps.leaseOwner,
    leaseDurationMs: deps.config.leaseMs,
    nowUnixMs: startMs
  });

  if (!claim) {
    return { outcome: "idle" };
  }

  const receiptId = claim.targetReceiptId;
  const attemptCount = claim.attemptCount;

  try {
    const insight = await deps.synthesizePolicyInsight({
      scope: { kind: "pair" },
      marketSelector: deps.config.marketSelector,
      positionPlan: null
    });

    const endMs = deps.clock.nowUnixMs();
    const durationMs = endMs - startMs;

    const updated = await deps.triggerPort.complete({
      cursorKey: "pair",
      leaseOwner: deps.leaseOwner,
      targetReceiptId: receiptId,
      nowUnixMs: endMs,
      outcome: "success"
    });

    if (!updated) {
      return { outcome: "lease_lost", receiptId };
    }

    deps.logger.info("policy_insight_synthesis_succeeded", {
      receiptId,
      scope: "pair",
      synthesisInputHash: insight.insightId,
      insightId: insight.insightId,
      durationMs,
      attemptCount,
      outcome: "success"
    });

    return {
      outcome: "succeeded",
      receiptId,
      insightId: insight.insightId,
      synthesisInputHash: insight.insightId,
      durationMs
    };
  } catch (err: unknown) {
    const endMs = deps.clock.nowUnixMs();
    const durationMs = endMs - startMs;
    const { errorCode, errorMessage } = getErrorInfo(err);

    const isPermanent = isPermanentError(err);
    const isExhausted = !isPermanent && attemptCount >= deps.config.maxAttempts;

    if (isPermanent || isExhausted) {
      if (isExhausted) {
        deps.logger.error("policy_insight_synthesis_retry_budget_exhausted", {
          receiptId,
          scope: "pair",
          durationMs,
          attemptCount,
          maxAttempts: deps.config.maxAttempts,
          outcome: "permanent_failure",
          errorCode,
          errorMessage
        });
      } else {
        deps.logger.error("policy_insight_synthesis_failed", {
          receiptId,
          scope: "pair",
          durationMs,
          attemptCount,
          outcome: "permanent_failure",
          errorCode,
          errorMessage
        });
      }

      const updated = await deps.triggerPort.complete({
        cursorKey: "pair",
        leaseOwner: deps.leaseOwner,
        targetReceiptId: receiptId,
        nowUnixMs: endMs,
        outcome: "permanent_failure",
        errorCode,
        errorMessage
      });

      if (!updated) {
        return { outcome: "lease_lost", receiptId };
      }

      return {
        outcome: "permanent_failure",
        receiptId,
        errorCode,
        errorMessage
      };
    } else {
      deps.logger.warn("policy_insight_synthesis_transient_failure", {
        receiptId,
        scope: "pair",
        durationMs,
        attemptCount,
        outcome: "transient_failure",
        errorCode,
        errorMessage
      });

      const updated = await deps.triggerPort.releaseForRetry({
        cursorKey: "pair",
        leaseOwner: deps.leaseOwner,
        targetReceiptId: receiptId,
        nowUnixMs: endMs,
        classification: errorCode,
        sanitizedMessage: errorMessage,
        retryAtUnixMs: endMs + deps.config.retryMs
      });

      if (!updated) {
        return { outcome: "lease_lost", receiptId };
      }

      return {
        outcome: "transient_failure",
        receiptId,
        errorCode,
        errorMessage
      };
    }
  }
}
