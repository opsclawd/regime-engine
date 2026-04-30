import { describe, expect, it } from "vitest";
import { createLedgerStore } from "../store.js";

describe("createLedgerStore", () => {
  it("sets busy_timeout to 2000ms", () => {
    const store = createLedgerStore(":memory:");
    const row = store.db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    expect(row.timeout).toBe(2000);
    store.close();
  });
});
