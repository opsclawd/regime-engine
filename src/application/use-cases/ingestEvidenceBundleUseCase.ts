import type {
  EvidenceBundleRepositoryPort,
  EvidenceBundleReceipt
} from "../ports/evidenceBundleRepositoryPort.js";
import type { ClockPort } from "../ports/clock.js";
import { parseEvidenceBundleV1 } from "../../contract/evidence/v1/validate.js";
import { toCanonicalJson } from "../../contract/v1/canonical.js";
import { sha256Hex } from "../../contract/v1/hash.js";

export type IngestEvidenceBundleUseCase = (input: unknown) => Promise<{
  status: "created" | "already_ingested";
  runId: string;
  evidenceHash: string;
  receipt: EvidenceBundleReceipt;
}>;

export const createIngestEvidenceBundleUseCase =
  (deps: {
    repository: EvidenceBundleRepositoryPort;
    clock: ClockPort;
  }): IngestEvidenceBundleUseCase =>
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
    return {
      status: result.status,
      runId: bundle.runId,
      evidenceHash: result.receipt.evidenceHash,
      receipt: result.receipt
    };
  };
