# Start here — running the application

Updated with every release. State: release of 2026-09-07 (the
process flow as the instrument, the explore board beside it, the run screen
in plain words, revisable data decisions, and the knowledge and review
endpoints on the server).

## Start

One command from the repository root, after the install in `docs/DEPLOY.md`
(a Python virtual environment in `apps/backend/.venv` with the library, the
analytics and knowledge packages and `pip install -e apps/backend`, and
`npm install` in `apps/frontend`):

```bash
WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify tools/start.sh
```

It builds the screens once, starts the server and opens
`http://127.0.0.1:8000/`. Next time `tools/start.sh --no-build` is enough.
Without `WISE_WORKSPACE` a new, empty workspace is created in
`~/WISE Workbench`; the verified workspace above already holds the BPI
Challenge 2019 log, its norm, the scored run and the run's analytics.

The same by hand, once `apps/frontend/dist` exists (`npm run build:live` in
`apps/frontend`):

```bash
cd apps/backend && WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify .venv/bin/wise-workbench serve --open
```

Development mode (screens reload on every change): backend as above without
`--open`, then `VITE_API_URL=http://127.0.0.1:8000 npm run dev` in
`apps/frontend` and open `http://127.0.0.1:5173`. Without `VITE_API_URL` the
screens run on mock data (the verified run's own responses for company ×
spend area and vendor, illustrative data elsewhere). Stop everything with
Ctrl-C; a server left behind is stopped by its port:
`kill $(lsof -t -nP -iTCP:8000 -sTCP:LISTEN)`.

After every scoring run the server computes the run's analytics (about 50 s
on BPIC 2019: confidence in rank, kinds of problem, caveat shares,
comparison sentences); until then the cards read *confidence not computed*.

## What is new in this release

- **Flow is a step of its own.** **Data → Norm → Run → Signals → Flow → Why
  → What to do**, with `Alt+1` … `Alt+7`. The map has no card around it: one
  44 px filter bar (items in and out, the chips, the detail slider with its
  count, `Map | Model | Table`, the full window and a `⋯` menu), a legend
  column beside the canvas, and the drawing filling the rest of the screen —
  1,360 × 588 px, 61.7 % of a 1440 × 900 window, with no empty band wider
  than 5.5 % on any side and no page scrollbar. The frame keeps one size
  while you work: opening the activity card, adding a filter or entering the
  full window no longer resizes it.
- **Every action on the map does something, and says so.** Click an activity
  and the card underneath offers *Filter to · Exclude · Paths in / out ·
  Distribution · Worst cases · Pin*, with `f x i d w p` on the keyboard.
  *Filter to* **Record Goods Receipt** moves the count from 251,734 to
  234,479 purchase order items, adds a chip and announces the change; an
  action that removes nothing says *no purchase order items removed* instead
  of looking broken. `⤢` or `F` fills the window (over 95 % of it) and
  `Escape` leaves.
- **Every path is reachable.** *Paths in / out* lists the paths of an
  activity from the full directly-follows relation, not only the ones drawn:
  **Change Quantity** has 22 in and 20 out, and at the default detail all 42
  sit under *hidden at this detail level (42)* with **Show them**.
- **`Map | Model | Table`.** The same scene as a BPMN 2.0 diagram with the
  same overlays and the same selection, without a request; `⋯ → BPMN 2.0
  (.bpmn)` downloads the file (9 tasks, 10 gateways, 29 sequence flows, 6
  lanes on BPIC 2019 at the default detail).
- **The explore board.** `Flow | Board` in the page header opens a board of
  linked panels: four selectors (flow type, period, expectation area,
  group), the map, the ranked list, the distribution, a breakdown with three
  tabs and four tiles. One click on the map filters every panel at once;
  every filtered number carries its *all items* twin; bars keep the
  unfiltered order and mark a changed rank instead of moving; removing the
  chip restores the board and the address exactly. **Freeze this**, **Save
  as…** and one primary action *Why? Packaging →* at the foot.
- **The defects of the last round.** Data decisions can be taken again and
  accumulate on one case table (*decided twice · in force: v3*); the
  day-precision dialog is one dialog with the activities *measured to the
  day* preselected (1 of 42); every flow-type card offers **Open the map ·
  Analyse this flow · Compare**; the flow-typing dialog says *The mapping
  already types these 251,734 cases … Nothing would change.* instead of
  reporting 0 of 251,734 affected.
