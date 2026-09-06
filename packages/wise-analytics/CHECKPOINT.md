# CP-C2 — Analytics package (`wise_analytics` 0.2.0)

Workstream C, cycle 2. What a person runs, what appears, and what "pass"
means. Numbers below come from an actual run on 2026-09-06 (Python 3.13,
`wise` 0.1.0, numpy 2.5, pandas 3.0). CP-C1 (sections 1–10 of the demo)
is unchanged in substance; cycle 2 adds one window end for every
readiness number, per-group caveats, two readiness checks, the plain card
sentences and the sub-group table (sections 11–13).

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

Runs in about 0.6 s and exits with code 0 when every identity holds, every
planted artefact is flagged and every generated sentence passes the
vocabulary check (`CHECKS FAILED` and exit code 1 otherwise). Thirteen
sections:

1. **Running example, bootstrap by company (Finance, γ = 2, B = 200).**
   Expected table (seed 1):

   ```
            n_cases  mean_score  stable_gap  stable_gap_lo  stable_gap_hi  stable_PI  stable_PI_lo  stable_PI_hi  rank  rank_lo  rank_hi  p_top5 stability
   company
   B              3      0.6400      0.0419            0.0         0.1772     0.1257           0.0        0.3684     1      1.0      2.0    0.65   fragile
   A              2      0.8146      0.0000            0.0         0.0613     0.0000           0.0        0.1260     2      1.0      2.0    0.28   fragile
   ```

   The point estimates are those of `wise.prioritize` (paper Table VI:
   μ_B = 0.640, μ̄ = 0.710).

2. **Running example, contrast waterfall for company=B (Finance).** The
   pass criterion of the checkpoint:

   ```
   sum of bars = 0.069833333333   gap = μ̄ − μ_s = 0.069833333333   |difference| = 1.1e-16  (must be ≤ 1e-9)
   ```

   `c3` (invoiced vs received amount) carries 63 % of the gap, `c1` 38 %,
   `c6` 19 %; `c2` and `c5` are negative.

3. **Running example, headroom for company=B.** `Σ headroom_score = 0.360 = 1 − μ_s`
   with identity error 5.6e-17.

4. **Running example, readiness.** Eleven checks; with closure = Clear
   Invoice / Cancel Invoice Receipt and `opened_by` = Record Invoice
   Receipt every check is `pass` (`vocabulary_drift`, `frequency_drift`
   and `exposure_sanity` are `skipped`: no period with ≥ 200 events or
   ≥ 50 case starts, no exposure column). The last line names the window
   end and its source:

   ```
   overall: pass   window end 2024-01-31 00:00:00 (robust observation window (EventLog.observation_window, q = 0.001))
   ```

11. **Running example, plain card sentences for company=B.** Expected:

    ```
    comparison : Invoiced vs received amount: 18 % apart here against 0 % elsewhere.
    distance   : 7.0 points below the overall score of 71.0 (10 %)
    kind       : systematic: one kind of problem explains most of it (library alias: mechanism)
    caveats    : none touch this group
    ```

5. **Synthetic log** (3,000 cases, 16,464 events, seed 1) with three
   planted hotspots — C2 × Packaging (GR → INV lag × 3, loads `c2`),
   vendor V007 (35 % missing invoices, loads `c1`, by construction also
   `c2`, `c3`), C3 × Logistics (two extra goods receipts, loads `c5`) —
   and nine planted artefacts (censoring 15 % of cases, replication 10 %,
   sentinel dates 1 % of events, duplicates 1 %, precision mix 30 % of
   invoice receipts, a renamed invoice label in the last quarter, exposure
   of company C3 × 1000, a payment-block release on 25 % of invoice-bearing
   cases with the block itself logged for 1 % of them, a requisition step
   on 10 % → 60 % of cases from 60 % of the window on). The last two are
   planted on their own random streams, so the hotspots, the other
   artefacts and every number of sections 6–9 are the same as in CP-C1.

