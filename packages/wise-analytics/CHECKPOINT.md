# CP-C1 — Analytics package (`wise_analytics`)

Workstream C, increment 0. What a person runs, what appears, and what
"pass" means. Numbers below come from an actual run on 2026-09-05
(Python 3.13, `wise` 0.1.0, numpy 2.5, pandas 3.0).

## Setup

```bash
cd packages/wise-analytics
python3 -m venv .venv
.venv/bin/pip install -e ../../wise-lib
.venv/bin/pip install -e '.[dev,stats]'
```

## 1. The checkpoint demo

```bash
.venv/bin/python -m wise_analytics.demo            # add --quiet to omit the readings
```

Runs in about half a second and exits with code 0 when every identity holds
and every planted artefact is flagged (`CHECKS FAILED` and exit code 1
otherwise). Ten sections:

1. **Running example, bootstrap by company (Finance, γ = 2, B = 200).**
   Expected table (seed 1):

   ```
            n_cases  mean_score  stable_gap  stable_gap_lo  stable_gap_hi  stable_PI  stable_PI_lo  stable_PI_hi  rank  rank_lo  rank_hi  p_top5 stability
   company
   B              3      0.6400      0.0419            0.0         0.1772     0.1257           0.0        0.3684     1      1.0      2.0    0.65      fragile
   A              2      0.8146      0.0000            0.0         0.0613     0.0000           0.0        0.1260     2      1.0      2.0    0.28      fragile
   ```

   The point estimates are those of `wise.prioritize` (paper Table VI:
   μ_B = 0.640, μ̄ = 0.710). Five cases cannot support a "stable" badge;
   the reason column says why.

2. **Running example, contrast waterfall for company=B (Finance).** The
   bars (`delta`) are `mean_s(π_c) − mean_Σ(π_c)`; the line

   ```
   sum of bars = 0.069833333333   gap = μ̄ − μ_s = 0.069833333333   |difference| = 1.1e-16  (must be ≤ 1e-9)
   ```

   is the pass criterion of the checkpoint. `c3` (invoiced vs received
   amount) carries 63 % of the gap, `c1` 38 %, `c6` 19 %; `c2` and `c5`
   are negative (company B is better than the log on them). Each row also
   shows the violation-rate difference, the median in native units
   (days, counts, relative difference), the Hodges–Lehmann shift and the
   shift-vs-tail reading.

3. **Running example, headroom for company=B.** `Σ headroom_score = 0.360 = 1 − μ_s`
   with identity error 5.6e-17; removing every `c2` or `c3` violation in
   the slice would remove 100 % of its stabilised PI under the norm
   (baseline held fixed).

4. **Running example, readiness.** With closure = Clear Invoice / Cancel
   Invoice Receipt and `opened_by` = Record Invoice Receipt every check is
   `pass` (vocabulary drift and exposure sanity are `skipped`: no period
   with ≥ 200 events, no exposure column). Overall: `pass`.

5. **Synthetic log** (3,000 cases, ≈ 15,000 events, seed 1) with three
   planted hotspots — C2 × Packaging (GR → INV lag × 3, loads `c2`),
   vendor V007 (35 % missing invoices, loads `c1`, by construction also
   `c2`, `c3`), C3 × Logistics (two extra goods receipts, loads `c5`) —
   and seven planted artefacts (censoring 15 % of cases, replication 10 %,
   sentinel dates 1 % of events, duplicates 1 %, precision mix 30 % of
   invoice receipts, a renamed invoice label in the last quarter, exposure
   of company C3 × 1000).

6. **Synthetic, cluster bootstrap by purchasing document, by company × spend area (Finance, γ = 20).**
   C2 × Packaging ranks #1 with rank range 1–1, `P(top-5) = 1.00`,
   badge `stable`, stabilised gap 0.116 (90 % interval 0.083–0.142).
   Badges: 7 stable, 8 fragile, 0 insufficient support.

7. **Synthetic, sensitivity envelope** — 16 settings (3 γ values, 8
   threshold scalings, 3 weight jitters, plus the reference): the four
   positive-PI slices stay in the top-5 under every setting; minimum
   top-5 Jaccard 0.80.

8. **Synthetic, contrast for C2 × Packaging.** `c2` carries 0.129 of the
   0.125 gap (the other bars are slightly negative); violated in 88 % of
   cases vs 35 % elsewhere; median lag 18.2 d vs 5.7 d; Cliff's δ 0.81;
   reading "whole distribution shifted" (the planted mechanism is a
   multiplicative slowdown of every case). `|difference| = 3.7e-16`.

9. **Synthetic, headroom for C2 × Packaging.** Removing `c2` violations
   removes 100 % of the slice's stabilised PI (29.0 → 0.0); identity error
   1.1e-16.

10. **Synthetic, readiness.** Overall `fail`; the last block must read

    ```
    planted artefact → check status:
      censoring          flagged  {'right_censoring': 'fail', 'window_edge_share': 'warn'}
      replication        flagged  {'replication': 'warn'}
      sentinel_dates     flagged  {'sentinel_dates': 'fail'}
      duplicates         flagged  {'duplicate_events': 'warn'}
      precision_mix      flagged  {'timestamp_precision': 'fail'}
      vocabulary_drift   flagged  {'vocabulary_drift': 'fail'}
      unit_mixing        flagged  {'exposure_sanity': 'fail'}
    ```

    followed by `all checks passed: waterfalls sum to the gap, headroom identities hold, planted artefacts flagged`.

