# User guide — WISE Workbench

Current setup and limitations are maintained in [START_HERE](START_HERE.md) and the [repository README](../README.md#current-limits). The norm workflow records calibration and exclusion decisions per expectation and preserves the current signer on reload. Software approval records the responsible person's decision; appropriate business thresholds still require domain review.

For an analyst who has an event log of a purchase-to-pay (or similar) process
and wants to know where it falls short of expectations, without knowing the
method behind the application. Every screen is described with the labels it
shows. The words in **bold** are labels you will find on the screen; the
numbers are those of the BPI Challenge 2019 log in the verified workspace.

## Workflow

The stepper across the top of every screen names the seven steps of an
analysis — **Data → Norm → Run → Signals → Flow → Why → What can we do?** —
and shows where you are (*you are here*), what is done (●), what is in
progress (◐) and what is still waiting (○, with the reason in a tooltip:
*needs a finished run*). Every step is a link to where its work happens;
`Alt+1` … `Alt+7` jump to them; **Back to …** and `Alt+←` return to where
you came from, with its filters. A reader who wants one path rather than
seven steps can open any address with `?mode=guided` (section 2).

**Data.** You give the application an event log (one row per event: which
case, which activity, when), name the columns, say what a case is (an order
item, a ticket, an invoice) and build the case table. The readiness report
lists what in the data could distort the results — cases still open at the
end of the data, placeholder dates, duplicated events, header events copied
onto every item — and every caveat that allows a decision has one: censor,
exclude or keep the open cases, drop the events outside the window, collapse
duplicates, type the header events away. *Your process* shows the flow types
the log contains and lets you analyse them together or one by one.

**Norm.** You tell the application what the process is expected to do — a
list of expectations such as "an invoice is cleared within 30 days of
receipt" or "an order line is not changed after approval", grouped into
expectation areas and weighted per perspective (Finance, Logistics,
Compliance, Automation). The public-log preset brings the reference norm;
the calibration lens shows how a threshold sits in the data and commits a
new version with a note.

**Run.** A run scores every case against a norm version and ranks groups of
cases — by vendor, by company × spend area, by any one to three attributes,
numeric ones in bands — with caution against small groups (γ). A run can
cover the whole log or one flow type; identical inputs return the existing
run. After scoring, the server computes the run's analytics (confidence in
rank, kinds of problem, caveat shares, real-unit comparisons).

**Signals.** **Where is it worst?** ranks the groups by priority: how many
cases × how far below the overall score, small groups discounted. Each card
is one sentence with three numbers, a real-unit comparison with everyone
else, the kind of problem, the confidence in the rank and at most one caveat
chip. **Refine** narrows the list by group, size, expectation area, kind and
confidence; every filter is a chip and lives in the address.

**Flow.** The process map as an instrument, not a picture: the whole log
or the current selection drawn as activities and paths, with one filter bar
above it and every action — filter to an activity, exclude it, list its
paths, open its distribution, open its worst cases — changing the count in
front of you. Beside it, under `Flow | Board`, the **explore board**: one
selection moves the map, the ranked list, the distribution, the breakdown
and the four numbers together. Section 9.

**Why.** One click on **Why?** opens the group's reasons: which expectations
are missed and how much of the shortfall each explains, the comparison with
everyone else, where in the flow it happens (the group's map with actions on
every activity), the cases furthest off, whether the data can be trusted,
and the possible gain. The decision pane asks **What next?** — investigate,
defer, accept the shortfall, not a problem — with a note. **Freeze this**
keeps any screen in the notebook with its context and your remark.

**What can we do?** The last step takes the group's shortfall apart into its
drivers: for each, the expectation in plain words, what closing it would be
worth in score points, what to check first, the usual reasons split into *in
the log — check …* and *outside the log — ask …*, and the usual actions with
the kind of countermeasure and the role that usually owns them. A reason
marked **to test** becomes a hypothesis, which the checks on the group must
let through; a proposed action is recorded with its owner and appears on the
dashboard. Every word on the screen has a page in the knowledge hub behind
it. Section 11.

Priorities are evidence for hypotheses, not verdicts. The application never
says what causes a shortfall; it shows where the shortfall sits and which
expectations coincide with it.

## 1. Start it

```bash
tools/start.sh
```

builds the screens once and starts the server; the browser opens at
`http://127.0.0.1:8000/`. Next time, `tools/start.sh --no-build` is enough.
Details, folders and settings: `docs/DEPLOY.md`; the verified workspace and
what is new: `docs/START_HERE.md`.

The first screen is the project's dashboard (or **Projects** when there is
more than one; a project is one process with a steering question, its logs,
norm versions and runs). A fresh workspace has one project, **Demo**, created
by the public-log preset described in section 3.

## 2. What every screen shares

**Three bands.** The ribbon, the stepper, the page. Nothing else stays on
every screen.

**The ribbon** shows the context every number belongs to — **project**,
**run** (its note and date, *Run of Sep 5, 2026* without one), and the
switchers of the current step: **perspective**, **grouping**, **scope** (all
flow types, or one) on Signals and Why; **case table** (*case table v1 ·
251,734 cases*) on Data. On the right: **N caveats** (opens the data
caveats), **Notebook** with its snapshot count, the camera (presses the
screen's **Freeze this**), **Help and glossary** (`?`) and the **Command
palette** (`⌘K` / `Ctrl K`). The rest — **Knowledge hub** (*what the words
mean*, section 11), density, theme, the **words** switch, *live backend* or
*mock data* — sits behind **⋯**. No id is visible; hover a switcher for it.

**The stepper** (the Workflow section above). Sub-screens show a second line
under their step: on the norm lens opened from Why it reads *Why › Packaging
· lens of "Invoice-bearing flows should clear in a reasonable time"*; the
notebook shows under the step it was opened from. **All stages** (⋯) at
the right end lists the twelve stages of the method with their state.

**Back to …** is the first element of every sub-screen's header — *Back to
Where is it worst? (page 1, widespread only)* — and returns to the last
screen of another kind with its page, tab, filters and chips; `Alt+←` does
the same; the browser's back button always works because every move is a
normal history entry.

**How to read this.** Every screen has a short paragraph behind the `?`
beside its title; it opens under the title and stays open or closed per
screen as you left it.

**Freeze this** on every analysis screen (dashboard, signals, Why, norm,
run, dataset) opens a small dialog — a prefilled **title**, a **note** — and
stores a picture of the screen, the numbers behind it and where you were
(run, grouping, perspective, filters) in the project's notebook (section 14).

**The job tray** (bottom right, **Jobs**) appears when something runs: each
job with its status (*queued*, *running*, *done*, *failed*, *cancelled*), a
progress bar, **Cancel job**, **Open result** when it is done and
**Dismiss**. The tray announces "Job … is done" to screen readers.

**Two vocabularies.** Every label is written in plain words first (group,
expectation, expectation area, perspective, shortfall, priority, kind of
problem, confidence in rank, purchase order items for the cases). The
method's own terms (slice, constraint, layer, view, gap, PI, hotspot type,
stability) appear behind **more**, in tooltips and with the **words** switch
(**plain** | **method**) in **⋯**; the choice is remembered in your browser.
Section 17 lists all pairs.

**Keyboard.** `Alt+1` … `Alt+7` the steps, `Alt+←` back, `⌘K` the palette,
`?` the help; on the signals list `↑` `↓` move between cards, `↵` opens
**Why?**, `p` pins, `f` opens the decision pane, `/` opens **Refine**; on the
map the arrow keys move between activities, `Space` selects, `Enter` opens
the actions menu, `Esc` clears.

**Guided mode.** `?mode=guided` in any address turns the workbench into one
path for a reader who has a question rather than an analysis to run; it is
remembered until `?mode=analyst` turns it off. What changes:

- **three steps instead of seven** — **Where is it worst? → Why? → What can
  we do?**; loading a log, writing a norm and scoring a run are the
  analyst's work and are not on the path;
