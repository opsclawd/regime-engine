import { toCanonicalJson } from "../contract/v1/canonical.js";
import { SCHEMA_VERSION } from "../contract/v1/types.js";
import type { SrLevelBriefRequest, SrLevelsCurrentResponse, SrLevelResponse } from "../contract/v1/types.js";
import type { LedgerStore } from "./store.js";
import { LEDGER_ERROR_CODES, LedgerWriteError } from "./writer.js";

export const writeSrLevelBrief = (
  store: LedgerStore,
  input: SrLevelBriefRequest,
  receivedAtUnixMs?: number
): { briefId: string; insertedCount: number; status?: "already_ingested" } => {
  const capturedAtUnixMs = receivedAtUnixMs ?? Date.now();
  const canonicalBrief = toCanonicalJson(input);

  store.db.exec("BEGIN IMMEDIATE");
  try {
    const existing = store.db
      .prepare(
        `SELECT brief_json FROM sr_level_briefs WHERE source = ? AND brief_id = ?`
      )
      .get(input.source, input.brief.briefId) as { brief_json: string } | undefined;

    if (existing) {
      if (existing.brief_json === canonicalBrief) {
        store.db.exec("COMMIT");
        return { briefId: input.brief.briefId, insertedCount: 0, status: "already_ingested" as const };
      }
      store.db.exec("ROLLBACK");
      throw new LedgerWriteError(
        LEDGER_ERROR_CODES.SR_LEVEL_BRIEF_CONFLICT,
        `S/R level brief conflict for source "${input.source}", briefId "${input.brief.briefId}".`
      );
    }

    store.db
      .prepare(
        `INSERT INTO sr_level_briefs (source, brief_id, symbol, source_recorded_at_iso, summary, brief_json, captured_at_unix_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.source,
        input.brief.briefId,
        input.symbol,
        input.brief.sourceRecordedAtIso ?? null,
        input.brief.summary ?? null,
        canonicalBrief,
        capturedAtUnixMs
      );

    const briefRow = store.db
      .prepare(`SELECT id FROM sr_level_briefs WHERE source = ? AND brief_id = ?`)
      .get(input.source, input.brief.briefId) as { id: number };

    const insertLevel = store.db.prepare(
      `INSERT INTO sr_levels (brief_id, level_type, price, timeframe, rank, invalidation, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    let insertedCount = 0;
    for (const level of input.levels) {
      insertLevel.run(
        briefRow.id,
        level.levelType,
        level.price,
        level.timeframe ?? null,
        level.rank ?? null,
        level.invalidation ?? null,
        level.notes ?? null
      );
      insertedCount++;
    }

    store.db.exec("COMMIT");
    return { briefId: input.brief.briefId, insertedCount };
  } catch (error) {
    try { store.db.exec("ROLLBACK"); } catch (_rollbackError) { void _rollbackError }
    throw error;
  }
};

const mapLevel = (l: {
  price: number;
  rank: string | null;
  timeframe: string | null;
  invalidation: number | null;
  notes: string | null;
}): SrLevelResponse => {
  const entry: SrLevelResponse = { price: l.price };
  if (l.rank !== null) entry.rank = l.rank;
  if (l.timeframe !== null) entry.timeframe = l.timeframe;
  if (l.invalidation !== null) entry.invalidation = l.invalidation;
  if (l.notes !== null) entry.notes = l.notes;
  return entry;
};

export const getCurrentSrLevels = (
  store: LedgerStore,
  symbol: string,
  source: string
): SrLevelsCurrentResponse | null => {
  const briefRow = store.db
    .prepare(
      `SELECT id, brief_id, source_recorded_at_iso, summary, captured_at_unix_ms
       FROM sr_level_briefs
       WHERE symbol = ? AND source = ?
       ORDER BY captured_at_unix_ms DESC
       LIMIT 1`
    )
    .get(symbol, source) as {
      id: number;
      brief_id: string;
      source_recorded_at_iso: string | null;
      summary: string | null;
      captured_at_unix_ms: number;
    } | undefined;

  if (!briefRow) {
    return null;
  }

  const levels = store.db
    .prepare(`SELECT level_type, price, timeframe, rank, invalidation, notes FROM sr_levels WHERE brief_id = ?`)
    .all(briefRow.id) as Array<{
      level_type: string;
      price: number;
      timeframe: string | null;
      rank: string | null;
      invalidation: number | null;
      notes: string | null;
    }>;

  const supports = levels
    .filter((l) => l.level_type === "support")
    .sort((a, b) => a.price - b.price)
    .map(mapLevel);

  const resistances = levels
    .filter((l) => l.level_type === "resistance")
    .sort((a, b) => a.price - b.price)
    .map(mapLevel);

  return {
    schemaVersion: SCHEMA_VERSION,
    source,
    symbol,
    briefId: briefRow.brief_id,
    sourceRecordedAtIso: briefRow.source_recorded_at_iso,
    summary: briefRow.summary,
    capturedAtIso: new Date(briefRow.captured_at_unix_ms).toISOString(),
    supports,
    resistances
  };
};