Pass when: both `|difference|` lines are ≤ 1e-9, both identity errors are
≤ 1e-9, no artefact line says `MISSED`, exit code 0.

Options: `--n-cases 20000` (still about two seconds), `--seed`, `--B`.

## 2. Tests, lint, types

```bash
.venv/bin/pytest -q                       # 66 passed in about 10 s
.venv/bin/ruff check src tests            # All checks passed!
.venv/bin/ruff format --check src tests   # 22 files already formatted
.venv/bin/mypy                            # Success: no issues found in 12 source files
```

What the tests establish (all deterministic under fixed seeds):

- **Decomposition** sums to the gap to 1e-9 on the running example (both
  views, every company / vendor / single case), on synthetic logs in both
  scoring modes, for random case masks (hypothesis, 25 examples), and on a
  random norm that uses every constraint type of the catalogue including
  `activation="each"`, `missing_b="censor"`, `missing="skip"`, precedence,
  metric, rule-form applicability and unscored cases. The layer table
  equals `wise.layer_drivers`' `__delta` to 1e-12.
- **Bootstrap coverage**: 30 samples of 1,500 cases from a 40,000-case
  synthetic population with four planted hotspots; the 90 % interval of
  the raw gap covers the population gap in 104 of 120 trials (0.867;
  assertion ≥ 0.85). Point estimates equal `prioritize` bit-for-bit;
  intervals contain the point estimate; `Σ_s P(top-k) ≤ k`; across six
  null logs no slice averages `P(top-5)` above 0.7.
- **Planted driver recovery**: the top waterfall bar is the planted
  constraint in 10 of 10 seeds; the pattern reads "whole distribution
  shifted" for the multiplicative lag hotspot; the fragmentation hotspot
  surfaces under the Logistics view with `c5`.
- **Readiness**: each artefact planted alone flips its check to warn/fail
  (sentinel dates, vocabulary drift, unit mixing and precision mix to
  `fail`); the clean synthetic log has no failing check; the running
  example passes.
- **Headroom**: zero for constraints without violations (exactly 0.0),
  `Σ_c headroom = 1 − μ_s`, reductions bounded by the PI, the planted
  driver removes the planted PI.
- **Weight what-ifs from cached violations** reproduce `wise.score`
  bit-for-bit for existing and new views in both scoring modes; the
  identity what-if reproduces the backlog exactly.
- **Provenance**: record ids are deterministic (parameter order and
  runtime do not enter), change with parameters or output, records are
  frozen, log fingerprints are content-based.
- **Vocabulary**: every reading of every analytic passes `check_reading`
  (no "causes", "because", "root cause", "effect", "will improve", …).

## 3. Scale (informational, not a test)

On a synthetic log of 250,000 cases / 1.19 M events (`generate(n_cases=250000)`,
scored by `wise` in 0.3 s): bootstrap by vendor B = 200 in 3.7 s; cluster
bootstrap over 600 slices in 2.6 s; contrast with intervals 3.6 s;
headroom 0.6 s; readiness 2.2 s; sensitivity envelope 1.6 s; weight
what-if 0.7 s; log fingerprint 0.6 s. All within the "interactive < 5 s"
budget of `ml_specialist.md` §3.

## Not done

- **Beyond the MVP of `ml_specialist.md`**: `norm_aids.py`
  (`suggest_thresholds`, `suggest_applicability`, `constraint_health`,
  `cooccurrence`), `monitoring.py` (`period_backlogs`, `control_signals`),
  `signatures.py`, `subgroups.py`, `resources.py`, `forecast.py`,
  `whatif_norm` (a full re-score under another norm with scope diff).
- **BPIC 2019 golden snapshots** (Packaging IR→CI 83 vs 55 d, Logistics
  replicated share 72.5 %, focus slices `stable`): not run here; the
  package has no dependency on the BPIC file. Add an opt-in test keyed on
  `WISE_BPIC19_CSV` when the backend's golden run exists.
- **Sensitivity envelope** is basic: γ grid, one-column threshold
  re-evaluation, weight jitter; no Kendall τ_b (would need `scipy`), no
  per-slice rank-range charting, and the badge does not yet fold in
  `always_topk` (documented; combine by hand).
- **Contrast**: Hodges–Lehmann is subsampled above 4 M pairs (seeded,
  recorded); no within-flow-type contrast or case-start histogram for the
  time-confounding caveat; ECDF pairs are returned, not drawn.
- **Readiness**: thresholds are conventions calibrated on the synthetic
  generator, not on real extracts; attribute-cardinality drift (new
  vendors share) is not implemented; the vocabulary check warns on the
  partial first month of a log (the reference is the following periods);
  cross-case replication needs `document_col`.
- **Synthetic generator**: one template (`p2p`), no attribute-conjunction
  hotspots off the slice keys, no step change at a period `t*`, no
  resource-level mechanisms; `vocabulary_drift` renames one label.
- **Cache / Parquet artefacts**: results are returned in memory; writing
  `analytics/<name>/<params_hash>.parquet` is the backend's job
  (`ARCHITECTURE.md` §4) — `Record.output_hash` and `record_id` are ready
  for that key.
- No `scipy`-dependent code path exists yet; the `stats` extra is declared
  for the v1 items.