- **the ribbon keeps the project, the run and the scope**; the perspective,
  the grouping, γ and the **words** switch move under **⋯**, and the
  duplicated selects beside the ranked list are gone;
- **the explanations open with the screen** — the *How to read this*
  paragraph is unfolded and cannot be closed;
- **Refine becomes three questions** — *only the groups with many items*,
  *only the ranks we are sure of*, *only the sharpest problems* — instead of
  the drawer with the method's terms;
- **the decision pane asks *What next?* and a note**; the kind of problem is
  computed rather than asked for;
- **a banner** at the top says what guided mode is, with **Show
  everything** — one click back to the whole workbench.

The numbers, the sentences and the addresses are the same in both modes: a
link copied in guided mode opens the same screen for an analyst.

## 3. Load a log: the BPIC 2019 preset or your own CSV

**Data** (step 1) reads "Upload a log, map its columns, type header events
away and read the data caveats before scoring — or load a public log in one
click." and has two cards:

- **Drop a CSV, Parquet or XES file here** with a **Choose file…** button.
  Dropping a file starts an *Ingest* job (the file is copied into the
  workspace, its SHA-256 becomes the dataset's content hash, its columns are
  profiled). XES needs the optional `pm4py` package, which this release does
  not install.
- **Load public log preset**: "A known log on this machine, its column
  mapping and the reference norm, ingested, built and scored in one job. The
  file is read in place, not copied." It lists **BPI Challenge 2019
  (purchase-to-pay)** with the file path. When the file is not at that path
  the card says so and names the setting (`WISE_BPIC19_CSV`). The button
  starts one job that does everything up to a scored run (about 90 s on a
  laptop for the 1.6 million events, then about 50 s of analytics) —
  **Open result** in the tray then opens the ranked list.

Below, the **Datasets** table: **name** (a link to the dataset screen),
**status** (*ready*, *ingesting*, *failed*), **events**, **created**, and
**Map columns** for ready datasets. When a case table exists, **Your
process** (section 4) is shown here as well.

The BPI Challenge 2019 log is the public purchase-to-pay log of a coatings
company: 1,595,923 events, 251,734 purchase-order items, 42 activities,
January 2018 to January 2019. The examples in this guide come from it.

## 4. Your process: the flow-type fork

On the dashboard, and on the data screen under its **Your process** tab, one
sentence says how the log splits — *The log splits into 4 flow types by
flow_type; DF2 carries 88 % of the 251,734 purchase order items* — and one
card per flow type follows, largest first: the count and share as a bar, a
small map of the flow, its readiness in one line (how many of its items are
still open at the end of the data, its median duration), and **Analyse this
flow**.

**How do you want to analyse?** offers the fork:

- **Compare everything together** keeps one run over the whole log; the
  ranked list compares every group with the overall score.
- **Analyse per flow type** starts one run per flow type with the same norm
  and grouping (four jobs in the tray on BPIC 2019). When they are done the
  ribbon's **scope** switcher offers *all flow types / DF2 only / DF1 only /
  …*, and every screen — list, Why, map — is restricted to that flow type.
  **Every flow type has its run** is shown once that is the case.
- **Flow types side by side** opens the comparison on the run screen: one
  column per flow type with its items and share, the share of rules met
  against everyone, the expectation missed most, the largest groups and the
  censoring share (DF2 84 % met · *Mostly automatic*; DF1 81 % · *Paid
  within terms*; Consignment 91 %; 2-way 77 % · *Approved once*).

Flow types come from the mapping's rules for known logs (DF1, DF2,
Consignment, 2-way match on BPIC 2019) or from a case attribute you name.

## 5. Map columns, read the data caveats, decide about them

Click a dataset (or **Map columns**). The screen **Data · mapping and case
notion** has three tabs: **Data caveats**, **Your process** and **Column
mapping**.

**Column mapping** is prefilled — the line under the title says by what:
"Prefilled by the backend from the column names (BPI Challenge 2019 export)",
"(XES / pm4py convention)" or "(patterns)". The fields:

| Field | What to put there |
|---|---|
| **case id \*** | the column that identifies one case (an order item, a ticket, an invoice) |
| **activity \*** | the column with the activity name |
| **timestamp \*** | when the event happened |
| **timestamp format** | a `strptime` pattern such as `%d-%m-%Y %H:%M:%S.%f`; empty lets the library parse mixed formats |
| **resource** | who or what did it (optional) |
| **lifecycle** | the transition column, when the log has `start`/`complete` rows |
| **exposure (volume for PI)** | a money or quantity column; priorities can be weighted by it |
| **case attributes (slice keys)** | tick the columns you want to group by later (vendor, company, spend area, item type, …). Only ticked columns can be groupings of a run |
| **header events (replicated onto items; typed away)** | activities that belong to the purchasing document rather than the item — they count once per document, not per item |
| **note** | free text: "Case notion: PO item; header events typed away". The case notion is a human decision and travels with the case table |

For known logs the mapping also carries the flow-type rules, the closing
activity (**closes with Clear Invoice**) and the name of a case (*purchase
order items*), which every sentence uses instead of "cases".

**Validate and build case table** validates the mapping on a sample and
starts the *Case table* job (about 10 s for BPIC 2019). When it is done the
screen moves to **Data caveats** and the ribbon's **case table** switcher
lists the new table.

**Data caveats** reads *251,734 cases from 1,595,923 events; 6 caveats
travel with every result until you decide about them* and lists the
readiness report — **What could distort the results, and what you decide
about it** — one line per check with its level (*info*, *warn*, *fail*) and
a sentence. On BPIC 2019:

| Line | Plain reading | Decision offered |
|---|---|---|
| **window** | the period the data covers (robust quantiles, ending 2019-01-17) and the raw span of timestamps | — |
| **timestamp_outliers** | 578 events outside the window (1948 and 2020 stamps) | **Drop the events outside the window** |
| **sentinel_dates** | timestamps that look like placeholders | **Treat placeholder dates as missing** |
| **timestamp_precision** | activities recorded only to the day | **Mark day-precise activities** |
| **duplicate_events** | exact duplicates (same case, activity, time): 180,913 events in 5,089 items | **Collapse exact duplicates** |
| **header_event_replication** | header events copied onto every item of a document | **Type the header events away** |
| **right_censored** | cases still open at the end of the data (34,947 = 13.9 %) | **Decide how open cases count** |
| **zero_exposure** | cases with exposure 0 | **Decide how items without a value count** |
| **flow_types** | how many cases of each flow type the rules found | **Assign the flow types** |

A decision opens a small dialog: the choices (for open cases *censor* —
lags without an end are not counted as late —, *exclude them from the case
table*, or *keep them as they are and count the missing closure*; for items
without a value *exclude them from value-weighted priorities* or *keep them
with their value of 0*; activities as check boxes), **Preview the effect**
— *34,947 of 251,734 cases · 173,184 of 1,595,923 events affected* for the
open cases, *5,089 of 251,734 cases · 180,913 of 1,595,923 events* for the
duplicates —, a mandatory **note** and an **author**, and **Apply and
rebuild the case table**. Applying records the decision, derives a new
mapping version and builds a new case table (the tray follows it); the
screen moves to the new table and re-evaluates its readiness. **Decisions
taken** lists every decision with its kind, version, cases and events
affected, author, note, resulting case table and time; **Decide again**
changes a decision on a later version. Runs of the earlier case table are
unchanged.

Warnings never block; they travel with every result: the ribbon's **N
caveats** chip, a line on the dashboard, one chip per card on the ranked
list (*14 % still open at the end*) and **Can the data be trusted?** on the
Why screen.

## 6. Import or write a norm, and read its JSON

**Norm** (step 2) lists every version: **version**, **status** (*draft*,
*reviewed*, *approved*), **note**, **author**, **created**, and the run that
used it. Every save is a new, immutable version with a note.

