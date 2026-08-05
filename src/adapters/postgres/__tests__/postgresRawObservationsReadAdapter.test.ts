import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { createPostgresRawObservationsReadAdapter } from "../postgresRawObservationsReadAdapter.js";
import { EvidenceStoreUnavailableError } from "../../../application/errors/evidenceErrors.js";
import type { Db } from "../../../ledger/pg/db.js";

describe("postgresRawObservationsReadAdapter", () => {
  it("returns raw observations for a run id in deterministic JSON order", async () => {
    let capturedQuery: SQL | null = null;
    const mockDb = {
      execute: async (query: SQL) => {
        capturedQuery = query;
        return [
          { observation: { alpha: 1, beta: "first" } },
          { observation: { alpha: 2, beta: "second" } }
        ];
      }
    } as unknown as Db;

    const adapter = createPostgresRawObservationsReadAdapter(mockDb);
    const result = await adapter.getByRunId("run-123");

    expect(result).toEqual([
      { alpha: 1, beta: "first" },
      { alpha: 2, beta: "second" }
    ]);
    expect(capturedQuery).not.toBeNull();

    const compiled = new PgDialect().sqlToQuery(capturedQuery!);
    expect(compiled.sql).toContain(
      "raw_observation.source_request_meta->>'intelligencePipelineRunId' = $1"
    );
    expect(compiled.sql).toContain("OR raw_observation.source_request_meta->>'runId' = $2");
    expect(compiled.sql).not.toContain("raw_observation.run_id");
    expect(compiled.params).toEqual(["run-123", "run-123"]);
  });

  it("returns an empty list when a run id has no raw observations", async () => {
    const mockDb = {
      execute: async () => []
    } as unknown as Db;

    const adapter = createPostgresRawObservationsReadAdapter(mockDb);
    const result = await adapter.getByRunId("empty-run");

    expect(result).toEqual([]);
  });

  it("rejects malformed raw-observation rows as unavailable", async () => {
    const malformedCases = [
      [{ observation: null }],
      [{ observation: [1, 2, 3] }],
      [{ observation: "scalar-string" }],
      [{ observation: 42 }],
      [{ observation: true }]
    ];

    for (const rows of malformedCases) {
      const mockDb = {
        execute: async () => rows
      } as unknown as Db;

      const adapter = createPostgresRawObservationsReadAdapter(mockDb);
      await expect(adapter.getByRunId("malformed-run")).rejects.toThrow(
        EvidenceStoreUnavailableError
      );
    }
  });

  it("maps raw-observation query failures to EvidenceStoreUnavailableError", async () => {
    const dbError = new Error("relation intelligence.raw_observations does not exist");
    const mockDb = {
      execute: async () => {
        throw dbError;
      }
    } as unknown as Db;

    const adapter = createPostgresRawObservationsReadAdapter(mockDb);
    const promise = adapter.getByRunId("error-run");

    await expect(promise).rejects.toThrow(EvidenceStoreUnavailableError);
    await promise.catch((err) => {
      expect(err.cause).toBe(dbError);
    });
  });
});
