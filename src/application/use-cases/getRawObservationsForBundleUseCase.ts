import type { EvidenceBundleRepositoryPort } from "../ports/evidenceBundleRepositoryPort.js";
import type { RawObservationsReadPort, RawObservation } from "../ports/rawObservationsReadPort.js";
import {
  RawObservationIdentifierValidationError,
  RawObservationsNotFoundError
} from "../errors/evidenceErrors.js";

export interface GetRawObservationsForBundleUseCaseDeps {
  evidenceRepository: EvidenceBundleRepositoryPort;
  rawObservations: RawObservationsReadPort;
}

export type GetRawObservationsForBundleUseCase = (input: { identifier: string }) => Promise<{
  runId: string;
  items: readonly RawObservation[];
}>;

const NUMERIC_ID_REGEX = /^\d+$/;

export const createGetRawObservationsForBundleUseCase = (
  deps: GetRawObservationsForBundleUseCaseDeps
): GetRawObservationsForBundleUseCase => {
  return async (input) => {
    const { identifier } = input;

    let targetRunId: string;

    if (NUMERIC_ID_REGEX.test(identifier)) {
      const numericId = Number(identifier);
      if (!Number.isSafeInteger(numericId) || numericId <= 0 || String(numericId) !== identifier) {
        throw new RawObservationIdentifierValidationError(
          `Invalid numeric bundle identifier: ${identifier}`
        );
      }

      const resolvedRunId = await deps.evidenceRepository.getRunIdById(numericId);
      targetRunId = resolvedRunId ?? identifier;
    } else {
      if (identifier.length === 0 || identifier.length > 256) {
        throw new RawObservationIdentifierValidationError(
          `Invalid run identifier length: ${identifier.length}`
        );
      }

      targetRunId = identifier;
    }

    const items = await deps.rawObservations.getByRunId(targetRunId);
    if (items.length === 0) {
      throw new RawObservationsNotFoundError(targetRunId);
    }

    return {
      runId: targetRunId,
      items
    };
  };
};
