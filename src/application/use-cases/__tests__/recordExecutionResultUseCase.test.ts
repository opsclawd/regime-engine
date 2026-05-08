import { describe, expect, it } from "vitest";
import { createRecordExecutionResultUseCase } from "../recordExecutionResultUseCase.js";
import { FakeExecutionResultLedgerWritePort } from "./fakes/fakeExecutionResultLedgerWritePort.js";
import {
  ExecutionResultConflictError,
  ExecutionResultPlanHashMismatchError,
  ExecutionResultPlanNotFoundError
} from "../../errors/ledgerErrors.js";
import type { ExecutionResultRequest } from "../../../contract/v1/types.js";

const baseBody = (): ExecutionResultRequest => ({
  schemaVersion: "1.0",
  planId: "plan-1",
  planHash: "hash-1",
  asOfUnixMs: 1_762_591_300_000,
  actionResults: [{ actionType: "REQUEST_REBALANCE", status: "SUCCESS" }],
  costs: { txFeesUsd: 0.05, priorityFeesUsd: 0.02, slippageUsd: 0.15 },
  portfolioAfter: { navUsd: 10_120, solUnits: 20.5, usdcUnits: 5_920 }
});

describe("RecordExecutionResultUseCase", () => {
  it("returns success body on inserted outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({ kind: "inserted" });
    const useCase = createRecordExecutionResultUseCase({ port });

    const body = baseBody();
    const response = await useCase(body);

    expect(response).toEqual({
      schemaVersion: "1.0",
      ok: true,
      linkedPlanId: "plan-1",
      linkedPlanHash: "hash-1"
    });
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0].executionResult).toBe(body);
  });

  it("returns idempotent: true on idempotent replay outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({ kind: "idempotent" });
    const useCase = createRecordExecutionResultUseCase({ port });

    const response = await useCase(baseBody());

    expect(response).toEqual({
      schemaVersion: "1.0",
      ok: true,
      linkedPlanId: "plan-1",
      linkedPlanHash: "hash-1",
      idempotent: true
    });
  });

  it("throws ExecutionResultPlanNotFoundError on plan-not-found outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({ kind: "plan-not-found", message: 'No plan found for planId "plan-1".' });
    const useCase = createRecordExecutionResultUseCase({ port });

    await expect(useCase(baseBody())).rejects.toThrow(ExecutionResultPlanNotFoundError);
    await expect(useCase(baseBody())).rejects.toThrow('No plan found for planId "plan-1".');
  });

  it("throws ExecutionResultPlanHashMismatchError on plan-hash-mismatch outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({
      kind: "plan-hash-mismatch",
      message: 'planHash mismatch for planId "plan-1".'
    });
    const useCase = createRecordExecutionResultUseCase({ port });

    await expect(useCase(baseBody())).rejects.toThrow(ExecutionResultPlanHashMismatchError);
    await expect(useCase(baseBody())).rejects.toThrow('planHash mismatch for planId "plan-1".');
  });

  it("throws ExecutionResultConflictError on execution-result-conflict outcome", async () => {
    const port = new FakeExecutionResultLedgerWritePort();
    port.setNextOutcome({
      kind: "execution-result-conflict",
      message: 'Execution result conflict for planId "plan-1".'
    });
    const useCase = createRecordExecutionResultUseCase({ port });

    await expect(useCase(baseBody())).rejects.toThrow(ExecutionResultConflictError);
    await expect(useCase(baseBody())).rejects.toThrow(
      'Execution result conflict for planId "plan-1".'
    );
  });
});
