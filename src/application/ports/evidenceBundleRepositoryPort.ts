import type { Scope } from "../../contract/evidence/v1/types.generated.js";
import type { EvidenceBundleV1 } from "../../contract/evidence/v1/types.generated.js";

export class EvidenceRunConflictError extends Error {
  readonly errorCode = "EVIDENCE_RUN_CONFLICT" as const;
  constructor(
    message: string,
    readonly existingHash: string,
    readonly incomingHash: string
  ) {
    super(message);
    this.name = "EvidenceRunConflictError";
  }
}

export interface EvidenceBundleReceipt {
  id: number;
  evidenceHash: string;
  receivedAtUnixMs: number;
  scopeKey: string;
}

export interface EvidenceSourceFilter {
  publisher?: string;
  sourceId?: string;
}

export interface EvidenceScopeQuery {
  pair: string;
  scopeKey?: string;
  source?: EvidenceSourceFilter;
  fromUnixMs?: number;
  toUnixMs?: number;
}

import type {
  EvidenceLifecycle,
  EvidenceBundleRecord
} from "../../engine/evidence/selectEvidence.js";

export type { EvidenceLifecycle, EvidenceBundleRecord };

export interface EvidenceHistoryCursor {
  receivedAtUnixMs: number;
  id: number;
}

export interface EvidenceBundleRepositoryPort {
  append(input: {
    bundle: EvidenceBundleV1;
    payloadCanonical: string;
    payloadHash: string;
    receivedAtUnixMs: number;
  }): Promise<
    | { status: "created"; receipt: EvidenceBundleReceipt }
    | { status: "already_ingested"; receipt: EvidenceBundleReceipt }
  >;

  getLatest(input: {
    pair: "SOL/USDC";
    scope: Scope;
    source: EvidenceSourceFilter | null;
    nowUnixMs: number;
  }): Promise<EvidenceBundleRecord[]>;

  getHistory(input: {
    pair: "SOL/USDC";
    scope: Scope;
    source: EvidenceSourceFilter | null;
    limit?: number;
    cursor: EvidenceHistoryCursor | null;
    nowUnixMs: number;
  }): Promise<{
    records: EvidenceBundleRecord[];
    nextCursor: EvidenceHistoryCursor | null;
  }>;
}

const LENGTH_PREFIX = (s: string): string => `${s.length}:${s}`;

export const evidenceScopeKey = (scope: Scope): string => {
  switch (scope.kind) {
    case "pair":
      return "pair";
    case "whirlpool":
      return `whirlpool:${scope.whirlpoolAddress}`;
    case "wallet":
      return `wallet:${scope.walletAddress}`;
    case "position":
      return (
        "position:" +
        LENGTH_PREFIX(scope.walletAddress) +
        LENGTH_PREFIX(scope.whirlpoolAddress) +
        LENGTH_PREFIX(scope.positionId)
      );
  }
};
