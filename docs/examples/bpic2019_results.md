# Purchase-to-pay — BPI Challenge 2019 — where the flow falls short of expectations

Filled from the verified workspace on 2026-09-06 (Apple Silicon laptop,
Python 3.13.9, Node 18.20.8). Workspace
`~/code/PhD/WISE/wise-workbench-data/workspace_verify`; application versions
(`GET /api/v1/system/version`): workbench 0.1.0, wise 0.1.0, duckdb 1.5.5.
Every number below was read from the running application or its API on
that date; the screenshots in `screenshots/` were taken with
`tools/capture_screens.mjs` and the steps in `screens.json`.

## 1. Goal and question

Project **Demo** (`prj_0mtoq2jvx8mcfcg6j`), process p2p. Steering question
as written on the dashboard: *Where does the purchase-to-pay flow fall short
of expectations?* The purpose of this run is to reproduce the paper's
Table XI on the public log — the three focus groups Packaging, Logistics and
Real Estate — and to show what the application says about each. Out of
scope: actions; the log is public and anonymised, no owner can be asked.

## 2. Dataset and its hash

| | |
|---|---|
| file | `BPI_Challenge_2019.csv`, the BPI Challenge 2019 event log (purchase-order items of a coatings company), read in place by the public-log preset |
| dataset id | `ds_0mtoq2k50b40fq628` |
| content hash | `7d592fb425690d13011d1b874fe2af63f61a66acfc368ecf87b4ed266e6cdb00` |
| events / columns | 1,595,923 events, 22 columns |
| period covered | observation window 2017-12-31 23:59 to 2019-01-17 15:44 (robust quantiles); raw timestamps span 1948-01-26 to 2020-04-09 |

## 3. Mapping and case notion

| | |
|---|---|
| mapping id / case table id | `map_0mtoq3wn7abfoul3f` / `ct_0mtoq3xcgajce13jv` |
| case id / activity / timestamp | `case concept:name` / `event concept:name` / `event time:timestamp`, format `%d-%m-%Y %H:%M:%S.%f`, order by `eventID` |
| case notion | one purchase-order item; note "BPI Challenge 2019 preset" |
| case attributes (slice keys) | `case Company`, `case Spend area text`, `case Vendor`, `case Item Type`, `case Purchasing Document`, `case Document Type`, `case Item Category` |
| exposure | `event Cumulative net worth (EUR)`, absolute maximum per case |
| header events typed away | Create Purchase Order Item, Vendor creates invoice, Record Invoice Receipt, Clear Invoice, Remove Payment Block |
| flow types, closing activity | DF1 (3-way match, invoice after GR), DF2 (3-way match, invoice before GR), 2-way, Consignment from `case Item Category`; closes with Clear Invoice |
| cases / events / activities | 251,734 cases, 1,595,923 events, 42 activities |

## 4. Norm version and fingerprint

| | |
|---|---|
| norm, version, status | **WISE BPIC'19 norm · v1**, draft |
| norm version id | `nv_0mtoq44v68e19ia7e` |
| fingerprint | `e17ca18ed3c1a30114694c29455b86def27480bb34000e797e1e06a82dc644b0` |
| areas / expectations / perspectives | 7 layers (Expected completion and closure, Flow-conditioned control discipline, Handovers and ageing, Rework and instability, Exceptions and corrections, Value and commercial integrity, Effort and automation friction), 29 constraints, 4 views (Finance, Logistics, Compliance, Automation); scoring mode `layer_balanced` |
| origin | imported by the preset from the library's `examples/bpic19_norm.json` (note "imported from bpic19_norm.json") |
| changes against the previous version | none, first version |

## 5. Run id and parameters