Where norms come from in this release:

- the public-log preset imports the reference norm of the BPI Challenge 2019
  (`bpic19_norm.json`) as **v1** with the note "imported from bpic19_norm.json";
- committing a threshold from the calibration lens (below) creates the next
  version;
- a norm written by hand is sent to the API: `POST /api/v1/projects/{project
  id}/norms` with a body `{"norm": <the JSON document>, "note": "why"}`
  (open `http://127.0.0.1:8000/docs`, *norms*, **Try it out**). The document
  is validated by the library; errors come back as a list.

The norm builder also provides rule and applicability forms; see section 12 for saving, reviewing and approving a version.

Open a version. The header reads its name and version (**WISE BPIC'19 norm ·
v1**), the status badge, the scoring mode and the counts: "layer_balanced ·
7 layers · 29 constraints · 4 views". A version created against a case table
lists its **warnings**: activities the norm names that never occur in the
log (three on BPIC 2019, such as *Change Payment Terms*); the ranked list
marks the groups whose most-missed area contains such an expectation.
Three tabs:

**Constraints.** The **Catalogue** lists the expectations by expectation
area with their plain name (*Paid within terms*), the sentence, the type,
the weight and, for expectations with a threshold, **ϑ = 30 · W = 60**. The
sentence patterns by type:

| Type | Sentence |
|---|---|
| presence | *A should occur at least 1×* |
| exclusion | *A should not occur* |
| precedence | *A should precede B* |
| lag | *B within 30 D of A (tolerance 60)* — a duration; ϑ is the threshold, W the width of the tolerance band |
| singularity | *A at most 1× (tolerance up to 3)* |
| metric | *attribute at most 5 (width 5)* — a case attribute compared with a threshold |
| balance | *x vs y within 0.1* |

The **Calibration lens** on the right shows, for the selected expectation and
the latest finished run, the distribution of the raw signal in the data
(histogram and cumulative curve, binned on the observation window with one
bin for everything beyond it) with **ϑ threshold** and **W width** as inputs
and sliders; the line under the chart says what share of cases lies beyond
ϑ (*97 % beyond 30 days* for invoice clearing). Moving them is exploration.
The commit button opens **Commit threshold as a new version** — "A
threshold is a human decision, so a one-line reason is required." — with a
**note \*** field and **Create version**. Arriving from a Why screen, the
header reads **Back to Why?**.

**JSON** shows the document as the library reads it:

```json
{
  "name": "WISE BPIC'19 norm",
  "scoring_mode": "layer_balanced",
  "layers": [{ "id": "L3_timeliness_ageing", "name": "Handovers and ageing" }, …],
  "views": [{ "name": "Finance", "layer_weights": { "L3_timeliness_ageing": 1.0, … } }, …],
  "constraints": [
    {
      "id": "c_l3_invoice_to_clear_days",
      "layer": "L3_timeliness_ageing",
      "type": "lag",
      "params": { "a": ["Record Invoice Receipt", "Vendor creates invoice"], "b": "Clear Invoice", "delta": 30, "width": 60, "unit": "D" },
      "weight": 1.0,
      "description": "Invoice-bearing flows should clear in a reasonable time.",
      "applicability": { … which cases the expectation is meant for … }
    }
  ]
}
```

- `layers` are the expectation areas; the plain names on screen (*On time*,
  *Doing it once*, *Touchless where possible*) come from the knowledge pack.
- `views` are the perspectives: whose expectations count and how much.
- `constraints` are the expectations; `params` depend on the type;
  `applicability` restricts an expectation to the cases it is meant for (a
  flow type, an item category), and only those cases are *counted* for it.
- `scoring_mode: layer_balanced` means a case's score (0–1) averages the
  areas, so an area with many expectations does not dominate.

**Version notes**: **This version** (note, author, created, parent,
validation) and the **Lineage** of all versions.

## 7. Run: the slice designer, the scope, the monitor

**Run** (step 3): "A run = case table × norm version × parameters; identical
inputs return the existing run." **All runs** lists **run**, **status**,
**period / note**, **norm**, **case table**, **scope**, **γ**, **min
cases**, **views**, **slicings**, **finished** and a button to its ranked
list.

**New run** opens the form:

| Field | Meaning |
|---|---|
| **case table** | the built case table to score |
| **norm version** | which version of the expectations |
| **scope** | *all flow types*, or one flow type (the fork of section 4 fills this) |
| **γ (small groups count less)** | caution against small groups: "A slice with n = γ keeps half of its gap." 20 for BPIC 2019; 50 is the default |
| **min cases** | groups with fewer scored cases are not ranked |
| **views** | which perspectives to score (all by default) |
| **groupings** | the slice designer, below |
| **note** | a period label and the reason for γ; the ribbon shows it as the run's name |

**The slice designer.** A grouping is one to three attributes chosen from
the case attributes ticked in the mapping (*Company × Spend area text*,
*Vendor*); a numeric attribute (exposure, number of events, a case
attribute) can be banded into quantiles with a count (quartiles) or at cut
points you type (*1000, 10000, 100000*). Several groupings go into one run.
Every grouping shows its **preview** on the run's case table before you
start: *1,975 groups over 251,734 cases; 1,709 below 20 cases stay
unranked* for the vendor; *3,778 groups; 2,662 below 20* for vendor ×
exposure quartiles, with the band edges.

