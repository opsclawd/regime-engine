# Task: Add regime-engine S/R level ingestion to crypto-aggregator

## Context

The `crypto-aggregator` repo already produces `out/theses-YYYY-MM-DD.json` daily via the existing cron pipeline. This task adds a new step that projects SOL-only theses down to an S/R level payload and POSTs it to the `regime-engine` service.

The regime-engine endpoint (`POST /v1/sr-levels`) already exists and is deployed. Its request contract is defined in the regime-engine repo at `src/contract/v1/validation.ts` (look for `srLevelBriefRequestSchema`). Do not modify regime-engine — conform to its existing contract.

## Reference files to read first

Before writing any code, read:

1. `schemas/thesis.schema.json` (this repo) — the exact shape of each item in `out/theses-YYYY-MM-DD.json`
2. `scripts/update-thesis-ledger.ts` (this repo) — the current final step of the pipeline; the new step runs after this
3. `config/cron.yaml` (this repo) — how cron steps are defined
4. In the `regime-engine` repo: `src/contract/v1/validation.ts` — the accepted request schema for `POST /v1/sr-levels`
5. In the `regime-engine` repo: `src/http/handlers/srLevelsIngest.ts` — confirm auth header name and response shape

Report back if any of these files don't exist where described. Do not proceed on assumption.

## Deliverable

A new script `scripts/emit-sr-levels.ts` and a cron step that runs it after the thesis ledger update, plus environment variable additions and a dry-run mode.

## Step 1: Confirm the regime-engine contract

Open the regime-engine repo and locate `srLevelBriefRequestSchema`. Copy the expected request shape into a comment at the top of `scripts/emit-sr-levels.ts`. The shape should include at minimum:

- `schemaVersion` (string, literal `"1.0"`)
- `source` (string)
- `symbol` (string) — use `SOL/USDC`
- `brief` (object with `briefId` (required), optional `sourceRecordedAtIso`, optional `summary`)
- `levels` (array of objects with `levelType` (`'support'`|`'resistance'`), `price` (number), optional `timeframe`, optional `rank` (string, not enum), optional `invalidation` (number), optional `notes` (string))

**Note:** `rank` is an optional free-form string in the regime-engine schema. The projection convention is `"primary"` for high-reliability sources, `"secondary"` for medium, and `"minor"` for low or missing. Use only these three values — do not use `"key"`.

Also confirm:
- Auth header name: `X-Ingest-Token`
- Response codes: 201 on insert, 200 on idempotent duplicate, 400 on validation error, 401 on auth failure, 409 on conflict (same `briefId` with differing payload), 500 on server misconfiguration
- 5xx responses should be retried; 4xx responses should NOT be retried

## Step 2: Add environment variables

Add to `.env.example`:

```
# Regime-engine S/R ingestion
REGIME_ENGINE_URL=https://regime-engine-production.example.com
REGIME_ENGINE_INGEST_TOKEN=<set-in-openclaw-secret-store>
EMIT_SR_LEVELS_DRY_RUN=false
```

Do not commit real tokens. The actual `REGIME_ENGINE_INGEST_TOKEN` will be set as a secret in the OpenClaw cron environment.

## Step 3: Write the projection function

Create `scripts/emit-sr-levels.ts`. The script must export the following **pure helpers** for testability, with all CLI/network/process-exit behavior kept in `main()`:

- `parsePriceString(value: string): number | null` — price parser
- `canonicalizeSource(sourceHandle: string): string | null` — source canonicalization (returns `null` for unresolvable handles, e.g., empty after normalization)
- `projectThesesToRequests(theses: Thesis[], date: string): SrLevelBriefRequest[]` — full projection (skips theses with `null` source from `canonicalizeSource`)
- `buildNotes(thesis: Thesis): string` — notes field builder

The script's responsibilities:

