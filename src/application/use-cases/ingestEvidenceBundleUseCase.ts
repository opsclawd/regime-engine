import type {
  EvidenceBundleRepositoryPort,
  EvidenceBundleReceipt
} from "../ports/evidenceBundleRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";
import type { RequestPositionPolicyInsightSynthesisUseCase } from "./requestPositionPolicyInsightSynthesisUseCase.js";
import { parseEvidenceBundleV1 } from "../../contract/evidence/v1/validate.js";
import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { sha256Hex } from "../../contract/v1/hash.js";

export type IngestEvidenceBundleUseCase = (input: unknown) => Promise<{
  status: "created" | "already_ingested";
  runId: string;
  evidenceHash: string;
  receipt: EvidenceBundleReceipt;
}>;

export interface IngestEvidenceBundleUseCaseDeps {
  repository: EvidenceBundleRepositoryPort;
  clock: ClockPort;
  requestPositionSynthesis?: RequestPositionPolicyInsightSynthesisUseCase;
}

export const createIngestEvidenceBundleUseCase =
  (deps: IngestEvidenceBundleUseCaseDeps): IngestEvidenceBundleUseCase =>
  async (input) => {
    const bundle = parseEvidenceBundleV1(input);
    const payloadCanonical = toCanonicalJson(bundle);
    const payloadHash = sha256Hex(payloadCanonical);
    const result = await deps.repository.append({
      bundle,
      payloadCanonical,
      payloadHash,
      receivedAtUnixMs: deps.clock.nowUnixMs()
    });

    if (deps.requestPositionSynthesis && bundle.scope.kind === "position") {
      await deps.requestPositionSynthesis({
        scope: bundle.scope,
        wakeUpIdentity: bundle.runId
      });
    }

    return {
      status: result.status,
      runId: bundle.runId,
      evidenceHash: result.receipt.evidenceHash,
      receipt: result.receipt
    };
  };
