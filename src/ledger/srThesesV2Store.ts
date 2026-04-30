import { and, asc, desc, eq } from "drizzle-orm";
import { srThesesV2 } from "./pg/schema/index.js";
import type { SrThesesV2Row } from "./pg/schema/index.js";
import type { Db } from "./pg/db.js";
import {
  computeSrThesisV2CanonicalAndHash,
  type SrLevelsV2IngestRequest,
  type SrLevelsV2CurrentResponse,
  type SrThesisV2
} from "../contract/v2/srLevels.js";

export const SR_THESIS_V2_ERROR_CODES = {
  SR_THESIS_V2_CONFLICT: "SR_THESIS_V2_CONFLICT"
} as const;

export interface SrThesisV2ConflictKey {
  source: string;
  symbol: string;
  briefId: string;
  asset: string;
  sourceHandle: string;
}

export class SrThesisV2ConflictError extends Error {
  public readonly errorCode = SR_THESIS_V2_ERROR_CODES.SR_THESIS_V2_CONFLICT;
  public readonly key: SrThesisV2ConflictKey;

  public constructor(key: SrThesisV2ConflictKey) {
    super(
      `S/R thesis v2 conflict for source="${key.source}" symbol="${key.symbol}" briefId="${key.briefId}" asset="${key.asset}" sourceHandle="${key.sourceHandle}"`
    );
    this.key = key;
  }
}

export type SrThesesV2InsertResult =
  | { status: "created"; insertedCount: number; idempotentCount: number }
  | { status: "already_ingested"; insertedCount: 0; idempotentCount: number };

export interface SrThesesV2InsertInput {
  request: SrLevelsV2IngestRequest;
  capturedAtUnixMs: number;
}

const rowToThesis = (row: SrThesesV2Row): SrThesisV2 => ({
  asset: row.asset,
  timeframe: row.timeframe,
  bias: row.bias,
  setupType: row.setupType,
  supportLevels: row.supportLevels,
  resistanceLevels: row.resistanceLevels,
  entryZone: row.entryZone,
  targets: row.targets,
  invalidation: row.invalidation,
  trigger: row.triggerText,
  chartReference: row.chartReference,
  sourceHandle: row.sourceHandle,
  sourceChannel: row.sourceChannel,
  sourceKind: row.sourceKind,
  sourceReliability: row.sourceReliability,
  rawThesisText: row.rawThesisText,
  collectedAt: row.collectedAtIso,
  publishedAt: row.publishedAtIso,
  sourceUrl: row.sourceUrl,
  notes: row.notes
});

export class SrThesesV2Store {
  public constructor(private readonly db: Db) {}

  public async insertBrief(input: SrThesesV2InsertInput): Promise<SrThesesV2InsertResult> {
    const { request, capturedAtUnixMs } = input;
    const receivedAtUnixMs = Date.now();

    return this.db.transaction(async (tx) => {
      let insertedCount = 0;
      let idempotentCount = 0;

      for (const thesis of request.theses) {
        const { hash } = computeSrThesisV2CanonicalAndHash(request, thesis);

        const inserted = await tx
          .insert(srThesesV2)
          .values({
            schemaVersion: request.schemaVersion,
            source: request.source,
            symbol: request.symbol,
            briefId: request.brief.briefId,
            sourceRecordedAtIso: request.brief.sourceRecordedAtIso,
            summary: request.brief.summary,
            capturedAtIso: new Date(capturedAtUnixMs).toISOString(),
            capturedAtUnixMs,
            asset: thesis.asset,
            timeframe: thesis.timeframe,
            bias: thesis.bias,
            setupType: thesis.setupType,
            supportLevels: thesis.supportLevels,
            resistanceLevels: thesis.resistanceLevels,
            entryZone: thesis.entryZone,
            targets: thesis.targets,
            invalidation: thesis.invalidation,
            triggerText: thesis.trigger,
            chartReference: thesis.chartReference,
            sourceHandle: thesis.sourceHandle,
            sourceChannel: thesis.sourceChannel,
            sourceKind: thesis.sourceKind,
            sourceReliability: thesis.sourceReliability,
            rawThesisText: thesis.rawThesisText,
            collectedAtIso: thesis.collectedAt,
            publishedAtIso: thesis.publishedAt,
            sourceUrl: thesis.sourceUrl,
            notes: thesis.notes,
            payloadHash: hash,
            receivedAtUnixMs
          })
          .onConflictDoNothing({
            target: [
              srThesesV2.source,
              srThesesV2.symbol,
              srThesesV2.briefId,
              srThesesV2.asset,
              srThesesV2.sourceHandle
            ]
          })
          .returning();

        if (inserted.length > 0) {
          insertedCount += 1;
          continue;
        }

        const existing = await tx
          .select()
          .from(srThesesV2)
          .where(
            and(
              eq(srThesesV2.source, request.source),
              eq(srThesesV2.symbol, request.symbol),
              eq(srThesesV2.briefId, request.brief.briefId),
              eq(srThesesV2.asset, thesis.asset),
              eq(srThesesV2.sourceHandle, thesis.sourceHandle)
            )
          )
          .limit(1);

        const row = existing[0];
        if (!row) {
          throw new Error(
            "append-only invariant violated: ON CONFLICT did not insert but no existing row found"
          );
        }
        if (row.payloadHash !== hash) {
          throw new SrThesisV2ConflictError({
            source: request.source,
            symbol: request.symbol,
            briefId: request.brief.briefId,
            asset: thesis.asset,
            sourceHandle: thesis.sourceHandle
          });
        }
        idempotentCount += 1;
      }

      if (insertedCount > 0) {
        return { status: "created", insertedCount, idempotentCount };
      }
      return { status: "already_ingested", insertedCount: 0, idempotentCount };
    });
  }

  public async getCurrent(
    symbol: string,
    source: string
  ): Promise<SrLevelsV2CurrentResponse | null> {
    const latest = await this.db
      .select()
      .from(srThesesV2)
      .where(and(eq(srThesesV2.symbol, symbol), eq(srThesesV2.source, source)))
      .orderBy(desc(srThesesV2.capturedAtUnixMs), desc(srThesesV2.id))
      .limit(1);

    const head = latest[0];
    if (!head) return null;

    const rows = await this.db
      .select()
      .from(srThesesV2)
      .where(
        and(
          eq(srThesesV2.source, source),
          eq(srThesesV2.symbol, symbol),
          eq(srThesesV2.briefId, head.briefId)
        )
      )
      .orderBy(asc(srThesesV2.id));

    return {
      schemaVersion: "2.0",
      source: head.source,
      symbol: head.symbol,
      brief: {
        briefId: head.briefId,
        sourceRecordedAtIso: head.sourceRecordedAtIso,
        summary: head.summary
      },
      capturedAtIso: head.capturedAtIso,
      theses: rows.map(rowToThesis)
    };
  }
}