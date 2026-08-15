# Hetzner Migration Assessment and Deferred Execution Plan

Created: 2026-08-15

## Decision

Do not migrate the CLMM and Regime Engine workloads from Railway yet solely to reduce hosting cost or close the Railway account.

The migration is technically viable on the existing Hetzner VPS, but the measured savings are only about USD 60-78 per year before backup costs. That does not justify an estimated 2-4 focused days of migration work plus the permanent responsibility for deployments, monitoring, patching, backups, and recovery.

This is a **Hold**, not a rejection. Preserve the migration path and reassess it when cost, platform limits, or infrastructure-control requirements materially change.

## Scope and Repository Map

This assessment covers the three-service architecture:

- `opsclawd/clmm-v2`: the deployed backend is represented by the `clmm-api` and `clmm-worker` Railway services. The active local checkout used for this assessment was named `clmm-superpowers-v2`; the GitHub repository remains `opsclawd/clmm-v2`.
- `opsclawd/regime-engine`: the deployed runtimes are the API, GeckoTerminal collector, and Policy Insight synthesis worker.
- `opsclawd/sol-usdc-clmm-intelligence`: this service already runs on the Hetzner VPS through system cron and uses the host's native PostgreSQL installation.

The migration would move five Node.js processes and the shared CLMM/Regime PostgreSQL data from Railway. The intelligence service remains in place but must be rewired to the local CLMM and Regime endpoints during cutover.

## Evidence Snapshot

The following measurements were taken on 2026-08-15.

### Railway

- Six running workloads: `clmm-api`, `clmm-worker`, PostgreSQL, `regime-engine`, `gecko-collector`, and `regime-engine-synthesis-worker`.
- Previous billing-period resource usage: USD 6.50.
- Current billing-period projection: USD 5.04.
- Combined observed memory across all six workloads: approximately 731 MB.
- Observed CPU demand: negligible at the time of measurement.
- Stateful data reported by Railway included approximately 306 MB for PostgreSQL and 96 MB for the Regime Engine API volume. Collector and synthesis-worker volumes also existed because the shared Railway configuration requires `/data`, even though those processes do not own durable application state.
- Railway Hobby has a USD 5 monthly minimum that includes the first USD 5 of resource usage. At current demand, closing Railway would therefore save approximately USD 5-6.50 per month.

### Hetzner VPS

- 4 vCPUs and approximately 7.75 GB RAM.
- Approximately 5.4 GB RAM available during inspection.
- Approximately 29 GB free disk space.
- No swap configured.
- Existing services include Caddy, Docker, PostgreSQL 16, OpenClaw, Tailscale, fail2ban, and the intelligence collectors.
- The existing intelligence PostgreSQL database was approximately 522 MB.
- Caddy already owns public ingress, and PostgreSQL listens only on loopback.
- Coolify was not installed.

The host has enough steady-state CPU, RAM, and disk capacity for the Railway workloads. Build-time memory and disk spikes remain a risk because the host has no swap and already carries unrelated workloads.

## Why Migration Is Deferred

### Economics

The maximum demonstrated gross saving is approximately USD 78 per year. Even a well-rehearsed migration requires state transfer, deployment automation, TLS and DNS work, monitoring, backup configuration, restore testing, and a rollback window. The engineering and ongoing operational cost dominates the hosting saving.

Hetzner server backups cost an additional 20% of the server price when enabled. Off-host logical database and SQLite backups are still required because a server-level backup alone does not prove application-level recovery.

### Reliability and Operations

Railway currently provides builds, process supervision, health-aware routing, deploy logs, private networking, volume management, and rapid rollback of application images. Moving removes those managed controls.

The Hetzner VPS is a single failure domain. The end-to-end evidence pipeline already depends on this host because the intelligence service runs there, but migrating would also make the public CLMM API and all Regime Engine functions unavailable during a host or operator failure.

### Coolify Is Not the Current Target

Do not install Coolify on the existing VPS as part of this migration.

Coolify recommends a fresh server, at least 2 CPU cores, 2 GB RAM, and 30 GB free disk. The existing host has only 29 GB free and already runs Caddy, Docker, native PostgreSQL, and multiple long-lived services. Installing another control plane and proxy on this host would add resource pressure, port conflicts, and another stateful system to back up.

Provisioning a separate VPS for Coolify would eliminate the primary economic benefit of leaving Railway.

