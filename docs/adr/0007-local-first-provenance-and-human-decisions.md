# ADR 0007 — Local-first, reproducible artefacts, and human-only decisions

Status: accepted (2026-09-05)

## Context
Trust in a ranked backlog depends on reproducibility, traceability and on
knowing which choices were made by whom.

## Decision
All data stays under the workspace directory; the only network egress is the
configured local LLM endpoint; no telemetry. Every result-bearing artefact
records `(log content hash, mapping id, norm fingerprint, parameters hash,
library version)`. Runs with the same inputs return the existing result.
Thresholds, widths, weights, γ, case notion, applicability, validation
readings, case exclusions, hotspot-label overrides, root causes, action
owners, norm approvals and re-baselining are human actions with a mandatory
note and author. Baselines for period comparison are frozen and named.

## Consequences
An auditor can recompute any backlog from the project folder; the governance
pack carries run ids and the method appendix; the product never degenerates
into an unattributed dashboard.
