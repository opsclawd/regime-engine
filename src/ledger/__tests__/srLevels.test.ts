import { afterEach, describe, expect, it } from "vitest";
import { createLedgerStore, getLedgerCounts } from "../store.js";
import { writeSrLevelBrief, getCurrentSrLevels } from "../srLevelsWriter.js";
import { LEDGER_ERROR_CODES, LedgerWriteError } from "../writer.js";
import type { SrLevelBriefRequest } from "../../contract/v1/types.js";

const makeBriefRequest = (overrides: Partial<SrLevelBriefRequest> = {}): SrLevelBriefRequest => {
  return {
    schemaVersion: "1.0",
    source: "clmm-analyzer",
    symbol: "SOLUSDC",
    brief: {
      briefId: "brief-001",
      sourceRecordedAtIso: "2025-04-17T12:00:00Z",
      summary: "Test brief"
    },
    levels: [
      { levelType: "support", price: 140.5 },
      { levelType: "resistance", price: 180.25, rank: "strong", timeframe: "1h" }
    ],
    ...overrides
  };
};

describe("srLevelsWriter", () => {
  let store: ReturnType<typeof createLedgerStore>;

  afterEach(() => {
    store?.close();
  });

  it("writes a brief with levels and verifies rows", () => {
    store = createLedgerStore(":memory:");
    const input = makeBriefRequest();
    const result = writeSrLevelBrief(store, input, 1_700_000_000_000);

    expect(result).toEqual({
      briefId: "brief-001",
      insertedCount: 2
    });

    expect(getLedgerCounts(store)).toEqual(
      expect.objectContaining({
        srLevelBriefs: 1,
        srLevels: 2
      })
    );
  });

  it("returns already_ingested for byte-equal re-write without new rows", () => {
    store = createLedgerStore(":memory:");
    const input = makeBriefRequest();
    writeSrLevelBrief(store, input, 1_700_000_000_000);

    const result = writeSrLevelBrief(store, input, 1_700_000_001_000);

    expect(result).toEqual({
      briefId: "brief-001",
      insertedCount: 0,
      status: "already_ingested"
    });

    expect(getLedgerCounts(store)).toEqual(
      expect.objectContaining({
        srLevelBriefs: 1,
        srLevels: 2
      })
    );
  });

  it("throws LedgerWriteError on same source+briefId with different levels", () => {
    store = createLedgerStore(":memory:");
    const input = makeBriefRequest();
    writeSrLevelBrief(store, input, 1_700_000_000_000);

    const conflictInput = makeBriefRequest({
      levels: [{ levelType: "support", price: 999 }]
    });

    expect(() => writeSrLevelBrief(store, conflictInput, 1_700_000_001_000)).toThrow(
      LedgerWriteError
    );

    try {
      writeSrLevelBrief(store, conflictInput, 1_700_000_002_000);
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerWriteError);
      expect((error as LedgerWriteError).code).toBe(LEDGER_ERROR_CODES.SR_LEVEL_BRIEF_CONFLICT);
    }
  });

  it("returns latest brief for getCurrentSrLevels with multiple briefs for same symbol+source", () => {
    store = createLedgerStore(":memory:");

    writeSrLevelBrief(
      store,
      makeBriefRequest({
        brief: { briefId: "brief-001", sourceRecordedAtIso: "2025-04-17T12:00:00Z" },
        levels: [{ levelType: "support", price: 140 }]
      }),
      1_700_000_000_000
    );

    writeSrLevelBrief(
      store,
      makeBriefRequest({
        brief: { briefId: "brief-002", sourceRecordedAtIso: "2025-04-18T12:00:00Z" },
        levels: [
          { levelType: "support", price: 150 },
          { levelType: "resistance", price: 200, rank: "strong" }
        ]
      }),
      1_700_001_000_000
    );

    const result = getCurrentSrLevels(store, "SOLUSDC", "clmm-analyzer");

    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe("1.0");
    expect(result!.symbol).toBe("SOLUSDC");
    expect(result!.source).toBe("clmm-analyzer");
    expect(result!.briefId).toBe("brief-002");
    expect(result!.sourceRecordedAtIso).toBe("2025-04-18T12:00:00Z");
    expect(result!.summary).toBeNull();
    expect(result!.capturedAtIso).toBe(new Date(1_700_001_000_000).toISOString());
    expect(result!.supports).toEqual([{ price: 150 }]);
    expect(result!.resistances).toEqual([{ price: 200, rank: "strong" }]);
  });

  it("returns null for nonexistent symbol+source", () => {
    store = createLedgerStore(":memory:");
    const result = getCurrentSrLevels(store, "SOLUSDC", "nonexistent");
    expect(result).toBeNull();
  });

  it("returns full response shape with invalidation, notes, sourceRecordedAtIso, and summary", () => {
    store = createLedgerStore(":memory:");

    writeSrLevelBrief(
      store,
      makeBriefRequest({
        brief: {
          briefId: "brief-full",
          sourceRecordedAtIso: "2025-04-17T10:00:00Z",
          summary: "Market turning bullish"
        },
        levels: [
          { levelType: "support", price: 130, invalidation: 120, notes: "Key demand zone" },
          {
            levelType: "resistance",
            price: 190,
            rank: "major",
            timeframe: "4h",
            invalidation: 200,
            notes: "Double top"
          }
        ]
      }),
      1_700_000_000_000
    );

    const result = getCurrentSrLevels(store, "SOLUSDC", "clmm-analyzer");

    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe("1.0");
    expect(result!.briefId).toBe("brief-full");
    expect(result!.sourceRecordedAtIso).toBe("2025-04-17T10:00:00Z");
    expect(result!.summary).toBe("Market turning bullish");
    expect(result!.capturedAtIso).toBe(new Date(1_700_000_000_000).toISOString());
    expect(result!.supports).toEqual([{ price: 130, invalidation: 120, notes: "Key demand zone" }]);
    expect(result!.resistances).toEqual([
      { price: 190, rank: "major", timeframe: "4h", invalidation: 200, notes: "Double top" }
    ]);
  });

  it("rolls back brief insertion when level insertion fails mid-transaction", () => {
    store = createLedgerStore(":memory:");
    const input = makeBriefRequest();

    const levelsWithInvalidType = {
      ...input,
      levels: [
        { levelType: "support" as const, price: 140.5 },
        { levelType: "invalid" as unknown as "support" | "resistance", price: 999 }
      ]
    };

    expect(() =>
      writeSrLevelBrief(store, levelsWithInvalidType as SrLevelBriefRequest, 1_700_000_000_000)
    ).toThrow();

    expect(getLedgerCounts(store)).toEqual(
      expect.objectContaining({
        srLevelBriefs: 0,
        srLevels: 0
      })
    );
  });
});
