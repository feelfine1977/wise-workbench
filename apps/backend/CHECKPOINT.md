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

Observed (0.40 s; comparison sentences in the cycle 2 release form — one form per kind of number, the expectation first, the difference in brackets, never a zero difference):

```
2019-01-17T15:44:00 purchase order items
1 stable 1.0 widespread | 0.9 points below the overall score of 84.4 (1 %) | Paid within terms: 83 days here against 55 elsewhere (+25 days). | ['14 % of purchase order items still open at the end of the data (2019-01-17): late clearing cannot be judged', '17 % … started within the lag horizon of the window end (2019-01-17) …']
2 stable 1.0 systematic | 5.6 points below the overall score of 84.4 (7 %) | Received in few deliveries: 14 Record Goods Receipt or Record Service Entry Sheet events per purchase order item here against 1 elsewhere (+13). | ['13 % … still open …', '73 % of purchase order items carry copied postings (…)', …]
3 stable 1.0 widespread | 1.0 points below the overall score of 84.4 (1 %) | Mostly automatic: missed in 98 % of purchase order items here against 92 % elsewhere (+6.2 points). | […]
4 stable 1.0 systematic | 1.8 points below … | Mostly automatic: a manual share of 83 % here against 80 % elsewhere (+3.3 points). | […]
5 stable 1.0 systematic | 9.0 points below the overall score of 84.4 (11 %) | Approved once: 3 Change Approval for Purchase Order events per purchase order item here against 0 elsewhere (+3). | ['44 % of purchase order items still open at the end of the data (2019-01-17): late clearing cannot be judged', …]
```

The `reading` string of every row carries the confidence word of its
`stability` (`confidence in rank: high`) and the kind the analytics decided;
`comparison_kind` names the form (`lag`, `count`, `share`, `metric`, `rate`,
or `none` for *No material difference on the top expectation (…)*).

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

## Cycle 3 — CP-3.1 … CP-3.8 (the explore board, the flow as an instrument, decisions, the review, the O2C preset)

Everything below was observed on 2026-09-06 against the verified workspace
(`WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify`,
project `prj_0mtoq2jvx8mcfcg6j`, run `run_0mtoq44vd14f208ur`, case table
`ct_0mtoq3xcgajce13jv`) on port 8091, unless another workspace is named:

```bash
WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify .venv/bin/wise-workbench serve --port 8091
API=http://127.0.0.1:8091/api/v1; P=prj_0mtoq2jvx8mcfcg6j; R=run_0mtoq44vd14f208ur; CT=ct_0mtoq3xcgajce13jv
# stop it again by port:  kill $(lsof -t -nP -iTCP:8091 -sTCP:LISTEN)
```

### CP-3.1 — facets under the canonical filter (R3-O12)

```bash
curl -s "$API/projects/$P/runs/$R/facets?by=attribute&attribute=case%20Spend%20area%20text&view=Automation&limit=6"
curl -s "$API/projects/$P/runs/$R/facets?by=flow_type&view=Automation"
curl -s "$API/projects/$P/runs/$R/facets?by=period&view=Automation&sort=period&limit=20"
```

Observed (4.6 s cold, then from the frame cache): by spend area, Packaging
109,199 items, 99.97 % below expectation, priority 945.7, 14.4 % still open,
exposure 162,021,028; Logistics 5,242 / 100 % / 294.2 / 12.6 %; Additives
18,318 / 99.9 % / 177.8 / 16.5 % — the same numbers the backlog prints for
the same grouping. By flow type: DF1 15,182 (priority 545.7, 14.2 % open),
DF2 221,010 (331.1), 2-way 1,044 (71.6, 39.2 % open), Consignment 14,498
(0.0). By period: 37 case-start months in time order, from 1948-01 (5 items,
the planted outliers) through 2018.

Pass: every facet value carries `cases`, `share`, `share_below_expectation`,
`priority_at_stake` (the stabilised Priority Index against the run's overall
score) and `open_share`; `by=period` groups by case start month and comes
back in time order; the priority of a facet value equals the backlog's
`stable_PI` for the same grouping to 1e-6.

### CP-3.2 — KPI tiles (R3-O12)

```bash
curl -s "$API/projects/$P/runs/$R/kpis?view=Automation"
```

```
items                     251,734 purchase order items in this selection (all 251,734).
share_below_expectation   99.9 % of the 251,734 scored purchase order items miss at least one expectation.
priority_at_stake         1,674.9 priority carried by the 30 groups of case Company × case Spend area text in this
                          selection (shortfall against the overall score of 84.4, small groups discounted).
open_share                14 % of these purchase order items are still open at the end of the data (2019-01-17).
mean_score                84.4 points on average against 84.4 over the whole run (+0.0).
```