6. **Synthetic, cluster bootstrap by purchasing document, by company × spend area (Finance, γ = 20).**
   C2 × Packaging ranks #1 with rank range 1–1, `P(top-5) = 1.00`,
   badge `stable`, stabilised gap 0.116 (90 % interval 0.083–0.142).
   Badges: 7 stable, 8 fragile, 0 insufficient support.

7. **Synthetic, sensitivity envelope** — 16 settings; the four
   positive-PI slices stay in the top-5 under every setting; minimum
   top-5 Jaccard 0.80.

8. **Synthetic, contrast for C2 × Packaging.** `c2` carries 0.129 of the
   0.125 gap; violated in 88 % of cases vs 35 % elsewhere; median lag
   18.2 d vs 5.7 d; Cliff's δ 0.81; "whole distribution shifted";
   `|difference| = 3.7e-16`.

9. **Synthetic, headroom for C2 × Packaging.** Removing `c2` violations
   removes 100 % of the slice's stabilised PI (29.0 → 0.0); identity error
   1.1e-16.

10. **Synthetic, readiness.** Overall `fail`. The window-end line must
    say that the robust window end was a far-out date and the bulk end
    was used (the planted sentinel dates contaminate the 0.999 quantile;
    the sentinel check fails for the same reason):

    ```
    overall: fail   window end 2024-12-30 20:20:41 (bulk of timestamps (3·MAD rule): the robust observation-window end 2099-12-31 is a far-out date)
    ```

    The artefact block must read

    ```
    planted artefact → check status:
      censoring          flagged  {'right_censoring': 'fail', 'window_edge_share': 'warn'}
      replication        flagged  {'replication': 'warn'}
      sentinel_dates     flagged  {'sentinel_dates': 'fail'}
      duplicates         flagged  {'duplicate_events': 'fail'}
      precision_mix      flagged  {'timestamp_precision': 'fail'}
      vocabulary_drift   flagged  {'vocabulary_drift': 'fail'}
      unit_mixing        flagged  {'exposure_sanity': 'fail'}
      logging_asymmetry  flagged  {'logging_asymmetry': 'warn'}
      frequency_drift    flagged  {'frequency_drift': 'fail'}
    ```

    (`duplicate_events` is `fail` rather than CP-C1's `warn` because the
    check now counts the library's dedupe key — the replicated copies
    share case, activity and timestamp — instead of exact rows.)

12. **Synthetic, plain card sentences and caveats for C2 × Packaging (Finance).** Expected:

    ```
    comparison : GR → INV within 10 days: 18 days here against 5.7 elsewhere (+12 days).
    distance   : 12.5 points below the overall score of 78.6 (16 %)
    kind       : systematic: one kind of problem explains most of it (library alias: severity)
    caveat [warn] 13 % of purchase order items still open at the end of the data (2024-12-30): late clearing cannot be judged
    caveat [warn] 7 % of purchase order items carry copied postings (several events at one timestamp, as when a document-level posting is copied onto every item)
    caveat [fail] 13 % of purchase order items carry duplicate events (the same activity twice at one timestamp)
    caveat [fail] 6 % of purchase order items carry a placeholder date far outside the observation window
    caveat [warn] 12 % of purchase order items started within the lag horizon of the window end (2024-12-30): the lag could not yet be met
    most censored top slice ('C3', 'Services'): gap collapses without censored cases: window artefact
    ```

13. **Synthetic, sub-groups inside C2 × Packaging by vendor, flow type and start quarter (Finance).**
    Vendor V001 carries 15 % of the penalty mass (17 of 38 vendors carry
    80 %), DF1 63 %, and the start quarter 2024Q4 35 % with the caveat

    ```
    start_Q = 2024Q4 (n = 37, mean penalty 0.809): 89 % of its purchase order items still open at the end of the data (2024-12-30); open lags are skipped, not penalised, so its mean penalty is not comparable with earlier periods (late clearing cannot be judged).
    ```

    followed by `all checks passed: waterfalls sum to the gap, headroom identities hold, planted artefacts flagged, sentences descriptive`.