1. Read today's theses file: `out/theses-YYYY-MM-DD.json`, where the date is derived from an env var `CRON_RUN_DATE` if set, otherwise today's UTC date in `YYYY-MM-DD` format.
2. Filter theses to SOL only (asset field matches `'SOL'`, case-insensitive — the thesis schema uses lowercase `"sol"`).
3. For each SOL thesis, project down to one or more level rows using the rules in Step 4. Skip a thesis only if it has no parseable support/resistance levels after running the price parser. Log a message for each skipped thesis.
4. Bias (`bullish`/`bearish`/`neutral`/`mixed`) is included in the `notes` field, not used as a filter.
5. Build the request body per source (see Step 4 for source abbreviation and briefId construction). If multiple sources contribute theses on the same day, POST once per source (separate requests, separate brief IDs). Do not combine sources into one brief.
6. **Skip the entire POST for a source** if, after projection and deduplication, `levels.length === 0`. The regime-engine contract requires `.min(1)` on levels. Log a message like `"no parseable levels for source mco, skipping POST"`.
7. POST to `${REGIME_ENGINE_URL}/v1/sr-levels` with header `X-Ingest-Token: ${REGIME_ENGINE_INGEST_TOKEN}` and JSON body.
8. Handle responses:
   - 201 → log success with `insertedCount`
   - 200 → log idempotent skip (`status: "already_ingested"`)
   - 400/401 → log error and exit non-zero
   - 409 → log conflict and exit non-zero (same `briefId` with differing payload — investigate manually)
   - 500 → treat as retryable (will be retried per Step 3.10)
9. If `EMIT_SR_LEVELS_DRY_RUN=true`, log the request body that would be POSTed and exit 0 without sending.
10. Retry on network errors and 5xx up to 3 times with exponential backoff (500ms, 1s, 2s). Do not retry on 4xx.

## Step 4: Projection rules (thesis → levels)

**Schema mapping reference** (confirmed from actual `schemas/thesis.schema.json`):

| Thesis field | Type | Usage |
|---|---|---|
| `sourceHandle` | `string` | Source identifier (e.g., `"morecryptoonline"`, `"Morecryptoonl"`). Maps to `source` in regime-engine payload via canonicalization (see source abbreviation rules below). The original `sourceHandle` is preserved in `notes` for traceability. |
| `asset` | `string` (`enum: btc/eth/sol`) | Filter: must match `'SOL'` (case-insensitive). |
| `bias` | `string` (`enum: bullish/bearish/neutral/mixed`) | Included in `notes` field. Not a filter — neutral/mixed theses with S/R levels are included. |
| `timeframe` | `string` (`enum: intraday/swing/macro/unknown`) | Pass through to `timeframe` on level rows. |
| `setupType` | `string` (`enum: breakout/breakdown/range/trend continuation/mean reversion/reclaim/rejection/unknown`) | Used in `notes` field. |
| `sourceReliability` | `string` (`enum: low/medium/high`) | Maps to `rank`: `"primary"` if `high`, `"secondary"` if `medium`, `"minor"` if `low` or missing. |
| `supportLevels` | `string[]` | Parse each string to a number → emit `support` level rows. |
| `resistanceLevels` | `string[]` | Parse each string to a number → emit `resistance` level rows. |
| `targets` | `string[]` | **Skip entirely.** These are take-profit levels, not S/R. |
| `trigger` | `string | null` | Condition description for `notes`. |
| `invalidation` | `string | null` | Condition description for `notes`. |
| `entryZone` | `string | null` | **Excluded from v0.** Could be a price zone, but semantics are ambiguous. |
| `sourceKind` | `string` (`enum: x/youtube/rss/official`) | **Excluded from v0.** Not needed for the S/R payload. |
| `sourceChannel` | `string | null` | **Excluded from v0.** Not needed for the S/R payload. |
| `collectedAt` | `string` | Used as fallback for `sourceRecordedAtIso` (see Step 4). |
| `publishedAt` | `string | null` | Preferred value for `sourceRecordedAtIso`. |

### `sourceRecordedAtIso`

Set `brief.sourceRecordedAtIso` to the **latest** `publishedAt ?? collectedAt` value among all theses in the source group. Since a brief covers multiple theses from one source, use the most recent timestamp as the canonical "when was this data recorded" value. `collectedAt` is always present in the thesis schema (required field), so the field will always have a value.

**Omit `brief.summary`** in v0. There is no aggregate summary field in the thesis schema, and synthesizing one from multiple theses would be fragile.

### `symbol`

Map `asset: "sol"` → `symbol: "SOL/USDC"`. This matches the CLMM read-path convention used by the downstream consumer (`GET /v1/sr-levels/current?symbol=SOL/USDC&source=mco`).

