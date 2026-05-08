export type { ErrorDetail } from "../contract/errors.js";
export { pathToString, stableSortDetails, zodIssueToDetails } from "../contract/errors.js";

export {
  ERROR_CODES,
  ERROR_DETAIL_CODES,
  type ErrorCode,
  type ErrorDetailCode,
  type ErrorEnvelope,
  ContractValidationError,
  unsupportedSchemaVersionError,
  validationErrorFromZod,
  batchTooLargeError,
  malformedCandleError,
  duplicateCandleInBatchError,
  candlesNotFoundError
} from "../contract/v1/errors.js";
