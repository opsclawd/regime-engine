# HTTP Adapter Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `src/http/**` to `src/adapters/http/**` so the HTTP adapter lives where `architecture.md` says it should, while extracting contract validation error primitives out of HTTP and replacing the route registration's `ApplicationDependencies` import with an HTTP-owned dependency type — all without changing public behavior.

**Architecture:** Path-and-boundary refactor. Step 1 splits HTTP-owned contract error primitives into a neutral `src/contract/errors.ts` plus a v1-specific `src/contract/v1/errors.ts`. Step 2 introduces an HTTP-owned `HttpRouteDependencies` interface so route registration no longer pulls types from `src/composition/**`. Step 3 moves the entire HTTP tree to `src/adapters/http/**` and updates docs/dependency rules to match.

**Tech Stack:** TypeScript, Fastify, Zod, Vitest, dependency-cruiser. Existing Clean Architecture seam with `src/contract/**`, `src/application/**`, `src/composition/**`, `src/adapters/**`.

---

## File Structure

### New files

- `src/contract/errors.ts` — neutral, version-agnostic primitives:
  - `ErrorDetail` interface (with `code: string` so v1 and v2 envelopes can both use it)
  - `pathToString(path: Array<string | number>): string`
  - `stableSortDetails(details: ErrorDetail[]): ErrorDetail[]`
  - `zodIssueToDetails(issue: ZodIssue): ErrorDetail[]` (returns details using the same string codes both v1 and v2 already produce identically)
- `src/contract/v1/errors.ts` — v1-specific public error envelopes/factories:
  - `ERROR_CODES`, `ErrorCode`
  - `ERROR_DETAIL_CODES`, `ErrorDetailCode` (full v1 set, including `NO_SOURCE_CANDLES`, `NO_DERIVED_CANDLES_AFTER_AGGREGATION`)
  - `ErrorEnvelope` (v1)
  - `ContractValidationError`
  - `unsupportedSchemaVersionError`
  - `validationErrorFromZod` (uses neutral `zodIssueToDetails` + `stableSortDetails`)
  - `batchTooLargeError`, `malformedCandleError`, `duplicateCandleInBatchError`, `candlesNotFoundError`

### Files moved

- `src/http/auth.ts` → `src/adapters/http/auth.ts`
- `src/http/openapi.ts` → `src/adapters/http/openapi.ts`
- `src/http/routes.ts` → `src/adapters/http/routes.ts`
- `src/http/handlers/*.ts` → `src/adapters/http/handlers/*.ts`
- `src/http/handlers/__tests__/*.ts` → `src/adapters/http/handlers/__tests__/*.ts`
- `src/http/__tests__/*.ts` → `src/adapters/http/__tests__/*.ts`

### Files modified

- `src/contract/v1/validation.ts` — re-point error imports from `../../http/errors.js` to `./errors.js`.
- `src/contract/v1/insights.ts` — same re-point.
- `src/contract/v1/__tests__/validation.test.ts`, `insights.validation.test.ts`, `regimeCurrent.validation.test.ts`, `candles.validation.test.ts` — re-point to `../errors.js`.
- `src/contract/v2/errors.ts` — drop `../../http/errors.js` import; import `ErrorDetail`, `zodIssueToDetails`, `stableSortDetails` from `../errors.js`; replace `ERROR_DETAIL_CODES.INVALID_VALUE` with the literal `"INVALID_VALUE"`.
- `src/contract/v2/srLevels.ts` — drop `../../http/errors.js` import; replace `ERROR_DETAIL_CODES.INVALID_VALUE` with `"INVALID_VALUE"`.
- `src/http/routes.ts` (then moved) — define and use `HttpRouteDependencies`; remove `ApplicationDependencies` import.
- `src/composition/buildApp.ts` — re-point `registerRoutes` import from `../http/routes.js` to `../adapters/http/routes.js`.
- `package.json` — update three `src/http/__tests__/...` paths in `test:pg` to `src/adapters/http/__tests__/...`.
- `.dependency-cruiser.cjs` — add boundary rules for `src/adapters/http`, `contract` not importing `adapters`, etc.; remove rules referencing `src/http`.
- `architecture.md` — replace `src/http/` references with `src/adapters/http/**`.

### Files deleted

- `src/http/errors.ts` (split into `src/contract/errors.ts` + `src/contract/v1/errors.ts`).
- The `src/http/` directory itself (everything else moves).

---

## Task 1: Create neutral `src/contract/errors.ts`

**Files:**

- Create: `src/contract/errors.ts`

- [ ] **Step 1: Write the new neutral module**

Create `src/contract/errors.ts` with:

```typescript
import type { ZodIssue } from "zod";

export interface ErrorDetail {
  path: string;
  code: string;
  message: string;
}

export const pathToString = (path: Array<string | number>): string => {
  if (path.length === 0) {
    return "$";
  }

  let formatted = "$";
  for (const part of path) {
    if (typeof part === "number") {
      formatted += `[${part}]`;
      continue;
    }

    formatted += `.${part}`;
  }

  return formatted;
};

export const stableSortDetails = (details: ErrorDetail[]): ErrorDetail[] => {
  return [...details].sort((left, right) => {
    if (left.path !== right.path) {
      return left.path.localeCompare(right.path);
    }
    if (left.code !== right.code) {
      return left.code.localeCompare(right.code);
    }
    return left.message.localeCompare(right.message);
  });
};

export const zodIssueToDetails = (issue: ZodIssue): ErrorDetail[] => {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => ({
      path: pathToString([...issue.path, key]),
      code: "UNKNOWN_KEY",
      message: `Unexpected key: ${key}`
    }));
  }

  if (issue.code === "invalid_type") {
    if (issue.received === "undefined") {
      return [
        {
          path: pathToString(issue.path),
          code: "REQUIRED",
          message: "Field is required"
        }
      ];
    }

    return [
      {
        path: pathToString(issue.path),
        code: "INVALID_TYPE",
        message: `Expected ${issue.expected}, received ${issue.received}`
      }
    ];
  }

  if (
    issue.code === "invalid_literal" ||
    issue.code === "invalid_enum_value" ||
    issue.code === "invalid_string"
  ) {
    return [
      {
        path: pathToString(issue.path),
        code: "INVALID_VALUE",
        message: "Invalid value"
      }
    ];
  }

  if (issue.code === "too_small" || issue.code === "too_big") {
    return [
      {
        path: pathToString(issue.path),
        code: "OUT_OF_RANGE",
        message: "Value is out of range"
      }
    ];
  }

  return [
    {
      path: pathToString(issue.path),
      code: "INVALID_VALUE",
      message: "Invalid value"
    }
  ];
};
```

**Why neutral, why now:** The string codes used here (`UNKNOWN_KEY`, `REQUIRED`, `INVALID_TYPE`, `INVALID_VALUE`, `OUT_OF_RANGE`) are already produced identically by both v1 and v2 today — they are version-neutral by inspection. The typed `ERROR_DETAIL_CODES` enum (which adds v1-specific codes like `NO_SOURCE_CANDLES`) stays version-specific and lives in `src/contract/v1/errors.ts`.

- [ ] **Step 2: Run typecheck to confirm the new file compiles in isolation**

Run: `npm run typecheck`
Expected: PASS (this file does not break the existing graph; the old `src/http/errors.ts` is still present and unchanged at this point, so consumers continue to work).

- [ ] **Step 3: Commit**

```bash
git add src/contract/errors.ts
git commit -m "refactor: add neutral src/contract/errors.ts primitives"
```

---

## Task 2: Create v1-specific `src/contract/v1/errors.ts`

**Files:**

- Create: `src/contract/v1/errors.ts`

- [ ] **Step 1: Write the new v1 errors module**

Create `src/contract/v1/errors.ts` with:

```typescript
import type { ZodIssue } from "zod";
import { SCHEMA_VERSION, type SchemaVersion } from "./types.js";
import { type ErrorDetail, stableSortDetails, zodIssueToDetails } from "../errors.js";

export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_SCHEMA_VERSION: "UNSUPPORTED_SCHEMA_VERSION",
  BATCH_TOO_LARGE: "BATCH_TOO_LARGE",
  MALFORMED_CANDLE: "MALFORMED_CANDLE",
  DUPLICATE_CANDLE_IN_BATCH: "DUPLICATE_CANDLE_IN_BATCH",
  CANDLES_NOT_FOUND: "CANDLES_NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  SERVER_MISCONFIGURATION: "SERVER_MISCONFIGURATION",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INSIGHT_NOT_FOUND: "INSIGHT_NOT_FOUND",
  INSIGHT_RUN_CONFLICT: "INSIGHT_RUN_CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_DETAIL_CODES = {
  REQUIRED: "REQUIRED",
  INVALID_TYPE: "INVALID_TYPE",
  INVALID_VALUE: "INVALID_VALUE",
  OUT_OF_RANGE: "OUT_OF_RANGE",
  UNKNOWN_KEY: "UNKNOWN_KEY",
  NO_SOURCE_CANDLES: "NO_SOURCE_CANDLES",
  NO_DERIVED_CANDLES_AFTER_AGGREGATION: "NO_DERIVED_CANDLES_AFTER_AGGREGATION"
} as const;

export type ErrorDetailCode = (typeof ERROR_DETAIL_CODES)[keyof typeof ERROR_DETAIL_CODES];

export interface ErrorEnvelope {
  schemaVersion: SchemaVersion;
  error: {
    code: ErrorCode;
    message: string;
    details: ErrorDetail[];
  };
}

export class ContractValidationError extends Error {
  public readonly statusCode: number;
  public readonly response: ErrorEnvelope;

  public constructor(statusCode: number, response: ErrorEnvelope) {
    super(response.error.message);
    this.statusCode = statusCode;
    this.response = response;
  }
}

export const unsupportedSchemaVersionError = (receivedVersion: string): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: {
      code: ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      message: `Unsupported schemaVersion "${receivedVersion}". Expected "${SCHEMA_VERSION}".`,
      details: [
        {
          path: "$.schemaVersion",
          code: ERROR_DETAIL_CODES.INVALID_VALUE,
          message: "Invalid value"
        }
      ]
    }
  });
};

export const validationErrorFromZod = (
  message: string,
  issues: ZodIssue[]
): ContractValidationError => {
  const details = stableSortDetails(issues.flatMap((issue) => zodIssueToDetails(issue)));

  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: {
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      details
    }
  });
};

export const batchTooLargeError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.BATCH_TOO_LARGE, message, details }
  });
};

export const malformedCandleError = (
  message: string,
  details: ErrorDetail[]
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.MALFORMED_CANDLE, message, details }
  });
};

export const duplicateCandleInBatchError = (
  message: string,
  details: ErrorDetail[]
): ContractValidationError => {
  return new ContractValidationError(400, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.DUPLICATE_CANDLE_IN_BATCH, message, details }
  });
};

export const candlesNotFoundError = (
  message: string,
  details: ErrorDetail[] = []
): ContractValidationError => {
  return new ContractValidationError(404, {
    schemaVersion: SCHEMA_VERSION,
    error: { code: ERROR_CODES.CANDLES_NOT_FOUND, message, details }
  });
};
```

