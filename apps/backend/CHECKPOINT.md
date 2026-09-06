# Backend checkpoints (increments 0 and 1, workstream A; cycle 2 in CP-2.x below)

How to try each feature by hand, with the exact commands and the output
observed on 2026-09-05 (Apple Silicon laptop, Python 3.13.9, wise-pm 0.1.0,
DuckDB 1.5.5) and, for the cycle 2 checkpoints, on 2026-09-06. Paths assume the workbench at `~/code/PhD/WISE/wise-workbench`,
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

## Increment 1 — serving the screens (CP-B2, CP-1.1 to CP-1.5, service side)

The frontend's checkpoints (`apps/frontend/CHECKPOINT.md`) run against this
service. Everything below was observed on 2026-09-06 on the verified
workspace (BPIC 2019 ingested and scored: project `prj_0mtoq2jvx8mcfcg6j`,
run `run_0mtoq44vd14f208ur`, company × spend area, Automation, γ = 20,
min cases 1) unless a fresh workspace is named.

### Serve the verified workspace

```bash
WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify .venv/bin/wise-workbench serve
```

`WISE_CORS_ORIGINS` defaults to the dev server (`localhost:5173`,
`127.0.0.1:5173`) and the Playwright preview (`…:4173`); `vite dev` proxies
`/api` to the backend, production builds call it cross-origin.

### CP-B2 — every read the screens make

Timings from a process that had just started (the first slice detail
re-scores the run because live `ScoreResult` objects are not persisted yet).

| Screen | Request | Observed |
|---|---|---|
| dashboard | `GET /projects/{p}/runs/{r}/summary`, first backlog page | mean score per view Finance 0.819, Logistics 0.817, Compliance 0.871, Automation 0.844; 251,734 cases; concentration per slicing and view; 0.01 s |
| data and mapping | `GET …/datasets/{d}/mapping-suggestion` | source `bpic2019`, case id `case concept:name`, 7 case attributes, header events and flow typing prefilled; `GET …/datasets/presets` lists `bpic2019` with `available: true` |
| case table and readiness | `GET …/case-tables/{c}` | 251,734 cases, 1,595,923 events, readiness `warn` with 11 items, 42 activities |
| norms | `GET …/norms`, `GET …/norms/{n}` | v1 draft "WISE BPIC'19 norm", 29 constraints in 7 layers, 4 views; the JSON is the library's `Norm.dumps` |
| signals list and table | `GET …/backlog?slicing=case Company+case Spend area text&view=Automation&minCases=1` | 30 groups in 0.32 s; ranks 1–5: Packaging 109,199 cases / stable PI 945.7 (widespread), Logistics 5,242 / 294.2 (systematic), Additives 18,318 / 177.8, Latex & Monomers 5,007 / 88.8, Real Estate 583 / 50.6; `maxStablePI` 945.72; `kind=systematic` → 10 groups; `q=Real&sort=n_cases` → 2 groups |
| slice detail (Why?) | `GET …/slices/%5B%22companyID_0000%22%2C%22Packaging%22%5D?slicing=…&view=Automation` | 12.9 s once, then from the cache: 29 drivers whose `delta_gap` sum to the gap 0.008662, 7 layer rows, penalty mass by `case Vendor` (50 rows), 20 worst cases, validation row (censored share, replicated share, retained, reading) |
| trace timeline | `GET …/cases/4507037358_00030/trace` | 28 events, each with the expectations it violates (`Change Quantity` → `c_l6_change_quantity`, …), scores per view; 0.11 s |
| distribution lens | `GET …/signals/c_l3_invoice_to_clear_days?slicing=…&sliceKey=…` | unit D, ϑ = 30, W = 60, 40 bins, 101 ECDF points, 100,635 cases in scope, median 83.4 days, 96.7 % violated; 0.07 s |
| process map | `GET …/flow?abstraction=0.05` and the same with `slicing` and `sliceKey` | whole log: 11 nodes (9 activities placed in the 6 stages of the P2P pack: Request, Order, Receive, Invoice, Match, Pay), 28 edges, 40 overlays (arc, badge, hatch, tint), 1.36 s; Packaging: 11 nodes, 30 edges, 40 overlays, 109,199 cases, 0.75 s |

