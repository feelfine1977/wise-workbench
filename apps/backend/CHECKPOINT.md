# Backend checkpoints (increment 0, workstream A)

How to try each feature by hand, with the exact commands and the output
observed on 2026-09-05 (Apple Silicon laptop, Python 3.13.9, wise-pm 0.1.0,
DuckDB 1.5.5). Paths assume the workbench at `~/code/PhD/WISE/wise-workbench`,
the library checkout at `~/code/PhD/WISE/wise-lib` and the BPI Challenge 2019
CSV at `~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv`.

Setup once:

```bash
cd ~/code/PhD/WISE/wise-workbench/apps/backend
python3 -m venv .venv
.venv/bin/pip install -e ~/code/PhD/WISE/wise-lib
.venv/bin/pip install -e '.[dev]'
```

All commands below accept `--workspace DIR` (default `~/WISE Workbench`, or
`WISE_WORKSPACE`). `WISE_LOG_FORMAT=console WISE_LOG_LEVEL=WARNING` keeps the
job logs quiet; the default is JSON lines on stderr.

## CP-A1 — Ingest and case table

```bash
.venv/bin/wise-workbench demo ingest --csv ~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv
```

The CSV is read in place (not copied); its SHA-256 becomes the dataset's
content hash. The BPIC 2019 mapping is detected from the column names
(case `case concept:name`, activity `event concept:name`, timestamp
`event time:timestamp` with format `%d-%m-%Y %H:%M:%S.%f`, order `eventID`,
exposure `event Cumulative net worth (EUR)` as absolute maximum, seven case
attributes, flow typing from `case Item Category` through library
applicability rules, header events, closure `Clear Invoice`). Other logs: pass
`--case`, `--activity`, `--timestamp`, `--attr` (repeatable).

Observed (72 s in total: ingest 63.5 s with the `cp1252` fallback because 242
lines are not UTF-8, case table 7.5 s; 4.0 GB peak RSS):

```
Dataset ds_…: 1,595,923 events, 22 columns, sha256 7d592fb42569
Mapping validated on 200,000 sample events; flow types {'DF2': 41686, 'DF1': 3205, 'Consignment': 2714, '2-way': 157}

Case table ct_…: 251,734 cases, 1,595,923 events, 42 activities
Readiness: WARN
  [INFO] volume: 1,595,923 events in 251,734 cases over 42 activities.
  [INFO] window: Observation window 2017-12-31 23:59:00 to 2019-01-17 15:44:00 (robust quantiles); raw timestamps span 1948-01-26 23:59:00 to 2020-04-09 23:59:00.
  [WARN] timestamp_outliers: 578 events lie outside the observation window (earliest 1948-01-26 23:59:00, latest 2020-04-09 23:59:00); lags touching them are unreliable.
  [WARN] sentinel_dates: 11 timestamp value(s) look like placeholders (…); most frequent: 2017-12-04T23:59:00 on 74 events.
          2017-12-04T23:59:00: 74 events (outside window)
          2008-06-19T23:59:00: 45 events (outside window)
          …  1948-01-26T23:59:00: 10 events; 2020-04-09T23:59:00: 1 event (latest raw timestamp)
  [WARN] timestamp_precision: Timestamp precision per activity (minute: 41, day: 1). Day-level activities: Create Purchase Requisition Item; sub-day lags on them are not meaningful.
  [WARN] duplicate_events: 180,913 events are exact duplicates (same case, activity and timestamp); counts and singularity constraints are inflated.
  [INFO] tied_timestamps: 17.4% of events share their timestamp with another event of the same case; order between them is undefined.
  [INFO] zero_exposure: 16,378 cases have exposure 0; exposure-weighted priorities ignore them.
  [WARN] header_event_replication: Header events (Create Purchase Order Item, Vendor creates invoice, Record Invoice Receipt, Clear Invoice, Remove Payment Block) are replicated onto items: 93.1% of their events share activity and timestamp with another case. 4,323 cases (1.7%) have more than 2 events per distinct timestamp.
  [WARN] right_censored: 34,947 cases (13.9%) are still open within 60 days of the window end; their missing closure is a window artefact until proven otherwise.
  [INFO] flow_types: Flow types: DF2: 221,010, DF1: 15,182, Consignment: 14,498, 2-way: 1,044.
Activities (top 10): Record Goods Receipt 314,097 events / 234,479 cases; Create Purchase Order Item 251,734 / 251,734; …
```