Pass: four tiles plus the score, each with a plain sentence; the priority
tile is the sum of the backlog's bars for the same grouping.

### CP-3.3 — one activity filter moves every panel by the same number (R3-O9, R3-O11)

```bash
F='{"and":[{"kind":"activity","op":"contains","activity":"Change Quantity"}]}'
Q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$F")
curl -s "$API/projects/$P/runs/$R/filters/preview?filter=$Q"
curl -s "$API/projects/$P/runs/$R/backlog?slicing=case%20Company%2Bcase%20Spend%20area%20text&view=Automation&minCases=1&filter=$Q"
curl -s "$API/projects/$P/runs/$R/kpis?view=Automation&filter=$Q"
curl -s "$API/projects/$P/runs/$R/facets?by=flow_type&view=Automation&filter=$Q"
curl -s "$API/projects/$P/runs/$R/flow?abstraction=0.05&filter=$Q"
```

Observed: the filter keeps **17,590** of 251,734 purchase order items, and
every panel says so — `filters/preview` 17,590 in / 234,144 out; the backlog
19 groups instead of 30 with `params.cases` 17,590 (Packaging 8,073 items,
priority 507.6 instead of 109,199 / 945.7); the KPI tiles 17,590 ("7.0 % of
all 251,734"), 3,144 still open, priority 878.3 over 19 groups; the flow-type
facet DF2 15,596 + DF1 858 + Consignment 1,136 = 17,590; the map
`meta.cases` 17,590 with `filterCases {in: 17590, out: 234144}`, 13 nodes and
34 edges. Pass: one filter, one number, on every panel.

### CP-3.4 — paths from the full directly-follows relation (R3-O8)

```bash
curl -s "$API/projects/$P/runs/$R/flow/activities/Change%20Quantity?abstraction=0.05"
curl -s "$API/projects/$P/runs/$R/flow?abstraction=0.05&focus=a_change_quantity"
```

Observed for **Change Quantity** — the owner's "no outgoing or incoming
path": the activity is on the map (17,590 items, 7.0 % of the log, stage
*Order*), and at detail level 0.05 **every one of its 42 paths is below the
level**, so the map draws none of them. The endpoint answers with all 42 from
the full relation and says so: *"42 of 42 paths through Change Quantity are
hidden by the detail level (40,459 purchase order items on them); they are
listed here from the full relation."* Incoming: Create Purchase Order Item
11,760 items, Vendor creates invoice 2,483, Change Quantity 1,628, Record
Goods Receipt 1,404. Outgoing: Record Goods Receipt 8,997, Vendor creates
invoice 5,918, Change Quantity 1,628, Change Delivery Indicator 1,080. At
`abstraction=0.01` 39 of 42 are hidden, at 0.005 35 of 42, and each path
carries `onMap`. The profile also lists the expectations that name the
activity (`c_l6_change_quantity`). Pass: the paths never depend on the detail
level, and what the level hides is counted and named.

### CP-3.5 — BPMN export of the flow (R3-O11)

```bash
curl -s -D - -o flow.bpmn "$API/projects/$P/runs/$R/flow/bpmn?scope=flow&detail=0.05"
curl -s -o stages.bpmn  "$API/projects/$P/runs/$R/flow/bpmn?scope=stages"
```

