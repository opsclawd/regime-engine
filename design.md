# Trigger Pair-Scoped PolicyInsight Synthesis on Evidence Ingest: Design Document

## 1. The Problem Being Solved and Why It Matters

The application needs to automatically synthesize `PolicyInsight` records when new intelligence evidence is ingested, so that the UI can display up-to-date, evidence-backed insights to the user.

The original concept of a naive trigger had two critical flaws:

1. **Scope Disconnect**: Upstream (`sol-usdc-clmm-intelligence`) currently only publishes position-scoped evidence, but the UI expects a pair-scoped insight. A naive trigger querying for pair-scoped evidence would find zero rows, resulting in an empty or degraded insight that silently ignores the ingested position evidence.
2. **Durability and Isolation**: A simple fire-and-forget trigger in the HTTP handler ties the ingest HTTP response to the synthesis process. If synthesis fails or the server restarts immediately after a `201 Created` response, the insight is never generated.

We must implement a durable trigger mechanism that successfully generates pair-scoped insights based on correct evidence, survives restarts, and completely decouples evidence ingestion from synthesis.

## 2. Key Design Decisions and Trade-offs Considered

### Scope Resolution

We must choose how to reconcile the fact that upstream sends position-scoped data, but we need pair-scoped insights.

- _Option A: Projection Policy in Regime Engine._ We could build a formal projection in `regime-engine` to strip position-specific fields and aggregate them into a pair view. **Trade-off:** This adds significant complexity to the `regime-engine` synthesis logic and forces it to understand how to safely generalize position data.
- _Option B (Preferred): Upstream Publishes Pair Scope._ We modify `sol-usdc-clmm-intelligence` to explicitly publish a pair-scoped evidence bundle containing only pair-safe data. **Trade-off:** Requires a cross-repository change, but keeps `regime-engine` logic pure, exact, and strictly aligned with the requested scope.
  **Decision:** We are explicitly selecting Option B (Preferred).

### Trigger Durability

The trigger must survive a restart between the `201` response and synthesis.

- _Option A: In-memory Event Bus (EventEmitter)._ Fast and easy to implement in the HTTP handler. **Trade-off:** Fails the durability requirement; lost on restart.
- _Option B: Outbox Pattern / Queue Table._ Insert a trigger record into a Postgres queue table within the same transaction as the evidence ingestion. **Trade-off:** Requires schema migrations and transaction coordination.
- _Option C: Cursor-based Polling Worker._ A background worker periodically queries the evidence repository for bundles newer than a persisted cursor (e.g., the last processed `receiptId`). **Trade-off:** Introduces a slight polling delay, but natively solves durability (cursor is saved), natively coalesces concurrent updates (processes the latest bundle since the last poll), and requires minimal schema changes.
  **Decision:** A Cursor-based Polling Worker or an Outbox table. Given the need to coalesce concurrent pair-synthesis attempts, a queue/outbox table with deduplication or a polling worker tracking the latest state is ideal.

## 3. Proposed Approach with Rationale

**1. Explicit Pair-Scope Publication (Companion Issue)**
We will assume the companion issue in `sol-usdc-clmm-intelligence` is completed, meaning `regime-engine` will naturally begin receiving evidence bundles where `scope.kind === "pair"`.

**2. Canonical Market Selector Configuration**
Pair-scoped synthesis lacks a `poolAddress` (unlike position scope). We will define the canonical SOL/USDC market values in the application configuration to feed into `synthesizePolicyInsightUseCase`:

```typescript
{
  source: "geckoterminal",
  network: "solana",
  poolAddress: process.env.CANONICAL_SOL_USDC_POOL_ADDRESS,
  timeframe: "1h"
}
```

**3. Durable Trigger Worker**
To satisfy the restart survival and coalescing requirements:

- We will implement a `SynthesisTriggerWorker` that runs in the background.
- It will track a cursor (the highest `receiptId` or `receivedAtUnixMs` processed) in the database (e.g., a simple key-value state table or an outbox table).
- When `ingestEvidenceBundleUseCase` returns `created`, it can optionally signal the worker to wake up immediately (to minimize polling delay), but the worker's source of truth is the database.
- The worker fetches all new pair-scoped evidence since the last cursor. If multiple exist, it only calls `synthesizePolicyInsightUseCase` for the latest one (coalescing).
- The worker updates its cursor only after a successful synthesis or after permanently classifying a failure.

**4. Error Isolation and Logging**

- The HTTP handler (`evidenceIngest.ts`) will no longer attempt to run synthesis. It will only return `201` upon successful evidence insertion.
- The worker will wrap `synthesizePolicyInsightUseCase` in a `try/catch`.
- Upon success or failure, it will log: evidence receipt ID, scope, `synthesisInputHash`, resulting insight ID (if successful), and duration.
- Failures in the worker will not affect the `201` status of the original HTTP request.

**5. Backfill Script**
We will create a script `scripts/backfill-pair-insights.ts` that:

- Queries the latest ingested pair-scoped evidence.
- Invokes `synthesizePolicyInsightUseCase` directly.
- Can be run manually during deployment to catch up on evidence ingested prior to this feature.

## 4. Assumptions Made

- The upstream publisher (`sol-usdc-clmm-intelligence`) will be updated to publish `scope.kind: "pair"` evidence bundles.
- A canonical `SOL/USDC` pool address will be provided via environment variables (e.g., `CANONICAL_SOL_USDC_POOL_ADDRESS`).
- The system has a mechanism to persist a cursor (e.g., a small state table in Postgres) for the background worker to resume from after a restart.
- The `synthesisInputHash` replay detection in `synthesizePolicyInsightUseCase` is functioning correctly and provides a secondary defense against duplicate insights.
- "Whirlpool" scope is fully deprecated and out of scope for this implementation.

## 5. Scope

**In Scope:**

- Creating the durable background worker/polling mechanism.
- Wiring the canonical market selector for pair-scoped synthesis.
- Implementing the comprehensive logging for synthesis outcomes.
- Ensuring the HTTP ingest handler remains isolated from synthesis failures.
- Creating the `scripts/backfill-pair-insights.ts` script.

**Out of Scope:**

- Making changes to the upstream `sol-usdc-clmm-intelligence` repository.
- Implementing a position-to-pair projection policy in `regime-engine`.
- Generating insights for anything other than pair-scope in this specific trigger.

## 6. Risks or Concerns Identified from Code Analysis

- **Cursor Persistence:** The application currently has ledger adapters for SQLite and repositories for Postgres. If the background worker needs to store a cursor to survive restarts, we need a clean, consistent place to store it (likely in Postgres alongside the evidence repository) to prevent race conditions in multi-instance deployments.
- **Backfill Interference:** The `backfill-pair-insights.ts` script must be careful not to trigger duplicate work if the background worker is simultaneously processing the same evidence. The `synthesisInputHash` replay detection handles this, but we may see `PolicyInsightStoreUnavailableError` or constraint violations if they race.