| | |
|---|---|
| run id | `run_0mtoq44vd14f208ur` |
| perspectives (views) | Finance, Logistics, Compliance, Automation (the reading below uses Automation, as Table XI does) |
| grouping (slicing) | `case Company` × `case Spend area text`, id `case Company+case Spend area text` |
| γ (caution against small groups) | 20 — the paper's value; a group with 20 cases keeps half of its shortfall |
| minimum cases | 1 |
| manifest | norm fingerprint `e17ca18ed3c1…`, content hash `7d592fb42569…`, params hash `6b13ae5e338ef058e05cbaf2c060a8318f0ca7be633d430e6048b0f909a8ec7c`, wise 0.1.0, started 2026-09-05T18:35:49.04Z, finished 2026-09-05T18:36:02.18Z (13.1 s), job `job_0mtoq44vf478b9u8d` (1 attempt), 16 artefacts with checksums |

Summary of the run (`GET …/summary`): overall average score Finance 0.819,
Logistics 0.817, Compliance 0.871, Automation 0.844; 76.2 % of the cases
evaluated (84.1 % in scope of at least one expectation); in the Automation
perspective 80 % of the priority sits in the top 3 of the 30 groups and 95 %
in the top 6.

## 6. Readiness caveats

Status **warn**, eleven lines (`screenshots/03_dataset_mapping.png`):

| Line | Level | What it means here |
|---|---|---|
| volume | info | 1,595,923 events in 251,734 cases over 42 activities |
| window | info | 2017-12-31 to 2019-01-17 covers the data; the raw span reaches back to 1948 |
| timestamp_outliers | warn | 578 events outside the window (1948 and 2020 stamps): durations touching them are unreliable. Accepted — they are placeholders in the source system |
| sentinel_dates | warn | 11 placeholder timestamps, most frequent 2017-12-04 23:59 on 74 events. Accepted |
| timestamp_precision | warn | Create Purchase Requisition Item is recorded to the day only; durations below a day from it are not meaningful. Accepted; no expectation measures a sub-day lag from it |
| duplicate_events | warn | 180,913 exact duplicates inflate counts and singularity expectations. Open — relevant for the rework and effort areas |
| tied_timestamps | info | 17.4 % of events share a timestamp within their case |
| zero_exposure | info | 16,378 cases have exposure 0 |
| header_event_replication | warn | the five header events are copied onto 93.1 % of their items. Typed away in the mapping; the per-group check under "Can the data be trusted?" still reports groups where replication is high (Logistics, section 9) |
| right_censored | warn | 34,947 cases (13.9 %) still open within 60 days of the window end. Open — checked per group in section 9 |
| flow_types | info | DF2 221,010; DF1 15,182; Consignment 14,498; 2-way 1,044 |

## 7. The top groups and their readings

Ranked list with perspective Automation, grouping company × spend area,
minimum cases 1, γ = 20 (`screenshots/10_signals_list.png`,
`11_signals_table.png`, `12_signals_all_groups.png`). 30 groups ranked,
overall average 84.4 %.

| rank | group | cases | shortfall | kind | most-missed area | priority (discounted) | confidence |
|---|---|---|---|---|---|---|---|
| 1 | companyID_0000 × Packaging | 109,199 | 0.9 % | widespread | Handovers and ageing | 945.7 (raw 945.9) | not computed |
| 2 | companyID_0000 × Logistics | 5,242 | 5.6 % | systematic | Rework and instability | 294.2 (raw 295.3) | not computed |
| 3 | companyID_0000 × Additives | 18,318 | 1.0 % | systematic | Effort and automation friction | 177.8 | not computed |
| 4 | companyID_0000 × Latex & Monomers | 5,007 | 1.8 % | systematic | Effort and automation friction | 88.8 | not computed |
| 5 | companyID_0003 × Real Estate | 583 | 9.0 % (8.7 % discounted) | systematic | Rework and instability | 50.6 (raw 52.4) | not computed |
| 6 | companyID_0000 × (missing) | 3,257 | 1.1 % | systematic | Expected completion and closure | 36.3 | not computed |
| 7 | companyID_0000 × Solvents | 2,629 | 0.8 % | systematic | Effort and automation friction | 20.9 | not computed |
| 8 | companyID_0000 × Specialty Resins | 2,406 | 0.5 % | systematic | Effort and automation friction | 13.1 | not computed |
| 9 | companyID_0000 × Workforce Services | 127 | 11 % (9.9 % discounted) | acute | Flow-conditioned control discipline | 12.5 (raw 14.5) | not computed |
| 10 | companyID_0000 × Pigments & Colorants | 2,593 | 0.4 % | systematic | Effort and automation friction | 10.8 | not computed |

