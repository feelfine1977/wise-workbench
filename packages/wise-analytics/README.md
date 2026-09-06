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
`prioritize`, `layer_drivers`, `penalty_mass`, `gap_retained`,
`right_censored`, `event_replication`, `cross_case_replication`,
`validation_table`, `estimate_gamma`, `top_k_overlap`,
`hotspot_table` and `evaluate_constraint`.

## Install

```bash
cd packages/wise-analytics
python3 -m venv .venv
.venv/bin/pip install -e ../../wise-lib          # wise-pm from the local checkout
.venv/bin/pip install -e '.[dev,stats]'
```

`pyproject.toml` declares `[tool.uv.sources] wise-pm = { path = "../../wise-lib", editable = true }`
for `uv`. Python 3.11 or later; `scipy` is optional.

## API (checkpoint CP-C2)

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
c.norm           # the norm the slice was scored with (for the plain sentences)
wa.raw_signals(log, norm)   # cases × constraints in native units (days, counts, relative difference)

# 1.3 readiness gate — one window end, one definition of censoring, duplicates and precision
q = wa.readiness(log, norm, result=result, by=["company"], view="Finance", gamma=2.0,
                 closure=["Clear Invoice", "Cancel Invoice Receipt"], opened_by="Record Invoice Receipt",
                 window="60D", window_end=None, period="M", group_col=None, document_col=None,
                 asymmetry_pairs=None, k=10, items="purchase order items", closure_label="clearing",
                 thresholds=None)
q.status         # pass / warn / fail
q.table          # one row per check: status, metric, value, threshold_warn, threshold_fail, window_end, evidence
q.window_end     # the window end every check was computed against (summary["window_end_source"] says where it came from)
q.evidence       # detail DataFrame per check; q.slices = the paper's Table XII for the top-k slices,
                 # with the censoring sentence in `reading` when the censored share reaches 20 %
q.case_flags     # per case: censored, replicated, duplicate, sentinel, window_edge
wa.caveats_for_slice(q, {"company": "B"}, items="purchase order items", closure_label="clearing")
                 # → [Caveat(id, n, n_group, share, status, text, window_end), …] — the caveat chips of a card
wa.caveats_by(q, ["company"])          # caveat shares for every slice at once
wa.vocabulary_drift(log, "M")          # the label-drift table on its own
wa.activity_frequency_drift(log, "M")  # share of cases with each activity per start period (R1-37)
wa.logging_asymmetry(log, norm=norm)   # releases logged without their setting activity (R1-24)

# 1.4 plain sentences for cards (cycle 1 review §9, R1-03/04/06)
wa.comparison_sentence(c, top=1, items="purchase order items",
                       labels={"c2": "invoices arrive {slice} days after the goods here against {rest} elsewhere ({diff} days)"})
wa.comparisons(c, top=3)               # kind (lag / count / share / metric / rate), values, unit, rates, sentence
wa.points_below(0.835, 0.844)          # "0.9 points below the overall score of 84.4 (1 %)"
wa.problem_kind(wise.prioritize(result, "company", view="Finance", gamma=2.0))   # acute / systematic / widespread / none
wa.problem_kinds(result, "company", gamma=2.0, primary="Finance")               # one kind per group across views
wa.kind_reading("widespread", items="purchase order items")                    # "widespread: many purchase order items, each slightly off"
wa.KIND_RULE                            # the documented rule with its thresholds

# 1.5 headroom under the norm and weight what-ifs
h = wa.headroom(result, "Finance", {"company": "B"}, gamma=2.0)
h.table          # per constraint: headroom_score (= mean penalty, exact rise of μ_s),
                 # headroom_PI, stable_PI_after, PI_reduction, share_of_PI, share_violated
wa.headroom_by(result, ["company"], "Finance", gamma=2.0)   # all slices at once (long table)
w = wa.whatif_weights(result, "Logistics", by=["company"], view="Finance", gamma=2.0, k=10)
w.table          # rank / stable_gap / stable_PI before and after; summary has top_k_overlap
wa.rescore_view(result, {"c1": 0.5, "c2": 0.5})   # per-case scores for new weights from cached V

