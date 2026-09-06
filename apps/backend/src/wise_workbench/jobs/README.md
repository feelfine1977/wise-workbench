# apps/backend/src/wise_workbench/jobs

Crash-safe job queue on the `jobs` table (leases, heartbeats, retries, cancel, progress) and worker processes; one handler per job kind: ingest, build_cases, score_run, diagnostics, compare, export.