### Price parser requirements

Each element in `supportLevels` and `resistanceLevels` is a human-written string. Write a `parsePriceString(value: string): number | null` function that handles:

1. **Strip parentheticals first:** `"86K–87K (target zone)"` → work with `"86K–87K"` before further parsing. This prevents the parser from accidentally treating `"100"` inside `"(100% C-wave extension)"` as a separate price.
2. **Strip trailing non-numeric labels:** Remove trailing words like `"area"`, `"zone"`, `"target"`, `"support"`, `"resistance"`, `"initial"`, `"next"`, etc. Example: `"$96 area (March highs)"` → after parenthetical strip → `"$96 area"` → strip `"area"` → `"$96"`.
3. **Handle dollar prefixes:** `"$128"` → `128`
4. **Handle comma-separated numbers:** `"$67,600"` → `67600`
5. **Handle `K` suffix (thousands):** `"86K"` → `86000`, `"67.5K"` → `67500`
6. **Handle `K` suffix with dollar prefix:** `"$86K"` → `86000`, `"$67.5K"` → `67500`
7. **Handle ranges with en-dash, hyphen, or the word "to":**
   - `"86–87K"` → midpoint `86500`
   - `"86-87K"` → midpoint `86500`
   - `"128 to 132"` → midpoint `130`
   - `"$78.81 to $81.75 area"` → midpoint `80.28` (after label/parenthetical stripping)
   - `"$67,600 to $73,000 (main support zone)"` → midpoint `70300`
8. **Handle plain numbers:** `"128"` → `128`
9. **Handle approximate prefix:** `"~128"` → `128`
10. **Unparseable strings** (e.g., `"around the weekly low"`, `"21-week EMA"`, `"bull market support band"`) → return `null`; log a warning and skip that level

**Decision: midpoint for ranges.** When a string describes a range, emit a single level at the midpoint. Do not emit both endpoints. This keeps level counts predictable and avoids near-duplicate prices.

### Source abbreviation (canonicalization)

The `sourceHandle` values in real data are **not stable** — the same analyst appears as both `"morecryptoonline"` and `"Morecryptoonl"`. A canonicalization step is required.

Both the `source` field in the payload and the `briefId` prefix use the same abbreviated slug. The canonicalization map:

| Raw `sourceHandle` (case-insensitive match) | Canonical abbreviation |
|---|---|
| `morecryptoonline` | `mco` |
| `Morecryptoonl` | `mco` |

For any other `sourceHandle`, derive the slug by: lowercase → strip non-alphanumeric characters → take the result as-is. If the result is an empty string, `canonicalizeSource` returns `null` and `projectThesesToRequests` skips theses from that source. Log a warning like `"sourceHandle '!!!' normalized to empty, skipping"`.

`briefId` format: `{canonicalAbbreviation}-sol-{YYYY-MM-DD}`

Examples:
- `sourceHandle = "morecryptoonline"` → `source = "mco"`, `briefId = "mco-sol-2026-04-23"`
- `sourceHandle = "Morecryptoonl"` → `source = "mco"`, `briefId = "mco-sol-2026-04-23"` (same canonical ID — deduplicated)
- `sourceHandle = "some_other_source"` → `source = "someothersource"`, `briefId = "someothersource-sol-2026-04-23"`

One source per brief. Never combine multiple sources into one brief.

### Level emission rules

For each SOL thesis:

1. For each string in `supportLevels`:
   - Parse with `parsePriceString`. If `null`, skip with a warning.
   - Emit one level row:
     - `levelType`: `'support'`
     - `price`: parsed number
     - `timeframe`: thesis `timeframe` if present
     - `rank`: `"primary"` if `sourceReliability === 'high'`, `"secondary"` if `medium`, `"minor"` if `low` or missing
     - `notes`: see Step 5
     - `invalidation`: **do not set in v0.** The thesis `invalidation` field is prose (a condition description), not a numeric price.

