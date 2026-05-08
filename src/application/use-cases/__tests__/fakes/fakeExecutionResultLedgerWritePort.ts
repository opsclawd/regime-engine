import type {
  ExecutionResultLedgerOutcome,
  ExecutionResultLedgerWritePort
} from "../../../ports/executionLedgerPort.js";
import type { ExecutionResultRequest } from "../../../../contract/v1/types.js";

export class FakeExecutionResultLedgerWritePort implements ExecutionResultLedgerWritePort {
  public calls: Array<{ executionResult: ExecutionResultRequest }> = [];
  private nextOutcome: ExecutionResultLedgerOutcome = { kind: "inserted" };

  public setNextOutcome(outcome: ExecutionResultLedgerOutcome): void {
    this.nextOutcome = outcome;
  }

  async recordExecutionResult(input: {
    executionResult: ExecutionResultRequest;
  }): Promise<ExecutionResultLedgerOutcome> {
    this.calls.push({ executionResult: input.executionResult });
    return this.nextOutcome;
  }
}