Every backlog row carries, next to the library's columns, the plain fields
`kind` (acute | systematic | widespread), `kind_reading`,
`dominant_layer_name`, `top_constraint`, `top_constraint_description`,
`top_constraint_share`, `n_ranked` and the reading sentence:

```
companyID_0000 × Packaging: 109,199 cases, 0.9 % below expectation on average; widespread: many cases,
slightly off; most-missed expectation area: Handovers and ageing (Invoice-bearing flows should clear in a
reasonable time, missed in 97 % of these cases); confidence in rank: not computed for this run;
priority 945.7 (raw 945.9; small groups discounted with γ = 20), rank 1 of 30 in the Automation perspective.
```

Pass: the backlog reproduces Table XI (945.7 / 294.2 / 50.6 at ranks 1, 2, 5);
the slice detail returns 29 drivers that sum to the gap; the trace marks
violated expectations per event; the flow carries stage groups and overlays.

### CP-1.1 — the public log in one job (`POST /datasets/presets/bpic2019`)

On a fresh workspace (`WISE_WORKSPACE=/tmp/ws`), with the CSV at the default
path or `WISE_BPIC19_CSV` and the norm at `WISE_BPIC19_NORM`:

```bash
API=http://127.0.0.1:8000/api/v1
P=$(curl -s -X POST $API/projects -H 'content-type: application/json' -d '{"name":"Preset","process":"p2p"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -s $API/projects/$P/datasets/presets                       # [{"id":"bpic2019","available":true,"source":"…/BPI_Challenge_2019.csv", …}]
J=$(curl -s -X POST $API/projects/$P/datasets/presets/bpic2019 | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -N $API/jobs/$J/events                                     # CP-1.3 below
```

Observed (2026-09-06, 87.9 s from the request to the terminal event):

```
   0.5s progress running  0.01 hashing the log file
   1.0s progress running  0.04 ingest: reading the source file
  56.5s progress running  0.31 ingest: profiling columns
  64.6s progress running  0.51 validating the mapping on a sample
  65.6s progress running  0.53 case table: reading events
  71.1s progress running  0.64 case table: data-readiness report
  73.1s progress running  0.83 scoring: scoring cases
  83.3s progress running  0.88 scoring: backlog case Company+case Spend area text × Finance
  84.8s progress running  0.93 scoring: backlog case Vendor × Finance
  87.4s progress running  0.97 scoring: writing summary
  87.9s progress done     1.00 done
  87.9s done     done     1.00 done
```

The job's `resultRef` is `run:run_…`; the run has γ = 20, min cases 1,
slicings `case Company+case Spend area text` and `case Vendor`, all four
views; its Automation backlog lists Packaging 945.7, Logistics 294.2,
Additives 177.8, Latex & Monomers 88.8, Real Estate 50.6; the case table
has 251,734 cases with the 11 readiness items of CP-A1. A second
`POST …/presets/bpic2019` reuses the dataset (content hash), the case table
(same mapping), the norm version (fingerprint) and the run (parameters hash)
and finishes in 0.9 s with `reusing run run_…`.

Pass: one request leads to a scored run; loading twice creates nothing new.

### CP-1.3 — progress over server-sent events (`GET /jobs/{id}/events`)

```bash
curl -N http://127.0.0.1:8000/api/v1/jobs/$J/events
```

```
retry: 2000

event: progress
data: {"id": "job_…", "status": "running", "progress": 0.31, "message": "ingest: profiling columns", "attempts": 1, "resultRef": null, "error": null}

: heartbeat

event: progress
data: {"id": "job_…", "status": "done", "progress": 1.0, "message": "done", "attempts": 1, "resultRef": "run:run_…", "error": null}

event: done
data: {"id": "job_…", "status": "done", "progress": 1.0, "message": "done", "resultRef": "run:run_…", "error": null, "attempts": 1}
```

A `progress` event follows every change of status, progress or message,
`: heartbeat` comments keep the connection alive while nothing changes,
exactly one terminal `done` event carries the final status (done, failed or
cancelled) and the stream closes (`curl` returns). On an already finished job
the stream sends one `progress` and the `done` event and closes at once
(0.01 s). The frontend opens the stream with `EventSource` and falls back to
polling `GET /jobs/{id}` when the stream fails.

Pass: `curl -N` exits by itself after `event: done`;
`tests/api/test_api.py::test_job_events_stream_and_cancel` checks the same.

### CP-1.5 — the process map payload (`GET /runs/{id}/flow`)