## Reconsideration Triggers

Reopen this plan when any one of these conditions is true:

- Railway costs exceed USD 15-20 per month for three consecutive billing periods.
- Railway service, replica, storage, or networking limits block a required capability.
- A non-financial requirement makes infrastructure ownership necessary, such as local-only networking, data-residency requirements, or a repeatable self-hosted deployment platform shared by several projects.
- The Hetzner host has tested off-host backups, documented recovery, monitoring and alerts, sufficient swap or off-host builds, and enough disk headroom for releases and retained images.
- A second host or an acceptable disaster-recovery strategy exists for the public CLMM API.

Reassessment must repeat both the Railway billing query and the Hetzner capacity measurements. Do not activate this plan using the 2026-08-15 numbers as timeless assumptions.

## Target Architecture When Activated

Use the host's existing infrastructure rather than adding Coolify:

- Run the five Node.js processes under systemd with explicit restart policies, environment files, health checks, and log retention.
- Keep native PostgreSQL 16 and restore the Railway database into a new isolated database. Preserve the existing per-service schemas and migration-history tables.
- Keep PostgreSQL bound to loopback. Run application processes on the host so they can use local database connections without exposing PostgreSQL to Docker networks or the public internet.
- Use the existing Caddy installation for TLS and public routing.
- Expose only the CLMM API publicly. Keep the CLMM worker, Regime API, collector, synthesis worker, and PostgreSQL on loopback unless a verified external producer requires Regime ingress.
- Route intelligence collectors to local CLMM and Regime endpoints.
- Store the Regime SQLite ledger outside release directories with ownership restricted to the Regime service account.
- Build release artifacts in CI or another host when possible; deploy immutable artifacts rather than compiling all repositories on the production VPS.
- Send PostgreSQL and SQLite backups to off-host storage and test restoration on a schedule.

The deployment design must preserve the existing migration ownership rules:

- CLMM API owns CLMM migrations; CLMM worker never runs migrations and must refuse to process jobs until the schema is ready.
- Regime API owns Regime migrations; collectors and synthesis workers never race the API for migration ownership.
- Database rollback remains forward-fix only. Do not restore old application code against a schema it no longer supports.

## Prerequisites

Do not schedule a production cutover until all prerequisites are complete:

- A stable custom domain exists for the CLMM API. `api.clmm.v2.app`, the endpoint documented in the application environment example, did not resolve during the assessment. Do not couple another client release to a provider-generated hostname.
- The deployed mobile and web clients' actual BFF base URL is inventoried, and the impact of changing it is known.
- A complete, redacted inventory of Railway environment-variable names exists for all five processes and PostgreSQL. Secret values remain in the password manager, not in repository files.
- New service accounts and restricted environment files exist on the VPS.
- The host has swap or release builds are performed off-host.
- Caddy routing, firewall policy, systemd supervision, log rotation, resource limits, and health monitoring are ready before application data moves.
- PostgreSQL logical backup and restore have been rehearsed into a disposable database.
- Regime SQLite backup, `PRAGMA integrity_check`, copy, ownership, startup, and restore have been rehearsed using a non-production copy.
- Off-host backups exist for both data stores, with at least one successful restore test.
- A monitoring destination can alert on CLMM API health, Regime health, worker liveness, disk pressure, memory pressure, PostgreSQL health, and missed intelligence schedules.
- Railway remains active throughout rehearsal and the observation window.

## Deferred Execution Plan

### Phase 0: Revalidate the Decision

1. Re-measure Railway monthly spend, per-service memory, CPU, network, and volume usage.
2. Re-measure VPS memory, swap, disk, process footprint, PostgreSQL size, and port ownership.
3. Confirm a reconsideration trigger is satisfied.
4. Re-estimate migration and ongoing operational cost.

**Exit criterion:** the economic or control benefit now exceeds the migration and operational cost. Otherwise return to Hold.

### Phase 1: Build the Host Deployment Foundation

1. Define a stable release layout outside the intelligence checkout.
2. Create separate service accounts and environment files for CLMM and Regime processes.
3. Add systemd units for `clmm-api`, `clmm-worker`, `regime-engine`, `gecko-collector`, and `regime-engine-synthesis-worker`.
4. Encode migration ownership and schema-readiness ordering into deployment scripts.
5. Add Caddy routing for the stable CLMM API domain while keeping backend-only ports on loopback.
6. Configure health monitoring, log retention, resource alerts, and off-host backups.
7. Deploy the application processes against disposable databases and a copied SQLite ledger.

