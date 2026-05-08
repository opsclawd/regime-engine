export class ReportRangeApplicationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ReportRangeApplicationError";
  }
}
