# Task Context: Task 3

Title: Publish cross-repository canonical JSON and hash vectors
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/regime-engine/.ai-worktrees/issue-58
Repository: opsclawd/regime-engine
Branch: ai/issue-58
Start Commit: 7bd5b19db3afbf66e95e06ac273453030f5381fe

## Task Requirements

**Files:**

- Create: `contracts/evidence-bundle/v1/hash-vectors.json`
- Create: `src/contract/evidence/v1/__tests__/canonicalHash.test.ts`
- Modify: `scripts/generateEvidenceContract.ts`

- [ ] **Step 1: Write failing published-vector tests**

Use `canonicalJson` and `sha256Hex` from `src/contract/v1`. Define the vector file shape explicitly:

```ts
interface EvidenceHashVector {
  name: string;
  payload: unknown;
  canonical: string;
  utf8ByteLength: number;
  sha256: string;
  schemaSha256: string;
}
```

Name tests `reproduces every published EvidenceBundle hash vector`, `ignores object insertion order but preserves array order`, `normalizes negative zero and preserves ECMAScript exponent formatting`, and `detects a deliberately mismatched published hash`. Validate each payload first, except focused primitive canonicalizer vectors. Assert the schema digest on every vector.

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/canonicalHash.test.ts`

Expected: FAIL because `hash-vectors.json` is absent.

- [ ] **Step 2: Generate deterministic vectors**

Extend the generator to derive vectors from the two valid fixtures plus focused non-ASCII, negative-zero, exponent, empty-context, null-brief, and array-reorder inputs. For every vector, compute canonical text, UTF-8 byte length, SHA-256, and current schema SHA-256. `--write` writes stable pretty JSON with a final newline; `--check` compares bytes and reports the vector path as stale. Do not accept a publisher-supplied `payloadHash` field.

- [ ] **Step 3: Prove vectors and regeneration are stable**

Run: `pnpm run contract:evidence:generate`

Run: `pnpm run contract:evidence:check`

Expected: PASS without rewriting published vectors.

Run: `pnpm vitest run src/contract/evidence/v1/__tests__/canonicalHash.test.ts src/contract/evidence/v1/__tests__/generation.test.ts`

Expected: PASS.

Run: `pnpm exec prettier --check scripts/generateEvidenceContract.ts contracts/evidence-bundle/v1/hash-vectors.json src/contract/evidence/v1/__tests__/canonicalHash.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit portable hash vectors**

```bash
git add scripts/generateEvidenceContract.ts contracts/evidence-bundle/v1/hash-vectors.json src/contract/evidence/v1/__tests__/canonicalHash.test.ts
git commit -m "m58: publish EvidenceBundle hash vectors"
```

## Repository Targets

### Expected Files
- contracts/evidence-bundle/v1/hash-vectors.json
- src/contract/evidence/v1/__tests__/canonicalHash.test.ts
- scripts/generateEvidenceContract.ts

## Validation Commands

```bash
pnpm run contract:evidence:check
pnpm vitest run src/contract/evidence/v1/__tests__/canonicalHash.test.ts src/contract/evidence/v1/__tests__/generation.test.ts
pnpm exec prettier --check scripts/generateEvidenceContract.ts contracts/evidence-bundle/v1/hash-vectors.json src/contract/evidence/v1/__tests__/canonicalHash.test.ts
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **published hashes reproduce**: Every vector's canonical bytes, UTF-8 length, SHA-256, and schema SHA-256 reproduce independently. (Test: `reproduces every published EvidenceBundle hash vector`)
- **objects sort but arrays do not**: Object insertion order does not affect canonical output, while an array reorder changes canonical bytes and hash. (Test: `ignores object insertion order but preserves array order`)
- **ECMAScript number semantics**: Negative zero normalizes to zero and exponent formatting follows ECMAScript JSON serialization. (Test: `normalizes negative zero and preserves ECMAScript exponent formatting`)

