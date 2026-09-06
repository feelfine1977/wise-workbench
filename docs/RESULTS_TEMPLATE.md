# Results template — documenting one analysis

Copy this file, fill every section, keep the ids and hashes: they are what
makes the analysis reproducible. A filled example is
`docs/examples/bpic2019_results.md`. Words in plain language first, the
method's term in brackets where it helps the reader who knows the method.

---

# <Process> — <period> — <one-line title>

Author, date, workspace folder (`WISE_WORKSPACE`), application version
(`GET /api/v1/system/version`: workbench, wise, duckdb).

## 1. Goal and question

The steering question as written on the project (dashboard header), who
asked it, what decision it informs, what is out of scope.

## 2. Dataset and its hash

| | |
|---|---|
| file | name and origin |
| dataset id | `ds_…` (**Data and mapping**, the Datasets table) |
| content hash | SHA-256 from the same table |
| events / columns | from the dataset screen header |
| period covered | the **window** line of the readiness report |

## 3. Mapping and case notion

| | |
|---|---|
| mapping id / case table id | `map_…` / `ct_…` (dataset screen, under the readiness report) |
| case id / activity / timestamp | the three mapped columns and the timestamp format |
| case notion | one sentence: what one case is (the mapping's note) |
| case attributes (slice keys) | the ticked columns |
| header events typed away | the ticked activities |
| flow types, closing activity | the rules shown as badges, if any |
| cases / events / activities | from the readiness report |

## 4. Norm version and fingerprint

| | |
|---|---|
| norm, version, status | **Norm versions** table |
| norm version id | `nv_…` |
| fingerprint | from the same table |
| areas / expectations / perspectives | the header of the norm screen |
| origin | preset import, lens commit (with the note), hand-written JSON |
| changes against the previous version | **Version notes** |

## 5. Run id and parameters

| | |
|---|---|
| run id | `run_…` |
| perspectives (views) | |
| grouping (slicing) | the attributes and the id (`attr1+attr2`) |
| γ (caution against small groups) | and the reason, from the run's note |
| minimum cases | |
| manifest | norm fingerprint, content hash, params hash, wise version, started, finished, job id (**Parameters and manifest**) |

## 6. Readiness caveats

Copy the lines of the readiness report with their level and add one
sentence each on what they mean for this question. State which caveats you
accept, which you typed away (header events) and which remain open.

## 7. The top groups and their readings

The ranked list with the filters used (perspective, grouping, minimum
cases, γ). One row per group of interest with the card's reading sentence
verbatim (hover a card, or `reading` in the API row):

| rank | group | cases | shortfall | kind | most-missed area | priority (discounted) | confidence |
|---|---|---|---|---|---|---|---|

Say how concentrated the priority is (the dashboard's "80 % of the priority
sits in N groups", or **All groups at once**).

## 8. Drivers and real-unit comparisons for the chosen groups

For every group you take further, from **Why?**:

- the top three expectations behind the shortfall with "missed in x % of
  cases — explains y % of the shortfall";
- the comparison in real units from **Compared with everyone else**: the
  threshold ϑ and width W, the share beyond ϑ, median and percentiles of the
  raw signal (days, counts, amounts) — numbers a process owner recognises;
- the sub-key Pareto (where inside the group the shortfall sits);
- two or three cases from **cases furthest off** with what happened in
  them, as evidence the pattern is real.

## 9. Validation gates

Per group, the **Can the data be trusted?** row: reading, share still open
at the end of the data, share with duplicated events, shortfall kept
without open cases; and the state of each check (pending, passed, failed,
waived) with your one-line reasoning. A group whose check fails is reported
as "verify logging before acting", not as a finding.

## 10. Hypotheses and actions

Descriptive wording: "coincides with", "is driven by (in the score)"; the
application shows where and which expectations, not why. For each
hypothesis: the group, the expectation(s), the evidence (section 8), what
would confirm or refute it, the disposition chosen in the Decision pane
(investigate / defer / waive / not a hotspot) and the owner.

## 11. Exports

Where the tables in this report come from. All endpoints are under
`http://127.0.0.1:8000/api/v1` and documented at `/docs`; `<key>` is the
group's key as a JSON array, URL-encoded (`%5B%22companyID_0000%22%2C%22Packaging%22%5D`).

| Table | Endpoint or file |
|---|---|
| ranked list | `GET /projects/{p}/runs/{r}/backlog?slicing=…&view=…&minCases=…&pageSize=500` (JSON rows with `reading`) |
| run summary (means per perspective, concentration) | `GET /projects/{p}/runs/{r}/summary` |
| the group's drivers, layers, sub-key Pareto, worst cases, validation | `GET /projects/{p}/runs/{r}/slices/<key>?slicing=…&view=…` |
| validation rows of every group | `GET /projects/{p}/runs/{r}/diagnostics?slicing=…&view=…` |
| a signal's distribution in real units | `GET /projects/{p}/runs/{r}/signals/{constraintId}?slicing=…&sliceKey=<key>` |
| a case's events | `GET /projects/{p}/runs/{r}/cases/{caseId}/trace` |
| the process map (whole log or one group) | `GET /projects/{p}/runs/{r}/flow[?slicing=…&sliceKey=<key>]` |
| the norm document | `GET /projects/{p}/norms/{nv}` |
| the run manifest | `GET /projects/{p}/runs/{r}` |

CSV: there is no download button in this release. Either save the JSON
from `/docs` (**Try it out** → **Download**), or read the run's Parquet
files from the workspace with DuckDB, for example

```bash
duckdb -c "COPY (SELECT * FROM '<workspace>/projects/<p>/runs/<r>/backlogs/case Company+case Spend area text__Automation.parquet') TO 'backlog.csv' (HEADER)"
```

## 12. Screenshots

Captured with `tools/capture_screens.mjs` at 1440 × 900 against the running
application. Write a steps file (JSON array; `docs/examples/screens.json` is
the one used for the example) and run

```bash
node tools/capture_screens.mjs --base http://127.0.0.1:8000 --steps my_screens.json --out my_screenshots
```

Each step names the file, the route (with query string), optional clicks by
ARIA role and name (`{"role": "tab", "name": "Table"}`), by text, by test id,
or a key press (`{"press": "Control+k"}`), an element or text to wait for,
an extra settle time and whether to capture the full page. Node 18 or
newer; Playwright comes from `apps/frontend/node_modules` (`npm install`
there, then `npx playwright install chromium` once). Failed steps are
reported at the end and never stop the others.

Reference the files here with one line each on what the reader should see.

## 13. Appendix — timings

| Step | Duration | Machine |
|---|---|---|
| ingest | | |
| case table build | | |
| scoring (run manifest: finished − started) | | |
| first Why? after start (re-score) | | |
| ranked list query | | |

Plus the environment: Python and Node versions, `pip list` for `wise-pm`,
`wise-workbench`, `duckdb`.
