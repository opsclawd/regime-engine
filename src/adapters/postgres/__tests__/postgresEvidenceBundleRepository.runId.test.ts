import { describe, expect, it } from "vitest";
import { createPostgresEvidenceBundleRepository } from "../postgresEvidenceBundleRepository.js";
import { EvidenceStoreUnavailableError } from "../../../application/errors/evidenceErrors.js";
import type { Db } from "../../../ledger/pg/db.js";

const makeTransientDbError = (code: string, message = "connection refused") => {
  const err = new Error(message);
  (err as unknown as { code: string }).code = code;
  return err;
};

describe("postgresEvidenceBundleRepository.getRunIdById", () => {
  it("resolves an existing evidence bundle id to its run id", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ runId: "run-xyz-789" }]
          })
        })
      })
    } as unknown as Db;

    const repository = createPostgresEvidenceBundleRepository(mockDb);
    const runId = await repository.getRunIdById(42);

    expect(runId).toBe("run-xyz-789");
  });

  it("returns null when an evidence bundle id does not exist", async () => {
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => []
          })
        })
      })
    } as unknown as Db;

    const repository = createPostgresEvidenceBundleRepository(mockDb);
    const runId = await repository.getRunIdById(999);

    expect(runId).toBeNull();
  });

  it("maps transient bundle-id lookup failures to EvidenceStoreUnavailableError", async () => {
    const transientError = makeTransientDbError("ECONNREFUSED");
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              throw transientError;
            }
          })
        })
      })
    } as unknown as Db;

    const repository = createPostgresEvidenceBundleRepository(mockDb);
    const promise = repository.getRunIdById(42);

    await expect(promise).rejects.toThrow(EvidenceStoreUnavailableError);
    await promise.catch((err) => {
      expect(err.cause).toBe(transientError);
    });
  });
});