This is byte-for-byte the same factory behavior as `src/http/errors.ts` today, only re-homed and re-using neutral helpers from `../errors.js`.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no consumer is wired to this yet; old `src/http/errors.ts` is still authoritative).

- [ ] **Step 3: Commit**

```bash
git add src/contract/v1/errors.ts
git commit -m "refactor: add src/contract/v1/errors.ts owning v1 contract envelopes"
```

---

## Task 3: Make `src/http/errors.ts` re-export from the new contract modules

**Files:**

- Modify: `src/http/errors.ts`

This is a transitional shim so existing handlers and tests continue to work unchanged while we migrate consumers.

- [ ] **Step 1: Replace contents of `src/http/errors.ts`**

Replace the entire file with:

```typescript
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
```

- [ ] **Step 2: Run typecheck and full test suite**

Run: `npm run typecheck && npm run test`
Expected: PASS — every consumer of `src/http/errors.js` (handlers, contract modules, tests) continues to receive the same symbols.

- [ ] **Step 3: Commit**

```bash
git add src/http/errors.ts
git commit -m "refactor: convert src/http/errors.ts to a re-export shim"
```

---

## Task 4: Re-point v1 contract modules to import from `./errors.js`

**Files:**

- Modify: `src/contract/v1/validation.ts`
- Modify: `src/contract/v1/insights.ts`

- [ ] **Step 1: Update `src/contract/v1/validation.ts`**

Change the top of the file from:

```typescript
import {
  ContractValidationError,
  batchTooLargeError,
  duplicateCandleInBatchError,
  malformedCandleError,
  unsupportedSchemaVersionError,
  validationErrorFromZod
} from "../../http/errors.js";
```

to:

```typescript
import {
  ContractValidationError,
  batchTooLargeError,
  duplicateCandleInBatchError,
  malformedCandleError,
  unsupportedSchemaVersionError,
  validationErrorFromZod
} from "./errors.js";
```

- [ ] **Step 2: Update `src/contract/v1/insights.ts`**

Change:

```typescript
import { unsupportedSchemaVersionError, validationErrorFromZod } from "../../http/errors.js";
```

to:

```typescript
import { unsupportedSchemaVersionError, validationErrorFromZod } from "./errors.js";
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm run test -- src/contract/`
Expected: PASS — same symbols, same behavior.

- [ ] **Step 4: Commit**

```bash
git add src/contract/v1/validation.ts src/contract/v1/insights.ts
git commit -m "refactor: re-point v1 contract modules to ./errors.js"
```

---

## Task 5: Re-point v1 contract tests to `../errors.js`

**Files:**

- Modify: `src/contract/v1/__tests__/validation.test.ts`
- Modify: `src/contract/v1/__tests__/insights.validation.test.ts`
- Modify: `src/contract/v1/__tests__/regimeCurrent.validation.test.ts`
- Modify: `src/contract/v1/__tests__/candles.validation.test.ts`

- [ ] **Step 1: In each test file, change `../../../http/errors.js` to `../errors.js`**

For each of the four files above, replace the existing `from "../../../http/errors.js"` (or `from "../../../http/errors"`) import lines so the symbols come from the v1 errors module:

- `validation.test.ts` becomes `import { ContractValidationError, ERROR_CODES } from "../errors.js";`
- `insights.validation.test.ts` becomes `import { ContractValidationError } from "../errors.js";`
- `regimeCurrent.validation.test.ts` becomes `import { ContractValidationError } from "../errors.js";`
- `candles.validation.test.ts` becomes `import { ContractValidationError } from "../errors.js";`

- [ ] **Step 2: Run the v1 contract tests**

Run: `npm run test -- src/contract/v1/`
Expected: PASS with the same number of passing tests as before.

- [ ] **Step 3: Commit**

```bash
git add src/contract/v1/__tests__/validation.test.ts \
        src/contract/v1/__tests__/insights.validation.test.ts \
        src/contract/v1/__tests__/regimeCurrent.validation.test.ts \
        src/contract/v1/__tests__/candles.validation.test.ts
git commit -m "refactor: re-point v1 contract tests to v1 errors module"
```

---

## Task 6: Re-point v2 contract modules off `src/http/errors.js`

**Files:**

- Modify: `src/contract/v2/errors.ts`
- Modify: `src/contract/v2/srLevels.ts`

The v2 modules currently use `ERROR_DETAIL_CODES.INVALID_VALUE` (a single member of a v1-typed enum) plus the neutral helpers `zodIssueToDetails` and `stableSortDetails`. We replace the typed enum reference with the literal `"INVALID_VALUE"` (preserves wire output exactly) and import neutral helpers from `../errors.js`.

- [ ] **Step 1: Update `src/contract/v2/errors.ts`**

Change the imports at the top from:

```typescript
import type { ZodIssue } from "zod";
import {
  type ErrorDetail,
  zodIssueToDetails,
  stableSortDetails,
  ERROR_DETAIL_CODES
} from "../../http/errors.js";
```

to:

```typescript
import type { ZodIssue } from "zod";
import { type ErrorDetail, zodIssueToDetails, stableSortDetails } from "../errors.js";
```

Then replace the single `ERROR_DETAIL_CODES.INVALID_VALUE` reference in `unsupportedSchemaVersionV2Error` with the string literal `"INVALID_VALUE"`. The resulting `unsupportedSchemaVersionV2Error` block reads:

```typescript
export const unsupportedSchemaVersionV2Error = (received: string): V2ContractValidationError => {
  return new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: V2_ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
      message: `Unsupported schemaVersion "${received}". Expected "${V2_SCHEMA_VERSION}".`,
      details: [
        {
          path: "$.schemaVersion",
          code: "INVALID_VALUE",
          message: "Invalid value"
        }
      ]
    }
  });
};
```

Leave every other v2 export (`V2_SCHEMA_VERSION`, `V2_ERROR_CODES`, `V2ErrorEnvelope`, `V2ContractValidationError`, `validationErrorV2FromZod`, `validationErrorV2`, `serviceUnavailableV2Error`, `unauthorizedV2Error`, `serverMisconfigurationV2Error`, `srThesisV2NotFoundError`, `buildSrThesisV2ConflictEnvelope`, `internalErrorV2`) byte-identical.

- [ ] **Step 2: Update `src/contract/v2/srLevels.ts`**

Delete this import:

```typescript
import { ERROR_DETAIL_CODES } from "../../http/errors.js";
```

In the `duplicateThesisIdentityError` factory, replace `ERROR_DETAIL_CODES.INVALID_VALUE` with `"INVALID_VALUE"`. The resulting factory reads:

```typescript
const duplicateThesisIdentityError = (duplicateIndex: number): V2ContractValidationError =>
  new V2ContractValidationError(400, {
    schemaVersion: V2_SCHEMA_VERSION,
    error: {
      code: "VALIDATION_ERROR",
      message: "Duplicate thesis identity in request",
      details: [
        {
          path: `$.theses[${duplicateIndex}]`,
          code: "INVALID_VALUE",
          message:
            "Duplicate (source, symbol, briefId, asset, sourceHandle) within a single request is not allowed"
        }
      ]
    }
  });
```

- [ ] **Step 3: Run v2 contract tests and v2 e2e tests**

Run: `npm run test -- src/contract/v2/ src/http/__tests__/srLevelsV2.e2e.test.ts`
Expected: PASS. Wire output for v2 errors is unchanged because `"INVALID_VALUE"` is the same string the enum produced.

- [ ] **Step 4: Commit**

```bash
git add src/contract/v2/errors.ts src/contract/v2/srLevels.ts
git commit -m "refactor: re-point v2 contract modules off src/http/errors.js"
```

---

## Task 7: Verify `src/contract/**` no longer imports HTTP

**Files:**

- No source changes; verification step.

- [ ] **Step 1: Search for any remaining HTTP imports in contract**

Run: `rg "from \".*http/" src/contract/`
Expected: empty output (no matches).

Also run: `rg "from \".*adapters/http" src/contract/`
Expected: empty output.

- [ ] **Step 2: If matches appear, fix them before continuing**

Each remaining match means a contract file still imports adapter code. Move the symbol to either `src/contract/errors.ts` or `src/contract/v1/errors.ts` and re-point. Do **not** proceed to Task 8 until both rg invocations are empty.

- [ ] **Step 3: Run boundaries gate**

Run: `npm run boundaries`
Expected: PASS (existing rules already forbid `application` from importing `http`; the new contract layout does not violate any rule yet).

(No commit — verification only.)

---

## Task 8: Define `HttpRouteDependencies` in `src/http/routes.ts`

**Files:**

- Modify: `src/http/routes.ts`

The route file currently imports `ApplicationDependencies` from `src/composition/buildApplication.js`. Replace it with an HTTP-owned interface that lists exactly what route registration needs. `ApplicationDependencies` is a structural superset, so `buildApp` can keep passing the same object.

- [ ] **Step 1: Replace the file's imports and signature**

Open `src/http/routes.ts`. Remove this line:

```typescript
import type { ApplicationDependencies } from "../composition/buildApplication.js";
```

Add these new imports near the existing handler imports (group them together at the top):

```typescript
import type { ClockPort } from "../application/ports/clock.js";
import type { GetCurrentRegimeUseCase } from "../application/use-cases/getCurrentRegimeUseCase.js";
import type { GeneratePlanUseCase } from "../application/use-cases/generatePlanUseCase.js";
import type { IngestCandlesUseCase } from "../application/use-cases/ingestCandlesUseCase.js";
import type { RecordExecutionResultUseCase } from "../application/use-cases/recordExecutionResultUseCase.js";
import type { RecordClmmExecutionResultUseCase } from "../application/use-cases/recordClmmExecutionResultUseCase.js";
import type { GetWeeklyReportUseCase } from "../application/use-cases/getWeeklyReportUseCase.js";
import type { LedgerStore } from "../ledger/store.js";
import type { InsightsStore } from "../ledger/insightsStore.js";
import type { SrThesesV2Store } from "../ledger/srThesesV2Store.js";
```

Add the interface above `registerRoutes`:

```typescript
export interface VersionInfo {
  name: string;
  version: string;
  commit?: string;
}

export interface HealthResult {
  ok: boolean;
  postgres: "ok" | "unavailable" | "not_configured";
  sqlite: "ok" | "unavailable";
}

export interface HttpRouteDependencies {
  clock: ClockPort;
  ingestCandles: IngestCandlesUseCase;
  getCurrentRegime: GetCurrentRegimeUseCase;
  generatePlan: GeneratePlanUseCase;
  recordExecutionResult: RecordExecutionResultUseCase;
  recordClmmExecutionResult: RecordClmmExecutionResultUseCase;
  getWeeklyReport: GetWeeklyReportUseCase;
  ledgerStore: LedgerStore;
  insightsStore: InsightsStore | null;
  srThesesV2Store: SrThesesV2Store | null;
  versionInfo: VersionInfo;
  checkHealth(): Promise<HealthResult>;
}
```

Update the function signature:

