import { describe, expect, it } from "vitest";
import { buildApplication } from "../buildApplication.js";
import { createLedgerStore } from "../../ledger/store.js";
import { SqlitePlanLedgerReadAdapter } from "../../adapters/sqlite/sqlitePlanLedgerReadAdapter.js";

describe("positionPolicyInsightWiring composition", () => {
  it("SQLite-only composition retains plan and evidence behavior without a queue", () => {
    const ledger = createLedgerStore(":memory:");

    const app = buildApplication({
      ledger,
      pg: null,
      candleStore: null,
      srThesesV2Store: null,
      close: async () => {}
    });

    expect(app.planLedgerReadPort).toBeInstanceOf(SqlitePlanLedgerReadAdapter);
    expect(app.positionPolicyInsightSynthesisQueue).toBeNull();
    expect(app.requestPositionPolicyInsightSynthesis).toBeNull();
    expect(app.ingestEvidenceBundle).toBeNull();
    expect(app.generatePlan).toBeDefined();

    ledger.close();
  });

  it("wires Postgres queue and synthesis requester when pg context is present", () => {
    const ledger = createLedgerStore(":memory:");
    const fakePg = {} as unknown as NonNullable<Parameters<typeof buildApplication>[0]["pg"]>;

    const app = buildApplication({
      ledger,
      pg: fakePg,
      candleStore: null,
      srThesesV2Store: null,
      close: async () => {}
    });

    expect(app.planLedgerReadPort).toBeInstanceOf(SqlitePlanLedgerReadAdapter);
    expect(app.positionPolicyInsightSynthesisQueue).not.toBeNull();
    expect(app.requestPositionPolicyInsightSynthesis).not.toBeNull();
    expect(app.ingestEvidenceBundle).not.toBeNull();
    expect(app.generatePlan).toBeDefined();

    ledger.close();
  });
});
