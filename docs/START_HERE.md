# Start here — running the application

Updated with every release. State: release of 2026-09-07 (the four screens
that answer *what can we do*, the gates and hypotheses behind them, the
knowledge hub and the norm builder; a process map whose every label can be
read; one comparison and one bracket everywhere a sentence is written; and a
guided path for a reader who does not want the whole workbench).

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

If a server from an earlier session still holds the port, the script says so
before it builds and prints the process; `tools/start.sh --replace` stops that
one and takes the port, and `tools/start.sh --port 8010` leaves it alone. The
port is a separate argument (`--port 8010`), not `--port:8010`.
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

- **The last step answers the question.** **What can we do?** is a screen
  now, not a placeholder: the group's top drivers, each with the expectation
  in plain words, what closing it would be worth (*8.67 points of possible
  gain (96 %)*), the comparison sentence, **what to check first**, the usual
  reasons split into *in the log — check …* and *outside the log — ask …*,
  and the usual actions with the kind of countermeasure and the role that
  owns it (*system setting · purchasing*). **Propose this action** opens its
  form inside the driver you pressed, and what you record appears on the
  dashboard under **Open findings** — from the server, so a second browser
  and a restarted server show the same list.
- **Gates and hypotheses, on the screen.** Four checks — readiness,
  censoring, replication and *domain* — are computed for the group you are
  looking at, each with its evidence and one plain sentence, and each can be
  passed, failed or waived with a note. Readiness is now judged on the
  group's own shares; what only the log as a whole can be judged on is said
  once, at the run. Marking a reason **to test** writes a hypothesis, and a
  hypothesis on a group whose gate is not decided is refused until it is —
  on **Real Estate**, readiness and censoring both fail (*44 % of these
  purchase order items are still open at the end of the data*). The test
  itself is computed, not typed.
- **A knowledge hub with a page for every word.** 597 pages for
  purchase-to-pay — 7 stages, 8 expectation areas, 92 expectations, failure
  modes, reasons, actions and indicators — each with what is expected, what
  it means when it is missed, why it matters, how it is detected, the usual
  reasons and actions, what to check first, examples and who usually owns
  it. A **What does this mean?** chip on a missed expectation, a driver row,
  an expectation area and a data caveat chip opens the page beside the
  screen you are on, and your own note is added to the pack's text, never
  instead of it.
- **A norm builder instead of JSON.** The Norm step lists the versions with
  their status, author and note, and offers **Mark reviewed** and **Approve
  this version** beside it. An expectation is built from pickers with the
  log's own counts, its applicability comes from the flow types the log
  carries, and a threshold is set on the distribution of the log's own
  values. A threshold this version changes needs a **reason and an owner**,
  and a version cannot leave draft without them or without a named person;
  an expectation this log cannot carry is marked *not applicable to this
  log* with a note instead of being scored as a constant.
- **The map can be read.** Every text drawn inside the map — the activity
  name, the item count, the stage and lane headers, the start and end
  markers, the path labels and both halves of a badge — is at least **11 px
  on the screen** at 1440 × 900, 1280 × 720 and 1024 × 768, on both logs,
  at every detail level, with the activity name at 12 px. The drawing is
  fitted to itself rather than to the empty lanes: the band above it is
  **4.2 %** of the frame at 1440 × 900, where the design allows 8 % and the
  same drawing left 44.7 % empty before the fit was changed.
- **One path answer, over the map.** *Paths in / out* opens a sheet across
  the map: all **49** paths of **Record Goods Receipt** are on the screen at
  once, sortable by items and by median wait, each with **filter to this
  path**, and the canvas keeps its full 1,158 px width behind it.
- **One comparison, one bracket.** The sentence is written once, on the
  server, and the bracket is the difference of the two numbers printed
  beside it: *Paid within terms: 83 days here against 55 elsewhere (**+28
  days**)*. A run scored before this release cannot serve the old form —
  every one of the 40 comparison sentences the reference run answers with
  passes the rule. Where the two distributions differ by something that is
  not that subtraction, it is said in a second, labelled sentence.
