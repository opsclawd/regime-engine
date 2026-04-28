import { describe, expect, it } from "vitest";
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
      } as never
    };

    expect(ctx.ledger).toBeDefined();
    expect(ctx.pg).toBeDefined();
    expect(ctx.pgClient).toBeDefined();
    expect(typeof ctx.ledger.close).toBe("function");
  });
});