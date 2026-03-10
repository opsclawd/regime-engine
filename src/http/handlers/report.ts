import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { type LedgerStore } from "../../ledger/store.js";
import {
  generateWeeklyReport,
  ReportRangeError
} from "../../report/weekly.js";

const invalidReportRangeResponse = (message: string) => ({
  schemaVersion: SCHEMA_VERSION,
  error: {
    code: "INVALID_REPORT_RANGE",
    message,
    details: []
  }
});

export const createWeeklyReportHandler = (store: LedgerStore) => {
  return async (
    request: FastifyRequest<{
      Querystring: {
        from?: string;
        to?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    const from = request.query.from;
    const to = request.query.to;

    if (!from || !to) {
      return reply.code(400).send(
        invalidReportRangeResponse(
          "Query params from and to are required in YYYY-MM-DD format."
        )
      );
    }

    try {
      const report = generateWeeklyReport({
        store,
        from,
        to
      });

      return reply.code(200).send({
        schemaVersion: SCHEMA_VERSION,
        markdown: report.markdown,
        summary: report.summary
      });
    } catch (error) {
      if (error instanceof ReportRangeError) {
        return reply.code(400).send(invalidReportRangeResponse(error.message));
      }

      throw error;
    }
  };
};