- **A guided path.** `?mode=guided` in any address leaves three steps —
  **Where is it worst? → Why? → What can we do?** — opens the *how to read
  this* paragraph with the screen, replaces the refine drawer with three
  questions, and puts the method's controls under `⋯`. **Show everything**
  gives the whole workbench back in one click.
- **The board answers at once.** The four tiles of the reference run are
  computed in **0.20 s** cold and **0.009 s** again, against 7.7 s before,
  with every number unchanged; a filtered selection costs 0.13 s once the
  log is in the process.

**On the server, not yet on a screen.** A **what-if scenario** against a
frozen baseline: a transform layer (cap a lag, delete an activity, move an
event, set an attribute, keep the first of a repetition), a re-score under
the baseline's own parameters or under a norm version of the scenario's own,
and a change table with each group's movement in rank, the Spearman
agreement of the two orders and the provenance of both runs. Section 11 of
the user guide says what it answers and how to ask it.

## Five things to try

1. **Ask what can be done.** Open a group with **Why?**, then **What can we
   do?** in the stepper (`Alt+7`). Read the first driver — the expectation
   in plain words, what closing it is worth, and the reasons split into what
   the log can show and what has to be asked. Press **Mark to test** on one
   reason: it becomes a hypothesis with its checks, and on a group whose
   checks fail it says so instead of recording it.
2. **Follow a word to its page.** Press the **What does this mean?** chip on
   a card's missed expectation. The hub page opens beside the screen with
   what is expected, what it means when it is missed, how it is detected and
   what usually helps — the same text the driver rows and the reason lists
   use, so a word means one thing everywhere.
3. **Read the map.** Press **Flow** in the stepper (or `Alt+5`) and move the
   detail slider: the activity names stay the same size on the screen at
   every level, and so do the stage headers, the counts and the badges.
   Click **Record Goods Receipt** and press **Paths in / out**: 49 paths on
   one sheet over the map, each with **filter to this path**.
4. **Try the guided path.** Add `?mode=guided` to the address of the signals
   list. Three steps, the explanation open, three questions instead of the
   refine drawer, and **Show everything** to leave it again.
5. **Sign a norm version.** Open **Norm**: the version list carries the
   status, the note, the author and **Mark reviewed** beside it. Signing
   asks for the person who signs, and a version whose changed thresholds
   have no reason and no owner is refused in the server's own words with
   the thresholds named — which is what the calibration lens is for.

`docs/USER_GUIDE.md` walks through the workflow and every screen; the
checkpoint files (`apps/backend/CHECKPOINT.md`, `apps/frontend/CHECKPOINT.md`)
list the steps with pass criteria and observed output.

## Known rough edges in this release

- **Two drawn texts can land on the same pixels.** Every text on the map is
  large enough to read, but the labels over the drawing are placed without
  knowledge of each other: on the purchase-to-pay log 12 to 22 pairs
  intersect, depending on the window and the detail level — a path's share
  over another path's, or a badge over the activity name beside it. Open the
  full window or move the detail slider to separate them.
- **The map's own tooltips still say *cases*.** The `<title>` of a path
  reads *124,621 cases. median lag 37 d.* where the rest of the screen says
  *purchase order items*: the drawing library writes that text and takes no
  case noun.
- **At *stages only* the drawing sits in the corner.** The other four detail
  levels fill their frame; the coarsest one leaves the frame two thirds
  empty at 1440 × 900. Move the slider one step right.
- **A version whose thresholds have no reason cannot be signed.** That is
  the rule working, but on a norm that arrived as a template it means the
  thresholds have to be calibrated first: on the sales extract 13 of the 14
  thresholds have neither a reason nor an owner, and the server refuses to
  move the version out of draft until they do.
- **The first board request after the server starts** reads the event log
  once for a run scored before this release (about 3 s); afterwards the
  tiles answer in milliseconds.

## Where to write remarks

In your own notes: a dated heading, free text, one line per screen or
question. The questions of the walkthrough in your notes help; the results
template (`docs/RESULTS_TEMPLATE.md`) is the place for an analysis, and the
notebook's Markdown export is the place for the screens you want to keep.