**Exit criterion:** every process survives restart, unhealthy processes restart or alert correctly, logs remain bounded, and no backend-only port is publicly reachable.

### Phase 2: Rehearse State Migration

1. Create a consistent Railway PostgreSQL logical backup without changing production.
2. Restore it into the isolated Hetzner database and verify schemas, migration journals, row counts, constraints, and representative reads.
3. Copy the Regime SQLite ledger while the rehearsal target is offline, run integrity checks, and verify representative plan, execution-result, and report reads.
4. Point staged CLMM and Regime processes at the restored stores.
5. Run the cross-service smoke suite, worker readiness checks, and one non-authoritative intelligence collection cycle.
6. Destroy and repeat the rehearsal from the documented backups to prove repeatability.

**Exit criterion:** two clean rehearsals produce the same validation results without manual database repair.

### Phase 3: Prepare Cutover and Rollback

1. Lower DNS TTL far enough in advance for the chosen domain.
2. Freeze the exact Railway deployment versions and record the rollback targets.
3. Confirm the final cutover order, maintenance window, operator, and abort thresholds.
4. Pause every writer before the final PostgreSQL dump and SQLite copy. This includes CLMM worker jobs, Regime collectors and synthesis, intelligence schedules that publish to Regime, and external ingest producers.
5. Confirm the rollback path can restore the old DNS route and resume Railway writers without accepting writes on both sides.

**Exit criterion:** the operator can name every writer, stop it, verify it stopped, and restore the Railway path without improvisation.

### Phase 4: Cut Over

1. Enter the maintenance window and stop all writers.
2. Take final PostgreSQL and SQLite backups and record checksums.
3. Restore PostgreSQL and place the SQLite ledger on Hetzner.
4. Run migrations once through the designated API owners.
5. Start Regime API, then Regime workers, then CLMM API, then CLMM worker.
6. Update local service URLs and restart intelligence schedules.
7. Run store integrity, health, contract, authentication, worker, and end-to-end smoke checks.
8. Switch the stable CLMM API domain to Caddy on Hetzner.
9. Resume writers only after public and internal checks pass.

**Abort conditions:** failed integrity checks, missing migration history, unexplained row-count differences, failed authentication boundaries, worker processing before readiness, or inability to restore the public endpoint. On abort, stop Hetzner writers, restore DNS to Railway, and resume Railway in the recorded order.

### Phase 5: Observe Before Cancelling Railway

Keep Railway intact but quiescent for at least seven days.

During the observation window:

- Confirm every intelligence cadence completes and publishes successfully.
- Confirm CLMM worker queues advance without duplicates or stranded jobs.
- Confirm Regime synthesis cursors and leases recover across restarts.
- Confirm the SQLite ledger grows only on Hetzner and survives a service restart.
- Confirm daily off-host backups and perform one restore into an isolated location.
- Monitor public latency, error rate, memory, disk growth, PostgreSQL health, and Caddy TLS renewal state.
- Confirm no production caller still uses a Railway-generated domain.

Cancel Railway only after the observation window passes, a final backup is stored off-platform, and rollback is intentionally retired. Railway documents that cancelling a subscription stops workspace deployments and that Hobby volume data is retained temporarily after cancellation; treat that retention as a last-resort grace period, not a backup strategy.

## Validation Checklist

The migration is complete only when all of the following are true:

- CLMM `/health` reports schema readiness through the stable public domain.
- Regime `/health` reports both PostgreSQL and SQLite healthy.
- CLMM authentication challenges and a read-only supported-position flow succeed.
- CLMM API reaches Regime through the configured local URL with the internal token.
- Regime accepts an authenticated evidence bundle and exposes the resulting current insight.
- CLMM execution-result delivery is accepted once and replayed idempotently.
- Gecko collection writes fresh candles through the authenticated ingest route.
- Policy synthesis advances its cursor and recovers after a forced process restart.
- CLMM worker refuses to start against an incomplete schema and processes normally after readiness.
- Intelligence collection reaches local CLMM and Regime endpoints and completes one full evidence cycle.
- The Regime SQLite ledger passes integrity checks before and after restart.
- PostgreSQL schema, migration history, representative row counts, and application reads match the final Railway source.
- Backend-only ports and PostgreSQL are unreachable from the public internet.
- Alerts fire for a deliberately stopped non-production service.
- PostgreSQL and SQLite backups restore successfully into isolated targets.
- The stable public domain resolves to Hetzner and no production configuration references `*.up.railway.app` or `*.railway.internal`.