Observed: `content-type: application/xml`, 35 KB, with the counts in the
response headers (`X-Wise-Bpmn-Tasks: 9`, `Gateways: 10`,
`Sequence-Flows: 29`, `Lanes: 6`). The document is a collaboration with one
participant, one process, six lanes (Request, Order, Receive, Invoice, Match,
Pay from the P2P pack), nine tasks in the map's order, one start and one end
event, exclusive gateways where a task branches or joins, and a
`BPMNDiagram` with a shape for every flow node and waypoints on every edge,
so it opens laid out. Counts travel as `bpmn:documentation` ("314,097 events;
93 % of the purchase order items") and as `wise:cases` / `wise:events` /
`wise:violationShare` attributes. `scope=stages` exports the pack's stage
model instead: 7 lanes, 53 tasks, 44 sequence flows from the expected
orderings. `?gateways=false` gives a plain follows model, `?download=true`
adds the attachment header, `?filter=` exports what the filter keeps.
Pass: `xml.etree` parses both; every sequence flow points at an existing node
and every node has a shape and sits in a lane.

### CP-3.6 — decisions accumulate, stay revisable, and say when nothing changes (R3-O1, R3-O3, R3-O4)

```bash
curl -s $API/projects/$P/case-tables/$CT/decisions          # the option set, the decision in force, the history
curl -s -X POST $API/projects/$P/case-tables/$CT/decisions -H 'content-type: application/json' \
     -d '{"kind":"collapse_duplicates","author":"data steward"}'
curl -s -X POST $API/projects/$P/case-tables/$CT/decisions -H 'content-type: application/json' \
     -d '{"kind":"open_cases","params":{"handling":"exclude"}}'   # from the same screen: still accumulates
curl -s -X POST $API/projects/$P/case-tables/$CT/decisions/preview -H 'content-type: application/json' \
     -d '{"kind":"flow_type_assignment"}'
```

`GET …/decisions` answers with the lineage of case tables the decisions
built, and for every readiness item its **full** option set, the decision in
force with its option marked (`selected`, `currentValue`), whether it can be
decided again (always) and its history. A second decision applied from the
first screen is applied to the **head** of the lineage (`appliedTo` in the
response), so `mapping.decisions` reads `["collapse_duplicates",
"open_cases"]` and the second does not undo the first; deciding `open_cases`
again appends a third decision and leaves both earlier ones in the history.
`GET …/decisions?caseTableId=` lists the whole lineage.

The flow-type preview no longer reports "0 of 251,734 cases affected": with
no rules it uses the mapping's own flow typing and answers `alreadyTyped:
true` with *"The mapping already types these 251,734 cases: DF2: 221,010,
DF1: 15,182, Consignment: 14,498, 2-way: 1,044. Nothing would change."*;
applying it answers 409 `decision.already_typed`. A different rule set is a
real assignment and reports the cases and events that would change.

### CP-3.7 — truthfulness: comparison reasons and the caveat rule (R2-05, R2-06)

```bash
curl -s "$API/projects/$P/runs/$R/backlog?slicing=case%20Company%2Bcase%20Spend%20area%20text&view=Automation&minCases=1&pageSize=8"
```

Every row now carries either a `comparison` **or** a `comparison_reason`
(`{code, text}`), never both and never neither; the codes are
`no_scored_cases`, `no_driver`, `not_computed`, `analytics_unavailable`,
`analytics_error`. On this run 12 of 30 rows have a sentence and 18 the
reason *"No comparison was computed for this group in this run (the analytics
compute the top groups first); open the group to compute it."* The slice
detail says the same and adds `scoredCases`; a group with no scored case
prints no sentence at all.

`params.caveat_summary` carries the page-wide share, the largest share and
the always-show threshold (1.5 × the page-wide share) per caveat kind —
censoring 13.9 % page-wide, up to 90.6 %, threshold 20.8 %. Every caveat is
marked `suppressed` by that rule, and a `fail` caveat never is:

```
1 Packaging            censoring 0.144 warn  suppressed
2 Logistics            replication 0.725 fail SHOWN · duplicates 0.727 fail SHOWN
5 Real Estate          censoring 0.437 fail  SHOWN  ⚠ 44 % still open at the end of the data (2019-01-17)
6 (missing)            censoring 0.353 fail  SHOWN  ⚠ 35 % still open
7 Solvents             censoring 0.142 warn  suppressed        ← the review's acceptance, exactly
9 Workforce Services   replication 0.346 warn SHOWN (above the 2.5 % threshold of its kind)
```

The slice detail adds `subgroup_censoring` caveats from the sub-group table
(attribute, value, cases and the share still open) so that a group that is
clean on average but holds a censored sub-group says so.

### CP-3.8 — the run screen plain first, the norm builder, the hub and the review

```bash
curl -s $API/projects/$P/runs/$R/manifest                       # R3-O7
curl -s "$API/projects/$P/norms/inventory?caseTableId=$CT"      # R3-O6 pickers
curl -s -X POST $API/projects/$P/norms/constraints/check -H 'content-type: application/json' -d @constraint.json
curl -s "$API/projects/$P/norms/guidance-questions?kind=layer&id=timeliness_ageing"
curl -s $API/projects/$P/knowledge/hub                          # RK-3
curl -s $API/projects/$P/knowledge/hub/layer:timeliness_ageing
curl -s $API/projects/$P/guidance/constraint/c_l3_invoice_to_clear_days   # RK-2
Q='slicing=case%20Company%2Bcase%20Spend%20area%20text&key=%5B%22companyID_0003%22%2C%22Real%20Estate%22%5D'
curl -s "$API/projects/$P/runs/$R/gates?$Q&view=Automation"     # R1-12
curl -s "$API/projects/$P/runs/$R/what-can-we-do?$Q&view=Automation"      # R2-01
```

Observed:

* **run manifest** — nine plain rows and no hash among them (*Log:
  BPI_Challenge_2019.csv (251,734 purchase order items) · Expectations: WISE
  BPIC'19 norm v1 (draft; 29 expectations; 3 warnings) · Perspective: Finance,
  Logistics, Compliance, Automation · Grouped by: case Company × case Spend
  area text (groups of at least 1) · Small groups: γ = 20 (a group of 20
  purchase order items keeps half of its shortfall) · Scope: the whole log ·
  End of the data: 2019-01-17T15:44:00 · Run: 2026-09-05 18:36:02 (took 13 s)
  · Data caveats: 6 to keep in mind*), and `technical` with every fingerprint,
  hash and artefact checksum next to it.
* **inventory** — 42 activities with events, cases, share and their stage
  (Record Goods Receipt 314,097 / 234,479 / 93 % / receive / `p2p.gr`), and
  ten case attributes with their distinct counts and values (case Spend area
  text: 21 values, Packaging 109,199 / 43 %).
* **constraint check** — *"Paid within terms: after Record Invoice Receipt,
  Clear Invoice follows within 30 days (still partly counted up to 90 days).
  Applies when case Item Category is one of 3-way match, invoice after GR."*
  with 15,182 items in scope, 9,740 of them missing it (64 %); an activity
  the log does not carry is reported as an error and still rendered.
* **hub** — 597 nodes and 1,123 edges for `p2p` (7 stages, 8 layers, 92
  expectations, 29 failure modes, 266 reasons, 177 actions, 18 KPIs); a page
  carries the guidance block and the related expectations; a project's own
  note is stored per entry and marks its hub node.
* **gates** — Real Estate: readiness `failed` (the log's gate is fail),
  censoring `failed` (*44 % of these purchase order items are still open at
  the end of the data*), replication `passed`. A hypothesis on that group is
  refused with 409 `review.gate_failed`; waiving both with a note lets it
  through and the record keeps the computed status next to the decision.
* **hypothesis test** — computed from the run's contrast: risk difference
  0.985 [0.980, 0.985], 100 % here against 2 % elsewhere, medians 3 against
  0, 95 % of the shortfall.
* **What can we do?** — for Real Estate: *Approved once* (95 % of the
  shortfall, headroom 8.67 points = 96 % of the priority) with the reasons
  *in the log: which change event precedes each approval change* and the
  actions *Commercially relevant fields locked after release or a reason
  required* (system_setting, purchasing) and *Release strategy reviewed*
  (policy, finance_controlling); then *Few manual touches* (3.16 points) and
  *Mostly automatic* (6.00 points).
* **uncalibrated (R2-09)** — `c_l7_manual_share` is flagged on this run:
  *"Mostly automatic is missed by 92 % of all purchase order items it applies
  to — a threshold to calibrate, not a difference between groups."*, and six
  expectations are flagged as *cannot fail on this log as it is set*.

### CP-3.9 — the O2C preset end to end (R2-04)

On a fresh workspace, with the extract at its configured place
(`WISE_PRESET_DATA_DIRS`, default `~/code/PhD/WISE/WISE/hackathon_2026/outputs_icpm2026`):

```bash
WISE_WORKSPACE=/tmp/ws_o2c .venv/bin/wise-workbench serve --port 8092
API=http://127.0.0.1:8092/api/v1
P=$(curl -s -X POST $API/projects -H 'content-type: application/json' -d '{"name":"O2C","process":"o2c"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -s $API/projects/$P/datasets/presets            # bpic2019 (builtin) and icpm2026_o2c (pack)
curl -s -X POST $API/projects/$P/datasets/presets/icpm2026_o2c
```

Observed (about 4 minutes from the request to `done`): the preset list now
carries every preset the installed knowledge packs ship, with their case
noun, label pack, slicings and pitfalls; `icpm2026_o2c` resolves
`Sales_Eventlog.csv` and `o2c/templates/o2c_baseline.json`. The job builds

```
51,164 sales order items · 267,071 events · 16 activities · window end 2026-01-26
attributes: … days_late, order_month, return_item, confirmed_quantity, order_quantity, flow_type, header_event_count
flow types: standard 49,486 · rejected 1,568 · partial_delivery 110
readiness: 186 events outside the window, 137 duplicates, 84.1 % header replication of Create Order,
           639 items (1.2 %) still open at the end of the data
```

and scores a run with the pack's four views (Logistics first, from the
preset), the four slicings of the preset (Customer ID, SKU ID, Incoterms
(Part 1), order_month), γ = 20 and min cases 20. The template is translated
into this log's labels before it becomes norm v1 (`o2c.goods_issue` →
`Goods issue`); the 32 canonical activities the extract does not carry are
reported as norm warnings instead of failing. The flow map places the
activities in the pack's O2C lanes (Capture, Commit, Fulfil) and every
sentence says "sales order items".

Against the hackathon's own `WISE_backlog_sales_by_customer.csv` (71
customers, order quantity as volume, no shrinkage), with
`?volume=exposure&gamma=0&minCases=1`:

| What | Reference | This run | Why |
|---|---|---|---|
| customers | 71 | 69 + `(missing)` | three customers with 1, 3 and 2 items are not in the extract's case table; two items carry no customer id and form the `(missing)` group |
| items | 51,317 | 51,164 | the extract's own count is 51,164 (`cycle-02/GOAL.md`); the reference counts 153 more, spread over 16 customers (852213500 +65, 902158000 +29) |
| exposure per customer | — | agrees within 2 % for 65 of 68 | the same order quantity |
| mean score, priority | 852203000 0.943 / 1168.9 | 0.907 / 0.0 | **the norms differ**: the reference used the hackathon's own norm, this run the pack's `o2c_baseline` with placeholder thresholds and 32 activities that never occur here. The order therefore does not agree (Spearman ρ = 0.05 over the 68 common customers) and will not until the template is calibrated on the distribution lens. |

Pass: the population agrees, the scores do not, and the reason is named.
`tests/golden/test_o2c_preset.py` (3 tests, ~50 s) asserts exactly that and
skips when the extract is not on the machine.

## Cycle 4 — CP-4.1 … CP-4.6 (the four-tile budget, truthfulness, the group-aware gate, what-if, exposure and flow types, the norm builder)

Everything below was observed on 2026-09-07. Two workspaces:

```bash
# the verified BPI Challenge 2019 workspace, on a free port
WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify .venv/bin/wise-workbench serve --port 8101
API=http://127.0.0.1:8101/api/v1; P=prj_0mtoq2jvx8mcfcg6j; R=run_0mtoq44vd14f208ur

# a fresh workspace with the ICPM 2026 sales extract loaded by its preset
WISE_WORKSPACE=/tmp/ws_o2c .venv/bin/wise-workbench serve --port 8102
# stop either of them by port:  kill $(lsof -t -nP -iTCP:8101 -sTCP:LISTEN)
```

### CP-4.1 — the board answers within one second, first paint included (R3-07)

```bash
curl -s -o /dev/null -w "%{time_total}\n" "$API/projects/$P/runs/$R/kpis?view=Automation"   # twice
```

Observed on `run_0mtoq44vd14f208ur` (251,734 purchase order items):

| | before | after |
|---|---|---|
| first paint, warm process | 7.0 s | **0.156 s** |
| repeated call | 7.0 s (no cache) | **0.004 s** |
| a second view | 7.0 s | 0.010 s |
| first call of a cold process, censoring artefact already written | 4.2 s | **1.3 s** (of which 1.2 s is the knowledge pack, now warmed in the background: 0.156 s) |
| first call ever on a run scored before this release | 4.2 s | 2.9 s (loads the log once, writes the artefact) |
| filtered on 234,479 items, log in the process | — | 0.13 s |
| `Change Quantity`, 17,590 items | — | 0.04 s |

The numbers are identical to the ones CP-3.2 and CP-3.3 recorded: 251,734 items, 99.9 % below expectation,
priority **1,674.9** over 30 groups, 14 % still open, 84.4 points; under the `Change Quantity` filter 17,590
items, priority **878.3** over 19 groups. Three things did it:

* the group label of the priority tile is built by vectorised concatenation instead of a row-wise join
  (`frame[attrs].agg(" × ".join, axis=1)` cost 6.47 s on 251,734 rows; the vectorised form costs 0.015 s);
* the answer is memoised on `(run, its fingerprints, the analytics stamp, view, γ, min cases, grouping,
  filter)`, so a repeated call and every panel of one board answer from the memo;
* an unfiltered board at the run's own slicing and γ reads its priority from the **backlog artefact the scoring
  job wrote** (`params.priority_source: "run artefact"`), so the tile is the sum of the bars the ranked list
  shows rather than a second, independently computed number; and the open share is read from
  `runs/<id>/cache/censored__<hash>.parquet`, written by the scoring job, instead of loading the event log.

On the extract (51,164 sales order items): 0.022 s cold, 0.004 s warm, `priority_source: "run artefact"`,
57 groups, priority 320.62 — the same numbers the ranked list shows.

### CP-4.2 — one comparison, one bracket, and an expectation that measures logging (R3-04, R3-14)

```bash
curl -s "$API/projects/$P/runs/$R/backlog?slicing=case%20Company%2Bcase%20Spend%20area%20text&view=Automation&minCases=1&pageSize=30"
curl -s "$API/projects/$P/runs/$R/manifest"          # the uncalibrated block carries the new flags
```

Every comparison the server writes now brackets **the difference of the two numbers it prints**, computed from
the printed forms so that a reader who subtracts what is on the page arrives at what is in the brackets:

* BPIC card 1: *Paid within terms: 83 days here against 55 elsewhere (**+28 days**)* — the analytics package's
  Hodges–Lehmann shift (25 days) is not the difference of two medians and keeps its own labelled column in the
  contrast table;
* the extract's card 1: *Shipped within the target time: 100 days here against 1.6 elsewhere (**+98 days**)*;
  card 2 *4.4 days here against 1.4 elsewhere (+3 days)*; card 3 *missed in 19 % … against 2.2 % … (+17 points)*;
* the score tile: *84.4 points on average against 84.4 over the whole run (+0.0)* — the sign is the tile's own
  difference, not its negation;
* the hypothesis test and *What can we do?* print the two shares with their difference in percentage points, and
  the real-unit medians get a **second, labelled sentence** (`median_reading`, `median_comparison`) instead of a
  bracket in a different unit than the numbers beside it.

`bracket_is_difference()` in `domain/comparison.py` reads a rendered sentence back; an API test asserts it over
every `comparison` string of both views of a run.

`expectation_note` says which expectation is which when a card's headline and its comparison differ (*X is
missed by most of these items; Y carries the largest share of the shortfall, and the comparison is about that
one*).

**R3-14** adds two flags to the uncalibrated block, both computed from `measurement.json`, written by the
scoring job:

```
missing_partner  | Picked goods leave promptly: this expectation is missed mostly where the pair of events is
                 | missing — 42,747 of its 42,979 misses have no partner event, not a measured value beyond the
                 | threshold.
missing_partner  | Invoiced within two days of shipping: … 48,640 of its 48,640 misses have no partner event …
partly_measured  | <name> is measured on N of the M items it applies to (x %); on the rest it records whether the
                 | events are logged, not the value it names.
```

A flagged expectation may not lead a card unflagged: `_top_constraints` prefers an unflagged expectation of the
same area, and when there is none the card carries `top_constraint_measures_logging` and the sentence in
`top_constraint_flag`. On the extract the leading expectation of card 1 therefore **changes** from *Picked goods
leave promptly* to *Shipped within the target time*, which is a measured lag.

### CP-4.3 — the readiness gate is read from the group (R3-03)

```bash
Q='slicing=Customer%20ID&key=%5B%22852101700.0%22%5D&view=Logistics'
curl -s "http://127.0.0.1:8102/api/v1/projects/$P/runs/$R/gates?$Q"
```

Five of the eleven readiness checks have a share for a single group (censoring, replication, duplicates,
sentinel stamps, the window edge); the rest are properties of the whole log. The gate a group must pass is the
worst of **its own** shares; the log's verdict stays beside it under `runWide`, where the checks no group can be
judged on are named and decided once.

Observed on the extract's first twelve customers: readiness **passed on 7, pending on 5**, every one of them
`scope: "group"` — where cycle 3 read `fail` on all 57. On BPIC: Packaging passes, Real Estate fails on
censoring (44 %), Logistics fails on duplicates and replication (73 %). `runWide` on the extract reads *The
data-readiness gate on this log reads fail; every failed check has a share per group.*

A gate whose evidence is the log's (`scope: "run"`) is stored without a group, so waiving it once covers the
run. The `domain` gate of the contract is now **computed** (R3-27): it fails when the expectation carrying a
group's shortfall is flagged — a placeholder threshold, or one that measures logging — because then the claim
rests on the norm or on the logging rather than on the group. On the extract it fails for the customers whose
leading expectation is *Shipped within the target time*, whose threshold is still the template's.

### CP-4.4 — what-if against a frozen baseline (R3-27, R1-11)

```bash
curl -s -X POST "$API/projects/$P/runs/$R/whatif/preview" -H 'content-type: application/json' -d @transforms.json
curl -s -X POST "$API/projects/$P/runs/$R/whatif"         -H 'content-type: application/json' -d @scenario.json
curl -s "$API/projects/$P/runs/<scenarioId>/whatif?limit=8"
curl -s "$API/projects/$P/scenarios?baselineRunId=$R"
```

A scenario is a run with three things added: the id of the run it is compared against, the transform layer, and
a name. The `whatif` job builds the scenario's norm version (when the norm changes), scores it under the
baseline's own parameters and writes the change table.

The transform layer, previewed on the extract without scoring anything:

```
cap_lag           selected 51,164  touched 13,936  moved 13,937
delete_activity   selected 51,164  touched  1,613  removed 2,175   (Scheduled delivery date postponed)
move_event        selected 51,164  touched 48,703  moved 48,703    (first Goods issue, −2 D)
set_attribute     selected    208  touched    208  moved  1,246    (FCA → DAP)
keep_first        selected 51,164  touched  1,019  removed 1,562   (Changed Mat.Avail.Date)
```

The cycle's scenario, **make-to-order items get their own threshold**, on the extract: the five SKUs the
planning team calls make-to-order keep 45 days instead of 14 (the material master of this extract does not join
to the sales SKUs, so the population is named by SKU id — see CP-4.5), the baseline expectation is restricted to
the rest with `not_in`, and both become a norm version of the scenario's own.

```
normChanges  o_deliv_order_to_issue_days: applicability {…} → {… , {"attr": "SKU ID", "not_in": [five SKUs]}}
             o_deliv_order_to_issue_days_mto: added
summary      Against the frozen baseline, make-to-order items get their own threshold moves 55 of the 57 groups
             of sales order items that both runs rank; the group at the top is unchanged (["852101700.0"]),
             10 of the top ten are the same.
             priority 320.62 → 312.47   rank agreement (Spearman) 0.9494   top-ten overlap 1.0
             entered []   left []   changed 55   unchanged 2
rows         852101700.0  n 902   PI 134.5 → 130.1  Δ +0.59 points  Δrank 0
             902158000.0  n 8,401 PI  20.2 →  18.1  Δ +0.11 points  Δrank 0
provenance   frozen: true
             baseline run_0mtqxyi8… norm 6bddd1ed7599 params 477c97732e80 cases 51,164 γ 20 min cases 20
             scenario run_0mtqy1ao… norm 7be3781ddbbf params 4fc94a8cdbe9 cases 51,164 γ 20 min cases 20
```

The baseline is untouched: it still answers 134.48 / 67.21 / 44.26 for its top three customers while the
scenario answers 130.06 / 67.19 / 43.91.

### CP-4.5 — exposure and the O2C flow-type rules (R3-15)

```bash
curl -s "http://127.0.0.1:8102/api/v1/projects/$P/case-tables/$CT/flow-types"
curl -s "http://127.0.0.1:8102/api/v1/projects/$P/runs/$R/manifest"       # the "Ranked by" row
curl -s "…/backlog?slicing=Customer%20ID&view=Logistics&volume=exposure"  # rank by quantity
```

* **The `returns` type matches its items.** Two defects kept it at zero. The preset's rule
  `{kind: attribute, field: Returns Item, in: [X]}` was dropped when the mapping was fitted to the file, because
  the column extractor read the value list's key `in` as a column name; and the marker sits on 16 of the 267,071
  events while the case attribute takes the case's first value, which is blank. Flow typing now reads an
  attribute rule over **the whole case** (`attribute_on_any_event`), which is the same answer for an attribute
  that is constant per case. The extract now types **standard 49,481 · rejected 1,563 · partial delivery 110 ·
  returns 10** (51,164 items).
* **`make_to_order` is named absent with its reason**: *The flow type 'make_to_order' is not assigned on this
  log: its rule reads planning_type, which the file does not carry.* The join cannot be made: `SKU_360_WISE.csv`
  carries 80 material ids and `Planning type` with the single value *Reorder point based planning*, and **none**
  of its 80 keys occurs among the extract's 71 sales SKUs or material ids (measured 2026-09-07). Every dropped
  rule is kept as a `flowTypingNotes` entry on the mapping and surfaces in `flow-types.absent` and in
  `compare-flow-types.absent`; a rule that survives but matches nothing is reported as `matches_nothing`.
* **The run states its weighting.** The manifest's plain block carries *Ranked by — number of sales order items
  — in force; the same run also ranks by Order Quantity (rank by quantity)* with both options and which is in
  force; `?volume=exposure` answers the same run by quantity.

### CP-4.6 — the norm builder's server side (R3-02)

```bash
curl -s "$API/projects/$P/norms/applicability?caseTableId=$CT"
curl -s -X POST $API/projects/$P/norms -H 'content-type: application/json' -d @version.json   # with calibration
curl -s "$API/projects/$P/norms/<nv>/calibration"
curl -s -X PATCH "$API/projects/$P/norms/<nv>" -H 'content-type: application/json' \
     -d '{"status":"reviewed","author":"SD expert"}'
```

* **applicability from the flow types** — the extract answers `standard 49,481 · rejected 1,563 ·
  partial_delivery 110 · returns 10`, the absent `make_to_order` with its reason, 21 case attributes with their
  values, and the four clause shapes (`flow_type`, `attribute`, `always`, `not_applicable`);
* **a required rationale per threshold** — `POST /norms` takes `calibration: {<expectation>: {rationale, owner}}`
  and stores it in `metadata.calibration`; `GET /norms/{id}/calibration` lists every threshold, which of them
  this version set (against its parent), its rationale and owner, and `missingRationale`. A version whose
  changed threshold has no rationale and owner is refused when it leaves `draft` (422 `norm.rationale_required`),
  and leaving `draft` without a named person is refused too (422 `norm.author`);
* **not applicable to this log** — `notApplicable: {<expectation>: {note}}` moves the expectation out of the
  version with its note and its own weights, and keeps it in `metadata.not_applicable` so it can be brought
  back; a note is required (422 `norm.not_applicable_note`). This is what stops a layer-balanced score from
  averaging a constant.

The inventory, the constraint check with its plain sentence and the guidance questions per layer are unchanged
from CP-3.8.

### Also in this cycle — a group key a person recognises (R3-08, the backend half)

`key_label` drops the float tail a numeric key arrives with, in the one place the printed form of a key is
built, while the key itself — the JSON array that addresses the group — keeps the value it indexes by:

```
key (addresses the group)   ["852101700.0"]
keys (printed)              {"Customer ID": "852101700"}
reading                     852101700: 902 sales order items, 15 % below expectation on average; …
facet label                 852101700
```

## Tests, lint, types

```bash
.venv/bin/python -m pytest -q                        # 149 passed, 5 skipped (BPIC opt-in) in ~110 s
WISE_BPIC19_CSV=~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv .venv/bin/python -m pytest tests/golden/test_bpic19.py -q
                                                     # 4 passed in 2 min 25 s (20 passed in 3 min 20 s over tests/golden):
                                                     # readiness (251,734 cases, 1948/2020 stamps, header replication,
                                                     # minute vs day precision), Table XI focus slices at ranks 1, 2 and 5, Section V means,
                                                     # and the cycle 2 checks (Packaging stable, 14 % / 44 % still open at 2019-01-17,
                                                     # "97 % beyond 30 days", the four flow types, the norm warnings)
WISE_PRESET_DATA_DIRS=~/code/PhD/WISE/WISE/hackathon_2026/outputs_icpm2026 \
  .venv/bin/python -m pytest tests/golden/test_o2c_preset.py -q             # 3 passed in 42 s (CP-3.9)
.venv/bin/ruff check src tests && .venv/bin/ruff format --check src tests   # clean
.venv/bin/mypy                                                             # clean (96 files)
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
`tests/api/test_cycle3.py` (24 tests on the same synthetic log) covers the
explore board (facets by attribute, flow type and case start period, KPI
tiles, one filter moving every panel by the same number), the paths from the
full relation with the hidden-path count, the BPMN export, the run manifest,
the uncalibrated flags, the guidance and hub endpoints, the norm builder's
pickers and constraint check, the decision lineage and the review records;
`tests/unit/test_cycle3_domain.py` the facet and KPI arithmetic, the BPMN
writer and the path marking.
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
- **The O2C run is not calibrated.** The preset loads the pack's
  `o2c_baseline` template as norm v1 with its placeholder thresholds; its
  backlog therefore does not reproduce the hackathon's own priority order
  (CP-3.9 names every difference). The server side of the calibration is in place since cycle 4 (CP-4.6): the
  thresholds, their rationales and owners, the applicability editor's options and *not applicable to this log*.
  Setting them is the SD expert's work on the distribution lens, not the backend's.
- **`make_to_order` cannot be joined on this extract.** `SKU_360_WISE.csv` carries 80 material ids with the
  single planning type *Reorder point based planning*, and none of its keys occurs among the extract's 71 sales
  SKUs or material ids; the type is therefore reported absent with that reason (CP-4.5) rather than joined.
- **The what-if job (R1-11, R3-27)** exists since cycle 4 (CP-4.4): `POST /runs/{r}/whatif`, its preview,
  `GET /scenarios` and the change table. Not covered: a scenario against a *period* baseline (cycle 8), joint
  scenarios, and undoing a scenario's norm version.
- **Comparison sentences are computed for the top groups only** (12 per
  backlog by default, `WISE_ANALYTICS_COMPARISON_TOP`); every other row
  carries `comparison_reason` `not_computed` rather than a sentence. Opening
  the group computes its own contrast.
- **The gates are three**, computed from the run (readiness, censoring,
  replication); the `domain` gate of the contract exists in the vocabulary
  but nothing computes it yet.
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
