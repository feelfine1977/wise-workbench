# packages/wise-analytics

Python package `wise_analytics`: interpretable analytics on top of `wise`
artefacts, kept out of the method library (which stays numpy + pandas and
method-pure; ADR 0006). Every function takes `wise` objects (`EventLog`,
`Norm`, `ScoreResult`, backlogs) and returns a frozen result with

- `.table` — the numbers as a DataFrame,
- `.summary` — scalar facts as a read-only mapping,
- `.record` — a provenance `Record` (analytic, version, `wise` version,
  log and norm fingerprints, parameters, output hash, warnings, runtime;
  `record_id` is a deterministic SHA-256 of everything but the runtime),
- `.readings` — template sentences in the descriptive vocabulary of
  `CUSTOMER_JOURNEY.md` §8 ("carries", "coincides with", "headroom under
  the norm"; never "causes", "root cause", "will improve").

Nothing here re-implements scoring or estimates causal effects: the
analytics consume `ScoreResult.penalties`, `effective_weights`,
`violations`, `in_scope`, the log primitives and the library's
`prioritize`, `layer_drivers`, `gap_retained`, `right_censored`,
`event_replication`, `cross_case_replication`, `validation_table`,
`estimate_gamma`, `top_k_overlap` and `evaluate_constraint`.

## Install

```bash
cd packages/wise-analytics
python3 -m venv .venv
.venv/bin/pip install -e ../../wise-lib          # wise-pm from the local checkout
.venv/bin/pip install -e '.[dev,stats]'
```

`pyproject.toml` declares `[tool.uv.sources] wise-pm = { path = "../../wise-lib", editable = true }`
for `uv`. Python 3.11 or later; `scipy` is optional.

## API (MVP, checkpoint CP-C1)

```python
import wise, wise_analytics as wa

log, norm = wise.running_p2p_log(), wise.running_p2p_norm()
result = wise.score(log, norm)

# 1.1 uncertainty — case (or cluster) bootstrap of the backlog
u = wa.bootstrap_backlog(result, by=["company"], view="Finance", gamma=2.0,
                         B=200, seed=0, cluster=None, k=(5, 10), ci=0.90, min_support=10)
u.table          # backlog columns + rank, <metric>_lo/_hi for gap, stable_gap, PI, stable_PI,
                 # rank_lo/rank_hi, p_top5, p_top10, stability, stability_reason
u.draws          # replicates × slices of stabilised PI (for strip charts)
wa.STABILITY_RULE  # the documented badge rule (stable / fragile / insufficient support)

e = wa.sensitivity_envelope(result, by=["company"], view="Finance", gamma=2.0,
                            gamma_grid=None, scale=(0.8, 1.25), weight_jitter=0.1, n_jitter=3, k=10)
e.table          # rank_ref, rank_min, rank_max, topk_settings, n_settings, always_topk
e.settings       # one row per setting with its top-k Jaccard overlap to the reference

# 1.2 contrast — exact gap decomposition with descriptive effect sizes
c = wa.contrast_slice(result, "Finance", {"company": "B"}, ci=0.90, B=200, seed=0)
c.table          # per constraint: delta (sums to μ̄ − μ_s), delta_lo/hi, share_of_gap,
                 # rate_slice, rate_rest, risk_difference (+ Newcombe rd_lo/rd_hi), relative_risk,
                 # share_evaluated/in_scope, unit, median_slice/rest, hl_shift, cliffs_delta,
                 # q50_shift, q90_shift, pattern (whole distribution / tail / no material shift)
c.layers         # the same identity by layer (equals wise.layer_drivers' __delta)
c.ecdf["c2"]     # x, F_slice, F_rest for the overlay chart
wa.raw_signals(log, norm)   # cases × constraints in native units (days, counts, relative difference)

# 1.3 readiness gate
q = wa.readiness(log, norm, result=result, by=["company"], view="Finance", gamma=2.0,
                 closure=["Clear Invoice", "Cancel Invoice Receipt"], opened_by="Record Invoice Receipt",
                 period="M", group_col=None, document_col=None, k=10, thresholds=None)
q.status         # pass / warn / fail
q.table          # one row per check: status, metric, value, threshold_warn, threshold_fail, evidence
q.evidence       # detail DataFrame per check; q.slices = the paper's Table XII for the top-k slices
wa.vocabulary_drift(log, "M")   # the drift table on its own

# 1.5 headroom under the norm and weight what-ifs
h = wa.headroom(result, "Finance", {"company": "B"}, gamma=2.0)
h.table          # per constraint: headroom_score (= mean penalty, exact rise of μ_s),
                 # headroom_PI, stable_PI_after, PI_reduction, share_of_PI, share_violated
wa.headroom_by(result, ["company"], "Finance", gamma=2.0)   # all slices at once (long table)
w = wa.whatif_weights(result, "Logistics", by=["company"], view="Finance", gamma=2.0, k=10)
w.table          # rank / stable_gap / stable_PI before and after; summary has top_k_overlap
wa.rescore_view(result, {"c1": 0.5, "c2": 0.5})   # per-case scores for new weights from cached V

# synthetic evaluation data
slog, truth = wa.generate("p2p", n_cases=3000, seed=1,
                          hotspots=None,                         # default: three planted mechanisms
                          artefacts=wa.synthetic.DEFAULT_ARTEFACTS)
truth.hotspots, truth.artefacts, truth.norm      # ground truth next to the log
```

Slices are given as `{attribute: value}` (AND) or as a boolean mask over
cases; `by` follows `wise.prioritize`. All numbers are computed with the
scoring mode of the result (`flat` or `layer_balanced`) because they are
built from the library's effective weights.

### Readiness checks

| Check | What is measured | Library function used |
|---|---|---|
| `sentinel_dates` | events further than 3·MAD + 365 d from the median timestamp | `timestamp_outliers` (evidence) |
| `timestamp_concentration` | share of events on the busiest timestamp (informational) | — |
| `duplicate_events` | exact duplicate rows; duplicate (case, activity, timestamp) | — |
| `timestamp_precision` | date-only vs time-of-day mix per activity; lag pairs of different precision | — |
| `vocabulary_drift` | Jensen–Shannon divergence per period, new / vanished labels | `Norm.activities` |
| `exposure_sanity` | zero exposure, order-of-magnitude outliers, group medians decades apart | — |
| `window_edge_share` | activations within δ+Δ of the window end per lag constraint | `EventLog.first_ts` |
| `right_censoring` | censored cases; gap retained without them for the top-k slices | `right_censored`, `gap_retained` |
| `replication` | cases with > 2 events per timestamp; replicated share per top-k slice | `event_replication`, `cross_case_replication` |

Thresholds are conventions (`wa.DEFAULT_THRESHOLDS`), configurable per call
and recorded in the provenance record. A check whose inputs are missing is
`skipped`.

### Stability badge

`stable` / `fragile` / `insufficient_support`, relative to the largest `k` reported
(default 10): a slice with fewer than `min_support` scored cases is
`insufficient_support`; otherwise `p` is the bootstrap share of
replicates in which the slice keeps the position the point estimate gives
it (inside or outside the top-k), and the badge is `stable` for `p ≥ 0.8`,
`fragile` for `0.5 ≤ p < 0.8`, `insufficient_support` below. The sensitivity envelope is a
set of settings, not a probability; combine it with the badge by requiring
`always_topk`.

## Modules

| Module | Content | Tier |
|---|---|---|
| `uncertainty.py` | `bootstrap_backlog`, `sensitivity_envelope` | MVP |
| `contrast.py` | `contrast_slice`, `raw_signals`, `signal_units` | MVP |
| `quality.py` | `readiness`, `vocabulary_drift`, `DEFAULT_THRESHOLDS` | MVP |
| `whatif.py` | `headroom`, `headroom_by`, `whatif_weights`, `rescore_view` | MVP (headroom) / v1 (weights) |
| `provenance.py` | `Record`, `record`, `AnalyticResult`, `hash_frame`, `log_fingerprint` | MVP |
| `synthetic.py` | `generate`, `subsample_cases`, `GroundTruth`, `Hotspot` | MVP |
| `vocabulary.py` | `check_reading`, `FORBIDDEN` — enforced on every reading by the tests | MVP |
| `demo.py` | `python -m wise_analytics.demo` (checkpoint CP-C1) | MVP |
| `norm_aids.py`, `monitoring.py`, `signatures.py`, `subgroups.py`, `resources.py`, `forecast.py` | not started (see `CHECKPOINT.md`, "Not done") | v1 / later |

## Development

```bash
.venv/bin/pytest            # 66 tests, about 10 s
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests
.venv/bin/mypy
.venv/bin/python -m wise_analytics.demo
```

Dependencies: `numpy`, `pandas`, `pyarrow`, `wise-pm`; optional `scipy`,
`scikit-learn` (a shallow tree only, later), `joblib`. No SHAP, boosting,
deep learning, `lifelines` or `statsmodels`.
