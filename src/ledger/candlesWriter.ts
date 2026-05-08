import type {
  CandleIngestRequest,
  CandleIngestResponse,
  CandleRow,
  GetLatestCandlesParams
} from "../contract/v1/types.js";
import type { LedgerStore } from "./store.js";
import { createSqliteCandleRevisionUnitOfWork } from "../adapters/sqlite/SqliteCandleRevisionUnitOfWork.js";
import { createSqliteCandleReadAdapter } from "../adapters/sqlite/SqliteCandleReadAdapter.js";
import { createIngestCandlesUseCase } from "../application/use-cases/IngestCandlesUseCase.js";

export type { GetLatestCandlesParams, CandleRow };

export const writeCandles = async (
  store: LedgerStore,
  input: CandleIngestRequest,
  receivedAtUnixMs: number
): Promise<Omit<CandleIngestResponse, "schemaVersion">> => {
  const useCase = createIngestCandlesUseCase({
    candleWritePort: createSqliteCandleRevisionUnitOfWork(store)
  });
  return useCase(input, receivedAtUnixMs);
};

export const getLatestCandlesForFeed = async (
  store: LedgerStore,
  params: GetLatestCandlesParams
): Promise<CandleRow[]> => {
  return createSqliteCandleReadAdapter(store).getLatestCandlesForFeed(params);
};