- **The Run step in plain words.** Nine rows — log, expectations,
  perspective, grouping, small groups, scope, end of the data, run, data
  caveats — with the expectations that still need calibrating under them.
  Every fingerprint, hash, mapping id and job id is behind **Technical
  details**, closed on arrival.
- **Numbers that do not overstate.** A group with no contrast prints no
  comparison sentence and says why instead of borrowing one; the caveat rule
  is computed once on the server, so **Real Estate** keeps its *44 % still
  open* chip under a 14 % page-wide line while **Solvents** at 14 % does not
  get one; an expectation whose threshold separates no group carries *⚠ a
  threshold to calibrate* wherever it is named; a share is printed with the
  precision it needs, so 99.945 % never reads as 100 %.

**On the server, not yet on a screen.** The API answers **What can we do?**
(the group's drivers with their usual reasons, usual actions, countermeasure
type and owner role), hypotheses with readiness / censoring / replication
gates, findings and actions, the knowledge hub (597 nodes and 1,123 edges
for purchase-to-pay), the guidance overlay, the norm builder's inventory and
constraint check, and the order-to-cash preset for the ICPM 2026 extract.
The screens for them are the next piece of work; until then those steps read
*not available yet* in the interface.

## Five things to try

1. **Open the flow.** From the dashboard press **Flow** in the stepper (or
   `Alt+5`). Read the count line — *in 251,734 of 251,734 purchase order
   items* — then click **Record Goods Receipt** and press **Filter to** on
   the card underneath: the count becomes 234,479 of 251,734 · 17,255 out, a
   chip appears and the change is announced. Remove the chip to get the
   screen back.
2. **Find the paths the map does not draw.** Move the detail slider to *most
   activities*, click **Change Quantity** and press **Paths in / out**: the
   column beside the map lists all 42 paths with the other end, the items on
   them and the median wait, under *hidden at this detail level (42)* with
   **Show them**. This is the activity that looked path-less.
3. **Use the board.** Press **Board** in the page header. Click **Record
   Goods Receipt** on the board's map: the count line, the ranked list (30
   groups → 21) and the breakdown answer at once, and the four tiles follow
   with their *all items* twins (234,479 against 251,734; still open 12 %
   against 14 %). Remove the chip and every number returns to what it was.
   The first filtered selection on a fresh screen takes several seconds for
   the tiles; a selection made again is instant.
4. **Read the run in plain words.** Open **Run** in the stepper: nine rows
   with no hash among them, the log, the norm with its warnings, the
   perspective, the grouping and the end of the data, then the expectations
   flagged *a threshold to calibrate* — *Mostly automatic is missed by 92 %
   of all purchase order items it applies to*. **Technical details** holds
   the fingerprints for when they are needed.
5. **Decide about the data twice.** Open **Data** → **Data caveats**, decide
   how open cases count, then press **Decide again** on the same item: every
   option is still offered, the choice in force is marked *current*, and the
   line reads *decided twice · in force: v3*. The earlier decision stays
   visible and the second one lands on the case table the first one built.
   (This adds a case table to the workspace; the existing runs are
   unchanged.)

`docs/USER_GUIDE.md` walks through the workflow and every screen; the
checkpoint files (`apps/backend/CHECKPOINT.md`, `apps/frontend/CHECKPOINT.md`)
list the steps with pass criteria and observed output.

## Known rough edges in this release

- On the process map the activity labels are **too small to read at the
  fitted zoom** — 3.0 to 5.8 px against the 11 px the design asks for — at
  every detail level of this log. The slider therefore still offers all five
  levels and the caption marks the ones that fall short; use the full window
  (`F`) or zoom in to read a name.
- The path list of an activity with 42 paths **scrolls** inside its 264 px
  column: all 42 are there and inside the frame, but not all at once.
- The **first** filtered selection on the board takes about eight seconds
  for the four tiles (the count line, the ranked list and the breakdown
  answer in under half a second); the same selection made again is instant.

## Where to write remarks

In your own notes: a dated heading, free text, one line per screen or
question. The questions of the walkthrough in your notes help; the results
template (`docs/RESULTS_TEMPLATE.md`) is the place for an analysis, and the
notebook's Markdown export is the place for the screens you want to keep.