**Start run** queues the job and opens the run monitor: the run's note and
date with its status badge, the **Progress** card with the percentage and the current
message ("scoring cases", "backlog case Company+case Spend area text ×
Finance", …), a **Cancel** button while it runs. Scoring BPIC 2019 takes
about 13 s, the analytics that follow about 50 s; the tray announces when
scoring is done and **Open the ranked list** appears — cards read
*confidence not computed* until the analytics are in.

Three tabs: **Parameters and manifest** (the parameters, and the manifest:
norm fingerprint, content hash, mapping, params hash, window end, scope,
library version, started, finished — "Same content hash + norm fingerprint +
params hash → identical ranked list."), **Flow** — the process map of the
whole log with the expectations drawn on it (section 9 explains the map)
—, and **Flow types side by side** (section 4).

## 8. Read the signals list

**Signals** (step 4) is **Where is it worst?** for the run. One sentence
under the title says what is ranked: *23 groups of purchase order items by
Company × Spend area, ranked by how many × how far below the overall score,
small groups discounted, in the Automation perspective*. Caveats that hold
on nearly every group are stated once under it, in the run's own words and
with the run's own numbers (*On nearly every group of this run: 17 %
started near the window end · 14 % still open at the end*, and under it
*still open at the end: 14 % on average, up to 91 % on 23 of 23 groups*),
not on every card. A caveat that holds on six groups of the twenty-three is
not stated of the run.

**Refine** (the funnel) opens a drawer of questions — which group (`/`),
at least how many cases, only problems about one expectation area, only one
kind of problem, only high-confidence ranks, caution against small groups
(γ), per page — beside the **perspective** and **grouping** switchers. Every
active filter is a chip with × under the drawer button, and **clear all**
removes them; every filter lives in the address (section 15).

**Three tabs: Signals, Table, All groups at once.**

**Signals** is the default: one card per group, ranked, ten a page. A card
reads, from the top:

> **1** · **Packaging** · ● widespread
> **109,199** purchase order items · **0.9 %** below expectation · waiting too long between steps in **97 %** of them.
> Paid within terms: 83 days here against 55 elsewhere (+25 days).
> [priority bar] priority 946 · confidence high · ⚠ 14 % still open at the end · **more** · **Why?**

- the rank and the group's name — the part every group on the page shares
  (the company on BPIC 2019) is dropped; a group outside it keeps it as a
  suffix (*Real Estate · company 0003*);
- the **kind of problem** with its glyph: **acute** (▲) — few cases, far off;
  **systematic** (◆) — one pattern behind it; **widespread** (●) — many
  cases, slightly off. An acute group is a small set of cases to look at one
  by one, a systematic group has one recurring expectation behind it, a
  widespread group is large and slightly off everywhere;
- the sentence: how many, how far the group's score sits below the overall
  score (in score points, as a per cent), what is missed most and in what
  share of the group;
- the **comparison** with everyone else in real units, from the analytics:
  a duration (*Paid within terms: 83 days here against 55 elsewhere (+25
  days)*), a count per item (*Received in few deliveries: 14 Record Goods
  Receipt or Record Service Entry Sheet events per purchase order item here
  against 1 elsewhere (+13)*), a share (*Mostly automatic: a manual share of
  83 % here against 80 % elsewhere (+3.3 points)*) or, when no real-unit
  value applies, the share of items missing the expectation (*Mostly
  automatic: missed in 98 % of purchase order items here against 92 %
  elsewhere (+6.2 points)*). When the numbers round to the same value the
  line says *No material difference on the top expectation (…)*. The top
  twelve groups of every grouping and perspective carry one;
- the **priority** bar relative to the top group, the priority as a whole
  number, and the **confidence** in the rank — *high*, *medium*, *not
  enough cases to be sure* — from a bootstrap that resamples the cases 200
  times and asks how often the group keeps its place; *not computed* while
  the analytics are still running;
- at most one **caveat chip** — the share and what it means (*73 %
  duplicated events*, *35 % copied postings*); the rest under **more**;
- **more** unfolds the method's numbers — the priority with its raw value
  and γ, the rank, the average score as *share of the rules met*, the
  distance in points (*0.9 points below the overall score of 84.4 (1 %)*),
  the confidence reason (*P(stays in top-10) = 1.00* and the rank interval),
  the expectation area (*On time*), the full caveat texts, the reading
  sentence — and **Drill into this group**;
- **Why?** opens the group's reasons (section 10) on the first click.

**Drill into this group** ranks a finer grouping inside the group — the
vendors inside Packaging — with the overall score as baseline: the sentence
reads *… by Vendor inside companyID_0000 × Packaging*, a chip leaves the
drill. 135 vendors with at least 20 items sit inside Packaging;
vendorID_0136 (14,369 items) first. The confidence is not computed inside a
drill.

**How the ranking works.** Each case gets a score between 0 and 1 in the
chosen perspective (1 = every applicable expectation met). A group's
**shortfall** is how far its average score lies below the overall average.
Its **priority** is shortfall × number of cases — how much is at stake. To
stop tiny groups with one bad case from topping the list, the shortfall is
pulled towards the average by γ: a group with as many cases as γ keeps half
of its shortfall; the list is sorted by this discounted priority. That is
why Packaging (109,199 items, 0.9 % below) ranks above Real Estate (583
items, 9 % below): 946 against 51.

**Keyboard**: `↑` `↓` move between cards, `↵` opens Why?, `p` pins the card
into the comparison strip (three slots above the list; **Unpin** removes
it), `f` opens Why? with the decision pane focused, `/` opens Refine. The
footer shows "10 of 23 groups · page 1 / 3" with **Previous** and **Next**.

**Table** shows the same rows as numbers with full precision: **#**,
**group**, **cases**, **average score**, **shortfall**, **shortfall, small
groups discounted**, **priority**, **priority, small groups discounted**,
**kind of problem**, **confidence in rank**, **most-missed expectation
area**, **reading**. Column headers sort; hovering a numeric cell shows a
`?` — **Explain this number** — which opens the formula (for example
`PI = n · (μ̄ − μ_s)₊`), the inputs and caveats. A group's link opens Why?
on the first click.

**All groups at once** draws every group with the current filters: the
**cases × shortfall** scatter ("whiskers = the cautious bound; shape = kind
of problem; size = priority") and **how much of the priority the top groups
carry**. Clicking a point opens its reasons.

## 9. Where in the flow: the map as the instrument, and the board

**Flow** (step 5) is the process map with nothing around it. It opens from
the stepper (`Alt+5`), from the **where in the flow** tab of the Run screen,
from any flow-type card on the dashboard, and — smaller, in the same shape —
as the **Flow** tab of the Why screen, where **Open full →** carries the
group and the chips into the step.

**The header** holds **Back to …**, the title with one reading sentence, the
`Flow | Board` switch (two arrangements of one step: the context, the
filter, the chips and the selection survive the switch) and **Freeze this**.

**One filter bar, 44 px,** and nothing else above the drawing:

- the count line in the run's own case noun — *in 251,734 of 251,734
  purchase order items*, and under a filter *in 234,479 of 251,734 purchase
  order items · 17,255 out*;
- the chips, one per clause, in the order you added them, each with a ×;
- the **detail slider** from *stages only* to *all that fit*, with its
  caption *more activities · 8 of 42 activities* (`[` and `]`);
- **map | model | table** (`M`);
- the full window (`⤢`, or `F`);
- **⋯** with **BPMN 2.0 (.bpmn)** and the keyboard map.

**The frame is the page.** No card, no title over the drawing: a 1 px
border, the legend as a column beside the canvas (**Hide the legend** folds
it into a button; below 1200 px it is a **▤ legend** button with a pop-over,
so the canvas keeps the full width), and the zoom controls (**+**, **−**,
**Fit the map to the frame**, **Fill the window**) as the only thing over
it — the drawing library's own control bar and watermark are gone. At
1440 × 900 the frame is 1,360 × 588 px — 61.7 % of the window — with the
canvas 1,158 px wide beside the legend column, and the step never grows a
page scrollbar: opening the activity card, adding a filter or entering the
full window leaves the frame the size it was.

**Every label on the map can be read.** The drawing is fitted to what it
draws rather than to the lanes that hold it — the empty band above it is
**4.2 %** of the frame at 1440 × 900 — and every text inside the canvas is
drawn at a constant size on the screen whatever the fitted zoom: the
activity name at **12 px** and the item count, the stage and lane headers,
the start and end markers, the path labels and both halves of a badge at
**at least 11 px**, at 1440 × 900, 1280 × 720 and 1024 × 768, at every
detail level. A badge that cannot be drawn inside its own box at that size
is dropped, worst share first, rather than printed illegibly. Two things
this does not fix: the share labels of two different paths can still land on
the same pixels, and the pop-up title of a path is written by the drawing
library and says *cases* where the rest of the screen says *purchase order
items*.

**Click an activity** and a card appears under the map with its counts and
six actions, each with a key:

| Action | Key | What it does |
|---|---|---|
| **Filter to** | `f` | only the items that pass through it |
| **Exclude** | `x` | drops the items that pass through it |
| **Paths in / out** | `i` | every path in and out, from the full relation |
| **Distribution** | `d` | the distribution behind this activity, over the screen |
| **Worst cases** | `w` | the worst cases through here |
| **Pin** | `p` | keeps the scene in the strip above the filter bar |

A `≡` menu adds *analyse only the items that start here* and *add an
expectation here*; `×` clears the selection, and so does the first `Escape`.
Paths, stages, start and end markers and expectation arcs can be selected in
the same way and add their own clause.

**Nothing happens silently.** Every action says what it did — *Filter added:
with Record Goods Receipt — 234,479 of 251,734 purchase order items
remain.* — and an action that removes nothing says *no purchase order items
removed* rather than leaving you to wonder. **Record Goods Receipt** takes
the log from 251,734 to 234,479 items; the chip, the count line, the map and
the address all move together.

**Paths in / out** answers from the whole directly-follows relation, not
only from what is drawn, and it answers on a **sheet over the map** rather
than in a column beside it, so the drawing keeps its width. **Record Goods
Receipt** has 27 paths in and 22 out: all **49** are on the sheet at once,
without scrolling, each with its other end, the items on it and the median
wait in days, and each with **filter to this path**; the sheet sorts by
items or by median wait, and `Escape` closes it. The paths the current
detail level does not draw sit under one divider — *hidden at this detail
level* with **Show them** — printed once, on the sheet and nowhere else. An
activity the level does not draw says so under the frame, with **Raise the
detail**.

**Full window** (`⤢` or `F`) fills 95 % of the window and keeps the filter
bar; the first `Escape` clears the selection, the second leaves.

**model** draws the same scene as a BPMN 2.0 diagram — the same overlays,
the same selection, one lane per stage — without asking the server for
anything, and names the activities that have no task in the model. **⋯ →
BPMN 2.0 (.bpmn)** downloads the file (on BPIC 2019 at the default detail: 9
tasks, 10 gateways, 29 sequence flows, 6 lanes). **table** lists the same
activities and paths as rows.

### The explore board

**Board** in the page header arranges the same step as linked panels, so one
selection answers everywhere at once:

- **four selectors** — flow type, period, expectation area, group — which
  are views on the filter itself, so removing a chip clears the selector;
- **Where in the flow?** (the map: a click filters the whole board);
- **Where is it worst?** (the ranked groups: a click filters, **Why?**
  leaves the board);
- **How far off?** (one expectation's distribution with its expectation
  line);
- **How does it split?** (the breakdown, with *flow type · period ·
  attribute* tabs);
- **four tiles** — items, average score, priority at stake, still open.

Every panel has a one-line question as its title, a sentence under it, and
an `ⓘ` that prints where its numbers come from. A filtered number is never
shown alone: each tile carries its *all items* twin (*234,479 · all items
251,734*), bars keep the unfiltered order and mark a changed rank (`▲2`)
instead of moving, bin edges and map positions come from the unfiltered
population, and the ranked list — which is a ranking — says *ranked within
the filter*. Removing the last chip restores the board and the address
exactly.

At the foot: the source line in words (*Run of Sep 5, 2026 · Finance ·
Company × Spend area · all flows · no filter · 251,734 purchase order items
· computed …*) with no id and no hash in it, **Freeze this**, **Save as…**
(the dialog reads *Save this board*; boards are kept per project in your
browser) and one primary action, *Why? Packaging →*.

**What to expect of the speed.** Every panel answers a click in well under a
second. The four tiles of an unfiltered board are read from the run's own
artefacts (0.20 s the first time after the server starts, 0.009 s again);
a filtered selection is computed for that filter and costs about 0.13 s once
the log is in the server's memory, and about three seconds the first time
after a start for a run scored before this release.

**One population.** The board's ranked list counts the groups the signals
list counts — **23 groups**, *10 of 23* on the first page — and the name
column has the width it needs, so the ten rows read *Packaging · Logistics ·
Additives · Latex & Monomers · Real Estate · company 0003 …* in full.

## 10. Why? — the group's reasons

**Why** (step 6) opens with **Back to Where is it worst? (page 1)**, the
group's name with the kind chip and the confidence word, **Freeze this**,
the sentence — *109,199 purchase order items · 0.9 % below expectation ·
invoices cleared late in 97 % of them; the shortfall is 93 % this one
expectation* —, the comparison line, and a strip of four cells: **priority**,
**rank** (1 of 23, the same 23 groups the list ranks), **average met** (84 %,
everyone 84 %), **data caveats**
(the chip). **more ▾** unfolds the full metric set. A filter row (*purchase
order items in: all*) shows the active flow filters with their counts and
×.

Six tabs on one line — **Why · Compared · Flow · Cases · Data trust ·
Gain** — and the **Decision** pane on the right.

**Why** (the default) holds the reason chain:

- **Which expectations are missed**: the top three as plain phrases with a
  bar — *Paid within terms — missed in 97 % of these purchase order items ·
  explains 93 % of the shortfall · invoices cleared late* —, then **Show all
  29 expectations ▾**: the table of every expectation (share of the
  shortfall, missed in, applies to; shares can exceed 100 % when other
  expectations are met better than average), the waterfall (*share of the
  shortfall*, the last bar the whole), the expectation areas (*here* against
  *all*, per case) and **Where inside this group** (a Pareto by a sub-key).
- **Compared with everyone else, for the top expectation**: two sentences —
  *Paid within terms: 83 days here; everywhere else 55.* and *97 % of
  Packaging's purchase order items miss it (expected 30 days) — everyone
  else: 83 %.* — over the distribution with *everyone else* beside the group,
  the expectation line (*expected ≤ 30 days*) and the tolerance band; **show
  cumulative**, **more ▾** (cases with a value, mean, median, 90th
  percentile, maximum), **Table alternative**, **Open the full comparison →**.
- **Where in the flow**: the group's map (below), **Open the full map →**.
- **Can the data be trusted?**: the group's caveats in one line each (*14 %
  of purchase order items still open at the end of the data (2019-01-17):
  late clearing cannot be judged*; *17 % started within the lag horizon of
  the window end*; *no duplicated header events in this group*), **All
  checks →**.
- **Typical causes for this pattern**: the candidate reasons the process
  pack carries for the expectations this group misses, each labelled as
  something to check and not a finding, with **What can we do? →** into the
  last step (section 11).

**Compared** shows the lens for any expectation with a threshold (the select
lists them by plain name); ϑ and W are not moved here — the line under the
chart says that committing a threshold happens on the **norm's calibration
lens** (*Recalibrate in the norm →*), which opens the norm with **Back to
Why?**.

**Flow** is the group's map, and it is the same instrument as the Flow step
(section 9) in a smaller frame: the decision pane folds to its button, the
map takes the full width at 520 px with its own filter bar, legend column
and activity card, and **Open full →** carries the chips and the group into
the Flow step. Activities are boxes inside their stages (Request, Order,
Receive, Invoice, Match, Pay), paths are arrows whose width is the number of
cases and whose colour is the share of cases missing an expectation, with
badges for presence and count expectations, arcs for durations and order,
hatching outside an expectation's scope and a tint on the activities of the
top expectations. Above it: *purchase order items in: 109,199 of 109,199*,
the **detail** slider, **compare with everyone else** (recolours the paths
by the difference to the whole log) and `map | model | table`; the legend
lists only the encodings in use, and expectations about case attributes are
listed under the map as having no place on it.

A click opens the activity's card with the six actions of section 9.
**Filter to** and **Exclude** add a clause: the count changes (*234,479 of
251,734* for Record Goods Receipt over the whole log), a chip appears, the
map re-renders, and the screen announces *Filter added: with Record Goods
Receipt — 234,479 of 251,734 purchase order items remain.* The filter scopes
the map, the list and the analytics and lives in the address, so the ranked
list opened from here carries it. **Paths in / out** lists every path from
the full relation, the ones the detail level hides included; **Distribution**
opens the lens over the screen; **Worst cases** opens the Cases tab.

**Cases**. **What kind of cases carry it** — the sub-groups by flow type,
by start quarter and by the drill-down keys with their share of the
shortfall and their censored share — then **cases furthest off**: the twenty
cases with the lowest score, the number of missed expectations and the top
two as plain phrases. Clicking a case shows **what happened in the case**: a
timeline of its events with missed expectations marked ▲, the case's
attributes, and a table with **#**, **activity**, **timestamp**, **Δ prev**,
**resource**, **violates** (plain phrases).

**Data trust**. The reading of this group — *stable signal*, or *high event
replication: verify logging before acting* — with the caveat shares behind
it: **still open at the end of the data**, **duplicated events**, and the
subgroups whose share is worse than the group's, each named (*subgroup
censoring · start Q 2019Q1*, 99 %; *· start Q 2018Q4*, 53 %). Under it the
**checks before acting** — the same four gates as on the last step, each
listed once with one verdict, each with its evidence and its decision
(section 11). Nothing on this tab computes a second verdict of its own.