```typescript
export const registerRoutes = (app: FastifyInstance, deps: HttpRouteDependencies): void => {
```

The body of `registerRoutes` does not change — it already references each field that `HttpRouteDependencies` declares.

**Why duplicate `VersionInfo` / `HealthResult` here:** `composition/buildApplication.ts` defines them today, but with HTTP forbidden from importing composition, HTTP must own its own structurally compatible declarations. `buildApplication`'s return type structurally satisfies `HttpRouteDependencies` — a `VersionInfo`-shaped object is still a `VersionInfo`-shaped object regardless of which module declared the interface, so no runtime change occurs.

- [ ] **Step 2: Update `src/composition/buildApplication.ts` to keep `VersionInfo` / `HealthResult` exports for any current consumers**

Run: `rg "VersionInfo|HealthResult" src/ --files-with-matches`

- If only `src/composition/buildApplication.ts` and `src/http/routes.ts` reference them, no change required (the two interfaces structurally match).
- If any other module imports these names from `composition/buildApplication.ts`, leave the composition exports as-is. They remain runtime-equivalent to the HTTP-owned ones.

- [ ] **Step 3: Run typecheck and full tests**

Run: `npm run typecheck && npm run test`
Expected: PASS. `buildApp` still passes `deps` (an `ApplicationDependencies` object) to `registerRoutes`; structural typing accepts it.

- [ ] **Step 4: Commit**

```bash
git add src/http/routes.ts
git commit -m "refactor: introduce HttpRouteDependencies in src/http/routes.ts"
```

---

## Task 9: Verify `src/http/**` no longer imports `src/composition/**`

**Files:**

- No source changes; verification step.

- [ ] **Step 1: Search for HTTP-to-composition imports**

Run: `rg "from \".*composition/" src/http/`
Expected: empty output.

- [ ] **Step 2: If matches appear, fix them before continuing**

Each match means a handler or route file still pulls a symbol from composition. Either copy the structural type into HTTP (as we did with `HttpRouteDependencies`) or have composition pass the value via the route dependencies object.

- [ ] **Step 3: Run boundaries gate**

Run: `npm run boundaries`
Expected: PASS.

(No commit — verification only.)

---

## Task 10: Move `src/http/auth.ts` to `src/adapters/http/auth.ts`

**Files:**

- Move: `src/http/auth.ts` → `src/adapters/http/auth.ts`

`auth.ts` is a leaf with one inner import (`../contract/v1/types.js`) so we move it first.

- [ ] **Step 1: Create the target directory and move the file**

Run:

```bash
mkdir -p src/adapters/http
git mv src/http/auth.ts src/adapters/http/auth.ts
```

- [ ] **Step 2: Update the relative import inside the moved file**

In `src/adapters/http/auth.ts`, change:

```typescript
import { SCHEMA_VERSION } from "../contract/v1/types.js";
```

to:

```typescript
import { SCHEMA_VERSION } from "../../contract/v1/types.js";
```

(Path depth grows by one; `../` becomes `../../`.)

- [ ] **Step 3: Update consumers that import `auth.ts`**

Run: `rg "from \".*http/auth" src/`
For every match (likely several handler files), change `../auth.js` to `../auth.js` (depth unchanged because handlers will move next), or fully-qualified imports `../../http/auth.js` to `../../adapters/http/auth.js`. Only HTTP siblings/handlers should reference auth, and they will move in subsequent tasks — for now, fix any cross-folder reference (e.g. `src/composition/`, `src/__tests__/`) so the suite still compiles.

Specifically:

- Inside still-unmoved `src/http/handlers/*.ts`, change any `from "../auth.js"` to `from "../../adapters/http/auth.js"` temporarily so they continue to resolve. (When the handlers move in Task 12 the path collapses back to `../auth.js`.)

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/http src/adapters/http
git commit -m "refactor: move src/http/auth.ts to src/adapters/http/"
```

---

## Task 11: Move `src/http/openapi.ts` to `src/adapters/http/openapi.ts`

**Files:**

- Move: `src/http/openapi.ts` → `src/adapters/http/openapi.ts`

`openapi.ts` has no inner imports; move it cleanly.

- [ ] **Step 1: Move the file**

Run:

```bash
git mv src/http/openapi.ts src/adapters/http/openapi.ts
```

- [ ] **Step 2: Update consumers**

Run: `rg "from \".*http/openapi" src/`
Update each match:

- Inside still-unmoved `src/http/routes.ts`, change `from "./openapi.js"` to `from "../adapters/http/openapi.js"` temporarily. (When routes moves in Task 13 this will collapse back to `./openapi.js`.)

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A src/http src/adapters/http
git commit -m "refactor: move src/http/openapi.ts to src/adapters/http/"
```

---

## Task 12: Move `src/http/handlers/**` to `src/adapters/http/handlers/**`

**Files:**

- Move: every file under `src/http/handlers/` → `src/adapters/http/handlers/`

- [ ] **Step 1: Move the handlers directory**

Run:

```bash
mkdir -p src/adapters/http/handlers
git mv src/http/handlers/*.ts src/adapters/http/handlers/
mkdir -p src/adapters/http/handlers/__tests__
git mv src/http/handlers/__tests__/*.ts src/adapters/http/handlers/__tests__/
rmdir src/http/handlers/__tests__ src/http/handlers
```

- [ ] **Step 2: Update internal imports inside each moved handler**

For each file under `src/adapters/http/handlers/` (and its `__tests__/`), update relative imports. The depth changes from `src/http/handlers/foo.ts` (two levels deep) to `src/adapters/http/handlers/foo.ts` (three levels deep), so every `../../X` becomes `../../../X`, every `../X` (sibling within HTTP) stays the same, and the temporary fully-qualified `../../adapters/http/auth.js` from Task 10 collapses back to `../auth.js`.