Pass when: both `|difference|` lines are ≤ 1e-9, both identity errors are
≤ 1e-9, no artefact line says `MISSED`, every sub-group share table sums to
1, every sentence passes `check_reading`, exit code 0.

Options: `--n-cases 20000` (about two seconds), `--seed`, `--B`.

## 2. Tests, lint, types

```bash
.venv/bin/pytest -q                       # 86 passed in about 13 s
.venv/bin/ruff check src tests            # All checks passed!
.venv/bin/ruff format --check src tests   # 26 files already formatted
.venv/bin/mypy                            # Success: no issues found in 14 source files
```

What the tests establish (all deterministic under fixed seeds; the CP-C1
items on decomposition, bootstrap coverage, planted-driver recovery,
headroom, weight what-ifs and provenance are unchanged), cycle 2 additions:

- **One window end** (R1-02): the gate's window end equals
  `EventLog.observation_window()[1]` on a clean log, an explicit log
  window or argument takes precedence, every check row and the record
  carry it, and the per-case censored flags equal the library's
  `right_censored` with that end. On the artefact log whose robust end is
  the planted 2099-12-31 the gate falls back to the bulk end, says so in
  its warnings, fails the sentinel check and still flags the censoring.
- **One duplicate definition**: the count equals the number of rows
  `EventLog(dedupe=True)` drops; exact rows are a subset; the
  precision table classes every activity as day / time / mixed.
- **Caveats** (RG-20): `caveats_for_slice` shares equal the flagged
  counts inside the group, the texts pass the vocabulary check and name
  the window end, a mask and a `{attribute: value}` give the same list,
  `caveats_by` agrees with it per slice, the validation reading names the
  censored share from the threshold (20 %, configurable) on.
- **Logging asymmetry** (R1-24): the planted release-without-set artefact
  gives a 99 % share and `warn`; a norm that expects the setting activity
  turns it into `fail`; explicit pairs and an empty pair list are honoured.
- **Frequency drift** (R1-37): the planted 10 % → 60 % requisition step is
  the largest step, in the planted month (or the next), `fail`; censored
  periods are excluded; the per-period table is exposed as evidence.
- **Plain sentences** (R1-04): the lag sentence carries the medians and
  the Hodges–Lehmann shift in days, templates and phrase labels work, the
  presence / exclusion / singularity forms read as in the review's
  rubric, no constraint id appears, a slice without a positive bar gets
  the "no expectation is missed more often" sentence; `points_below`
  reproduces "0.9 points below the overall score of 84.4 (1 %)".
- **Kind of problem** (R1-06): the rule gives widespread / acute on a
  hand-made backlog and keeps the library's hotspot type as an alias;
  `problem_kinds` carries the primary view's kind across views.
- **Sub-groups** (R1-28): the table equals `wise.penalty_mass` per
  attribute, shares sum to 1, the start-quarter caveat appears on
  censored and partial periods only, closure activities and readiness
  flags give the same censored shares, a detached result refuses a period
  attribute.
- **Generator**: the two late artefacts leave every other event and every
  score of a seed unchanged.
- **Vocabulary**: every reading, caveat text, comparison sentence, kind
  reading and the kind rule pass `check_reading`.

## 3. On BPIC 2019 (informational, not a test)

`~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv` loaded with
the library example's mapping (1,595,923 events, 251,734 purchase order
items, 42 activities; 7.3 s), scored with `wise-lib/examples/bpic19_norm.json`
(9.3 s), sliced by company × spend area, Automation, γ = 20:

- readiness 3.5 s, status `fail`; window end **2019-01-17 15:44** from the
  robust observation window (raw maximum 2020-04-09); 34,947 items
  (13.9 %) right-censored; Packaging censored share **14.4 %** — the
  library's `right_censored` with the same window end gives 0.1437, the
  validation table 0.1437; **180,913** duplicate events (11 %, 0 exact
  rows; 5,089 items carry one); day precision on
  `Create Purchase Requisition Item`; 96 sentinel events (578 outside the
  robust window); replication `fail` (Logistics replicated share 72.5 %).
