# ADR 0010 — Analytics and knowledge packages live in the monorepo, split later

Status: accepted (2026-09-05)

## Context
`wise-analytics` and `process-knowledge` are useful outside the app but are
young and change with it.

## Decision
Both stay under `packages/` in this repository, each as an independently
installable distribution with its own `pyproject.toml`, README, tests,
changelog and version. They import `wise` and each other's public API only,
never `wise_workbench`. Releases to PyPI are cut from the monorepo with
path-filtered CI. When their APIs stabilise, `git subtree split` moves each
into its own public repository without rewriting history.

Exception: the visualisation library `@wise/flow` starts in its own
repository (ADR 0011).

## Consequences
One repository for the MVP; the split costs nothing later as long as the
import rule holds, which CI enforces.