2. For each string in `resistanceLevels`:
   - Parse with `parsePriceString`. If `null`, skip with a warning.
   - Emit one level row:
     - `levelType`: `'resistance'`
     - `price`: parsed number
     - `timeframe`: thesis `timeframe` if present
     - `rank`: `"primary"` if `sourceReliability === 'high'`, `"secondary"` if `medium`, `"minor"` if `low` or missing
     - `notes`: see Step 5
     - `invalidation`: **do not set in v0.**

3. **Deduplication:** if two theses from the same source produce rows with identical `(levelType, price)`, keep only the first. Do not POST duplicates.

4. **If all theses for a source yield zero parseable levels after deduplication,** skip the POST for that source entirely (the `levels` array must be `.min(1)`). Log `"no parseable levels for source {abbreviation}, skipping POST"`.

## Step 5: Notes field template

Build a one-sentence string from the thesis fields:

```
`${sourceHandle} ${timeframe}, ${bias}. ${setupType}${trigger ? ' | Trigger: ' + trigger : ''}${invalidation ? ' | Invalidation: ' + invalidation : ''}`.trim()
```

Example output: `morecryptoonline swing, bullish. trend continuation | Trigger: Decisive break above intraday high for direct breakout signal | Invalidation: break below $76.80 swing low from April`

The `bias` field is always included so downstream consumers can see directional context even for S/R levels from neutral/mixed theses. The `sourceHandle` is included for traceability even though the payload `source` uses the abbreviated form.

Keep under 200 characters. Truncate with `...` if longer. Do not serialize objects or arrays into notes — if a field is not a plain string, skip it.

## Step 6: Wire into the pipeline

Add a timed cron step in `config/cron.yaml`. The repo's cron system uses timed steps, not dependency-based ordering. Add a new entry:

```yaml
- key: emit-sr-levels
  name: Emit S/R levels to regime-engine
  cron: "20 6 * * *"
  messageFile: prompts/jobs/emit-sr-levels.txt
  thinking: low
  timeoutSeconds: 900
  enabled: true
  cwd: "~/.openclaw/workspace/crypto-aggregator"
```

Create the prompt file `prompts/jobs/emit-sr-levels.txt` with this content:

```
In the current workspace repo:

Run:
  cd ~/.openclaw/workspace/crypto-aggregator && pnpm emit:sr-levels

Do not browse.
Do not summarize.
```

**Reschedule existing jobs** to preserve the 20-minute spacing rule:

| Job | Before | After |
|---|---|---|
| `update-thesis-ledger` | 6:00 | 6:00 (unchanged) |
| `emit-sr-levels` | (new) | **6:20** |
| `render-market-map-input` | 6:20 | **6:40** |
| `morning-market-map` | 6:40 | **7:00** |

Do NOT make the final market map synthesis depend on this step. If the POST to regime-engine fails, the user-facing brief should still be produced and delivered. The emit step is a sibling, not a prerequisite.

After editing `config/cron.yaml`, run `pnpm cron:sync` to push the change to the OpenClaw Gateway.

## Step 7: Add a manual invocation command

Add to `package.json` scripts:

```json
"emit:sr-levels": "tsx scripts/emit-sr-levels.ts",
"emit:sr-levels:dry": "EMIT_SR_LEVELS_DRY_RUN=true tsx scripts/emit-sr-levels.ts"
```

This allows manual re-run if a cron invocation failed, and a dry-run for verification.

## Step 8: Add test infrastructure and tests

The crypto-aggregator repo currently has no test runner. Before writing tests, add the infrastructure:

1. `pnpm add -D vitest`
2. Create `vitest.config.ts` (minimal — `test: { include: ['scripts/__tests__/**/*.test.ts'] }`)
3. Add scripts to `package.json`:
   ```json
   "test": "vitest run",
   "test:watch": "vitest"
   ```
4. Mock HTTP by mocking `globalThis.fetch` with Vitest's `vi.fn()`. Do not add `nock` — Node's built-in `fetch` is used directly, and `vi.fn()` is sufficient.

Then create `scripts/__tests__/emit-sr-levels.test.ts` covering:

1. **Happy path:** reads a fixture `theses-2026-04-17.json`, produces the expected request body (snapshot test). Use a fixture with 1 MCO SOL thesis that has both `supportLevels` and `resistanceLevels` (e.g., `["$128"]`, `["$178–$182"]`). Use SOL-appropriate prices, not BTC-scale prices.
2. **Price parser unit tests** (test `parsePriceString` directly):
   - `"$128"` → `128`
   - `"86K"` → `86000`
   - `"86–87K"` → `86500` (midpoint, en-dash)
   - `"67.5K–73K"` → `70250` (midpoint, mixed K)
   - `"128 to 132"` → `130` (midpoint, "to" separator)
   - `"$78.81 to $81.75 area"` → midpoint after stripping "area"
   - `"$67,600 to $73,000 (main support zone)"` → `70300` (midpoint, comma numbers, parenthetical stripped)
   - `"$96 area (March highs)"` → `96` (parenthetical and label stripped)
   - `"21-week EMA"` → `null` (no numeric price)
   - `"bull market support band"` → `null` (prose, no number)
   - `"around the weekly low"` → `null`
   - `"128"` → `128`
   - `"~128"` → `128` (approximate prefix stripped)
   - `"$67.5K"` → `67500` (dollar + decimal + K)
3. **Source canonicalization** (test `canonicalizeSource` directly): `morecryptoonline` → `"mco"`, `Morecryptoonl` → `"mco"` (same brief ID deduplication), `some_other_source` → `"someothersource"`.
4. **Multi-source:** fixture with MCO + one other source for SOL → produces two separate POST calls with distinct brief IDs.
5. **Non-SOL filter:** fixture with BTC and ETH theses only → exits 0, no POSTs made, logs `"no SOL theses to emit"`.
6. **Neutral/mixed bias inclusion:** fixture with SOL theses where bias is `neutral` and `mixed`, both with parseable S/R levels → levels are emitted, bias appears in `notes`.
7. **Dry-run:** with `EMIT_SR_LEVELS_DRY_RUN=true`, logs the body but does not make network calls.
8. **Retry:** mock a 500 response for the first 2 attempts, success on the 3rd. Use `vi.useFakeTimers()` with `vi.advanceTimersByTime()` to verify the 500ms, 1s, 2s backoff intervals without real delays. Assert eventual success.
9. **409 conflict:** mock a 409 response. Assert exit non-zero and no retry.
10. **Notes truncation:** thesis with extremely long fields → notes string <= 200 chars.
11. **Deduplication:** two theses from same source producing identical `(levelType, price)` → only one row in the POST body.
12. **No-parseable-levels skip:** thesis with only unparseable strings (e.g., `["around the weekly low"]`) → skipped, logs warning, no POST for that thesis.
13. **Empty source slug skip:** `sourceHandle` that normalizes to empty string (e.g., `"!!!"`) → log warning, skip source entirely, no POST.
14. **Empty levels POST skip:** source with SOL theses where all levels are unparseable → skip the entire POST, do not send a request with an empty `levels` array.

## Step 9: Documentation

Update `README.md`:

1. In the "Daily flow (cron)" section, add step 4.5 (or renumber): "Emit S/R levels to regime-engine — `scripts/emit-sr-levels.ts` projects SOL theses to the regime-engine ingest contract and POSTs."
2. Add a new section "Regime-engine integration" describing:
   - What the integration does (one paragraph)
   - Required env vars (`REGIME_ENGINE_URL`, `REGIME_ENGINE_INGEST_TOKEN`)
   - How to dry-run for verification (`pnpm emit:sr-levels:dry`)
   - How to manually re-run after a failure (`pnpm emit:sr-levels`)

## Step 10: Verify end-to-end

After everything is wired:

1. Run `pnpm emit:sr-levels:dry` locally against today's theses file. Confirm the output JSON matches the expected shape against regime-engine's schema.
2. With `REGIME_ENGINE_URL` and `REGIME_ENGINE_INGEST_TOKEN` set to the real deployed regime-engine, run `pnpm emit:sr-levels` once manually.
3. Query regime-engine: `curl "${REGIME_ENGINE_URL}/v1/sr-levels/current?symbol=SOL%2FUSDC&source=mco"`. Confirm the levels returned match what was POSTed. Note: the stored `symbol` value is `SOL/USDC` (with literal slash), but query-string values must be URL-encoded.
4. Run a second manual invocation. Confirm the second response is 200 (idempotent), not 201.
5. Report back the dry-run output, the production POST response, and the GET response.