Ranks 1, 2 and 5 are the paper's Table XI: stable PI 945.7 / 294.2 / 50.6
with 109,199 / 5,242 / 583 cases and stable gap 0.0087 / 0.0561 / 0.0869.
The card of rank 1 reads verbatim:

> companyID_0000 × Packaging: 109,199 cases, 0.9 % below expectation on
> average; widespread: many cases, slightly off; most-missed expectation
> area: Handovers and ageing (Invoice-bearing flows should clear in a
> reasonable time, missed in 97 % of these cases); confidence in rank: not
> computed for this run; priority 945.7 (raw 945.9; small groups discounted
> with γ = 20), rank 1 of 30 in the Automation perspective.

Rank 9, Workforce Services, is the acute counter-example: 127 cases, 11 %
below expectation, one flow-discipline expectation (invoice before goods in
a three-way match, missed in 86 % of these cases). The group is small, so
γ = 20 discounts its shortfall to 9.9 % and its priority to 12.5; it stays
in the list as something to look at case by case, below the large groups.

## 8. Drivers and real-unit comparisons for the chosen groups

### Packaging (rank 1, widespread)

`screenshots/13_why_drivers.png`. Expectations behind the shortfall (share of
the shortfall; missed in):

| expectation | area | missed in | explains |
|---|---|---|---|
| Invoice-bearing flows should clear in a reasonable time (`c_l3_invoice_to_clear_days`, lag) | Handovers and ageing | 96.7 % | 93.4 % |
| In DF2, goods/service to Remove Payment Block should be timely (`c_l3_df2_goods_to_rpb_days`) | Handovers and ageing | 80.6 % | 24.0 % |
| Too many human handoffs indicate coordination cost (`c_l7_distinct_human_resources`, metric) | Effort and automation friction | 84.6 % | 21.3 % |
| In DF2, released items should clear quickly (`c_l3_df2_rpb_to_clear_days`) | Handovers and ageing | 85.6 % | 13.3 % |
| High manual share indicates low straight-through processing (`c_l7_manual_share`) | Effort and automation friction | 92.5 % | 12.2 % |

The shares exceed 100 % together because other expectations are met better
than average in this group (negative Δ, shown green in the table): the
expectation areas Expected completion and closure, Flow-conditioned control
discipline, Rework and instability, Exceptions and corrections and Value and
commercial integrity all have a lower penalty here than in the whole log;
Handovers and ageing carries the shortfall (penalty 0.056 against 0.045).

Real units (`screenshots/14_why_distributions.png`, Compared with everyone
else, `c_l3_invoice_to_clear_days`): the time from invoice receipt to Clear
Invoice, threshold ϑ = 30 days, width W = 60 days; 100,635 of the group's
cases are counted, 76,613 have a value; **96.7 % clear later than 30 days**;
median 83 days, mean 81 days, 90th percentile 113 days, 95th percentile
120 days, maximum 6,273 days (a 1948 placeholder stamp — see the readiness
caveats). The mean soft violation is 0.73: most invoices are not slightly
late, they are well past the 30 + 60 day band.

Where the shortfall sits inside the group (penalty Pareto by vendor):
vendorID_0136 (14,369 cases) carries 15.0 % of the group's penalty,
vendorID_0120 (13,449) 11.7 %, vendorID_0104 (9,773) 10.6 %, vendorID_0106
(7,067) next — the top three vendors carry 37 %.

Cases furthest off (`screenshots/15_why_cases_trace.png`): case
`4507037358_00030` (vendorID_0530, DF2, 28 events from 2018-06-18 to
2019-01-17, exposure 7,140 EUR, 10 different people, 82 % manual events)
scores 0.391 and misses 13 expectations, among them the invoice-to-clear
lag, repeated invoice receipt, cancelled invoice receipt, a debit memo,
price and quantity changes and every effort expectation. The timeline shows
the changes and the repeated receipts as ▲ marks.

