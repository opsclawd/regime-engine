import { describe, expect, it } from "vitest";
import { createRecordClmmExecutionResultUseCase } from "../recordClmmExecutionResultUseCase.js";
import { FakeClmmExecutionEventLedgerWritePort } from "./fakes/fakeClmmExecutionEventLedgerWritePort.js";
import { ClmmExecutionEventConflictError } from "../../errors/ledgerErrors.js";
import type { ClmmExecutionEventRequest } from "../../../contract/v1/types.js";

const baseBody = (): ClmmExecutionEventRequest => ({
  schemaVersion: "1.0",
  correlationId: "corr-001",
  positionId: "pos-001",
  breachDirection: "LowerBoundBreach",
  reconciledAtIso: "2025-04-17T12:00:00Z",
  txSignature: "sig-abc123",
  tokenOut: "USDC",
  status: "confirmed"
});

describe("RecordClmmExecutionResultUseCase", () => {
  it("returns success body on inserted outcome", async () => {
    const port = new FakeClmmExecutionEventLedgerWritePort();
    port.setNextOutcome({ kind: "inserted" });
    const useCase = createRecordClmmExecutionResultUseCase({ port });

    const body = baseBody();
    const response = await useCase(body);

    expect(response).toEqual({
      schemaVersion: "1.0",
      ok: true,
      correlationId: "corr-001"
    });
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0].event).toBe(body);
  });

  it("returns idempotent: true on idempotent outcome", async () => {
    const port = new FakeClmmExecutionEventLedgerWritePort();
    port.setNextOutcome({ kind: "idempotent" });
    const useCase = createRecordClmmExecutionResultUseCase({ port });

    const response = await useCase(baseBody());

    expect(response).toEqual({
      schemaVersion: "1.0",
      ok: true,
      correlationId: "corr-001",
      idempotent: true
    });
  });

  it("throws ClmmExecutionEventConflictError on correlation conflict", async () => {
    const port = new FakeClmmExecutionEventLedgerWritePort();
    port.setNextOutcome({
      kind: "clmm-correlation-conflict",
      message: 'CLMM execution event conflict for correlationId "corr-001".'
    });
    const useCase = createRecordClmmExecutionResultUseCase({ port });

    await expect(useCase(baseBody())).rejects.toThrow(ClmmExecutionEventConflictError);
    await expect(useCase(baseBody())).rejects.toThrow(
      'CLMM execution event conflict for correlationId "corr-001".'
    );
  });
});
