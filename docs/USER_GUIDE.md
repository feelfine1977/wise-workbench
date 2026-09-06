# User guide — WISE Workbench, cycle 2

For an analyst who has an event log of a purchase-to-pay (or similar) process
and wants to know where it falls short of expectations, without knowing the
method behind the application. Every screen is described with the labels it
shows. The words in **bold** are labels you will find on the screen; the
numbers are those of the BPI Challenge 2019 log in the verified workspace.

## Workflow

The stepper across the top of every screen names the six steps of an
analysis — **Data → Norm → Run → Signals → Why → What to do** — and shows
where you are (*you are here*), what is done (●), what is in progress (◐)
and what is still waiting (○, with the reason in a tooltip: *needs a
finished run*). Every step is a link to where its work happens; `Alt+1` …
`Alt+6` jump to them; **Back to …** and `Alt+←` return to where you came
from, with its filters.

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

**Why.** One click on **Why?** opens the group's reasons: which expectations
are missed and how much of the shortfall each explains, the comparison with
everyone else, where in the flow it happens (the group's map with actions on
every activity), the cases furthest off, whether the data can be trusted,
and the possible gain. The decision pane asks **What next?** — investigate,
defer, accept the shortfall, not a problem — with a note. **Freeze this**
keeps any screen in the notebook with its context and your remark.

**What to do.** The step exists on the stepper and arrives in cycle 3 with
the knowledge hub: typical causes for a pattern, what to check in the log
and outside it, and the actions that fit. Until then the Why screen ends
with a placeholder that says so.

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
palette** (`⌘K` / `Ctrl K`). The rest — density, theme, the **words**
switch, *live backend* or *mock data* — sits behind **⋯**. No id is visible;
hover a switcher for it.

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
(run, grouping, perspective, filters) in the project's notebook (section 9).

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
Section 11 lists all pairs.

**Keyboard.** `Alt+1` … `Alt+6` the steps, `Alt+←` back, `⌘K` the palette,
`?` the help; on the signals list `↑` `↓` move between cards, `↵` opens
**Why?**, `p` pins, `f` opens the decision pane, `/` opens **Refine**; on the
map the arrow keys move between activities, `Space` selects, `Enter` opens
the actions menu, `Esc` clears.

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

The norm builder forms are not part of this release.

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
whole log with the expectations drawn on it (section 8 explains the map)
—, and **Flow types side by side** (section 4).

## 8. Read the signals list

**Signals** (step 4) is **Where is it worst?** for the run. One sentence
under the title says what is ranked: *30 groups of purchase order items by
Company × Spend area text, ranked by how many × how far below the overall
score, small groups discounted, in the Automation perspective*. Caveats that
hold on nearly every group are stated once under it (*On nearly every group
here: 17 % started near the window end · 16 % still open at the end*), not
on every card.

**Refine** (the funnel) opens a drawer of questions — which group (`/`),
at least how many cases, only problems about one expectation area, only one
kind of problem, only high-confidence ranks, caution against small groups
(γ), per page — beside the **perspective** and **grouping** switchers. Every
active filter is a chip with × under the drawer button, and **clear all**
removes them; every filter lives in the address (section 10).

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
- **Why?** opens the group's reasons (section 9) on the first click.

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
footer shows "10 of 30 groups · page 1 / 3" with **Previous** and **Next**.

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

## 9. Why? — the group's reasons

**Why** (step 5) opens with **Back to Where is it worst? (page 1)**, the
group's name with the kind chip and the confidence word, **Freeze this**,
the sentence — *109,199 purchase order items · 0.9 % below expectation ·
invoices cleared late in 97 % of them; the shortfall is 93 % this one
expectation* —, the comparison line, and a strip of four cells: **priority**,
**rank** (1 of 30), **average met** (84 %, everyone 84 %), **data caveats**
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
- **Typical causes for this pattern**: a placeholder until the knowledge
  hub arrives in cycle 3, with **What can we do? →** disabled.

**Compared** shows the lens for any expectation with a threshold (the select
lists them by plain name); ϑ and W are not moved here — the line under the
chart says that committing a threshold happens on the **norm's calibration
lens** (*Recalibrate in the norm →*), which opens the norm with **Back to
Why?**.

