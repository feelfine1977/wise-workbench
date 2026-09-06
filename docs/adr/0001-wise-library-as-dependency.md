# ADR 0001 — The method library is a pinned dependency, imported in one adapter

Status: accepted (2026-09-05)

## Context
The `wise` library (`wise-pm`) implements the method and reproduces the paper's
tables. Earlier prototypes forked the scoring logic into apps and drifted.

## Decision
`wise-pm` is a pinned dependency (`>=0.1,<0.2`) imported only in
`apps/backend/src/wise_workbench/adapters/engine`. The app never subclasses
library types, stores norms exactly as `Norm.dumps` emits them, and records
`wise.__version__` and `Norm.fingerprint()` on every run. Missing capabilities
are proposed upstream (`ScoreResult.save/load`, a `signal_matrix` of raw
constraint signals, a `handoffs` recipe kind).

## Consequences
Method changes happen once, in the library, under its tests; the app carries
no constraint semantics of its own; ad-hoc drill-downs that need a live
`ScoreResult` re-score from a warm per-worker cache (about two seconds on the
BPIC'19 log) until `save/load` exists upstream.