# 1.6 sub-groups inside a group (RG-8, R1-28)
s = wa.subgroups(result, {"company": "B"}, ["vendor", "flow_type"], view="Finance",
                 period="Q", censored=q.case_flags["censored"], window_end=q.window_end, top=10,
                 items="purchase order items", closure_label="clearing")
s.table          # (attribute, value) × n_cases, penalty_mass, mean_penalty, share, cum_share, rank,
                 # censored_share, partial_period, caveat — the library's penalty_mass per attribute
s.summary["per_attribute"]   # n_values, values_for_80pct, top_value, top_share

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

### One window end, one definition (R1-02)

Every readiness number is computed against one window end and with the
library's own diagnostics, so that the backend's readiness report, the
validation table and this gate print the same censored share and the same
duplicate count for a group:

- **window end** — the explicit `window_end` argument; else the log's
  explicit window; else the end of the robust observation window
  `EventLog.observation_window()` (the 1 − q quantile of case ends,
  q = 0.001). Only when that robust end is itself a far-out date (more
  than `sentinel_gap_days` beyond the bulk of the timestamps) the bulk end
  is used, the sentinel check fails and `summary["window_end_source"]`
  says so. The value sits in the `window_end` column of every check row,
  in `summary["window_end"]`, in the record's parameters and in every
  caveat sentence.
- **right-censored case** — `wise.right_censored` with that window end:
  no closure activity, last event within `window` (60 days) of the end,
  and (with `opened_by`) an opening activity present.
- **duplicate event** — same case, activity and timestamp as an earlier
  event (the key `EventLog(dedupe=True)` drops); exact duplicate rows are
  reported next to it.
- **timestamp precision** — an event is *day*-precise when it carries no
  time of day; an activity is `day` / `time` / `mixed` by the share of
  its events (5 % margins); a lag whose two ends differ in precision is
  named.

On BPIC 2019 (1.6 M events, 251,734 items) the gate reports window end
2019-01-17 from the robust window, 34,947 censored items (13.9 %),
Packaging 14.4 % — the library's `right_censored` with the same window
end gives the same 14.4 % — and 180,913 duplicate events; the Real Estate
row of the validation table reads "44 % of purchase order items still open
at the end of the data (2019-01-17): late clearing cannot be judged".

### Readiness checks

| Check | What is measured | Library function used |
|---|---|---|
| `sentinel_dates` | events further than 3·MAD + 365 d from the median timestamp | `timestamp_outliers` (evidence) |
| `timestamp_concentration` | share of events on the busiest timestamp (informational) | — |
| `duplicate_events` | events sharing case, activity and timestamp with an earlier event; exact rows as a subset | the `dedupe` key of `EventLog` |
| `timestamp_precision` | day / time / mixed precision per activity; lag pairs of different precision | — |
| `vocabulary_drift` | Jensen–Shannon divergence per period, new / vanished labels | `Norm.activities` |
| `frequency_drift` | share of cases with each activity by start period; largest step between two stretches of periods (periods within the censoring window excluded) | `EventLog.count`, `cases.first_ts` |
| `logging_asymmetry` | releasing / closing activity logged without its setting activity (`Remove Payment Block` vs `Set Payment Block`); pairs detected from the labels or given | `EventLog.count` |
| `exposure_sanity` | zero exposure, order-of-magnitude outliers, group medians decades apart | — |
| `window_edge_share` | activations within δ+Δ of the window end per lag constraint | `EventLog.first_ts` |
| `right_censoring` | censored cases; gap retained without them for the top-k slices | `right_censored`, `gap_retained` |
| `replication` | cases with > 2 events per timestamp; replicated share per top-k slice | `event_replication`, `cross_case_replication` |