Pass: 251,734 cases; the 1948 and 2020 outliers are reported (in
`timestamp_outliers` and `sentinel_dates`); the header-event replication
warning is present.

## CP-A2 — Score and prioritise

The paper's Table XI slices are company × spend area under the Automation view
with γ = 20 (that is what `wise-lib/tests/test_bpic19.py` checks; the
`--slicing vendor` wording in `IMPLEMENTATION_PLAN.md` does not produce those
three numbers, see "Not done").

```bash
.venv/bin/wise-workbench demo run --norm ~/code/PhD/WISE/wise-lib/examples/bpic19_norm.json \
    --slicing company,spend_area --view Automation --gamma 20 --min-cases 1
```

Observed (score_run 13.4 s; all four views scored, backlogs, layer drivers,
validation tables, concentration and view agreement written; identical inputs
afterwards print `identical inputs: reusing run …`):

```
Run run_…: view Automation, slicing case Company × case Spend area text, γ = 20, min_cases = 1
  norm e17ca18ed3c1  log 7d592fb42569  params 3e83f6935e49  wise 0.1.0
  global mean 0.8444; 30 slices with at least 1 cases

rank  slice                                   n_cases      gap  stable_gap         PI  stable_PI  hotspot    dominant layer
   1  companyID_0000 × Packaging              109,199   0.0087      0.0087      945.9      945.7  reservoir  L3_timeliness_ageing
   2  companyID_0000 × Logistics                5,242   0.0563      0.0561      295.3      294.2  mechanism  L4_rework_instability
   3  companyID_0000 × Additives               18,318   0.0097      0.0097      178.0      177.8  mechanism  L7_effort_automation
   4  companyID_0000 × Latex & Monomers         5,007   0.0178      0.0177       89.2       88.8  mechanism  L7_effort_automation
   5  companyID_0003 × Real Estate                583   0.0898      0.0869       52.4       50.6  mechanism  L4_rework_instability
```

Pass: the three focus slices show stable PI 945.7 / 294.2 / 50.6 with
n = 109,199 / 5,242 / 583 and stable gap 0.0087 / 0.0561 / 0.0869 (Table XI).

The vendor backlog (`--slicing vendor --view Automation --gamma 20`) lists 705
vendors with at least 20 cases; the top three are vendorID_0136 (n = 14,471,
stable PI 461.9, reservoir), vendorID_0104 (9,817, 380.5) and vendorID_0106
(7,231, 222.1). Without `--view` the norm's first view (Finance) is shown.

## CP-A3 — API

```bash
.venv/bin/wise-workbench serve          # http://127.0.0.1:8000/docs
.venv/bin/wise-workbench health         # → 200 {"status":"ok","workspace":"…","inprocessWorker":true}
```

Swagger UI lists system, projects, datasets (upload → job), mappings (→ job),
case tables, norms (create validates with the library; 422 problem+json on
`NormError`), runs (Idempotency-Key; identical parameters return the existing
run), summary, backlog (DuckDB paging / sort / filter), slices, traces,
diagnostics, signals, flow and jobs (SSE at `/jobs/{id}/events`).

Running example from the browser or a shell (the CSV comes from the library):

