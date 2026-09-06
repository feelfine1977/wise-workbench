# Start here — running the application

Updated at the end of every cycle by the release step. State: cycle 1
released on 2026-09-06 (increment 1 integrated and verified).

## Start

One command from the repository root, after the install in `docs/DEPLOY.md`
(a Python virtual environment in `apps/backend/.venv` with the library and
`pip install -e apps/backend`, and `npm install` in `apps/frontend`):

```bash
WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify tools/start.sh
```

It builds the screens once, starts the server and opens
`http://127.0.0.1:8000/`. Without `WISE_WORKSPACE` a new, empty workspace is
created in `~/WISE Workbench`; the verified workspace above already holds
the BPI Challenge 2019 log, its norm and the scored run.

The same by hand, once `apps/frontend/dist` exists (`npm run build:live` in
`apps/frontend`):

```bash
cd apps/backend && WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify .venv/bin/wise-workbench serve --open
```

Development mode (screens reload on every change): backend as above without
`--open`, then `VITE_API_URL=http://127.0.0.1:8000 npm run dev` in
`apps/frontend` and open `http://127.0.0.1:5173`. Without `VITE_API_URL` the
screens run on mock data. Stop everything with Ctrl-C.

## What is new in cycle 1

- One-command start: the backend serves the built screens, the API and
  `/docs` on one port; `wise-workbench serve --open` opens the browser;
  `tools/start.sh` builds and starts.
- The screens on the real backend end to end: upload or the **Load public log
  preset** (BPI Challenge 2019 in one job), mapping with header events, the
  readiness report, norm versions with the calibration lens and JSON, runs
  with live progress and manifest, the ranked list, Why?, traces and the
  process map with stage groups.
- Plain words first on every screen, the method's terms as secondary labels,
  a **words** switch in the ribbon; the ranked list opens on sentence cards
  with the kind of problem (acute, systematic, widespread), the most-missed
  expectation area and one **Why?** per card.
- Real-backend end-to-end test, a CI workflow, a screenshot tool, and the
  documentation: `docs/USER_GUIDE.md`, `docs/DEPLOY.md`,
  `docs/RESULTS_TEMPLATE.md` with the filled example
  `docs/examples/bpic2019_results.md`.

## Five things to try

1. On the dashboard, read the sentence under **Where is it worst?**, then
   press **Open the ranked list**. Set **Only groups with at least … cases**
   to 1 and the perspective to Automation: Packaging 945.7, Logistics 294.2
   and Real Estate 50.6 at ranks 1, 2 and 5 are the paper's Table XI.
2. Press **Why?** on Packaging: the three expectations behind the shortfall,
   the waterfall that sums to 0.9 %, then **Compared with everyone else**
   (96.7 % of invoices clear later than 30 days; drag ϑ), **Cases** (open
   `4507037358_00030`) and **Where in the flow** with **compare with
   everyone else**.
3. Open **Why?** on Logistics and read **Can the data be trusted?**: 72.5 %
   of its cases carry duplicated header events — the reading says "verify
   logging before acting".
4. Switch **words** in the ribbon to *method* and back; open the help (`?`)
   and the glossary; press `⌘K` and jump to **Runs**.
5. On **Data and mapping**, drop any CSV with a case, activity and
   timestamp column, map it, build the case table and read its readiness
   report; then **New run** on it with a grouping from its case attributes.

`docs/USER_GUIDE.md` walks through every screen; the checkpoint files
(`apps/backend/CHECKPOINT.md`, `apps/frontend/CHECKPOINT.md`) list the steps
with pass criteria and observed output.

## Where to write remarks

In your own notes: a dated heading, free text, one line per screen or
question. The questions of the walkthrough in your notes help; the results
template (`docs/RESULTS_TEMPLATE.md`) is the place for an analysis.