**Gain**. The possible gain as sentences from the analytics — *If Paid
within terms were always met, this group would gain 4.3 points (100 % of
its shortfall); 97 % of these purchase order items miss it today* — one per
expectation, with a bar for the share of the shortfall.

**The Decision pane** stays on the right while you scroll (a **Decision**
pill under 1280 px). It shows the computed reading (kind and what is
missed) and asks one question, **What next?** — **Investigate** (proceeds to
mechanism analysis), **Defer** (stays in the backlog), **Accept the
shortfall**, **Not a problem** (returns a threshold to elicitation), the
method's dispositions in the tooltips — with a **note \*** and an
**owner**; **Save** is enabled once the note is written. **Change the
kind** and **Method terms** are disclosures. After a save the next step is
suggested: *Freeze this screen for the notebook*. A disposition taken here
is kept in your browser; the hypotheses and actions written on the last step
are kept on the server (section 11).

## 11. What can we do?, hypotheses and gates, and the knowledge hub

**What can we do?** (step 7, `Alt+7`) opens for one group, from the Why
screen or from the stepper. It begins with **Back to Why?**, the group's
name and the same reading sentence the card carries, then the **drivers** —
the expectations behind the shortfall, worst first. Each driver holds:

- the expectation in plain words with a **What does this mean?** chip;
- **what closing it would be worth**: *8.67 points of possible gain (96 %)*,
  and the share of the shortfall it carries (*This one expectation is 95 %
  of the shortfall of this group*);