```bash
curl -s "$API/projects/$P/runs/$R/flow?abstraction=0.05" | python3 -c 'import json,sys; g=json.load(sys.stdin); print(len(g["nodes"]), len(g["edges"]), [x["label"] for x in g["groups"]], sorted({o["kind"] for o in g["overlays"]}), g["meta"]["cases"])'
# 11 28 ['Request', 'Order', 'Receive', 'Invoice', 'Match', 'Pay'] ['arc', 'badge', 'hatch', 'tint'] 251734
```

Nodes carry `cases`, `events`, `share`, `violationShare` (the metric names
the flow library reads), follows edges `count`, `cases`, `share`,
`medianLagHours`; activities matched by the P2P knowledge pack carry their
stage as `group`; every constraint becomes an overlay (lag and precedence →
arc on a `constraint` edge, presence and singularity → badge, exclusion →
hatch, any violated expectation → tint) with a `payload` holding
`constraintId`, `constraintType`, `layer`, `value`, `coverage`, `text`,
`glyph`, `threshold`, `width`, `unit`; `meta.constraints` lists the
description and statistics of every expectation, `meta.constraintsWithoutNodes`
those about case attributes rather than activities. With `slicing` and
`sliceKey` the same payload is computed for one group so that the frontend
lays out both scenes together and draws the difference.

The stage groups come from the `p2p` pack of `packages/process-knowledge`
(`wise_knowledge.load_pack`). When the pack fails validation (for example
while its guidance file is being edited) the service loads it without
validation and logs `knowledge pack 'p2p' fails validation, using it without
validation: …`; the stages and activity matches do not depend on the parts
that are validated. Without the package or a loadable pack the map has no
groups and `meta.stages` is empty.

## CP-1.6 — one-command start (cycle 1 release)

```bash
cd ~/code/PhD/WISE/wise-workbench/apps/frontend && npm run build:live       # once; writes dist/ (same-origin API, mocks off)
cd ../backend && WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify .venv/bin/wise-workbench serve --open
# or, from the repository root: WISE_WORKSPACE=… tools/start.sh   (builds, starts, opens)
```

Observed (2026-09-06): the start-up line reads
`WISE Workbench 0.1.0: application at http://127.0.0.1:8000/ (built frontend from …/apps/frontend/dist), API documentation at http://127.0.0.1:8000/docs, workspace …/workspace_verify`;
the browser opens `http://127.0.0.1:8000/` about a second later (the opener
polls `/api/v1/system/health` from a thread and calls the default browser;
`BROWSER=<command>` redirects it); the page shows the dashboard with the
`live backend` badge; `GET /` and `GET /p/…/runs/…/backlog?…` answer
`index.html` (`Cache-Control: no-cache`), `GET /assets/…` the hashed files,
`GET /api/v1/nothing` a `problem+json` 404, `/docs` the Swagger UI. The
real-backend Playwright run against this server passes
(`E2E_API_URL=http://127.0.0.1:8000 npm run e2e`: 1 passed, 16.0 s cold).
A fresh Python 3.12 virtual environment with `pip install -e ../../../wise-lib`
and `pip install -e .` serves the same (ready after about 10 s on first
import; backlog row 1 Packaging 945.7). Pass: the application opens at `/`
from one process; `tests/api/test_static.py` (8 tests) covers the routes.

## Cycle 2 — CP-2.1 … CP-2.8 (analytics, one window end, flow-type fork, notebook, caveat actions, slice designer, flow filter and focus)

Setup adds the two packages delivered in this cycle:

```bash
cd ~/code/PhD/WISE/wise-workbench/apps/backend
.venv/bin/pip install -e ../../packages/wise-analytics ../../packages/process-knowledge
```

Every command below was run on 2026-09-06 against the verified workspace
(`WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify`,
project `prj_0mtoq2jvx8mcfcg6j`, run `run_0mtoq44vd14f208ur`, case table
`ct_0mtoq3xcgajce13jv`) with the server on port 8047:

```bash
WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify .venv/bin/wise-workbench serve --port 8047
API=http://127.0.0.1:8047/api/v1; P=prj_0mtoq2jvx8mcfcg6j; R=run_0mtoq44vd14f208ur; CT=ct_0mtoq3xcgajce13jv
```

### CP-2.1 — the analytics job (R1-01): stability badges, kinds, comparison sentences, caveats