```bash
.venv/bin/python -c "import wise; wise.running_p2p_events().to_csv('running.csv', index=False)"
.venv/bin/python -c "import wise, json; print(wise.running_p2p_norm().dumps())" > running_norm.json
API=http://127.0.0.1:8000/api/v1
P=$(curl -s -X POST $API/projects -H 'content-type: application/json' -d '{"name":"Running example","process":"p2p"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -s -F file=@running.csv $API/projects/$P/datasets            # 202 {"kind":"ingest", …, "resultRef":"dataset:ds_…"}
curl -s $API/projects/$P/datasets                                   # status "ready", 21 events, column profile
D=…                                                                  # the dataset id
curl -s -X POST $API/projects/$P/datasets/$D/mappings -H 'content-type: application/json' \
     -d '{"caseId":"case","activity":"activity","timestamp":"time","caseAttributes":["flow_type","company","vendor"]}'
                                                                     # 202 build job; resultRef "case_table:ct_…"
curl -s $API/projects/$P/case-tables/ct_…                           # 5 cases, readiness report
N=$(python3 -c "import json; print(json.dumps({'norm': json.load(open('running_norm.json')), 'note': 'Table V'}))" \
    | curl -s -X POST $API/projects/$P/norms -H 'content-type: application/json' -d @- | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -s -X POST $API/projects/$P/runs -H 'content-type: application/json' -H 'Idempotency-Key: demo-1' \
     -d "{\"caseTableId\":\"ct_…\",\"normVersionId\":\"$N\",\"slicings\":[{\"attributes\":[\"company\"]}],\"gamma\":0,\"minCases\":1}"
curl -s "$API/projects/$P/runs/run_…/backlog?slicing=company&view=Finance&minCases=1"
```

Expected backlog rows (identical to `wise.prioritize(result, "company", view="Finance")`):
company B: n_cases 3, mean_score 0.64, gap 0.0698, PI 0.2095, hotspot mechanism,
dominant layer match; company A: n_cases 2, gap 0, PI 0. Every row carries a
reading sentence, `keys`, `stability: "unknown"` and `PI_lower`.

The same flow is exercised by `tests/api/test_api.py` and the golden test
`tests/golden/test_running_example.py` (bit-for-bit against the library).

## CP-A4 — Crash-safe jobs

Run the API without a worker, queue a run on the full log, kill the worker
during scoring, start it again.

```bash
export WISE_WORKSPACE=~/WISE\ Workbench WISE_JOB_LEASE_SECONDS=10
.venv/bin/wise-workbench serve --no-worker &
# queue a run on the BPIC case table (ids from GET /projects/{id}/case-tables and /norms), e.g.
curl -s -X POST $API/projects/$P/runs -H 'content-type: application/json' \
     -d '{"caseTableId":"ct_…","normVersionId":"nv_…","slicings":[{"id":"vendor","attributes":["case Vendor"]}],"gamma":20,"minCases":20}'
.venv/bin/wise-workbench worker &      # note the pid; watch the JSON log for "scoring cases"
kill -9 <worker pid>
curl -s $API/jobs/<job id>             # status "running", attempts 1, lease still valid
sleep 11                               # the lease expires without heartbeats
.venv/bin/wise-workbench worker --once # claims the job again: attempts 2
curl -s $API/jobs/<job id>             # status "done", attempts 2, resultRef "run:…"
curl -s $API/projects/$P/runs/<run id> # status "done", manifest with artefacts and checksums
```

Observed (2026-09-05, `WISE_JOB_LEASE_SECONDS=10`, run on the 251,734-case
table with slicing `case Vendor`):

```
run queued: job job_0mtopu6k6d6x8m2rd
killed worker 82739 during scoring; job state now:
{'status': 'running', 'attempts': 1, 'progress': 0.15, 'message': 'scoring cases'}
waiting for the lease to expire (WISE_JOB_LEASE_SECONDS=10) and starting a second worker
{'status': 'done', 'attempts': 2, 'progress': 1.0, 'message': 'done', 'resultRef': 'run:run_0mtopu6k400mhd6q6'}
run done manifest artefacts: 16 finishedAt 2026-09-05T18:28:38.007517+00:00
backlogs  diagnostics  drivers  frame.parquet  in_scope.parquet  manifest.json  summary.json  violations.parquet
0                                  ← number of *.tmp files in the run directory
```

