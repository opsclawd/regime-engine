import type { WeeklyReportData } from "../../../ports/weeklyReportReadPort.js";

export interface WeeklyReportLedgerReadPort {
  getWeeklyReportData(input: { from: string; to: string }): Promise<WeeklyReportData>;
}

export class FakeWeeklyReportLedgerReadPort implements WeeklyReportLedgerReadPort {
  public calls: Array<{ from: string; to: string }> = [];
  private nextResult: WeeklyReportData | null = null;
  private nextError: Error | null = null;

  public setNextResult(data: WeeklyReportData): void {
    this.nextResult = data;
    this.nextError = null;
  }

  public setNextError(error: Error): void {
    this.nextError = error;
    this.nextResult = null;
  }

  async getWeeklyReportData(input: { from: string; to: string }): Promise<WeeklyReportData> {
    this.calls.push({ from: input.from, to: input.to });
    if (this.nextError) {
      throw this.nextError;
    }
    if (this.nextResult) {
      return this.nextResult;
    }
    throw new Error("FakeWeeklyReportLedgerReadPort: no result configured");
  }
}
