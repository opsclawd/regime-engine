import type {
  ClmmExecutionEventLedgerOutcome,
  ClmmExecutionEventLedgerWritePort
} from "../../../ports/executionLedgerPort.js";
import type { ClmmExecutionEventRequest } from "../../../../contract/v1/types.js";

export class FakeClmmExecutionEventLedgerWritePort implements ClmmExecutionEventLedgerWritePort {
  public calls: Array<{ event: ClmmExecutionEventRequest }> = [];
  private nextOutcome: ClmmExecutionEventLedgerOutcome = { kind: "inserted" };

  public setNextOutcome(outcome: ClmmExecutionEventLedgerOutcome): void {
    this.nextOutcome = outcome;
  }

  async recordClmmExecutionEvent(input: {
    event: ClmmExecutionEventRequest;
  }): Promise<ClmmExecutionEventLedgerOutcome> {
    this.calls.push({ event: input.event });
    return this.nextOutcome;
  }
}