- what it means when it is missed, and why it matters;
- the comparison with everyone else in real units (*Approved once: missed in
  100 % of purchase order items here against 1.5 % elsewhere (+99 points)*);
- **What to check first** — two or three concrete checks;
- **What usually causes it** — candidates to check, not findings, each
  marked *in the log — check …* or *outside the log — ask …*, each with
  **Mark to test**;
- **What usually helps** — the actions, each with the kind of countermeasure
  and the role that usually owns it (*system setting · purchasing*,
  *automation · IT process owner*), each with **Propose this action**.

**Propose this action** opens its form **inside the driver you pressed**,
with the cursor in *What should be done*; **Mark to test** fills a
hypothesis with the reason's own words and names its expectation. Both are
saved on the server and appear under **Open findings** at the foot of the
screen and in the dashboard's **Open findings** — with the group, the kind,
the owner role, the author and the date — so a colleague on another machine
and the same screen after a restart show the same list.

**Before acting on this: the checks.** Four gates are computed for the group
you are looking at, each with its evidence and one plain sentence:

| Gate | What it asks |
|---|---|
| **readiness** | do this group's own shares allow a judgement (still open, window edge, duplicates, replication, sentinel stamps)? |
| **censoring** | how many of these items had not finished at the end of the data (a warning at 20 %, a failure at 40 %)? |
| **replication** | how much of this group's evidence is the same event copied onto many items? |
| **domain** | does the expectation carrying this group's shortfall rest on a threshold that is still a placeholder, or on one that measures logging? |

A check whose evidence is a property of the whole log is decided **once, at
the run**, and says so instead of asking for a decision per group; a group
with no share above the reporting threshold reads *passed*, not *unknown*.
Each gate can be recorded as **passed**, **failed** or **waived**, always
with a note. A hypothesis on a group whose gates block is refused until they
are decided — on **Real Estate** readiness and censoring both fail (*44 % of
these purchase order items are still open at the end of the data*), and the
screen says so where the hypothesis would have been written. The test itself
is **computed, not typed**: the risk difference with its interval, the two
shares and the two medians.

**The knowledge hub** (**⋯ → Knowledge hub** in the ribbon, on every screen,
or the chip on any word) gives every word of the process a page: for
purchase-to-pay **597 pages** —
7 stages, 8 expectation areas, 92 expectations, the failure modes, reasons,
actions and indicators. A page holds what is expected, what it means when it
is missed, why it matters, how it is detected, what usually causes it and
what usually helps (the same texts the drivers use), what to check first,
examples of missed and as expected, the related stage, expectations, failure
modes and indicators, and who is usually accountable. **Your organisation's
note** is added to the pack's text and never replaces it. The index lists
the pages by kind with a search box; several expectations share a name
across templates, so the index still repeats some names.

**A What does this mean? chip** sits on the missed expectation of every
signal card, on every driver row, on the expectation area behind *more*, on
the norm's layers and constraints and on every data caveat chip — the chip
*is* the caveat chip, so the strip carries no second glyph. The kind of
problem (acute · systematic · widespread) has no page: it is the method's
own word and keeps its tooltip and its glossary entry.

### What-if against a frozen baseline

A scenario asks *what would the ranking look like if …*. It is **answered by
the server and has no screen yet**; it is asked through the API of the
running server (`http://127.0.0.1:8000/api/v1`, `…/docs` for the browsable
contract).

A scenario **is a run**: it keeps the artefacts, the manifest with its
fingerprints and the analytics every run has, and every screen that reads a
run reads it. It carries three things more: the id of the run it is measured
against, the transform layer, and a name a person recognises.

- `POST …/runs/{r}/whatif` queues one against this run as the **frozen
  baseline**; `POST …/runs/{r}/whatif/preview` says what the transforms
  would touch without scoring anything.
- **The transforms**: cap a lag, delete an activity, move an event, set an
  attribute, keep the first of a repetition — each selecting its cases with
  the same filter grammar the map writes, each reporting what it touched.
- The scenario is scored under the baseline's own parameters, or under a
  **norm version of its own** parented on the baseline's when it changes a
  threshold or an applicability.
- `GET …/runs/{r}/whatif` answers the **change table**: per group the two
  runs' cases, mean score and priority, the difference of each and the
  movement in rank; which groups entered and left; the Spearman agreement of
  the two orders and the overlap of the top ten; and one sentence to read.
  `GET /projects/{p}/scenarios` lists them, newest first.
- **The baseline is untouched.** Both runs are named in the provenance with
  their norm fingerprints, content hashes, case counts, γ and minimum group
  size, marked *frozen*.

## 12. The norm builder

**Norm** (step 2) is where what the process is expected to do is written
down. The screen opens on the **versions**: the status (*draft*, *reviewed*,
*approved*), the note, the author, the date, which version the latest run
was scored against, and the sign controls beside it.

**Opening a version** lists the expectations by area, each as the sentence
it means — *Clear Invoice follows Record Invoice Receipt or Vendor creates
invoice within 30 days, tolerated to 60* — with *⚠ a threshold to calibrate*
on the ones whose number is still the template's, and the line *7 expectation
areas · 29 expectations · 4 perspectives · 10 still to calibrate on this
log*. Selecting one opens it on the right in three panes: **the numbers**,
**the rule**, **who it applies to**.

**The numbers** is the calibration lens: the distribution of the log's own
values with the threshold and its tolerance drawn on it, and what each
candidate would make missing.

**The rule** is built from pickers that carry the log's own counts, so a
rule is written on what the log has rather than on what it might have: 42
activities with their events, items, share and stage (*Record Goods Receipt
· 314,097 events · 234,479 items · 93 % · receive*) and 18 case attributes
with their distinct and missing counts and their values (*Spend area:
21 values, Packaging 109,199 · 43 %*). The rule is checked against the case
table before it joins the norm — whether it is well formed, whether the
activities it names occur, how many items it applies to and how many miss it
— and shown back as one plain sentence. **New expectation** starts an empty
one in an area.

**Who it applies to** is offered from the log itself: the flow types the
case table carries with their counts, the flow types the rules name that it
does **not** carry with the reason, every case attribute with its values,
and the four shapes a clause can take — *this flow type*, *this attribute
value*, *always*, and **not applicable to this log**. An expectation marked
not applicable leaves the version with a required note and leaves the
perspectives' weights with it, instead of being averaged in as a constant;
the whole expectation is kept, so it can be brought back.

