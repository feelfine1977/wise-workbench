# ADR 0006 — Analytics live in `wise-analytics`; no black-box or causal claims

Status: accepted (2026-09-05)

## Context
The library already yields exact, additive quantities (violations, scores,
layer contributions, penalties, PI with shrinkage, drivers, diagnostics).
Earlier prototypes added SHAP, random forests and isolation forests without
rigour.

## Decision
Analytics that add value — bootstrap uncertainty and rank stability,
contrastive gap decomposition with effect sizes in native units, the
readiness gate, headroom under the norm, period monitoring with SPC limits,
norm-engineering proposals, signatures and PI-guided subgroups — are
implemented in a separate package `wise-analytics` with typed results and
provenance records. Excluded by policy: predictors of scores presented as
root causes, SHAP/LIME on an already additive score, unsupervised anomaly
detection as deviation evidence, causal effect claims from observational
logs, silent norm learning, p-value headlines, deep predictive monitoring.

## Consequences
Every displayed number comes from `wise` or `wise-analytics`; results carry
claim, evidence, uncertainty, caveats and provenance; wording is restricted
to descriptive vocabulary.