## Effort Estimate

- Deployment foundation and service definitions: 6-10 hours.
- Database and SQLite rehearsal: 4-8 hours.
- Caddy, DNS, security, monitoring, and backups: 4-8 hours.
- Cutover rehearsal, final migration, and rollback validation: 4-6 hours.

Expected total: approximately 18-32 focused hours. Requiring zero-downtime application deployment or adding a new control plane would increase the estimate.

## Risks and Mitigations

| Risk                                                  | Consequence                                | Mitigation                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL dump is inconsistent with active writers   | Lost or duplicated state                   | Stop all writers for the final dump; compare migration history and representative row counts before resume                       |
| SQLite ledger copied while writes continue            | Corrupt or incomplete ledger               | Stop Regime and every producer, checkpoint if required, run integrity checks, and checksum the final copy                        |
| CLMM worker starts before migrations                  | Jobs run against an incomplete schema      | Preserve API-only migration ownership and the worker schema-readiness gate                                                       |
| Public clients depend on a Railway hostname           | Client outage after cancellation           | Establish and validate a stable custom domain before cutover                                                                     |
| VPS memory or disk spikes during build                | Host-wide outage                           | Add swap or build off-host; set resource alerts and retain bounded releases                                                      |
| Coolify conflicts with existing services              | Proxy, port, and state-management failures | Do not install Coolify on this host; use existing Caddy, PostgreSQL, and systemd                                                 |
| Single VPS failure affects all three services         | Full architecture outage                   | Maintain tested off-host backups and a documented rebuild path; reconsider a second host if availability requirements rise       |
| Secrets are copied incorrectly or exposed             | Authentication failure or compromise       | Inventory names only, transfer through the password manager, restrict environment files, and rotate shared tokens during cutover |
| Railway is cancelled before confidence is established | Rollback and data recovery become harder   | Keep Railway quiescent through the observation window and save final off-platform backups before cancellation                    |

## Relevant Repository References

In `opsclawd/regime-engine`:

- `README.md` documents the PostgreSQL and SQLite ownership split and the Railway service topology.
- `Dockerfile`, `railway.toml`, and `scripts/start.sh` define the current API, collector, synthesis-worker, volume, migration, and health behavior.
- `docs/runbooks/railway-deploy.md` is the authoritative current deployment and smoke-test runbook.
- `docs/solutions/best-practices/postgres-schema-isolation-2026-04-28.md` records the shared-PostgreSQL schema and migration-history rules.
- `docs/solutions/database-issues/hand-authored-drizzle-migration-crash-loop-2026-04-30.md` records the forward-only migration failure mode.

In `opsclawd/clmm-v2`:

- `packages/adapters/railway.api.toml` and `packages/adapters/railway.worker.toml` define migration ownership and process startup.
- `docs/runbooks/railway-deploy.md` documents schema readiness, deploy ordering, health behavior, and rollback constraints.
- `apps/app/.env.example` declares the stable public BFF URL contract.

In `opsclawd/sol-usdc-clmm-intelligence`:

- `scripts/deploy-live.sh` defines the current update, migration, and system-cron installation sequence.
- `docs/operator-runbook.md` documents local CLMM and Regime endpoint configuration.
- `scheduling.md` documents the production scheduler and cadence assumptions.

## External References

- Railway pricing and included Hobby usage: https://docs.railway.com/pricing
- Railway plan and cancellation data-retention details: https://docs.railway.com/pricing/plans
- Railway cancellation behavior: https://docs.railway.com/pricing/faqs
- Hetzner cloud-server SLA: https://docs.hetzner.com/general/company-and-policy/slas-cloud/
- Hetzner server-management and backup responsibility: https://docs.hetzner.com/general/security-and-identify/technical-and-organizational-measures/
- Hetzner backup pricing: https://docs.hetzner.com/cloud/billing/faq/
- Coolify installation and host requirements: https://coolify.io/docs/get-started/installation