**Committing a change** asks for *why this change (required)* and *who owns
it (required)*; the threshold lens calls the first field *why this threshold
(required)*. The saved expectation shows its rationale, owner and decision
date after a reload. These are separate from the version note. An unchanged
expectation retains its earlier decision. Changing its threshold or
applicability needs an explicit new decision, even when the same rationale
still applies. Copying an unresolved draft does not clear this requirement.

For **Not applicable to this log**, also fill in *why (required)*. This is a
scope decision: a rule that everyone meets can still be a valid expectation.
After saving, **Version notes** lists the excluded expectation, its reason,
decision author and date; the original rule remains in the version's metadata.
If saving is refused, the form displays the error and retains the edits.

**Signing a version.** **Mark reviewed** and **Approve this version** sit
beside the status, and each asks for the person who signs. Every actual
review or approval needs an explicitly entered name; the current signer is
saved and shown after a reload. A refusal keeps that name in the open dialog.
A version cannot be signed while a required calibration decision is missing:
the server identifies the expectations that still need a reason and owner.
A repeated request for the same status does not replace the recorded signer. `GET
…/norms/{id}/calibration` is the same list — every threshold with its reason
and owner, what this version changed, what is marked not applicable, and
what still keeps it in draft.

**Still on the server only:** the five **guidance questions** to ask a
stakeholder about an expectation area, each with the pack's text as a
starting answer (`GET …/norms/guidance-questions?kind=layer&id=…`); the
answers are stored through the guidance overlay and added to the pack's
text, and no form asks them yet.

A norm can still arrive as a preset or as JSON through the API; what changes
is that it no longer has to.

## 13. The order-to-cash preset

**Data → Load public log preset** lists every preset the server offers,
which now includes the packs' own. Beside **BPI Challenge 2019
(purchase-to-pay)** there is **ICPM 2026 hackathon sales extract
(order-to-cash)**, read in place from its path and loadable with the same
button. Loading it takes about four minutes and produces 51,164 **sales
order items** over 267,071 events and 16 activities, with *Create Order*
typed as a header event, `days_late` and `order_month` prepared at
case-table build, the flow types *standard* 49,481 · *rejected* 1,563 ·
*partial delivery* 110 · *returns* 10, a readiness report (186 events
outside the window, 137 duplicates, 84.1 % header replication of *Create
Order*, 639 items still open) and `o2c_baseline` as norm v1 with its
uncalibrated flags visible.

Three things to know before using it:

- **The norm is a template, not a calibration.** Every threshold in
  `o2c_baseline` is a placeholder, and 32 of its canonical activities do not
  occur in this extract (they are reported as norm warnings, not dropped
  silently). The population of the customer backlog matches the hackathon's
  own output — 69 customers and a `(missing)` group against 71, item counts
  exact for 52 of 68 and within 2 % for 66 — but **the scores do not**, and
  the reason is the uncalibrated template. Calibrating it on the lens is the
  work an order-management expert has to do first, and until it is done the
  version cannot be signed: 13 of its 14 thresholds have neither a reason
  nor an owner, and the server names them when the version is asked to leave
  draft.
- **A flow type the log cannot carry says so.** *make to order* is named by
  the pack's rules and is **not assigned on this log**: the rule reads a
  planning type the file does not carry, and the flow-type answer says that
  in words instead of showing three types and no reason. A rule that
  survives but matches nothing is reported separately.
- **The preset card is the generic one.** The pack's own information — the
  case noun, the label pack, the six pitfalls, the extra slicings — is
  served by the API but not yet drawn on the card, and the map does not yet
  show the pack's capture / commit / fulfil lanes.

## 14. The notebook