**Flow** is the group's map full size: activities as boxes inside their
stages (Request, Order, Receive, Invoice, Match, Pay), paths as arrows whose
width is the number of cases and whose colour is the share of cases missing
an expectation, badges for presence and count expectations, arcs for
durations and order, hatching outside an expectation's scope, a tint on the
activities of the top expectations. Above it: *purchase order items in:
109,199 of 109,199*, a **detail** slider (stages only → nearly all
activities → all), **compare with everyone else** (recolours the paths by
the difference to the whole log) and **table alternative**; a legend lists
only the encodings in use; expectations about case attributes are listed
under the map as having no place on it. A single click opens the activity's
card (*Record Goods Receipt — 102,829 purchase order items (94 %) · worst
expectation touching it: Goods or service received (missed in 6 %)*) with
its four actions as buttons; a right click, or `Enter`, opens the same
actions menu on any activity or path:

- **Filter to cases with this activity** / **exclude** add a clause: the
  count changes (*234,479 of 251,734* for Record Goods Receipt over the
  whole log), a chip appears, the map re-renders, and the screen announces
  *Filter added: cases with Record Goods Receipt — 234,479 of 251,734
  remain.* The filter scopes the map, the list and the analytics, and lives
  in the address, so the ranked list opened from here carries it.
- **paths** focuses the activity: its incoming and outgoing paths with
  count, cases, median lag and the share of cases on the path that miss an
  expectation.
- **lens** opens the Compared tab on the expectation touching the activity;
  **worst cases** opens the Cases tab.

**Cases**. **What kind of cases carry it** — the sub-groups by flow type,
by start quarter and by the drill-down keys with their share of the
shortfall and their censored share — then **cases furthest off**: the twenty
cases with the lowest score, the number of missed expectations and the top
two as plain phrases. Clicking a case shows **what happened in the case**: a
timeline of its events with missed expectations marked ▲, the case's
attributes, and a table with **#**, **activity**, **timestamp**, **Δ prev**,
**resource**, **violates** (plain phrases).

**Data trust**. The validation row of this group: **Reading** (*stable
signal*, or *high event replication: verify logging before acting*),
**still open at the end of the data**, **duplicated events**, **shortfall
kept without open cases** and **shortfall without open cases**. Then the
checks before acting — still open (pending above 10 %), duplicated events
(failed at 50 % or more), plausibility — read-only in this release.

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
suggested: *Freeze this screen for the notebook*. Findings are stored in
your browser in this release.

## 10. The notebook

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

## 11. Filters and the URL

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

## 12. The command palette and help

`⌘K` (`Ctrl K` on Windows and Linux) opens the **Command palette**: type to
filter, `↑` `↓` `↵` to jump. It lists the screens, the context switches
(**Switch perspective to Automation**, **Group by …**), the notebook, **Help
and glossary** and **Theme**.

`?` in the ribbon opens the **Help** drawer with three tabs: **Glossary**
(every term in both vocabularies with its definition and the rewordings
readers found clearer, and a search box), **Formulas** (Gap, Priority Index,
Shrinkage, Stable gap, Stable PI, Lower bound, Soft violation) and
**Keyboard**. `Esc` closes it.

## 13. The two vocabularies

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

## 14. Known limits of this release

- **What to do** is a step on the stepper without a screen; **Typical
  causes** and **What can we do?** arrive with the knowledge hub in cycle 3.
- **Findings** (the decision pane) live in your browser, not on the server,
  and the checks under **Data trust** cannot be passed, failed or waived yet.
- **Confidence** is not computed inside a drill-in, and the comparison
  sentence covers the top twelve groups of every grouping and perspective.
- The analytics of a run take about 50 s after scoring on BPIC 2019; the
  first **Why?** and the first group map after the server starts take about
  13 s (the run is re-scored in memory once).
- **Why?** on a drilled row opens the sub-group's reasons over the whole
  log, not inside its parent group.
- Snapshots are pictures taken in the browser; when the capture fails the
  entry is stored without a picture. PowerPoint export arrives in cycle 4.
- **Norm builder forms** do not exist: norms come from the preset, from the
  calibration lens or from the API as JSON.
- **XES** files need `pm4py`, which is not installed; **Postgres** and a
  login do not exist; the server listens on `127.0.0.1` only.
- The process map needs the flow library checkout next to the repository;
  without it the map shows a notice.
- One language (English), one process preset (purchase-to-pay); the
  order-to-cash pack exists but has no preset in the interface yet.
