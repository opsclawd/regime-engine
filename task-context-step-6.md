# Task Context: Task 6

Title: Define strict evidence HTTP query and cursor contracts
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-59
Repository: opsclawd/regime-engine
Branch: ai/issue-59
Start Commit: 90e95da66c50bf9c462dfa0d552e3b13bce9a965

## Task Requirements

**Files:**

- Create: `src/adapters/http/evidenceHttp.ts`
- Create: `src/adapters/http/__tests__/evidenceHttp.test.ts`

- [ ] **Step 1: Write the parser/codec invariant matrix first**

Name cases `constructs exactly one evidence scope`, `rejects unknown repeated empty and inapplicable parameters`, `defaults history limit to thirty and bounds it at one hundred`, and `round trips only versioned opaque history cursors`. Cover every scope kind, independent source filters, current rejecting `limit/cursor`, history integer syntax (reject decimals, signs, whitespace, NaN), identifier length 1..128, cursor safe integers, positive ID, exact keys, and base64url alphabet.

Run: `pnpm vitest run src/adapters/http/__tests__/evidenceHttp.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement constants, strict parser, error, wire mapping, and codec**

Export `EVIDENCE_SCHEMA_VERSION`, `EVIDENCE_BODY_LIMIT_BYTES = 4 * 1024 * 1024`, `EvidenceHttpValidationError`, `parseEvidenceCurrentQuery`, `parseEvidenceHistoryQuery`, `encodeEvidenceCursor`, `toEvidenceWireItem`, and `evidenceErrorResponse`. Query parsers must enumerate allowed keys and read values as `unknown` so arrays/repeated parameters are rejected. Construct scopes exactly as follows:

```ts
pair      -> { kind: "pair" }
whirlpool -> { kind: "whirlpool", network: "solana-mainnet", whirlpoolAddress }
wallet    -> { kind: "wallet", network: "solana-mainnet", walletAddress }
position  -> { kind: "position", network: "solana-mainnet", walletAddress, whirlpoolAddress, positionId }
```

Encode cursor JSON with keys `v`, `receivedAtUnixMs`, `id` and `Buffer.from(json, "utf8").toString("base64url")`; decode strictly and reject non-canonical encodings by re-encoding and comparing. Wire items contain `bundle`, `evidenceHash`, `receiptId`, ISO `receivedAt`, and freshness `{ status, asOf, freshUntil, expiresAt }` sourced from the bundle/record.

- [ ] **Step 3: Verify and commit**

Run: `pnpm vitest run src/adapters/http/__tests__/evidenceHttp.test.ts`

Expected: PASS across the full matrix.

Commit: `git add src/adapters/http/evidenceHttp.ts src/adapters/http/__tests__/evidenceHttp.test.ts && git commit -m "m59: define evidence HTTP contract"`

## Repository Targets

### Expected Files
- src/adapters/http/evidenceHttp.ts
- src/adapters/http/__tests__/evidenceHttp.test.ts

## Validation Commands

```bash
pnpm vitest run src/adapters/http/__tests__/evidenceHttp.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **constructs exactly one evidence scope**: Pair is the default; each non-pair scope requires only its applicable bounded identifiers and receives fixed solana-mainnet network metadata. (Test: `constructs exactly one evidence scope`)
- **round trips only versioned opaque history cursors**: Only canonical base64url for exact {v:1,receivedAtUnixMs,id} safe-integer objects decodes; malformed, extended, unsupported, or noncanonical cursors fail. (Test: `round trips only versioned opaque history cursors`)

