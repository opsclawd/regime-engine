import type { Db } from "./pg/db.js";
import type {
  CandleIngestRequest,
  CandleIngestResponse,
  CandleRow,
  GetLatestCandlesParams
} from "../contract/v1/types.js";
import { createPostgresCandleRevisionUnitOfWork } from "../adapters/postgres/PostgresCandleRevisionUnitOfWork.js";
import { createPostgresCandleReadAdapter } from "../adapters/postgres/PostgresCandleReadAdapter.js";
import { createIngestCandlesUseCase } from "../application/use-cases/IngestCandlesUseCase.js";

export type { GetLatestCandlesParams, CandleRow };

export class CandleStore {
  constructor(private db: Db) {}

  async writeCandles(
    input: CandleIngestRequest,
    receivedAtUnixMs: number
  ): Promise<Omit<CandleIngestResponse, "schemaVersion">> {
    const useCase = createIngestCandlesUseCase({
      candleWritePort: createPostgresCandleRevisionUnitOfWork(this.db)
    });
    return useCase(input, receivedAtUnixMs);
  }

  async getLatestCandlesForFeed(params: GetLatestCandlesParams): Promise<CandleRow[]> {
    return createPostgresCandleReadAdapter(this.db).getLatestCandlesForFeed(params);
  }
}
