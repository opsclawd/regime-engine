---
title: "Hand-Authored Drizzle Migration Metadata Causes Deployment Crash Loop"
date: "2026-04-30"
category: database-issues
module: ledger,http
problem_type: runtime_error
component: database
symptoms:
  - Railway deployment crash-looping with process.exit(1) at startup
  - sr_theses_v2 table not found in Postgres
  - verifySrThesesV2Table failing because migration 0003 was never applied
root_cause: incomplete_setup
resolution_type: config_change
severity: critical
tags:
  - drizzle
  - migration
  - journal
  - deploy
  - railway
  - drizzle-kit
  - snapshot
related_components:
  - http
  - server
---

# Hand-Authored Drizzle Migration Metadata Causes Deployment Crash Loop

## Problem

The `0003_create_sr_theses_v2` migration was never applied to the Railway Postgres database, causing the service to crash-loop at startup. The `verifySrThesesV2Table()` check called `process.exit(1)` when the table didn't exist, making the service unreachable on every deploy.

## Symptoms

- Railway deployment crash-looping — the container starts, hits the table verification, and exits
- `regime_engine_migrations` journal shows zero rows for `0003_create_sr_theses_v2`
- `drizzle/meta/_journal.json` entry for idx 3 has `when: 1746009600000` (2025-04-30) — predating idx 1 (`1777474187042`) and idx 2 (`1777555442009`) which are both 2026 timestamps
- The 0003 snapshot JSON has a fake UUID `f3c98020-1234-4567-89ab-c1ab73164877`

## What Didn't Work

1. **Patching only the journal timestamp** (PR #33). Changing the `when` value in `_journal.json` to a correct 2026 timestamp seemed like a fix, but Drizzle's migration runner uses the `tag` and `breakpoints` fields to decide whether to apply a migration — and if the `regime_engine_migrations` journal already had a stale entry (or any entry referencing the old tag), the migration would still be skipped. The generated snapshot UUID was also fake, which could cause issues with Drizzle's snapshot diffing.

2. **Adding graceful degradation (PR #32)**. This treated the symptom (crash on missing table) rather than the root cause (migration not generated properly). While the 503 handler pattern is correct and was merged, it wouldn't have fixed the fact that the migration never ran — the table would always return 503.

## Solution

Delete the hand-authored migration artifacts and regenerate them properly with `drizzle-kit generate`:

1. Remove the hand-authored `0003_snapshot.json`
2. Remove the idx 3 entry from `_journal.json`
3. Run `drizzle-kit generate` to produce proper artifacts with real timestamps and valid UUIDs
4. Rename the generated migration from `0003_normal_nebula` back to `0003_create_sr_theses_v2`

The regenerated journal entry now has:

- `when: 1777605152384` (correctly after idx 2's `1777555442009`)
- A proper Drizzle-generated snapshot UUID (not `f3c98020-1234-...`)
- The generated SQL is identical to the hand-authored version (verified via diff)

The startup verification for `srThesesV2` was also removed from the startup gate in `server.ts` (PR #32), and v2 handlers now catch Postgres error code `42P01` (undefined table) and return 503 instead of crashing.

## Why This Works

Drizzle's migration runner tracks applied migrations in a journal table (`regime_engine_migrations`). When `drizzle-kit generate` creates a migration, it:

1. Assigns a monotonically increasing `when` timestamp based on the current time
2. Generates a proper snapshot JSON with a real UUID
3. Records the entry in `_journal.json`

The migration runner uses the journal to determine which migrations to apply, checking entries in order. A `when` timestamp that predates earlier migrations means the entry appears to have been applied long ago — or in edge cases, can confuse the runner's ordering logic. The fake UUID in the snapshot can also collide with or invalidate Drizzle's internal snapshot diffing.

By regenerating from scratch using `drizzle-kit generate`, the migration metadata is internally consistent and correctly ordered, so the migration runner will apply it on the next deploy when Railway runs `preDeployCommand: pnpm run db:migrate`.

## Prevention

- **Never hand-edit Drizzle migration metadata.** Always use `drizzle-kit generate` to produce migration files. If you need to rename a migration, only change the directory/filename prefix (e.g., `0003_normal_nebula` → `0003_create_sr_theses_v2`), not the `_journal.json` or snapshot contents.

- **Verify journal ordering after generating migrations.** Run a quick check that each migration's `when` timestamp is greater than the previous one. A timestamps like `1746009600000` (2025) between `1777474187042` (2026) entries is an immediate red flag.

- **New tables should not be in the startup verification gate.** Use the 503 pattern instead: catch Postgres `42P01` at the handler level and return a service-unavailable response. This prevents a chicken-and-egg where the service crashes before migrations can apply. Only verify tables that already exist in production at startup.

- **Railway's `preDeployCommand: pnpm run db:migrate` runs before the service starts.** If your startup gate kills the process for a table that doesn't exist yet, the migration never gets a chance to create it. The fix is to let the service start and return 503 for endpoints that depend on un-migrated tables.

## Related

- `docs/solutions/best-practices/sqlite-to-postgres-drizzle-orm-migration-2026-04-29.md` — Drizzle ORM patterns including `pgSchema`, advisory locks, and raw SQL type coercion
- `docs/solutions/best-practices/postgres-schema-isolation-2026-04-28.md` — PG schema isolation, `regime_engine_migrations` table setup, and `drizzle-kit` in dependencies
- `docs/solutions/best-practices/additive-v2-sr-thesis-storage-2026-04-30.md` — v2 endpoint patterns including the null-store → 503 pattern that provides graceful degradation
- PR #32: Graceful degradation for missing tables (503 handler pattern)
- PR #34: Proper regeneration of 0003 migration
