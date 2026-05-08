import type {
  WeeklyReportOutput,
  WeeklyReportReadPort
} from "../../../ports/weeklyReportReadPort.js";

export class FakeWeeklyReportReadPort implements WeeklyReportReadPort {
  public calls: Array<{ from: string; to: string }> = [];
  private nextResult: WeeklyReportOutput | null = null;
  private nextError: Error | null = null;

  public setNextResult(output: WeeklyReportOutput): void {
    this.nextResult = output;
    this.nextError = null;
  }

  public setNextError(error: Error): void {
    this.nextError = error;
    this.nextResult = null;
  }

  async getWeeklyReport(input: { from: string; to: string }): Promise<WeeklyReportOutput> {
    this.calls.push({ from: input.from, to: input.to });
    if (this.nextError) {
      throw this.nextError;
    }
    if (this.nextResult) {
      return this.nextResult;
    }
    throw new Error("FakeWeeklyReportReadPort: no result configured");
  }
}