Concrete rewrites by file (verify after editing with `npm run typecheck`):

- `candlesIngest.ts`:
  - `import { ContractValidationError } from "../errors.js";` → `import { ContractValidationError } from "../../../contract/v1/errors.js";`
  - `import { parseCandleIngestRequest } from "../../contract/v1/validation.js";` → `import { parseCandleIngestRequest } from "../../../contract/v1/validation.js";`
  - Other `../../X` imports gain a `../`.
- `clmmExecutionResult.ts`:
  - `import { ContractValidationError } from "../errors.js";` → `import { ContractValidationError } from "../../../contract/v1/errors.js";`
  - All `../../X` → `../../../X`.
- `executionResult.ts`, `executionResult.stub.ts`, `plan.ts`, `plan.stub.ts`, `srLevelsIngest.ts`, `candlesIngest.ts`:
  - `from "../errors.js"` → `from "../../../contract/v1/errors.js"`
  - `from "../../X"` → `from "../../../X"`
- `regimeCurrent.ts`:
  - `import { candlesNotFoundError, ContractValidationError, type ErrorDetail } from "../errors.js";` → `import { candlesNotFoundError, ContractValidationError } from "../../../contract/v1/errors.js"; import type { ErrorDetail } from "../../../contract/errors.js";`
  - `from "../../application/..."` → `from "../../../application/..."`
- `insightsCurrent.ts`, `insightsHistory.ts`:
  - `import { ERROR_CODES } from "../errors.js";` → `import { ERROR_CODES } from "../../../contract/v1/errors.js";`
  - `from "../../X"` → `from "../../../X"`
- `insightsIngest.ts`:
  - `import { ContractValidationError, ERROR_CODES } from "../errors.js";` → `import { ContractValidationError, ERROR_CODES } from "../../../contract/v1/errors.js";`
  - `from "../../X"` → `from "../../../X"`
- `report.ts`:
  - `from "../../application/errors/reportErrors.js"` → `from "../../../application/errors/reportErrors.js"`
- `srLevelsV2Current.ts`, `srLevelsV2Ingest.ts`:
  - `from "../../contract/v2/errors.js"` → `from "../../../contract/v2/errors.js"`
  - `from "../../X"` (other) → `from "../../../X"`
- `srLevelsCurrent.ts`:
  - `from "../../X"` → `from "../../../X"` for any application-layer or ledger imports.

