import { sql } from "drizzle-orm";
import type { Db } from "../../ledger/pg/db.js";
import type {
  RawObservation,
  RawObservationsReadPort
} from "../../application/ports/rawObservationsReadPort.js";
import { EvidenceStoreUnavailableError } from "../../application/errors/evidenceErrors.js";

export const createPostgresRawObservationsReadAdapter = (db: Db): RawObservationsReadPort => {
  return {
    getByRunId: async (runId: string): Promise<readonly RawObservation[]> => {
      try {
        const rows = await db.execute(sql`
          SELECT to_jsonb(raw_observation) AS observation
          FROM intelligence.raw_observations AS raw_observation
          WHERE raw_observation.source_request_meta->>'intelligencePipelineRunId' = ${runId}
             OR raw_observation.source_request_meta->>'runId' = ${runId}
          ORDER BY to_jsonb(raw_observation)::text
        `);

        const observations: RawObservation[] = [];
        for (const row of rows as unknown as Array<{ observation: unknown }>) {
          const obs = row.observation;
          if (obs === null || typeof obs !== "object" || Array.isArray(obs)) {
            throw new Error(
              `Malformed raw observation row: expected non-null, non-array object, got ${typeof obs}`
            );
          }
          observations.push(obs as RawObservation);
        }

        return observations;
      } catch (error) {
        if (error instanceof EvidenceStoreUnavailableError) {
          throw error;
        }
        throw new EvidenceStoreUnavailableError(undefined, { cause: error });
      }
    }
  };
};