`score_run` queues an `analytics` job for every finished run (unless
`WISE_ANALYTICS_AUTO=0`); `POST …/runs/{r}/analytics` queues it on demand;
`GET …/runs/{r}/analytics` shows the manifest.

```bash
curl -s -X POST $API/projects/$P/runs/$R/analytics          # 202 {"kind":"analytics", …}
curl -s $API/projects/$P/runs/$R/analytics | python3 -c 'import json,sys; d=json.load(sys.stdin); m=d["manifest"]; print(d["status"], d["windowEnd"], m["runtimeS"], "s", m["cluster"], m["replicatedShare"], m["readinessStatus"], sorted(m["records"])[:4])'
```

Observed: `done 2019-01-17T15:44:00 50.3 s None 0.0172 fail` with 11
records (readiness, validation, caveats, problem_kinds, four
`bootstrap_backlog` and four `comparisons` with 12 sentences each, one per
view; 63.9 s when the run has to be re-scored cold first); the cluster
bootstrap by purchasing document is not switched on because 1.7 % of the
items carry replicated events (below `WISE_ANALYTICS_CLUSTER_SHARE`, 20 %).
Every record is a Parquet table under
`runs/run_…/analytics/<name>/<params_hash>.parquet` with the provenance
record (`record_id`, log and norm fingerprints, parameters, output hash)
in `<params_hash>.json`; `manifest.json` lists them.

```bash
curl -s "$API/projects/$P/runs/$R/backlog?slicing=case%20Company%2Bcase%20Spend%20area%20text&view=Automation&minCases=1&pageSize=5" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["params"]["window_end"], d["params"]["case_noun"]); [print(r["rank"], r["stability"], r["p_top"], r["kind"], "|", r["points_below"], "|", r["comparison"], "|", [c["text"] for c in r["caveats"]]) for r in d["rows"]]'
```

Observed (0.40 s):

```
2019-01-17T15:44:00 purchase order items
1 stable 1.0 widespread | 0.9 points below the overall score of 84.4 (1 %) | Paid within terms: 83 days here against 55 elsewhere (+25 days). | ['14 % of purchase order items still open at the end of the data (2019-01-17): late clearing cannot be judged', '17 % of purchase order items started within the lag horizon of the window end (2019-01-17): the lag could not yet be met']
2 stable 1.0 systematic | 5.6 points below the overall score of 84.4 (7 %) | 14 Received in few deliveries per purchase order item here against 1 elsewhere. | ['13 % … still open …', '73 % of purchase order items carry copied postings (…)', '73 % … carry duplicate events (…)', '8 % … started within the lag horizon …']
3 stable 1.0 widespread | 1.0 points below the overall score of 84.4 (1 %) | 98 % of purchase order items Mostly automatic here against 92 % elsewhere. | […]
4 stable 1.0 systematic | 1.8 points below … | Mostly automatic: 0.8 here against 0.8 elsewhere (+0). | […]
5 stable 1.0 systematic | 9.0 points below the overall score of 84.4 (11 %) | 3 Approved once per purchase order item here against 0 elsewhere. | ['44 % of purchase order items still open at the end of the data (2019-01-17): late clearing cannot be judged', '31 % … started within the lag horizon …']
```

