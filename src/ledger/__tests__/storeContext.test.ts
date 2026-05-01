import { describe, expect, it, vi } from "vitest";
import { closeStoreContext } from "../storeContext.js";
import type { StoreContext } from "../storeContext.js";

describe("StoreContext", () => {
  it("holds both ledger and pg stores", () => {
    const ctx: StoreContext = {
      ledger: {
        db: {} as never,
        path: ":memory:",
        close: () => {}
      },
      pg: {} as never,
      pgClient: {
        end: async () => {}
      } as never,
      candleStore: {} as never,
      insightsStore: {} as never,
      srThesesV2Store: {} as never
    };

    expect(ctx.ledger).toBeDefined();
    expect(ctx.pg).toBeDefined();
    expect(ctx.pgClient).toBeDefined();
    expect(typeof ctx.ledger.close).toBe("function");
  });

  it("closeStoreContext closes both ledger and pgClient", async () => {
    const ledgerClose = vi.fn();
    const pgClientEnd = vi.fn();

    const ctx: StoreContext = {
      ledger: {
        db: {} as never,
        path: ":memory:",
        close: ledgerClose
      },
      pg: {} as never,
      pgClient: { end: pgClientEnd } as never,
      candleStore: {} as never,
      insightsStore: {} as never,
      srThesesV2Store: {} as never
    };

    await closeStoreContext(ctx);

    expect(ledgerClose).toHaveBeenCalledOnce();
    expect(pgClientEnd).toHaveBeenCalledOnce();
  });

  it("closeStoreContext closes pgClient even if ledger.close throws", async () => {
    const ledgerClose = vi.fn(() => {
      throw new Error("ledger close failed");
    });
    const pgClientEnd = vi.fn();

    const ctx: StoreContext = {
      ledger: {
        db: {} as never,
        path: ":memory:",
        close: ledgerClose
      },
      pg: {} as never,
      pgClient: { end: pgClientEnd } as never,
      candleStore: {} as never,
      insightsStore: {} as never,
      srThesesV2Store: {} as never
    };

    await expect(closeStoreContext(ctx)).rejects.toThrow("ledger close failed");
    expect(pgClientEnd).toHaveBeenCalledOnce();
  });
});