Thresholds are conventions (`wa.DEFAULT_THRESHOLDS`), configurable per call
and recorded in the provenance record. A check whose inputs are missing is
`skipped`. `logging_asymmetry` warns from a 10 % share of releases without
a logged setting event and fails at 50 % only when the norm references the
setting activity (an expectation on it would measure logging, not
behaviour).

### Caveats on cards (RG-20)

`caveats_for_slice(report, where)` returns, for any group, the caveats
that touch it with their share and a plain sentence: censoring ("14 % of
purchase order items still open at the end of the data (2019-01-17): late
clearing cannot be judged"), replication ("copied postings"), duplicates,
placeholder dates and the window edge. Each carries a status from the
report's thresholds and the window end; `Caveat.to_dict()` gives the
contract's `{id, share, text, …}`.

### Plain sentences (cycle 1 review §9)

- `comparison_sentence(contrast, top=1)` — one real-unit sentence from the
  top driver: lags as medians with the Hodges–Lehmann shift in brackets
  ("invoices clear 83 days after receipt here against 55 elsewhere
  (+25 days)"), counts as "14 receipt postings per item here against 1
  elsewhere", rates as "62 % of items without an invoice here against
  10 % elsewhere"; the rate form is the fallback when no real-unit shift
  is material. `labels` carry the plain phrases of the guidance object
  (a label with `{slice}`, `{rest}`, `{diff}` is a full template); without
  them the norm's descriptions and activity names are used. No constraint
  id appears in a sentence.
- `points_below(mean, global_mean)` — "0.9 points below the overall score
  of 84.4 (1 %)": distances as score points with the percent in brackets,
  never a bare percent.
- `problem_kind(backlog)` — acute / systematic / widespread / none from the
  group's own gap and size against the backlog's distributions
  (`KIND_RULE`: percentile ranks, a 1/3 margin); `problem_kinds(result, by)`
  keeps one kind per group across views (the primary view's kind wherever
  the gap is positive); the library's `hotspot_table` type is kept as an
  alias. `kind_reading(kind)` gives the sentence.

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
| `quality.py` | `readiness`, `caveats_for_slice`, `caveats_by`, `vocabulary_drift`, `activity_frequency_drift`, `logging_asymmetry`, `DEFAULT_THRESHOLDS` | MVP / cycle 2 |
| `plain.py` | `comparison_sentence`, `comparisons`, `points_below`, `problem_kind`, `problem_kinds`, `kind_reading`, `KIND_RULE` | cycle 2 |
| `subgroups.py` | `subgroups` — penalty mass by attribute value inside a group, censoring caveat on periods | cycle 2 |
| `whatif.py` | `headroom`, `headroom_by`, `whatif_weights`, `rescore_view` | MVP (headroom) / v1 (weights) |
| `provenance.py` | `Record`, `record`, `AnalyticResult`, `hash_frame`, `log_fingerprint` | MVP |
| `synthetic.py` | `generate`, `subsample_cases`, `GroundTruth`, `Hotspot` (nine planted artefacts) | MVP |
| `vocabulary.py` | `check_reading`, `FORBIDDEN` — enforced on every reading and sentence by the tests | MVP |
| `demo.py` | `python -m wise_analytics.demo` (checkpoint CP-C2) | MVP |
| transform layer (`whatif.transform`, `whatif_scenario`), hypothesis helpers (`test_hypothesis`), `norm_aids.py`, `monitoring.py`, `signatures.py`, `resources.py`, `forecast.py` | not started (see `CHECKPOINT.md`, "Not done") | cycle 3 / later |

## Development

```bash
.venv/bin/pytest            # 86 tests, about 13 s
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests
.venv/bin/mypy
.venv/bin/python -m wise_analytics.demo
```

Dependencies: `numpy`, `pandas`, `pyarrow`, `wise-pm`; optional `scipy`,
`scikit-learn` (a shallow tree only, later), `joblib`. No SHAP, boosting,
deep learning, `lifelines` or `statsmodels`.
