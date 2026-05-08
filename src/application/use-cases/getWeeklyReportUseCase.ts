import type { WeeklyReportOutput, WeeklyReportReadPort } from "../ports/weeklyReportReadPort.js";

export type GetWeeklyReportUseCase = (input: {
  from: string;
  to: string;
}) => Promise<WeeklyReportOutput>;

export interface GetWeeklyReportUseCaseDeps {
  port: WeeklyReportReadPort;
}

export const createGetWeeklyReportUseCase = (
  deps: GetWeeklyReportUseCaseDeps
): GetWeeklyReportUseCase => {
  return async (input) => {
    return deps.port.getWeeklyReport(input);
  };
};
