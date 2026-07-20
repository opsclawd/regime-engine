# Task Context: Task 4

Title: Cut synthesis, persistence, current/history reads, and OpenAPI over atomically
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-63
Repository: opsclawd/regime-engine
Branch: ai/issue-63
Start Commit: 543eadf9bf435b01023d1cdabc973036a876c595

## Task Requirements

This is one vertical task because changing the required record shape on `PolicyInsightRepositoryPort` without its PostgreSQL implementation and all read/write callers would fail the automatic workspace typecheck gate. Do not split the port, adapter, or endpoint cutover into layer-only commits.

**Files:**

- Create: `drizzle/0007_mark_policy_insight_wire_contract.sql`
- Create: `drizzle/meta/0007_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Modify: `src/ledger/pg/schema/policyInsights.ts`
- Create: `src/ledger/pg/__tests__/policyInsightsWireContractMigration.test.ts`
- Modify: `src/application/ports/policyInsightRepositoryPort.ts`
- Modify: `src/adapters/postgres/postgresPolicyInsightRepository.ts`
- Modify: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts`
- Modify: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts`
- Modify: `src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts`
- Modify: `src/application/use-cases/synthesizePolicyInsightUseCase.ts`
- Modify: `src/application/use-cases/getCurrentPolicyInsightUseCase.ts`
- Modify: `src/application/use-cases/getPolicyInsightHistoryUseCase.ts`
- Modify: `src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts`
- Modify: `src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts`
- Modify: `src/engine/policy/synthesizePolicyInsight.ts`
- Modify: `src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts`
- Modify: `src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts`
- Modify: `src/engine/policy/__tests__/synthesizePolicyInsight.findings.test.ts`
- Modify: `src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts`
- Modify: `src/adapters/http/handlers/insightsCurrent.ts`
- Modify: `src/adapters/http/handlers/insightsHistory.ts`
- Modify: `src/adapters/http/openapi.ts`
- Modify: `src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts`
- Modify: `src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts`
- Create: `src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts`

**Exported API changes:** Change the required member shapes of the exported `policyInsights` table object and its inferred `PolicyInsightRow` and `PolicyInsightInsert` types (adding `wireContractSha256`), change the required member shapes of `NewPolicyInsightRecord` and `StoredPolicyInsight`, update `PolicyInsightRepositoryPort` inputs to carry the supported wire-contract digest, change `SynthesizePolicyInsightUseCase`, `GetCurrentPolicyInsightUseCase`, and `GetPolicyInsightHistoryUseCase` result types to canonical generated types, and remove the temporary legacy `synthesizePolicyInsight` export after all callers use `synthesizePolicyInsightV1`. No repository method is added without its PostgreSQL implementation in this task.

**Behavioral invariants (write these named tests first):**

- `leaves legacy rows unmodified with a null wire contract digest`.
- `inserts every new canonical row with the exact published schema digest`.
- `allows one canonical row beside a legacy row with the same synthesis input hash`.
- `returns an existing canonical row for a replay with the same digest ruleset and input hash`.
- `never returns an unmarked legacy row from current or history`.
- `orders canonical history by generatedAtUnixMs then id descending without gaps or duplicates`.
- `rejects a marked row whose content schema canonical bytes or hash are corrupt`.
- `returns 404 when a scope has only legacy rows`.
- `uses the injected current-read instant for evaluatedAt status and ageSeconds`.
- `uses one injected history-read instant for queriedAt and every item freshness`.
- `marks current and history items stale at the exact expiry boundary`.
- `keeps current and the first history item identical at the same query instant`.
- `accepts history limits through 100 and rejects 101`.
- `returns canonical items without payloadHash receivedAtIso legacy status or old field names`.
- `preserves existing 400 404 500 and 503 generic error envelopes`.
- `references the published root and history definition and uses published examples in OpenAPI`.

- [ ] **Step 1: Write the migration, repository, use-case, HTTP, and OpenAPI tests named above before changing production code.** Extend the existing focused files by their current responsibility; put schema migration shape checks in the new migration test and OpenAPI identity/example checks in the new OpenAPI test. The affected existing test files are below 500 lines; this task is a vertical implementation cutover rather than a test-only update.

- [ ] **Step 2: Run the non-PostgreSQL slice and confirm it fails on the legacy response and record types.**

  Run: `pnpm exec vitest run src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts`

  Expected: FAIL because current code returns legacy content, handler-owned freshness, and handwritten OpenAPI schemas.

- [ ] **Step 3: Add the additive migration and matching Drizzle metadata.** Add nullable `wire_contract_sha256 varchar(64)`, a digest-format check allowing null, drop/replace `uniq_policy_insights_synthesis_input` with uniqueness over `(schema_version, wire_contract_sha256, ruleset_version, synthesis_input_hash)`, and update current/history indexes for `(pair, scope_key, generated_at_unix_ms, id)` filtering. Do not update existing rows or their JSON/hashes.

- [ ] **Step 4: Change the port and PostgreSQL adapter in the same edit.** Make canonical write records require `wireContractSha256` and `PolicyInsightContent`; make loaded canonical records expose validated immutable content. Pass the digest into replay lookup, inserts, conflict lookup, current, and history. Filter reads on both `schema_version = 'policy-insight.v1'` and the supported digest. On row load, call `parsePolicyInsightContent`, recompute canonical bytes/hash, and throw `PolicyInsightValidationError` on mismatch before returning any data.

  The logical port shape is:

  ```ts
  interface NewPolicyInsightRecord {
    readonly wireContractSha256: string;
    readonly synthesisOutputJson: PolicyInsightContent;
    // existing immutable audit/fingerprint fields remain
  }

  repository.findBySynthesisInputHash({
    schemaVersion,
    wireContractSha256,
    rulesetVersion,
    synthesisInputHash
  });
  ```

- [ ] **Step 5: Cut synthesis over to canonical content.** Call `synthesizePolicyInsightV1`, add the precomputed `insightId`, parse the completed `PolicyInsightContent`, hash that content, and persist the exact schema digest. Remove all new-code imports of `InsightIngestRequest`, `parseInsightIngestRequest`, and `computeInsightCanonicalAndHash`. Preserve selected/excluded audit lineage internally. Remove the temporary legacy reducer export only after all tests/callers use the canonical function.

- [ ] **Step 6: Move freshness into the read use cases.** Current captures the clock once and returns `projectPolicyInsightRead(record.synthesisOutputJson, queriedAtUnixMs)`. History captures once, projects every record with the same instant, returns canonical `queriedAt`, `limit`, `items`, and opaque `nextCursor`, and validates the envelope. No handler may call `Date.now()` or infer policy fields.

- [ ] **Step 7: Make handlers transport-only and align pagination.** Current sends the use-case item unchanged. History sets `nextCursor` from the repository cursor, validates/sends the canonical envelope, and caps `limit` at 100. Keep generic error envelopes at schema `1.0` because they are outside PolicyInsight success payloads.

- [ ] **Step 8: Replace handwritten OpenAPI success shapes.** Import the JSON Schema and valid fixtures once. Register `PolicyInsightRead` from the root definition and `PolicyInsightHistoryResponse` from `$defs`, point current/history 200 responses at those components, and load examples from `current-pair.json` and `history.json`. Do not retain parallel field-by-field PolicyInsight success schemas.

- [ ] **Step 9: Run the focused unit/contract slice.**

  Run: `pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.findings.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts`

  Expected: PASS with no legacy PolicyInsight success fields.

- [ ] **Step 10: Run the focused PostgreSQL slice when `DATABASE_URL` is configured.**

  Run: `pnpm exec vitest run src/ledger/pg/__tests__/policyInsightsWireContractMigration.test.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts`

  Expected: PASS against a migrated disposable test database. If `DATABASE_URL` is absent, the established `skipIf` guards report the PG cases as skipped; do not substitute a production database.

- [ ] **Step 11: Commit the atomic vertical cutover.**

  ```bash
  git add drizzle/0007_mark_policy_insight_wire_contract.sql drizzle/meta src/ledger/pg/schema/policyInsights.ts src/ledger/pg/__tests__/policyInsightsWireContractMigration.test.ts src/application/ports/policyInsightRepositoryPort.ts src/adapters/postgres src/application/use-cases src/engine/policy src/adapters/http/handlers/insightsCurrent.ts src/adapters/http/handlers/insightsHistory.ts src/adapters/http/openapi.ts src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts
  git commit -m "m63: serve canonical policy insight v1"
  ```

## Repository Targets

### Expected Files
- drizzle/0007_mark_policy_insight_wire_contract.sql
- drizzle/meta/0007_snapshot.json
- drizzle/meta/_journal.json
- src/ledger/pg/schema/policyInsights.ts
- src/ledger/pg/__tests__/policyInsightsWireContractMigration.test.ts
- src/application/ports/policyInsightRepositoryPort.ts
- src/adapters/postgres/postgresPolicyInsightRepository.ts
- src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts
- src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts
- src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts
- src/application/use-cases/synthesizePolicyInsightUseCase.ts
- src/application/use-cases/getCurrentPolicyInsightUseCase.ts
- src/application/use-cases/getPolicyInsightHistoryUseCase.ts
- src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts
- src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts
- src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts
- src/engine/policy/synthesizePolicyInsight.ts
- src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts
- src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts
- src/engine/policy/__tests__/synthesizePolicyInsight.findings.test.ts
- src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts
- src/adapters/http/handlers/insightsCurrent.ts
- src/adapters/http/handlers/insightsHistory.ts
- src/adapters/http/openapi.ts
- src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts
- src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts
- src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts

## Validation Commands

```bash
pnpm exec vitest run src/engine/policy/__tests__/synthesizePolicyInsight.determinism.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.evidence.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.findings.test.ts src/engine/policy/__tests__/synthesizePolicyInsight.precedence.test.ts src/application/use-cases/__tests__/synthesizePolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getCurrentPolicyInsightUseCase.test.ts src/application/use-cases/__tests__/getPolicyInsightHistoryUseCase.test.ts src/adapters/http/__tests__/policyInsights.openapi.contract.test.ts
pnpm exec vitest run src/ledger/pg/__tests__/policyInsightsWireContractMigration.test.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.command.test.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.current.test.ts src/adapters/postgres/__tests__/postgresPolicyInsightRepository.history.test.ts src/adapters/http/__tests__/policyInsights.current.e2e.pg.test.ts src/adapters/http/__tests__/policyInsights.history.e2e.pg.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **legacy rows remain untouched**: The additive migration leaves all existing JSON hashes and rows unchanged with a null digest marker. (Test: `leaves legacy rows unmodified with a null wire contract digest`)
- **new row digest**: Every canonical insert carries the exact SHA-256 of the published schema. (Test: `inserts every new canonical row with the exact published schema digest`)
- **legacy canonical coexistence**: Digest-aware uniqueness permits one marked canonical row beside an unmarked legacy row for the same synthesis input. (Test: `allows one canonical row beside a legacy row with the same synthesis input hash`)
- **canonical replay idempotency**: The same digest ruleset and input hash returns the existing canonical record instead of inserting another. (Test: `returns an existing canonical row for a replay with the same digest ruleset and input hash`)
- **legacy read exclusion**: Current and history queries return only rows marked with the supported digest. (Test: `never returns an unmarked legacy row from current or history`)
- **history ordering**: Canonical history uses generated time then id descending and cursor pagination has no gaps or duplicates. (Test: `orders canonical history by generatedAtUnixMs then id descending without gaps or duplicates`)
- **corruption fails closed**: A marked row with invalid content or mismatched canonical bytes/hash raises validation failure before serialization. (Test: `rejects a marked row whose content schema canonical bytes or hash are corrupt`)
- **legacy-only scope is absent**: A scope containing only unmarked rows returns the established not-found response. (Test: `returns 404 when a scope has only legacy rows`)
- **current shared clock**: Current freshness is derived only from the use case's single injected-clock value. (Test: `uses the injected current-read instant for evaluatedAt status and ageSeconds`)
- **history shared clock**: History queriedAt and every item use one captured injected-clock value. (Test: `uses one injected history-read instant for queriedAt and every item freshness`)
- **expiry boundary parity**: Current and history both mark equality with expiresAt as stale. (Test: `marks current and history items stale at the exact expiry boundary`)
- **current history item parity**: At the same query instant the current result equals the first history item for the same scope. (Test: `keeps current and the first history item identical at the same query instant`)
- **history limit**: The public parser and contract accept limits one through one hundred and reject larger values. (Test: `accepts history limits through 100 and rejects 101`)
- **canonical success fields only**: Success items omit payloadHash receivedAtIso legacy status and every ambiguous old field. (Test: `returns canonical items without payloadHash receivedAtIso legacy status or old field names`)
- **generic errors preserved**: Existing validation not-found internal and unavailable paths retain generic API error envelopes. (Test: `preserves existing 400 404 500 and 503 generic error envelopes`)
- **OpenAPI artifact reuse**: OpenAPI success components and examples come from the published schema and valid fixtures. (Test: `references the published root and history definition and uses published examples in OpenAPI`)