## What NOT to do

- Do not modify regime-engine. Its contract is canonical. If something doesn't fit, adjust the projection, not the endpoint.
- Do not add new tables, new schemas, or new endpoints to crypto-aggregator. This is a projection script, not new infrastructure.
- Do not expand beyond SOL. BTC/ETH theses stay in the ledger but are not POSTed. A later task can broaden the filter.
- Do not add logic that reads regime-engine state to decide what to POST. The POST is stateless from crypto-aggregator's perspective — regime-engine handles supersession.
- Do not combine multiple sources into one brief. One source per brief_id.
- Do not catch and swallow errors silently. Failed POSTs must log at ERROR and exit non-zero so cron alerts fire.
- Do not emit `targets` as S/R levels. Targets are take-profit levels and are out of scope for this integration.
- Do not set `level.invalidation` in v0. The thesis `invalidation` field is prose, not a numeric price. If you want to add numeric invalidation levels later, it requires a new parser rule or schema change.

## Estimated effort

5-6 hours total:
- Step 3-5 (script + price parser + projection + notes): ~2.5h
- Step 6-7 (cron wiring + prompt file + scripts): ~30min
- Step 8 (test infrastructure + tests): ~1.5h
- Step 9-10 (docs + E2E verification): ~30min

---

## Appendix: Decision log

| Decision | Rationale |
|---|---|
| Midpoint for price ranges | Keeps level counts predictable; regime-engine expects discrete prices, not ranges. |
| Strip parentheticals before parsing prices | Prevents accidental extraction of numbers inside parenthetical labels like `"(100% C-wave extension)"`. |
| Include `neutral`/`mixed` bias | S/R levels are useful regardless of directional bias. Bias is recorded in `notes` for context. |
| Skip `targets` array | Targets are take-profit levels, not support/resistance. Out of scope. |
| Skip `entryZone`, `sourceKind`, `sourceChannel` | Not needed for the S/R payload in v0. May be added later. |
| `rank` as `"primary"`/`"secondary"`/`"minor"` | Maps `sourceReliability` (high/medium/low) to intuitive rank labels. Schema accepts any optional string. |
| `SOL/USDC` symbol format | Matches CLMM read-path convention. The regime-engine S/R level docs, fixture, and curl examples all use `SOL/USDC`. |
| Source canonicalization map | Real data has `"morecryptoonline"` and `"Morecryptoonl"` for the same analyst. Without canonicalization, these would produce duplicate briefs. |
| `level.invalidation` excluded in v0 | Thesis `invalidation` field is prose (condition description), not a numeric price. |
| Empty normalized slug → skip source | Prevents POSTing with empty `source` or `briefId`, which would fail validation or create unqueryable records. |
| Empty levels → skip POST | The regime-engine contract requires `.min(1)` on levels. Sending empty arrays would fail validation. |
| `sourceRecordedAtIso` = latest `publishedAt ?? collectedAt` per source group | A brief covers multiple theses from one source; use the most recent timestamp as canonical. `collectedAt` is always present (required field). |
| `brief.summary` omitted in v0 | No aggregate summary field exists in the thesis schema. Synthesizing one from multiple theses would be fragile and out of scope. |
| Export pure helpers for testability | `parsePriceString`, `canonicalizeSource`, `projectThesesToRequests`, `buildNotes` exported as pure functions. CLI/network/exit behavior stays in `main()`. |
| `canonicalizeSource` returns `string | null` | A pure function returning empty string for "skip" is a footgun. `null` makes the contract explicit: `null` means skip the source, any string means use it. |
| URL-encode slash in query strings | The stored `symbol` value is `SOL/USDC` but query parameters must encode the slash as `%2F` to avoid ambiguity in URLs and shells. |
| Mock `globalThis.fetch` with `vi.fn()` | No `nock` dependency needed. Node's built-in fetch is used directly by the script. |
| Add vitest as test infrastructure | No test runner exists in crypto-aggregator. A new dependency is required. |
| Cron uses timed steps, not dependency syntax | The OpenClaw cron system uses timed scheduling with 20-minute spacing between jobs. Reschedule `render-market-map-input` to 6:40 and `morning-market-map` to 7:00 to accommodate the new 6:20 slot. |