The second worker re-scored from the start (15.3 s); the first attempt's
partial state was only in memory. A worker that finds the job with an expired
lease claims it with `BEGIN IMMEDIATE`; after `WISE_JOB_MAX_ATTEMPTS` (3)
failures the job is `failed` and the run is marked `failed` too.

Pass: the job finishes with `attempts = 2`; the run directory holds no `*.tmp`
files (artefacts are written to a temporary name and renamed; `manifest.json`
is written last and the run is `done` only after it exists).

## Tests, lint, types

```bash
.venv/bin/python -m pytest              # 57 passed, 3 skipped (BPIC opt-in) in ~16 s
WISE_BPIC19_CSV=~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv .venv/bin/python -m pytest tests/golden/test_bpic19.py -q
                                        # 3 passed in 83 s: readiness (251,734 cases, 1948/2020 stamps, header replication,
                                        # minute vs day precision), Table XI focus slices at ranks 1, 2 and 5, Section V means
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests   # clean
.venv/bin/mypy                                                             # clean (67 files)
.venv/bin/wise-workbench openapi --yaml > ../../packages/api-schema/openapi.yaml   # regenerate the contract (owner runs it)
```

`tests/api/test_contract.py` checks that every path, operation id and schema
of `packages/api-schema/openapi.yaml` exists in the generated document.

## Not done

- **`--slicing vendor` does not reproduce 945.7 / 294.2 / 50.6.** Those are the
  Table XI numbers for company × spend area in the Automation view (as the
  library's own `test_bpic19.py` asserts), and the three focus slices are ranks
  1, 2 and 5 of that backlog rather than the top three. The demo reproduces
  them with `--slicing company,spend_area --view Automation --gamma 20`; the
  vendor backlog is available too but has different values.
  `IMPLEMENTATION_PLAN.md` (not in this workstream's directory) should be
  corrected by the owner.
- **`packages/api-schema/openapi.yaml` was not overwritten** (outside this
  workstream's directory). `wise-workbench openapi --yaml` produces the
  regenerated file; the generated document is a superset of the draft
  (additive endpoints: `/system/ready`, dataset preview, mapping lists,
  case-table lists, norm status `PATCH`, run cancel, `/jobs` list; additive
  fields such as `missingLabel`, `closureActivities`, `exposureAgg` on
  `ColumnMapping`, `links`/`paramsHash` on `Run`). Response schema names for the
  multipart upload body (`Body_uploadDataset`) come from FastAPI.
- **Headroom is a placeholder** in the slice detail (a table with one row per
  layer and no values) until `wise-analytics` (workstream C) provides it;
  `stability` is always `"unknown"` for the same reason.
- **XES import** is wired through pm4py but untested here (pm4py is not
  installed in this environment; the API answers 422 `dataset.xes_unavailable`).
- **Postgres** claim path (`FOR UPDATE SKIP LOCKED`) is implemented but only
  the SQLite path is tested.
- **Per-slicing sensitivity to null keys**: null values in mapped text
  attributes are labelled `(missing)` at build time (`missingLabel` in the
  mapping, as the paper's loader does); the library's `hotspot_table` cannot
  index a NaN key otherwise. Null keys in derived attributes are labelled the
  same way at backlog time.
- **Live `ScoreResult` cache**: slice detail, signals and the validation table
  need a live result; a cold process re-scores from the case table (about 14 s
  on BPIC 2019, within the job budget but above the 3 s target for desktop
  logs). `ScoreResult.save/load` in wise-pm 0.2 will remove this.
- **Auth** (loopback token) and **retention/pruning** are not part of
  increment 0.