- validation table: Real Estate (583 items) reads "44 % of purchase order
  items still open at the end of the data (2019-01-17): late clearing
  cannot be judged"; `(missing)` 35 %.
- Packaging caveats: "14 % … still open …", 202 duplicates (0 %), 5
  placeholder dates, "17 % … started within the lag horizon of the window
  end (2019-01-17)".
- `logging_asymmetry` `warn`: "Remove Payment Block is logged 57136 times
  against 124 Set Payment Block; 100 % of the 55839 cases with a release
  have no logged setting event" (R1-24).
- `frequency_drift` `fail`: "Create Purchase Requisition Item: share of
  cases with the activity 1 % → 62 % from 2018-09 on" (the HPI report's
  finding, R1-37); the three months from 2018-11 on are excluded as
  censored.
- Packaging contrast (5.2 s with B = 200) and sentence with the guidance label:
  **"Invoices clear 83 days after receipt here against 55 elsewhere
  (+25 days)."**; distance "0.9 points below the overall score of 84.4
  (1 %)", rank 1 of 30.
- kinds (Automation): Packaging `widespread` (alias reservoir), Real
  Estate `acute`, Logistics `systematic`; with Automation as primary view
  `problem_kinds` keeps Packaging widespread in all four views and Real
  Estate acute wherever its gap is positive (per view alone Packaging
  reads systematic under Logistics and Real Estate systematic under
  Finance and Logistics).
- sub-groups inside Packaging (1.0 s): DF2 91.8 % of the penalty mass,
  Standard items 95.7 %, 22 of 266 vendors carry 80 % (0136 15.0 %, 0120
  11.7 %, 0104 10.6 %), start quarters 2018Q1–Q3 28.5–25.9 % each and
  2018Q4 16.9 % with "65 % of its purchase order items still open at the
  end of the data (2019-01-17); open lags are skipped, not penalised, so
  its mean penalty is not comparable with earlier periods".

Whole script (load, score, readiness, contrast, kinds, sub-groups): 26.7 s.

## Not done

- **Transform layer and scenarios** (R1-11: `whatif.transform` with
  cap_lag, delete_activity, move_event, set_attribute, keep_first,
  `whatif_scenario` against a frozen baseline) and **hypothesis helpers**
  (R1-12: `test_hypothesis` with Newcombe and Hodges–Lehmann intervals and
  the supported / not supported / inconclusive rule) — moved to cycles
  3/4 by the cycle 2 plan; `contrast_slice` already carries the risk
  difference with its Newcombe interval and the shift estimate per
  constraint.
- **P2**: period comparison with a frozen baseline (R1-23),
  `monitoring.py` (R1-31), the sensitivity summary sentence (R1-22).
- **Beyond the MVP of `ml_specialist.md`**: `norm_aids.py`,
  `signatures.py`, `resources.py`, `forecast.py`, `whatif_norm`.
- **BPIC 2019 golden snapshots** as tests: the numbers above were run by
  hand; the package keeps no dependency on the file. Add an opt-in test
  keyed on `WISE_BPIC19_CSV` when the backend's golden run exists.
- **Kind of problem**: per view the rank rule gives Packaging
  `systematic` under Logistics and Real Estate `systematic` under Finance;
  the one-kind-per-group requirement is met by `problem_kinds` with the
  primary view, which is a choice the run has to make (the view the
  backlog is read in).
- **Frequency drift** detects one step per activity (largest split); no
  seasonal model, no attribute-cardinality drift (new vendors share).
- **Logging asymmetry** pairs are detected by a fixed verb table on the
  first word of a label; pairs with other wordings must be passed in.
- **Sub-groups** break down by one attribute at a time; no conjunctions,
  no beam search (`ml_specialist.md` 1.8).
- **Sensitivity envelope** and **contrast** limitations of CP-C1 stand
  (no Kendall τ_b, subsampled Hodges–Lehmann above 4 M pairs, ECDF pairs
  returned not drawn).
- **Cache / Parquet artefacts**: results are returned in memory; writing
  `analytics/<name>/<params_hash>.parquet` is the backend's job.
