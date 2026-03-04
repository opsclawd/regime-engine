import type { FastifyReply, FastifyRequest } from "fastify";
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
import { type LedgerStore } from "../../ledger/store.js";
import { generateWeeklyReport } from "../../report/weekly.js";

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
      return reply.code(400).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "INVALID_REPORT_RANGE",
          message: "Query params from and to are required in YYYY-MM-DD format.",
          details: []
        }
      });
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
      return reply.code(400).send({
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "INVALID_REPORT_RANGE",
          message: error instanceof Error ? error.message : "Invalid report range.",
          details: []
        }
      });
    }
  };
};
