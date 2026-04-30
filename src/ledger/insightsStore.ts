import { and, desc, eq } from "drizzle-orm";
import { clmmInsights } from "./pg/schema/index.js";
import type { ClmmInsightRow } from "./pg/schema/index.js";
import type { Db } from "./pg/db.js";
import type { InsightIngestRequest } from "../contract/v1/insights.js";
import { parseInsightRowEnums } from "../contract/v1/insights.js";

export const INSIGHT_ERROR_CODES = {
  RUN_CONFLICT: "INSIGHT_RUN_CONFLICT"
} as const;

export class InsightConflictError extends Error {
  public readonly errorCode: string = INSIGHT_ERROR_CODES.RUN_CONFLICT;

  public constructor(public readonly source: string, public readonly runId: string) {
    super(`Insight conflict for source="${source}", runId="${runId}"`);
  }
}

export interface InsightInsertInput {
  request: InsightIngestRequest;
  payloadCanonical: string;
  payloadHash: string;
  receivedAtUnixMs: number;
}

export type InsightInsertResult =
  | { status: "created"; row: ClmmInsightRow }
  | { status: "already_ingested"; row: ClmmInsightRow };

export const rowToInsightWire = (row: ClmmInsightRow): InsightIngestRequest => {
  const parsed = parseInsightRowEnums(row);
  return {
    ...parsed,
    asOf: new Date(row.asOfUnixMs).toISOString(),
    runId: row.runId,
    expiresAt: new Date(row.expiresAtUnixMs).toISOString()
  };
};

export class InsightsStore {
  public constructor(private readonly db: Db) {}

  public async insertInsight(input: InsightInsertInput): Promise<InsightInsertResult> {
    const inserted = await this.db
      .insert(clmmInsights)
      .values({
        schemaVersion: input.request.schemaVersion,
        pair: input.request.pair,
        asOfUnixMs: Date.parse(input.request.asOf),
        source: input.request.source,
        runId: input.request.runId,
        marketRegime: input.request.marketRegime,
        fundamentalRegime: input.request.fundamentalRegime,
        recommendedAction: input.request.recommendedAction,
        confidence: input.request.confidence,
        riskLevel: input.request.riskLevel,
        dataQuality: input.request.dataQuality,
        clmmPolicyJson: input.request.clmmPolicy,
        levelsJson: input.request.levels,
        reasoningJson: input.request.reasoning,
        sourceRefsJson: input.request.sourceRefs,
        payloadCanonical: input.payloadCanonical,
        payloadHash: input.payloadHash,
        expiresAtUnixMs: Date.parse(input.request.expiresAt),
        receivedAtUnixMs: input.receivedAtUnixMs
      })
      .onConflictDoNothing({ target: [clmmInsights.source, clmmInsights.runId] })
      .returning();

    if (inserted.length > 0) {
      return { status: "created", row: inserted[0] };
    }

    const existingRows = await this.db
      .select()
      .from(clmmInsights)
      .where(
        and(
          eq(clmmInsights.source, input.request.source),
          eq(clmmInsights.runId, input.request.runId)
        )
      )
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      throw new Error(
        "append-only invariant violated: ON CONFLICT did not insert but no existing row found"
      );
    }
    if (existing.payloadHash === input.payloadHash) {
      return { status: "already_ingested", row: existing };
    }
    throw new InsightConflictError(input.request.source, input.request.runId);
  }

  public async getCurrent(pair: string): Promise<ClmmInsightRow | null> {
    const rows = await this.db
      .select()
      .from(clmmInsights)
      .where(eq(clmmInsights.pair, pair))
      .orderBy(desc(clmmInsights.asOfUnixMs), desc(clmmInsights.id))
      .limit(1);

    return rows[0] ?? null;
  }

  public async getHistory(pair: string, limit: number): Promise<ClmmInsightRow[]> {
    return this.db
      .select()
      .from(clmmInsights)
      .where(eq(clmmInsights.pair, pair))
      .orderBy(desc(clmmInsights.receivedAtUnixMs), desc(clmmInsights.id))
      .limit(limit);
  }
}