For the handler `__tests__` (`srLevelsV2Current.shape.test.ts`, `srLevelsV2Ingest.shape.test.ts`), only sibling imports are used (`from "../srLevelsV2Current.js"`); these remain unchanged.

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm run test`
Expected: PASS. If a path is still wrong, the typecheck will name the offending file; fix that import and rerun.

- [ ] **Step 4: Commit**

```bash
git add -A src/http src/adapters/http
git commit -m "refactor: move src/http/handlers to src/adapters/http/handlers"
```

---

## Task 13: Move `src/http/routes.ts` to `src/adapters/http/routes.ts`

**Files:**

- Move: `src/http/routes.ts` → `src/adapters/http/routes.ts`

- [ ] **Step 1: Move the file**

Run:

```bash
git mv src/http/routes.ts src/adapters/http/routes.ts
```

- [ ] **Step 2: Update internal imports inside the moved routes file**

In `src/adapters/http/routes.ts`:

- Handler imports remain `./handlers/X.js` (siblings; unchanged).
- The OpenAPI import collapses from the temporary `../adapters/http/openapi.js` (set in Task 11) back to `./openapi.js`.
- Application/ledger type imports change from `../application/...` and `../ledger/...` to `../../application/...` and `../../ledger/...`.

Concretely the imports section becomes:

```typescript
import type { FastifyInstance, FastifyReply } from "fastify";
import { buildOpenApiDocument } from "./openapi.js";
import { createClmmExecutionResultHandler } from "./handlers/clmmExecutionResult.js";
import { createExecutionResultHandler } from "./handlers/executionResult.js";
import { createPlanHandler } from "./handlers/plan.js";
import { createWeeklyReportHandler } from "./handlers/report.js";
import { createCandlesIngestHandler } from "./handlers/candlesIngest.js";
import { createRegimeCurrentHandler } from "./handlers/regimeCurrent.js";
import { createSrLevelsIngestHandler } from "./handlers/srLevelsIngest.js";
import { createSrLevelsCurrentHandler } from "./handlers/srLevelsCurrent.js";
import { createInsightsIngestHandler } from "./handlers/insightsIngest.js";
import { createInsightsCurrentHandler } from "./handlers/insightsCurrent.js";
import { createInsightsHistoryHandler } from "./handlers/insightsHistory.js";
import { createSrLevelsV2IngestHandler } from "./handlers/srLevelsV2Ingest.js";
import { createSrLevelsV2CurrentHandler } from "./handlers/srLevelsV2Current.js";
import type { ClockPort } from "../../application/ports/clock.js";
import type { GetCurrentRegimeUseCase } from "../../application/use-cases/getCurrentRegimeUseCase.js";
import type { GeneratePlanUseCase } from "../../application/use-cases/generatePlanUseCase.js";
import type { IngestCandlesUseCase } from "../../application/use-cases/ingestCandlesUseCase.js";
import type { RecordExecutionResultUseCase } from "../../application/use-cases/recordExecutionResultUseCase.js";
import type { RecordClmmExecutionResultUseCase } from "../../application/use-cases/recordClmmExecutionResultUseCase.js";
import type { GetWeeklyReportUseCase } from "../../application/use-cases/getWeeklyReportUseCase.js";
import type { LedgerStore } from "../../ledger/store.js";
import type { InsightsStore } from "../../ledger/insightsStore.js";
import type { SrThesesV2Store } from "../../ledger/srThesesV2Store.js";
```

Body is unchanged from Task 8.

- [ ] **Step 3: Update `src/composition/buildApp.ts`**

Change:

```typescript
import { registerRoutes } from "../http/routes.js";
```

to:

```typescript
import { registerRoutes } from "../adapters/http/routes.js";
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npm run typecheck && npm run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/http src/adapters/http src/composition/buildApp.ts
git commit -m "refactor: move src/http/routes.ts to src/adapters/http/"
```

---

## Task 14: Move `src/http/__tests__/**` to `src/adapters/http/__tests__/**`

**Files:**

- Move: `src/http/__tests__/*.ts` → `src/adapters/http/__tests__/*.ts`

- [ ] **Step 1: Move the test directory**

Run:

```bash
mkdir -p src/adapters/http/__tests__
git mv src/http/__tests__/*.ts src/adapters/http/__tests__/
rmdir src/http/__tests__
```

- [ ] **Step 2: Update relative imports in each moved test**

The depth changes from `src/http/__tests__/foo.test.ts` (two levels deep) to `src/adapters/http/__tests__/foo.test.ts` (three levels deep). Update each test:

- `from "../../app.js"` → `from "../../../app.js"`
- `from "../../ledger/health.js"` → `from "../../../ledger/health.js"`
- Any other `../../X` → `../../../X`.

Apply this to: `candleFallback.e2e.test.ts`, `candles.e2e.test.ts`, `clmmExecutionResult.e2e.test.ts`, `executionResult.e2e.test.ts`, `health.probe.test.ts`, `insights.e2e.pg.test.ts`, `insights.e2e.test.ts`, `plan.e2e.test.ts`, `regimeCurrent.e2e.test.ts`, `routes.contract.test.ts`, `srLevels.e2e.test.ts`, `srLevelsV2.e2e.pg.test.ts`, `srLevelsV2.e2e.test.ts`, `storeContext.e2e.test.ts`.

- [ ] **Step 3: Run typecheck and full test suite**

Run: `npm run typecheck && npm run test`
Expected: PASS — same number of HTTP integration tests, all green.

- [ ] **Step 4: Commit**

```bash
git add -A src/http src/adapters/http
git commit -m "refactor: move src/http/__tests__ to src/adapters/http/__tests__"
```

---

## Task 15: Delete the now-empty `src/http/` directory and remaining shim

**Files:**

- Delete: `src/http/errors.ts` (the re-export shim from Task 3)
- Delete: `src/http/` directory

By this task, every consumer of `src/http/errors.js` has either moved into `src/adapters/http/**` (handlers and tests, which now import directly from `../../../contract/v1/errors.js`) or migrated off it (contract files, which import from `./errors.js` or `../errors.js`). The shim has no remaining importers.

- [ ] **Step 1: Verify no consumers remain**

Run: `rg "from \".*src/http/|\"\\.\\./http/|\"\\.\\./\\.\\./http/" src/`
Expected: empty output.

- [ ] **Step 2: Remove the directory**

Run:

```bash
git rm src/http/errors.ts
rmdir src/http 2>/dev/null || true
```

- [ ] **Step 3: Confirm no tracked source/test files remain under `src/http/**`\*\*

Run: `git ls-files src/http`
Expected: empty output.

- [ ] **Step 4: Run typecheck, tests, and boundaries**

Run: `npm run typecheck && npm run test && npm run boundaries`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete legacy src/http/ tree"
```

---

## Task 16: Update `package.json` `test:pg` paths

**Files:**

- Modify: `package.json`

The `test:pg` script names three HTTP test paths that have moved.

- [ ] **Step 1: Edit `package.json`**

In `package.json`, replace inside the `test:pg` script:

- `src/http/__tests__/storeContext.e2e.test.ts` → `src/adapters/http/__tests__/storeContext.e2e.test.ts`
- `src/http/__tests__/insights.e2e.pg.test.ts` → `src/adapters/http/__tests__/insights.e2e.pg.test.ts`
- `src/http/__tests__/srLevelsV2.e2e.pg.test.ts` → `src/adapters/http/__tests__/srLevelsV2.e2e.pg.test.ts`

Leave every other path in the script unchanged.

- [ ] **Step 2: Run `npm run test:pg` if Postgres is available**

Run: `npm run test:pg`
Expected: PASS. **If Postgres is unavailable locally**, document this in the PR description: name the script change, identify the three PG-sensitive HTTP suites, and state that they were left for CI.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update test:pg paths after HTTP adapter move"
```

---

## Task 17: Update `.dependency-cruiser.cjs` for the new layout

**Files:**

- Modify: `.dependency-cruiser.cjs`

The current rules forbid inner layers from importing `^src/(http|ledger|workers|adapters|composition|application)/`. Once `src/http/**` no longer exists, that union still covers the prohibition correctly via `^src/adapters/`. We add two missing rules: `contract` must not import `adapters`, and existing `adapters-no-composition-or-entry` already forbids the inverse direction.

- [ ] **Step 1: Add a `contract-no-adapters` rule**

In `.dependency-cruiser.cjs`, in the `forbidden` array, add:

```javascript
{
  name: "contract-no-adapters",
  comment:
    "src/contract/** describes wire types and validation. It must not import outer adapters or composition wiring.",
  severity: "error",
  from: { path: "^src/contract/" },
  to: {
    path: "^src/(adapters|composition|http|ledger|workers)/|^src/(app|server)\\.ts$"
  }
}
```

The `^src/http/` part of the `to` path is defensive — even after the move, no contract file should ever import that path again.

- [ ] **Step 2: Verify other rules still match the layout**

Read the existing `engine-no-outer-layers`, `domain-no-outer-layers`, and `application-no-outer-layers` rules. They include `^src/(http|...)`. Leave the `http` literal in those `to` regexes — it's harmless because no `src/http/**` files exist, and keeping it documents that inner layers may not import an HTTP adapter regardless of where it lives.

- [ ] **Step 3: Run boundaries**

Run: `npm run boundaries`
Expected: PASS. The new `contract-no-adapters` rule has nothing to flag because Task 7 already verified contract is clean.

- [ ] **Step 4: Commit**

```bash
git add .dependency-cruiser.cjs
git commit -m "chore: add contract-no-adapters dep-cruiser rule"
```

---

## Task 18: Update `architecture.md`

**Files:**

- Modify: `architecture.md`

The doc still names `src/http/` as a top-level adapter folder while also naming `src/adapters/http/**` as the target. Make the doc reflect the new live state.

- [ ] **Step 1: Update the project layout section**

In `architecture.md` around line 84, replace:

```
- `src/http/` (I/O adapter)
  - routes, handlers, error taxonomy, OpenAPI
```

with:

```
- `src/adapters/http/` (I/O adapter)
  - routes, handlers, auth, OpenAPI
```

- [ ] **Step 2: Update the "Inner layers must never import" list**

Around line 129, replace:

```
- `src/http/**`, `src/ledger/**`, `src/workers/**`,
  `src/adapters/**`, `src/composition/**`,
  `src/app.ts`, `src/server.ts`
```

with:

```
- `src/ledger/**`, `src/workers/**`,
  `src/adapters/**` (including `src/adapters/http/**`),
  `src/composition/**`, `src/app.ts`, `src/server.ts`
```

- [ ] **Step 3: Update the data-flow phrase if present**

Around line 189, the phrase "Return PlanResponse (HTTP adapter)" is still accurate; leave it.

- [ ] **Step 4: Add a note that contract validation errors live in `src/contract/`**

In the Architecture-boundaries Status section (around line 113), append a short bullet under "Today" or "Next" describing that contract validation error primitives now live under `src/contract/errors.ts` and `src/contract/v1/errors.ts` rather than `src/http/`.

- [ ] **Step 5: Commit**

```bash
git add architecture.md
git commit -m "docs: align architecture.md with src/adapters/http/** location"
```

---

## Task 19: Final validation

**Files:**

- No source changes; whole-tree validation.

- [ ] **Step 1: Verify there are no tracked files under `src/http/**`\*\*

Run: `git ls-files src/http`
Expected: empty.

- [ ] **Step 2: Verify `src/contract/**` does not import HTTP\*\*

Run: `rg "from \".*http/" src/contract/`
Expected: empty.

- [ ] **Step 3: Verify `src/adapters/http/**` does not import composition\*\*

Run: `rg "from \".*composition/" src/adapters/http/`
Expected: empty.

- [ ] **Step 4: Run the full validation matrix**

Run each of the following and confirm PASS for all:

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:pg` (if Postgres is available; otherwise document why in the PR)
- `npm run build`
- `npm run boundaries`

- [ ] **Step 5: Compare OpenAPI output before/after**

Because `src/adapters/http/openapi.ts` only changed location (no content), this should be a no-op:

```bash
node -e 'import("./dist/src/adapters/http/openapi.js").then(m => console.log(JSON.stringify(m.buildOpenApiDocument(), null, 2)))' > /tmp/openapi.after.json
git stash
node -e 'import("./dist/src/http/openapi.js").then(m => console.log(JSON.stringify(m.buildOpenApiDocument(), null, 2)))' > /tmp/openapi.before.json
git stash pop
diff /tmp/openapi.before.json /tmp/openapi.after.json
```

If `git stash` is impractical (because the move is already committed), instead compare the new build's `openapi.json` against the OpenAPI snapshot from `b6c2d55` (the merge base before this branch). Any diff must be explained as non-behavioral and called out in the PR. Expected diff: none.

- [ ] **Step 6: No commit (validation only). PR description checklist:**

When opening the PR, include:

- Summary of the three substantive changes (contract error split, `HttpRouteDependencies`, folder move).
- A statement that response bodies, status codes, error codes/messages/details, auth headers/envs, OpenAPI content, `/health` and `/version` shapes, SQLite/Postgres selection, Railway startup, and graceful shutdown were preserved.
- A list of `test:pg` results, or — if Postgres was unavailable locally — explicit names of the three PG-sensitive HTTP suites (`storeContext.e2e.test.ts`, `insights.e2e.pg.test.ts`, `srLevelsV2.e2e.pg.test.ts`) left to CI.

---

## Self-review notes (already addressed in the plan)

- **Spec coverage:** every spec section maps to tasks — contract error split (Tasks 1–7), HttpRouteDependencies (Task 8), HTTP→composition verification (Task 9), folder move (Tasks 10–15), boundary rules and docs (Tasks 16–18), validation matrix (Task 19).
- **No placeholders:** every step that changes code names the file and either includes the full new code or the exact symbol-by-symbol rewrite.
- **Type consistency:** `HttpRouteDependencies` references the same use-case and store types `ApplicationDependencies` already exposes; `VersionInfo` and `HealthResult` are duplicated in HTTP intentionally and structurally match the composition exports so `buildApp` passes the same object without casting.