Every row also carries `kind_reading`, `kind_source` (`analytics` for the
package's rule, `library` for the hotspot alias when no analytics exist),
`plain_layer` ("On time"), `layer_missed_label` ("waiting too long between
steps"), `top_constraint_plain`, `stability_reason`, `rank_lo`/`rank_hi`,
`stable_PI_lo`/`stable_PI_hi`, `n_caveats` and `reading_plain` (one
sentence: cases, points below, confidence word). `?stability=stable` and
`?kind=widespread` filter on the badges. Pass: Packaging is `stable` at
rank 1 with the review's comparison sentence; Real Estate prints the R1-02
acceptance sentence ("44 % … still open at the end of the data
(2019-01-17): late clearing cannot be judged").

```bash
curl -s "$API/projects/$P/runs/$R/slices/%5B%22companyID_0000%22%2C%22Packaging%22%5D?slicing=case%20Company%2Bcase%20Spend%20area%20text&view=Automation" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["reading_plain"]); c=d["contrast"]; print(dict(zip(c["columns"], c["rows"][0]))); h=d["headroom"]; print(dict(zip(h["columns"], h["rows"][0]))); print(d["subgroups"]["rows"][:2]); print(d["guidance_refs"][:2]); print(d["analytics"]["recordIds"])'
```

Observed (9.8 s cold — contrast with 200 bootstrap replicates, headroom,
sub-groups; 1.7 s afterwards from the Parquet cache): the plain reading
"companyID_0000 × Packaging: 109,199 purchase order items, 0.9 points below
the overall score of 84.4 (1 %); widespread: many purchase order items,
each slightly off; most often missed: On time. Paid within terms: 83 days
here against 55 elsewhere (+25 days). Caveat: 14 % of purchase order items
still open at the end of the data (2019-01-17): late clearing cannot be
judged."; the contrast row of `c_l3_invoice_to_clear_days` (plain "Paid
within terms": missed in 96.7 % here against 83.4 % elsewhere, risk
difference 0.133 [0.131, 0.135], medians 83.4 against 54.7 days, shift
+24.9 days, 93 % of the shortfall); headroom 4.34 points (100 % of the
priority); sub-groups by `case Vendor` (vendorID_0136 15 % of the penalty
mass), `case Item Type`, `flow_type` and the start quarter; guidance references with hub
node ids (`layer:timeliness_ageing`,
`expectation:p2p_bpic19:c_l3_invoice_to_clear_days`).

### CP-2.2 — one window end (R1-02)

```bash
curl -s $API/projects/$P/case-tables/$CT | python3 -c 'import json,sys; r=json.load(sys.stdin)["readiness"]; print(r["windowEnd"], r["caseNoun"]); [print(i["level"], i["id"], (i.get("decision") or {}).get("kind"), "|", i["message"][:120]) for i in r["items"]]'
```

A case table built in this cycle carries `readiness.windowEnd` (the gate's
resolution: the library's robust observation-window end unless that end is
a far-out placeholder date), `caseNoun`, the gate's own checks as items
`gate:<check>` (timestamp concentration, vocabulary and frequency drift,
logging asymmetry, exposure sanity, window edge share, replication) and,
on every item that allows one, `decision` (the caveat action of CP-2.5).
The verified workspace's table predates this cycle, so its `windowEnd` is
resolved at read time from the log (2019-01-17 15:44, the same value). The
run manifest (`windowEnd`, `normWarnings`), `BacklogPage.params.window_end`,
the analytics manifest and every caveat sentence print that one end; the
validation table's `censored_share` of Packaging (0.1437), the caveat share
on its card (0.1437) and `wise.right_censored(log, ["Clear Invoice"],
window_end=…)` (34,947 of 251,734 items, 13.9 %, overall) agree
(`tests/api/test_cycle2.py::test_one_window_end_in_readiness_validation_and_gate`
checks the equality on the synthetic log, whose planted 2099 placeholder
date makes the fallback visible).

### CP-2.3 — norm warnings (R1-08) and robust histograms (R1-09)

```bash
curl -s $API/projects/$P/norms | python3 -c 'import json,sys; n=json.load(sys.stdin)[0]; print(n["guidance_complete"], *n["warnings"], sep="\n")'
curl -s "$API/projects/$P/runs/$R/signals/c_l3_invoice_to_clear_days?slicing=case%20Company%2Bcase%20Spend%20area%20text&sliceKey=%5B%22companyID_0000%22%2C%22Packaging%22%5D" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d["stats"]; print(len(d["bins"]), s["rangeLow"], s["rangeHigh"], d["beyond"], d["markers"], s["shareBeyondThresholdText"])'
```

Observed: `guidance_complete` true and the three warnings of the review's
S3 ("constraint 'c_l4_change_payment_terms_repeats': activity 'Change
Payment Terms' never occurs in the log", "constraint 'c_l5_credit_memo':
activity 'Vendor creates credit memo' never occurs in the log", and the
derived attribute that uses the credit memo); cards whose most-missed area
contains such an expectation carry a `norm_warning` caveat. The lens:
40 bins over 22–161 days (the 0.5–99.5 % range widened to δ and δ + W),
380 lags beyond 161 days in the `beyond` bin (up to 6,273 days), markers
`δ = 30 days` and `δ + W = 90 days`, and "97 % beyond 30 days"; `?scale=log`
bins log10 of the positive values. Pass: at least 20 informative bins with
the 30- and 90-day lines and "97 % beyond 30 days" (R1-09).

### CP-2.4 — flow-type fork (R2-O10)

```bash
curl -s $API/projects/$P/case-tables/$CT/flow-types | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["attribute"], d["source"], d["windowEnd"]); [print(t["name"], t["cases"], len(t["map"]["nodes"]), [g["label"] for g in t["map"]["groups"]], t["scope"], "|", t["readiness"]["headline"]) for t in d["types"]]'
curl -s $API/projects/$P/runs/$R/compare-flow-types | python3 -c 'import json,sys; d=json.load(sys.stdin); [print(t["name"], t["cases"], round(t["views"]["Automation"]["mean_score"],3), t["mostMissed"]["plain_name"], [g["key"] for g in t["topGroups"]]) for t in d["types"]]'
curl -s -X POST $API/projects/$P/runs -H 'content-type: application/json' \
  -d "{\"caseTableId\":\"$CT\",\"normVersionId\":\"nv_0mtoq44v68e19ia7e\",\"slicings\":[{\"attributes\":[\"case Company\",\"case Spend area text\"]}],\"gamma\":20,\"minCases\":1,\"scope\":{\"flow_type\":\"DF1\"}}"
```

Observed (4.1 s cold, then cached): `flow_type mapping 2019-01-17T15:44:00`;
DF2 221,010 items (11 map nodes in the six P2P stages; "221,010 purchase
order items (88%), 1,234,708 events, 39 activities, median 66 days from
first to last event; 14% still open at the end of the data (2019-01-17)."),
DF1 15,182 ("… 27% carry copied postings."), Consignment 14,498, 2-way 1,044
("… 39% still open …"); each type carries the `scope` to pass to `POST
/runs`. The comparison (0.6 s): DF2 0.843 "Mostly automatic" (Packaging,
Additives, (missing)), DF1 0.808 "Paid within terms" (Logistics, Packaging,
Latex & Monomers), Consignment 0.910, 2-way 0.774 "Approved once" (Real
Estate, Enterprise Services, Others). A scoped run scores the sub-log
(15,182 cases for DF1); its backlog, flow, signals and slices are restricted
to it, `manifest.scope` and `params.scope` say so, and its parameters hash
differs from the unscoped run's. Pass: four flow types with counts and maps;
a fork per flow type; the side-by-side comparison.

### CP-2.5 — caveat actions (R2-O1)

```bash
curl -s $API/projects/$P/decisions/kinds | python3 -c 'import json,sys; [print(k["kind"], "→", k["item"], k["params"]) for k in json.load(sys.stdin)]'
curl -s -X POST $API/projects/$P/case-tables/$CT/decisions/preview -H 'content-type: application/json' -d '{"kind":"open_cases","params":{"handling":"exclude"}}'
curl -s -X POST $API/projects/$P/case-tables/$CT/decisions/preview -H 'content-type: application/json' -d '{"kind":"collapse_duplicates"}'
curl -s -X POST $API/projects/$P/case-tables/$CT/decisions -H 'content-type: application/json' -d '{"kind":"collapse_duplicates","author":"data steward","note":"exact duplicates are copies"}'
```

Eight kinds (drop events outside the window, placeholder dates as missing,
collapse duplicates, day-precision marking, header events typed away, open
cases censor / exclude / keep, zero exposure, flow-type assignment). Observed
previews on BPIC 2019: `open_cases` exclude → 34,947 items, 
`drop_outside_window` → 578 events in 497 items (window 2017-12-31 to
2019-01-17), `collapse_duplicates` → 180,913 events in 5,089 items. Applying
one answers 202 with the decision (version 1, the readiness item it
answers, the preview), the new case table (`building`) and the
`build_cases` job; the child mapping carries `parentId`, `decisions[]` and
the folded effect (`dedupe`, `openCases`, `headerEvents`, …); the new
table's readiness report is the re-evaluation (its `right_censored` item
says "decision taken"). `GET …/decisions` lists them with author and note.
Pass: every decision has a preview with cases and events affected before
it is applied, and rebuilds the case table as a versioned mapping decision
(`tests/api/test_cycle2.py::test_decision_preview_apply_and_rebuild`
applies two decisions in a row on the synthetic log).

### CP-2.6 — slice designer (R2-O2)

```bash
curl -s "$API/projects/$P/runs/$R/slicings/preview?slicing=case%20Vendor,exposure&bands=%5B%7B%22attribute%22%3A%22exposure%22%2C%22q%22%3A4%7D%5D&minCases=20" | python3 -m json.tool | head -30
curl -s "$API/projects/$P/runs/$R/backlog?slicing=case%20Vendor&view=Automation&minCases=20&drillFrom=case%20Company%2Bcase%20Spend%20area%20text&drillKey=%5B%22companyID_0000%22%2C%22Packaging%22%5D&pageSize=3" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["total"], d["params"]["drill"], d["params"]["cases"]); [print(r["keys"], r["n_cases"], round(r["stable_PI"],1), r["kind"], r["stability"]) for r in d["rows"]]'
```

Observed: the preview of vendor × exposure quartiles gives 3,778 groups
(2,662 below 20 cases; bands "< 152", "152 – 534", "534 – 2.22k",
"≥ 2.22k"; sizes min 1, median 6, p90 116, max 7,578); the drill into
Packaging lists 135 vendors with at least 20 items of the 109,199
(vendorID_0136 14,369 items, stable PI 462.6; vendorID_0104 9,773 / 380.3;
vendorID_0106 7,067 / 219.2) with the same columns and the overall score
as baseline (`stability` stays `unknown` in a drill; `params.stability_applies`
is false). Slicings combine up to three attributes; a run slicing with
`bands` (`{"attributes": ["case Company", "exposure"], "bands": [{"attribute":
"exposure", "method": "quantile", "q": 4}]}`) gets its own artefacts and
analytics (slicing id `case Company+exposure:q4`, key column `exposure band`).

### CP-2.7 — flow filter and focus (R2-O7, RF-12, RF-13)

```bash
curl -s "$API/projects/$P/runs/$R/flow?focus=a_record_goods_receipt&abstraction=0.05" | python3 -c 'import json,sys; d=json.load(sys.stdin); f=d["meta"]["focus"]; print(f, [ (p["from"], p["cases"], p["violation_share"]) for p in d["paths"]["incoming"][:3]], [(p["to"], p["cases"]) for p in d["paths"]["outgoing"][:3]])'
F='{"and":[{"kind":"attribute","field":"case Item Category","in":["3-way match, invoice before GR"]}]}'
curl -s "$API/projects/$P/runs/$R/flow?abstraction=0.05&filter=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$F")" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["meta"]["cases"], d["meta"]["filterCases"])'
curl -s "$API/projects/$P/runs/$R/filters/preview?filter=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" '{"and":[{"kind":"open","value":true},{"kind":"lag","a":"Record Invoice Receipt","b":"Clear Invoice","unit":"D","min":30}]}')"
```

Observed: the focus on Record Goods Receipt (234,479 items, 27 incoming and
22 outgoing paths with count, cases, median lag in hours and the share of
the cases on the path that miss any expectation: Vendor creates invoice →
102,431 items, Create Purchase Order Item → 58,869, Receive Order
Confirmation → 19,761; → Record Invoice Receipt 106,211); the filter to
DF2 keeps 221,010 of 251,734 items (1.7 s with focus and filter); the
preview of "open and invoice-to-clear ≥ 30 days" keeps 0 items and says
that each clause alone keeps 34,947 and 114,727. The same `filter` is
accepted by the backlog and the signals endpoints; applicability is never
changed by a filter.

### CP-2.8 — notebook (R2-O11)

```bash
curl -s -X POST $API/projects/$P/notebook/snapshots -F image=@shot.png \
  -F 'payload={"title":"Packaging, Automation","note":"the largest shortfall","context":{"run_id":"'$R'","slicing":"case Company+case Spend area text","view":"Automation","url":"/p/'$P'/runs/'$R'/backlog"},"data":{"rank":1,"stable_PI":945.7}}'
curl -s $API/projects/$P/notebook | python3 -m json.tool | head -20
curl -s -X POST $API/projects/$P/notebook/reorder -H 'content-type: application/json' -d '{"ids":["snap_…"]}'
curl -s -o notebook.zip "$API/projects/$P/notebook/export?format=markdown" && unzip -l notebook.zip
```

A snapshot stores the PNG under `projects/<p>/notebook/<snapshot>.png`, the
data as JSON, the context and the note; `GET …/snapshots/{id}/image` serves
the PNG; `PATCH` edits title, note, context and data; `POST …/reorder` sets
the order; the export is a zip with `notebook.md` (one section per snapshot
with the image, the note, the context line and the data file) and the
images under `images/`; `format=pptx` answers 422 "PowerPoint arrives in
cycle 4" (the exporter registry `EXPORTERS` in
`application/services/notebook.py` is the extension point).

## Tests, lint, types

```bash
.venv/bin/python -m pytest -q                        # 100 passed, 4 skipped (BPIC opt-in) in ~34 s
WISE_BPIC19_CSV=~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv .venv/bin/python -m pytest tests/golden/test_bpic19.py -q
                                                     # 4 passed in ~4 min: readiness (251,734 cases, 1948/2020 stamps, header replication,
                                                     # minute vs day precision), Table XI focus slices at ranks 1, 2 and 5, Section V means,
                                                     # and the cycle 2 checks (Packaging stable, 14 % / 44 % still open at 2019-01-17,
                                                     # "97 % beyond 30 days", the four flow types, the norm warnings)
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests   # clean
.venv/bin/mypy                                                             # clean (71 files)
.venv/bin/wise-workbench openapi --yaml --out ../../packages/api-schema/openapi.yaml   # regenerate the contract, then `npm run generate` in apps/frontend
```

`tests/api/test_contract.py` compares the committed
`packages/api-schema/openapi.yaml` with the document the app generates and
fails on any difference (drift check), besides checking the paths,
operation ids, schemas and backlog query parameters the frontend relies on.
`tests/api/test_cycle2.py` (12 tests on the synthetic log of
`wise_analytics.generate` with its planted artefacts) covers the analytics
wiring, the one window end, norm warnings, robust histograms, the flow-type
fork, the notebook, the caveat actions, the slice designer and the flow
filter and focus; `tests/unit/test_cycle2_domain.py` the slicing bands, the
run scope, the decision validation, the band edges, the filter parser and the
robust bins.
`tests/api/test_presets.py` runs the BPIC 2019 preset on a ten-item log with
the challenge's column names and checks that a second load reuses everything;
`tests/unit/test_readings.py` pins the plain vocabulary of the reading
sentences (kinds of problem, percentages, confidence words). `tests/unit/test_knowledge.py`
checks the knowledge bridge: a validated pack, the fallback to an unvalidated
load, no pack at all, and the stage groups of the flow payload.

## Not done

- **Analytics on 1.6 M events take about a minute** after every scoring job
  (readiness gate, bootstrap per view, comparison sentences for the top 12
  groups per view); cards read "confidence not computed" until the job
  finishes. `WISE_ANALYTICS_COMPARISON_TOP` and `WISE_ANALYTICS_BOOTSTRAP_B`
  trade time for coverage.
- **`--slicing vendor` does not reproduce 945.7 / 294.2 / 50.6.** Those are the
  Table XI numbers for company × spend area in the Automation view (as the
  library's own `test_bpic19.py` asserts), and the three focus slices are ranks
  1, 2 and 5 of that backlog rather than the top three. The demo and the
  preset reproduce them with company × spend area, Automation, γ = 20;
  the vendor backlog is available too but has different values.
- **Without `wise-analytics` installed** the slice detail's headroom is a
  placeholder table and every rank reads "confidence in rank: not computed
  for this run" (`stability: "unknown"`); with the package the numbers come
  from CP-2.1.
- **XES import** is wired through pm4py but untested here (pm4py is not
  installed in this environment; the API answers 422 `dataset.xes_unavailable`).
- **Postgres** claim path (`FOR UPDATE SKIP LOCKED`) is implemented but only
  the SQLite path is tested.
- **Per-slicing sensitivity to null keys**: null values in mapped text
  attributes are labelled `(missing)` at build time (`missingLabel` in the
  mapping, as the paper's loader does); the library's `hotspot_table` cannot
  index a NaN key otherwise. Null keys in derived attributes are labelled the
  same way at backlog time.
- **Live `ScoreResult` cache**: slice detail, signals, the validation table
  and the flow of one group need a live result; a cold process re-scores from
  the case table (12.9 s on BPIC 2019, within the job budget but above the
  3 s target for desktop logs). `ScoreResult.save/load` in wise-pm 0.2 will
  remove this.
- **Auth** (loopback token) and **retention/pruning** are not part of
  increments 0 and 1.
