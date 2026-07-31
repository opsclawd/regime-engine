# Design Document: Durable Position-Scoped PolicyInsight Synthesis Pipeline

## 1. Problem and Context

The `clmm-v2` plan submission pipeline is blocked because the position-scoped PolicyInsight synthesis pipeline lacks durable, queued execution. Currently, `POST /v1/plan` is unused. For the system to react to position evidence and matching plans by synthesizing canonical `PolicyInsight` records, we need a reliable background worker.

The previous queue design was flawed because it keyed requests on `scopeKey + evidenceHash + rulesetVersion`, which fails to trigger a new synthesis when a new plan is submitted against unchanged evidence. Furthermore, the plan storage uses a SQLite ledger that lacks lookup columns for position/wallet/pool, making it inefficient to fetch the latest plan for a position. We need a robust architecture to enqueue, process, and persist position-scoped synthesis requests.

## 2. Key Design Decisions and Trade-offs

### 2.1. Plan Storage Topology

**Decision:** We will adopt **Option A: Run the synthesis worker in the same service/container as the HTTP API.**

- **Trade-offs:**
  - _Option A (Co-location)_ is the simplest approach and requires the least architectural churn. It avoids the complexity of dual-writes or a massive migration of the ledger from SQLite to Postgres.
  - _Option B (Move/mirror to Postgres)_ would allow transactional boundaries between plan persistence and queue wake-ups, which is cleaner long-term, but it introduces cross-database sync issues if we mirror, or requires significant rewrites if we move completely.
- **Rationale:** The HTTP service already manages connections to both SQLite (for ledger) and Postgres (for evidence/insights). Running the worker (`policyInsightSynthesizer`) as part of the same deployment (or as a background thread/process in the same container) guarantees filesystem access to the SQLite volume, avoiding distributed system complexity for now.

### 2.2. Queue Identity

**Decision:** The durable queue in Postgres (`policy_insight_synthesis_requests`) will use a unique constraint based on:
`scopeKey + selectionHash + planHash + rulesetVersion`

- **Rationale:** This fixes the identity gap. If a new plan arrives for existing evidence, `planHash` changes, resulting in a new queue entry. This ensures that every unique combination of evidence and plan produces a synthesis attempt.

### 2.3. Temporal Compatibility Rules

**Decision:**

- **Equality:** Exact wallet, position, and pool address equality must exist between the evidence scope and the plan.
- **Observation Skew:** Evidence age must be within 5 minutes of the plan's `asOfUnixMs` (aligned with `clmm-v2`'s staleness tolerance).
- **Expiration:** If evidence expires while waiting for a plan, the queued request permanently fails with `POSITION_STALE`. A fresh intelligence run will provide new evidence.
- **Superseding:** Since the queue identity includes `planHash`, a newer plan creates a new queue request. The worker will always resolve the _latest_ eligible plan. If an older request is processed, it will detect that a newer plan exists and can be skipped or naturally produce a superseded insight.

## 3. Proposed Approach

1.  **SQLite Migration:**
    We will add denormalized columns to the `plan_requests` SQLite table: `position_id`, `wallet_id`, and `pool_address`. This allows `PlanLedgerReadPort.getLatestPositionPlan()` to do indexed lookups rather than full JSON table scans.
2.  **Durable Queue (Postgres):**
    Create `policy_insight_synthesis_requests` in Postgres with:
    - `id` (PK)
    - `scope_key`, `selection_hash`, `plan_hash`, `ruleset_version` (Unique Constraint)
    - `status` (pending, processing, completed, failed)
    - `locked_at`, `locked_by`, `lease_expires_at` (for robust lease recovery, allowing crashed workers to drop leases)
    - `error_code`, `error_message`
3.  **Synthesis Worker (`src/workers/policyInsightSynthesizer.ts`):**
    A new worker that polls `policy_insight_synthesis_requests` using `FOR UPDATE SKIP LOCKED`. It will:
    - Claim a batch of requests by updating `locked_at`, `locked_by`, and `lease_expires_at`.
    - Read the exact `PlanRequest`/`PlanResponse` from SQLite using the new indexed columns.
    - Invoke `synthesizePolicyInsightUseCase`.
    - Classify errors using structured error codes to decide between retry and permanent failure.
4.  **Structured Error Codes:**
    We will add an `errorCode` string literal to `PolicyInsightValidationError` and `PolicyInsightStoreUnavailableError`. The worker will match on codes like `POSITION_PLAN_MISSING`, `PLAN_HASH_INVALID`, etc., rather than string-matching the message.
5.  **Internal Trigger Endpoint:**
    Implement `POST /v1/internal/insights/sol-usdc/synthesis-requests` in the HTTP adapter. It will enqueue requests into the Postgres table and return `202 Accepted` with a request ID.

## 4. Assumptions Made

- The SQLite database file is physically accessible to the worker process (guaranteed by our decision to co-locate the worker with the HTTP service).
- The 5-minute staleness tolerance for evidence vs plan is a hard limit; anything older is rejected.
- The `plan_requests` table can be safely migrated without downtime (or downtime is acceptable for this deployment).
- We only need to enqueue position scopes that are unexpired on deployment; scopes without eligible evidence will just wait for the next intelligence run.

## 5. Scope Definition

### 5.1. In Scope

- Updating SQLite `plan_requests` schema with `position_id`, `wallet_id`, `pool_address`.
- Creating Postgres table `policy_insight_synthesis_requests`.
- Implementing the worker `policyInsightSynthesizer`.
- Implementing the internal `POST` trigger endpoint.
- Enforcing temporal compatibility and structured error codes.

### 5.2. Out of Scope

- Pair/whirlpool-scoped synthesis (tracked in #78).
- Any changes to `clmm-v2` or its smart contracts.
- Modifying the HTTP `POST /v1/plan` endpoint (aside from having it trigger enqueueing).
- Moving plan storage completely to Postgres.

## 6. Risks and Concerns

- **Co-location Coupling:** While running the worker in the same service avoids Postgres migration, it tightly couples the worker's scaling to the HTTP API's scaling. If the HTTP API scales horizontally, multiple workers might fight over the SQLite lock (since SQLite concurrency is limited), though SQLite is currently only used for plan ledger appends.
- **SQLite Concurrency:** If the synthesis worker does heavy reads on the SQLite db while the HTTP API does writes, it could cause `SQLITE_BUSY` errors. We need to ensure WAL (Write-Ahead Logging) is enabled.
- **Lease Expiration Tuning:** The `lease_expires_at` window needs to be tuned correctly. If it's too short, a long-running synthesis might have its lease stolen; if too long, crashed workers will stall requests.
