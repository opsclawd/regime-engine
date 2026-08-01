# Plan Review Findings

## verdict

p1_found

## findings

- [P1] `task-manifest.json:Task 1` | "Task 1 replaces the schema constraint with a strict dual-pointer coherence check (`chk_synthesis_cursor_lease_coherence`) that requires both targets to be populated when leased and null when idle. This will cause immediate downtime for legacy workers during a rolling deployment. Legacy workers claiming new leases will fail the constraint because they leave `target_sr_theses_max_id` NULL. Legacy workers completing in-flight leases will fail because they clear `target_receipt_id` but leave the backfilled `target_sr_theses_max_id = 0`, violating the idle state. Deferring a known production outage to a 'Stop condition' instead of designing a backward-compatible migration strategy (e.g., relaxing the constraint for legacy states until code is fully deployed) is an unsafe deferral and a defect." | grounded
