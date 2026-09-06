# Start here — running the application

Updated at the end of every cycle by the release step. State: cycle 2
released on 2026-09-06 (analytics and knowledge wired in, clean interface,
flow-type fork, notebook, readiness decisions, slice designer).

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

## What is new in cycle 2

- **A clean interface.** Three bands — the ribbon with the switchers of the
  current step, the stepper, the page — and one dominant element per screen.
  A card is one sentence with three numbers (*109,199 purchase order items ·
  0.9 % below expectation · waiting too long between steps in 97 % of
  them*), the real-unit comparison under it, at most one caveat chip, the
  priority bar and **Why?**. No ids, no method terms and no γ in plain mode;
  *How to read this* sits behind the `?` beside every title; the method's
  numbers are behind **more** and the **words** switch.
- **The flow-type fork.** *Your process* on the dashboard and on the data
  screen: one card per flow type with its share, a small map and its
  readiness; **Compare everything together** or **Analyse per flow type**
  (one scoped run per type), a flow-type switcher in the ribbon and **Flow
  types side by side**.
- **The analysis notebook.** **Freeze this** on every analysis screen stores
  a picture of the screen with its context, a title and a note; the
  **Notebook** keeps the snapshots in order, reopens any screen and exports
  Markdown with the pictures.
- **The stepper and the way back.** **Data → Norm → Run → Signals → Why →
  What to do** across the top of every screen, with the state of each step
  and *you are here*; sub-screens show a second line; **Back to …** returns
  to where you came from with its filters (`Alt+←`; `Alt+1` … `Alt+6` jump
  to the steps); the browser's back button always works.
- **Caveat actions.** Every data caveat that allows a decision has one:
  open cases (censor, exclude, keep), placeholder dates, duplicates,
  day-precise activities, header events, items without a value, flow-type
  assignment — with **Preview the effect** (cases and events affected), a
  mandatory note, and **Apply and rebuild the case table**. Decisions are
  listed with their resulting case table.
- **The slice designer.** One to three attributes per grouping, numeric
  attributes in bands (quartiles or cut points), a preview of the group
  count on the run's case table, and **Drill into this group** behind
  **more** on every card.
- **Confidence.** Every rank carries its confidence from a bootstrap (high,
  medium, not enough cases to be sure); the kind of problem follows the
  analytics rule; caveat chips carry the share and the window end; every
  top group has a comparison in real units (*Paid within terms: 83 days here
  against 55 elsewhere (+25 days)*); the Why screen shows the missed
  expectations with the share of the shortfall, the sub-groups that carry
  it, and the possible gain.
- **Flow first on Why.** The Why tab holds the top three expectations, the
  comparison lens and the group's map; right-click or Enter on an activity
  offers *filter to*, *exclude*, *paths*, *lens* and *worst cases*; the
  filter scopes the map, the list and the analytics and lives in the URL.

## Five things to try

1. On the dashboard, read the sentence under **Where is it worst?** and the
   four cards of **Your process** (DF2 carries 88 % of the 251,734 purchase
   order items). Press **Open the ranked list**: Packaging, Logistics and
   Real Estate at ranks 1, 2 and 5 in the Automation perspective are the
   paper's Table XI; every card says *confidence high* except the small
   groups, and the second line compares the group with everyone else in real
   units.
2. Press **Why?** on Packaging — the reason screen opens on the first click.
   Read the three expectations with *missed in 97 % · explains 93 %*, the
   comparison lens with *everyone else*, and the map. Right-click **Record
   Goods Receipt** → *filter to*: the count changes to 234,479 of 251,734
   and a chip appears; press **Back to Where is it worst?** (or `Alt+←`).
3. Open **Data** → **Data caveats**. On *still open at the end of the data*
   press **Decide how open cases count**, choose *censor*, **Preview the
   effect** (34,947 of 251,734 purchase order items), write a note and
   **Apply and rebuild the case table**; the tray follows the rebuild and
   **Decisions taken** lists it. (This adds a case table to the workspace;
   the runs and the ranked list of the original table are unchanged.)
4. On any analysis screen press **Freeze this**, give it a title and a
   one-line note, then open the **Notebook** from the ribbon: the picture,
   the note, *Open this screen again*, move up and down, **Export
   Markdown**.
5. On **Runs** → **New run**, add a grouping *Vendor × exposure in
   quartiles* and read its preview (3,778 groups; 2,662 below 20 cases stay
   unranked); or, on the ranked list, open **more** on Packaging and press
   **Drill into this group** to rank its vendors inside it (135 vendors with
   at least 20 items; vendorID_0136 first).

`docs/USER_GUIDE.md` walks through the workflow and every screen; the
checkpoint files (`apps/backend/CHECKPOINT.md`, `apps/frontend/CHECKPOINT.md`)
list the steps with pass criteria and observed output.

## Where to write remarks

In your own notes: a dated heading, free text, one line per screen or
question. The questions of the walkthrough in your notes help; the results
template (`docs/RESULTS_TEMPLATE.md`) is the place for an analysis, and the
notebook's Markdown export is the place for the screens you want to keep.