### Logistics (rank 2, systematic)

Reading: 5,242 cases, 5.6 % below expectation; most-missed area Rework and
instability. Expectations behind the shortfall: too many goods/service
receipt events indicate fragmentation (missed in 77 %, explains 111 %),
very long event chains indicate execution friction (65 %, 78 %),
invoice-bearing flows should eventually be cleared (67 %, 22 %). One pattern
— fragmented receipts — explains more than the whole shortfall, the mark of
a systematic group. See section 9 before reading more into it.

### Real Estate (rank 5, systematic, company 0003)

Reading: 583 cases, 9.0 % below expectation (8.7 % discounted). Approval
changes should be rare — missed in 100 % of these cases — explains 95 % of
the shortfall; too many manual touches (43 %, 25 %) and high manual share
(100 %, 21 %) follow. Every real-estate item of company 0003 goes through an
approval change: a pattern of the company's process rather than of single
cases.

## 9. Validation gates

From **Can the data be trusted?** (`screenshots/16_why_validation.png`) and
`GET …/diagnostics`:

| group | reading | still open at the end of the data | duplicated events | shortfall kept without open cases | checks |
|---|---|---|---|---|---|
| Packaging | stable signal | 14.4 % | 0.0 % | 167 % (the shortfall grows without the open cases: the late invoices are among the closed ones) | open cases: pending (above 10 %); duplicated events: passed; plausibility: pending |
| Logistics | high event replication: verify logging before acting | 12.6 % | **72.5 %** | 107 % | duplicated events: **failed** — the fragmentation pattern coincides with header events copied onto items; verify the logging before treating it as a finding |
| Additives | stable signal | 16.5 % | 0.0 % | 178 % | open cases: pending |
| Latex & Monomers | stable signal | 15.8 % | 0.0 % | 141 % | open cases: pending |
| Real Estate | stable signal | **43.7 %** | 0.0 % | 104 % | open cases: pending — almost half the group was still open at the window end; the approval-change pattern is not a window artefact (it sits on events that already happened), the closure expectations are |

In this release the checks are display-only (no pass / fail / waive with a
note); the readings above are the analyst's.

## 10. Hypotheses and actions

- **Packaging** (investigate): invoice clearing in Packaging coincides with
  a median of 83 days from invoice receipt to clearing against a 30-day
  expectation, across all major vendors (top three carry 37 % of the
  penalty, so it is not one vendor). Confirming evidence would be payment
  terms of 60–90 days in the master data (then the expectation's ϑ should be
  recalibrated on the lens and committed with a note, not the process
  changed); refuting evidence would be a queue in invoice verification
  (then the handover between Record Invoice Receipt and Clear Invoice is the
  place to look). Owner: accounts payable.
- **Logistics** (defer until the check passes): the fragmentation signal is
  driven, in the score, by cases with duplicated header events (72.5 %);
  re-run after typing the remaining replicated activities away or after
  the source extract is corrected.
- **Real Estate, company 0003** (investigate): every item carries an
  approval change; a hypothesis is a mandatory re-approval step in that
  company's configuration rather than rework. One conversation with the
  company's purchasing lead settles it.
- **Workforce Services** (acute, 127 cases): invoices before goods receipt
  in a three-way-match flow; look at the cases one by one.

Dispositions were recorded in the Decision pane of the respective Why?
screens (browser storage in this release).

## 11. Exports

Everything above came from these calls (base `http://127.0.0.1:8000/api/v1`,
`P = prj_0mtoq2jvx8mcfcg6j`, `R = run_0mtoq44vd14f208ur`,
`S = case%20Company%2Bcase%20Spend%20area%20text`,
`K = %5B%22companyID_0000%22%2C%22Packaging%22%5D`):