**Freeze this** (or the camera in the ribbon) on the dashboard, the signals
list, the Why screen, the norm, the run and its tabs, and the dataset screen
opens the dialog **Freeze this screen**: "A picture of the screen, the
numbers behind it and where you were (run, grouping, perspective, filters) go
into the project's notebook." — a prefilled **title** (*Packaging — invoices
cleared late*), a **note** ("What this step shows and what you read from it;
one or two sentences"), **Freeze**. When the picture cannot be taken the
snapshot is stored without one and says so.

**Notebook** (the ribbon icon with the count) lists the snapshots in order:
the picture as a 160 px thumbnail (opens in a lightbox with the context line
and **Open this screen again**), the title and note (editable in place), the
context line in words (the screen, the run's note and date, the grouping,
the perspective, the filters), move up / down, **Go to this screen**, and
delete. **Export Markdown** downloads a zip with `notebook.md`, the images
and the numbers behind every screen. The notebook shows under the step it
was opened from; **Back to …** returns there.

## 15. Filters and the URL

Every filter, tab and selection lives in the address bar, so a link
reproduces exactly what you saw and reloading keeps it. The ranked list:

```
/p/<project>/runs/<run>/backlog?slicing=case Company+case Spend area text&view=Automation&minCases=1&kind=widespread&layer=L4_rework_instability&q=Logi&gamma=20&sort=-stable_PI&tab=table&page=1&pageSize=10&filter={"and":[…]}&drillFrom=…&drillKey=…
```

| Parameter | Filter |
|---|---|
| `slicing` | the grouping (the case attributes joined by `+`; bands as `attribute:q4`) |
| `view` | the perspective |
| `minCases` | at least … cases (default 20) |
| `kind` | `acute`, `systematic` or `widespread` |
| `layer` | only problems about … (the expectation area's id) |
| `stability` | `stable` for only high-confidence ranks |
| `q` | which group |
| `gamma` | caution against small groups, when it differs from the run's |
| `sort` | `-stable_PI` by default; a column name, `-` for descending |
| `tab` | `signals`, `table` or `scatter` |
| `page`, `pageSize` | paging |
| `filter` | the flow filter as JSON (`{"and":[{"kind":"activity","op":"contains","activity":"Record Goods Receipt"}]}`) |
| `drillFrom`, `drillKey` | the coarser grouping and the group a drill-in sits inside |
| `pins`, `row` | pinned groups; the active card |

The Why screen carries `slicing`, `view`, `tab` (`why`, `compared`, `flow`,
`cases`, `trust`, `gain`), `constraint` (the lens), `activity` (the focused
activity), `filter`, `case` (the open trace). A pasted Why address with
`tab=compared` and a filter reproduces the screen with its chips; **Back to
Where is it worst?** leads to the list, and the stepper marks Why. Runs
scoped to one flow type carry the scope on the run, not in the address.

The Flow step and the board share one address, because they are two
arrangements of one step:

| Parameter | Flow and board |
|---|---|
| `view`, `slicing`, `scope` | the perspective, the grouping, all flow types or one |
| `filter` | the canonical filter as JSON (`f` is accepted as its short name) |
| `fh` | the short hash of that filter, for share links and caches |
| `detail` | the detail level, 0 (*stages only*) to 4 (*all that fit*) |
| `sel` | the selected element, `activity:<label>` or `path:<a>→<b>` |
| `activity` | the activity whose paths are listed |
| `render` | `map`, `model` or `table` |
| `full` | the full window |
| `lens` | the expectation the distribution shows |
| `period`, `area`, `group` | the board's other three selectors |
| `breakdown`, `attribute` | which dimension the breakdown shows, and which attribute in its third tab |
| `panel`, `board` | the panel opened full window; the saved board this screen came from |

Two people who click the same things send byte-identical filters: the chips
read in the order you added the clauses, while the form that goes to the
server and into `fh` is sorted and de-duplicated.

**What can we do?** is a screen of one group and carries the group in the
path, not in the query: `/p/<project>/runs/<run>/slices/<key>/act?slicing=…&view=…`,
with `constraint` naming the expectation whose reason was marked to test.
The Why screen of the same group is the same path without `/act`, and the
knowledge hub is `/p/<project>/knowledge` and `/p/<project>/knowledge/<page>`.

`mode` is the one parameter that is not about a screen: `?mode=guided`
turns on the guided path (section 2) anywhere and is remembered until
`?mode=analyst` turns it off.

## 16. The command palette and help

`⌘K` (`Ctrl K` on Windows and Linux) opens the **Command palette**: type to
filter, `↑` `↓` `↵` to jump. It lists the screens, the context switches
(**Switch perspective to Automation**, **Group by …**), the notebook, **Help
and glossary** and **Theme**.

`?` in the ribbon opens the **Help** drawer with three tabs: **Glossary**
(every term in both vocabularies with its definition and the rewordings
readers found clearer, and a search box), **Formulas** (Gap, Priority Index,
Shrinkage, Stable gap, Stable PI, Lower bound, Soft violation) and
**Keyboard**. `Esc` closes it.

## 17. The two vocabularies

| Plain label | Method term | Meaning |
|---|---|---|
| group | slice | a set of cases that share a value, e.g. one vendor or one spend area |
| purchase order items (the case noun) | cases | what one case is in this log; the mapping names it |
| expectation | constraint | a rule the process is expected to follow |
| expectation area | layer | a family of expectations, e.g. timeliness, completeness, change discipline |
| perspective | view | whose expectations count and how much, e.g. Finance or Logistics |
| missed in … of them | violation share | the share of cases in the group that do not meet the rule |
| share of the rules met | score | 1 (100 %) means every applicable expectation is met |
| below expectation | gap | how far the group's average score is below the overall score |
| shortfall, small groups discounted | stable gap | the shortfall after pulling small groups towards the average (γ) |
| priority | PI | shortfall × number of cases: how much is at stake |
| caution against small groups | γ | how strongly small groups are pulled towards the average |
| acute: few cases, far off | kind (severity) | a small group with a large shortfall |
| systematic: one pattern behind it | kind (mechanism) | a group whose shortfall comes from one recurring expectation |
| widespread: many cases, slightly off | kind (reservoir) | a large group with a small shortfall each, big in total |
| confidence in rank | stability | whether the rank held when the cases were resampled (bootstrap) |
| comparison | contrast | the group against everyone else on the expectation missed most, in real units |
| caveat | readiness item | what in the data could distort the answer, with its share in the group |
| flow type | variant family | the kind of flow a case follows (DF1, DF2, consignment, 2-way match) |
| scope | sub-log | the flow type a run is restricted to |
| filter | case selection | the clauses that select cases on the map and the list |
| decision | readiness decision | what you decided about a caveat, applied when the case table is rebuilt |
| snapshot | notebook entry | a frozen screen with its context and your note |
| drill | nested slicing | a finer grouping ranked inside one group |
| explains … of the shortfall | contribution | how much of the shortfall this expectation accounts for |
| applies to / counted | applicability / in scope | which cases an expectation is meant for |
| still open at the end of the data | right-censored | cases that had not finished when the data was extracted |
| duplicated events / copied postings | replication | the same event copied onto several cases (a header line) |
| possible gain | headroom | how much the group would improve if this expectation were fully met |
| where is it worst | backlog | the ranked list of groups |
| where in the flow | process map | activities and paths with the expectations drawn on them |
| what happened in the case | trace | the events of one case in time order with the expectations it missed |
| cases furthest off | worst cases | the cases with the lowest score in the group |
| detail level | abstraction | how much of the process the map draws, from the stages only to all activities that fit |
| path | directly-follows edge | one activity followed directly by another, with the items on it and the median wait |
| board | linked panels | one selection answered by the map, the ranked list, the distribution, the breakdown and the four numbers at once |
| gate | validation gate | a check that must pass, fail or be waived with a note before a group carries a hypothesis or an action |
| what can we do? | remedy set | the usual reasons and actions for the expectations a group misses, with a countermeasure type and an owner role |
| knowledge hub | process knowledge graph | the pack's stages, layers, expectations, failure modes, reasons, actions and KPIs, and the pages that join them |
| a reason to test | hypothesis | a candidate cause written down with the group, the expectation and the direction expected, before it is tested |
| what was recorded | finding | the outcome of testing one, kept on the server with its mechanism and status |
| a proposed action | countermeasure | what should be done about it, with the kind of countermeasure and the role that owns it |
| what it applies to | applicability | the flow types or attribute values an expectation is written for, or *not applicable to this log* |
| why this threshold, who owns it | rationale, owner | what a version records against a threshold it sets; without both it stays a draft |
| what would happen if | what-if scenario | a run against a frozen baseline with one part of the log or the norm changed |
| the run it is measured against | frozen baseline | the run a scenario is compared with, unchanged by it |
| guided path | guided mode | three steps, the explanations open and the method's controls out of the way |

## 18. Known limits of this release

**On the map**

- **Two drawn texts can land on the same pixels.** Every text drawn inside
  the map is at least 11 px at 1440 × 900, 1280 × 720 and 1024 × 768 on both
  logs, but the labels over the drawing are placed without knowledge of each
  other: on the purchase-to-pay log 12 to 22 pairs intersect, depending on
  the window and the detail level — a path's share label over another path's
  (*⇒ 52 %* over *⇒ 38 %*), or a badge over the activity name or item count
  beside it (*≥1* over *Vendor creates invoice*). Moving the detail slider
  or opening the full window separates them; the placement itself is the
  drawing library's own geometry.
- **The pop-up title of a path says *cases*** — *124,621 cases. median lag
  37 d.* — where the rest of the screen says *purchase order items*: that
  text is written by the drawing library, which takes no case noun.
- **At *stages only* the drawing does not fill its frame.** The four other
  levels leave no band wider than 8 % of the frame on any side; the coarsest
  level leaves the frame about two thirds empty at 1440 × 900.
- **Two pinned scenes are kept, not compared**; the legend has no *show only
  this*; a range cannot be dragged across bars or bins; the breakdown draws
  twelve bars and drops the rest instead of offering a *top ten and other*
  row; a saved board does not show *modified*; the model's lanes are drawn
  in the reverse of the map's order.
- The map needs the flow library checkout next to the repository; without it
  the map shows a notice.

**On the board**

- The map panel redraws about twice as slowly as the other panels after a
  click (about 1.5 s against 0.8 s).
- Saved boards and pinned scenes live in your browser, not on the server;
  **Freeze this** goes to the notebook on the server as everywhere else.

**Steps and screens that do not exist yet**

- **A what-if scenario has no screen.** The server builds it, previews its
  transforms and answers the change table against the frozen baseline
  (section 11); nothing in the interface asks for one.
- **The remedy screen does not say what the possible gain is a share of**,
  and the shares of the drivers can sum past 100 % because they overlap.
- **An action has no due date** on the form, and *add the group to the next
  review session* is not offered.
- **The hub index repeats names.** Expectations that several templates carry
  are listed once per template, so about 35 distinct names appear as 92
  links; the *Related* block can list the page you are on.

**Numbers and data**

- **Confidence** is not computed inside a drill-in, and the comparison
  sentence is computed for the top twelve groups of every grouping and
  perspective; the other rows say why they have none instead of borrowing
  one.
- **A run scored before this release carries no comparison sentence** until
  it is scored again; the sales extract's run is such a run.
- The analytics of a run take about 50 s after scoring on BPIC 2019; the
  first board request after the server starts reads the event log once for a
  run scored before this release (about 3 s).
- **Why?** on a drilled row opens the sub-group's reasons over the whole
  log, not inside its parent group.
- **The order-to-cash norm is a template.** Its thresholds are placeholders
  and cannot be signed before they are calibrated (section 13), and its
  *make to order* flow type cannot be assigned on this extract.

**Platform**

- Snapshots are pictures taken in the browser; when the capture fails the
  entry is stored without a picture. PowerPoint export is not available yet.
- **XES** files need `pm4py`, which is not installed; **Postgres** and a
  login do not exist; the server listens on `127.0.0.1` only.
- One language (English), two process packs (purchase-to-pay and
  order-to-cash), and the interface's own vocabulary is written for
  purchase-to-pay.