| table | call |
|---|---|
| ranked list | `GET /projects/P/runs/R/backlog?slicing=S&view=Automation&minCases=1&pageSize=500` |
| summary | `GET /projects/P/runs/R/summary` |
| Packaging detail | `GET /projects/P/runs/R/slices/K?slicing=S&view=Automation` |
| validation rows | `GET /projects/P/runs/R/diagnostics?slicing=S&view=Automation` |
| invoice-to-clear distribution | `GET /projects/P/runs/R/signals/c_l3_invoice_to_clear_days?slicing=S&sliceKey=K` |
| the case | `GET /projects/P/runs/R/cases/4507037358_00030/trace` |
| process map | `GET /projects/P/runs/R/flow` and `…/flow?slicing=S&sliceKey=K` |
| norm, manifest | `GET /projects/P/norms/nv_0mtoq44v68e19ia7e`, `GET /projects/P/runs/R` |

The run's Parquet files are under
`workspace_verify/projects/P/runs/R/` (`backlogs/case Company+case Spend area text__Automation.parquet`, `drivers/…`, `diagnostics/validation/…`).

## 12. Screenshots

All 1440 × 900, `node tools/capture_screens.mjs --base http://127.0.0.1:8000 --steps docs/examples/screens.json --out docs/examples/screenshots` (23 steps, about 2 minutes including the map layouts).

| file | what to see |
|---|---|
| `01_dashboard.png` | the steering question, the top signal as one sentence, the four perspective averages, "80 % of the priority sits in", the data caveats |
| `02_data.png` | the dropzone, the **Load public log preset** card with the file path, the Datasets table with the content hash |
| `03_dataset_mapping.png` | the readiness report with its eleven lines, the column profiler, the prefilled mapping with the five header events |
| `04_norms.png` | the versions table with fingerprint and status |
| `05_norm_constraints.png` | the catalogue by expectation area, the calibration lens of `c_l3_invoice_to_clear_days` |
| `06_norm_json.png` | the norm document |
| `07_runs.png` | the runs table with γ, min cases, views, slicings |
| `08_run_monitor.png` | parameters and the manifest with the hashes |
| `09_run_flow.png` | the whole log's map with the stage groups Request … Pay and the overlays |
| `10_signals_list.png` | the ranked list: ranking rule, filters, the cards of ranks 1–10 |
| `11_signals_table.png` | the same rows as a table with both vocabularies in the headers |
| `12_signals_all_groups.png` | cases × shortfall and the concentration curve |
| `13_why_drivers.png` | Packaging: the three expectations behind the shortfall, the waterfall, areas against everyone, the vendor Pareto, all 29 expectations |
| `14_why_distributions.png` | the invoice-to-clear lens: 96.7 % beyond 30 days |
| `15_why_cases_trace.png` | the cases furthest off and the timeline of `4507037358_00030` |
| `16_why_validation.png` | the validation row and the checks before acting |
| `17_why_flow.png`, `18_why_flow_compare.png` | Packaging's map, then coloured by the difference to everyone else |
| `19_why_headroom.png` | the placeholder |
| `20_help_glossary.png`, `21_command_palette.png` | help and palette |
| `22_signals_method_words.png`, `23_signals_plain_words.png` | the same list in the method's words and in plain words |

## 13. Appendix — timings

| Step | Duration | Machine |
|---|---|---|
| public-log preset on a fresh workspace (ingest, case table, norm import, scoring) | 87.9 s (ingest 63.5 s with the cp1252 fallback, case table 7.5 s, scoring 13 s) | Apple Silicon laptop, 4.0 GB peak |
| scoring alone (manifest: finished − started) | 13.1 s | |
| first Why? after the server starts (re-score in memory) | 13–16 s | the real-backend end-to-end test measures 16.0 s cold, 3.4 s warm |
| ranked list query | 0.02 s | |
| whole-log map / group map | 0.55 s / 0.74 s | |
| ELK layout of the map in the browser | 2–4 s | |

Environment: Python 3.13.9 (`wise-pm` 0.1.0, `wise-workbench` 0.1.0,
`duckdb` 1.5.5, `fastapi` 0.141.1), Node 18.20.8, `@wise/flow` 0.3.0,
Playwright 1.61.1.
