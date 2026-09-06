# User guide — WISE Workbench, cycle 1

For an analyst who has an event log of a purchase-to-pay (or similar) process
and wants to know where it falls short of expectations, without knowing the
method behind the application. Every screen is described with the labels it
shows. The words in **bold** are labels you will find on the screen.

## 1. What the application does

You give it an event log (one row per event: which case, which activity,
when). You tell it what the process is expected to do — a **norm**: a list of
expectations such as "an invoice is cleared within 30 days of receipt" or
"an order line is not changed after approval". It scores every case against
those expectations, groups the cases (by vendor, by company and spend area,
…) and ranks the groups by **priority**: how many cases × how far below
expectation. Then it answers three questions for every group:

1. **Where is it worst?** — the ranked list of groups.
2. **Why?** — which expectations are missed in that group, compared with
   everyone else, down to single cases.
3. **Can the data be trusted?** — what in the data could distort the answer.

Priorities are evidence for hypotheses, not verdicts. The application never
says what causes a shortfall; it shows where the shortfall sits and which
expectations coincide with it.

## 2. Start it

```bash
tools/start.sh
```

builds the screens once and starts the server; the browser opens at
`http://127.0.0.1:8000/`. Next time, `tools/start.sh --no-build` is enough.
Details, folders and settings: `docs/DEPLOY.md`.

The first screen you see is the project's dashboard (or **Projects** when
there is more than one project; a project is one process with a steering
question, its logs, norm versions and runs). A fresh workspace has one
project, **Demo**, created by the public-log preset described in section 4.

## 3. What every screen shares

**The ribbon** (the bar at the top) shows the context every number belongs
to, as switchers: **project** · **dataset** · **mapping** · **norm** ·
**run** · **perspective** · **grouping** · **period** · **words** (in the
method's words: **view** and **by**). Changing one changes every screen. On the right: a badge reading **live backend**
(or **mock data** when the screens run on generated data), and four icon
buttons: **Command palette** (`⌘K` / `Ctrl K`), **Density** (comfortable or
compact rows), **Theme** (light, dark, system) and **Help and glossary**
(`?`).

**The journey** rail on the left lists the twelve stages of an analysis with
a state each — *not started*, *in progress*, *gated*, *done*:

| Stage | Name on the rail | Screen |
|---|---|---|
| S0 | Steering question and scope | dashboard |
| S1 | Log intake and data readiness | **Data and mapping** |
| S2 | Case notion, flow types, slice keys | the dataset screen |
| S3 | Norm elicitation | **Norm versions** |
| S4 | View design | **Norm versions** |
| S5 | Scoring and calibration | **Runs** |
| S6 | Backlog review | **Where is it worst?** |
| S7 | Validation gate | the **Why?** screen |
| S8–S12 | Mechanism analysis, Action hypotheses, Intervention planning, Monitoring across periods, Institutionalisation | later releases |

*Gated* means evidence is missing, not that the stage is locked: **Why
gated** opens the reason and a link (**Fix at**) to the screen where to look.
The rail collapses with the arrow button (**Collapse journey rail**).

**The readiness banner** under the ribbon — **Data readiness: N caveats
travel with every result** · **open report** — stays on every screen while
the data has caveats.

**The job tray** (bottom right, **Jobs**) appears when something runs:
each job with its status (*queued*, *running*, *done*, *failed*,
*cancelled*), a progress bar, the transport (*live* when the server streams
progress, *polling* otherwise), **Cancel job**, **Open result** when it is
done and **Dismiss**. The tray announces "Job … is done" to screen readers.

**Two vocabularies.** Every label is written in plain words first (group,
expectation, expectation area, perspective, shortfall, priority, kind of
problem, confidence in rank), with the method's own term beside it in small
grey type (slice, constraint, layer, view, gap, PI, hotspot type, stability).
Hover the grey term for its one-sentence definition. The **words** switcher
in the ribbon (**plain** | **method**) swaps the two everywhere; the choice
is remembered in your browser. The table in section 12 lists all pairs.

## 4. Load a log: the BPIC 2019 preset or your own CSV

Open **Data and mapping** (rail: S1, or the palette). The screen reads
"Upload a log, map its columns, type header events away and read the data
caveats before scoring — or load a public log in one click." and has two
cards:

- **Drop a CSV, Parquet or XES file here** with a **Choose file…** button.
  Dropping a file starts an *Ingest* job (the file is copied into the
  workspace, its SHA-256 becomes the dataset's content hash, its columns are
  profiled). XES needs the optional `pm4py` package, which this release does
  not install.
- **Load public log preset**: "A known log on this machine, its column
  mapping and the reference norm, ingested, built and scored in one job. The
  file is read in place, not copied." It lists **BPI Challenge 2019
  (purchase-to-pay)** with the file path. When the file is not at that path
  the card says so and names the setting (`WISE_BPIC19_CSV`). The **Load
  public log preset** button starts one job that does everything up to a
  scored run (about 90 s on a laptop for the 1.6 million events; under a
  second when it was loaded before) — **Open result** in the tray then opens
  the ranked list.

Below, the **Datasets** table: **name** (a link to the dataset screen),
**status** (*ready*, *ingesting*, *failed*), **events**, **content hash**,
**created**, and **Map columns** for ready datasets.

The BPI Challenge 2019 log is the public purchase-to-pay log of a coatings
company: 1,595,923 events, 251,734 purchase-order items, 42 activities,
January 2018 to January 2019. The examples in this guide come from it.

## 5. Map columns and read the readiness report

Click a dataset (or **Map columns**). The header reads **S1–S2 · Mapping and
case notion**, the dataset's name, its id, content hash and event count.

**Column profiler · N columns**: one row per column with **column**,
**type**, **nulls**, **distinct** and **sample** values. Use it to find the
case id, the activity and the timestamp.

**Column mapping** is prefilled — the line under the title says by what:
"Prefilled by the backend from the column names (BPI Challenge 2019 export)",
"(XES / pm4py convention)" or "(patterns)". The fields:

| Field | What to put there |
|---|---|
| **case id \*** | the column that identifies one case (an order item, a ticket, an invoice) |
| **activity \*** | the column with the activity name |
| **timestamp \*** | when the event happened |
| **timestamp format** | a `strptime` pattern such as `%d-%m-%Y %H:%M:%S.%f`; empty lets the library parse mixed formats. Day-level precision is reported by the data caveats |
| **resource** | who or what did it (optional) |
| **lifecycle** | the transition column, when the log has `start`/`complete` rows |
| **exposure (volume for PI)** | a money or quantity column; priorities can be weighted by it |
| **case attributes (slice keys)** | tick the columns you want to group by later (vendor, company, spend area, item type, …). Only ticked columns can be groupings of a run |
| **header events (replicated onto items; typed away)** | activities that belong to the purchasing document rather than the item — they count once per document, not per item. Tick them in the list or type another activity and press Enter |
| **note** | free text: "Case notion: PO item; header events typed away". The case notion is a human decision and travels with the case table |

For known logs, the mapping also carries flow-type rules and a closing
activity, shown as small badges (**flow type DF1**, **closes with Clear
Invoice**).

**Validate and build case table** validates the mapping on a sample and
starts the *Case table* job (about 10 s for BPIC 2019). When it is done the
screen scrolls to the readiness report and the ribbon's **mapping** switcher
lists the new case table.

**The readiness report** is a box titled **Data readiness: N caveats travel
with every result** (or *no blocking issue*, or *N blocking issues*). Each
line has a level — *info*, *warn* or *fail* — and a sentence. On BPIC 2019
you will read eleven lines; what they mean for you:

| Line | Plain reading |
|---|---|
| **volume** (info) | how many events, cases and activities there are |
| **window** (info) | the period the data covers (robust quantiles), and the raw span of timestamps |
| **timestamp_outliers** (warn) | events outside the observation window (578 events, 1948 and 2020 stamps): durations touching them are unreliable |
| **sentinel_dates** (warn) | timestamps that look like placeholders (identical stamp on many events) |
| **timestamp_precision** (warn) | activities recorded only to the day: durations below a day are not meaningful for them |
| **duplicate_events** (warn) | exact duplicates (same case, activity, time): counts are inflated |
| **tied_timestamps** (info) | events of one case with the same timestamp: their order is undefined |
| **zero_exposure** (info) | cases with exposure 0 are ignored by exposure-weighted priorities |
| **header_event_replication** (warn) | header events copied onto every item of a document: **type them away** in the mapping (section 5) or expect inflated counts |
| **right_censored** (warn) | cases still open at the end of the data (34,947 = 13.9 %): a missing closure may be a window artefact |
| **flow_types** (info) | how many cases of each flow type the rules found |

Warnings never block; they travel with every result: the dashboard lists
them under **data caveats**, the Why? screen checks them per group.

## 6. Import or write a norm, and read its JSON

**Norm versions** (rail: S3–S4) lists every version: **version**,
**status** (*draft*, *reviewed*, *approved*), **note**, **author**,
**fingerprint**, **created**. Every save is a new, immutable version with a
note; the version a run used is marked "used by run_…".

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
v1**), the status badge, the fingerprint, the scoring mode and the counts:
"layer_balanced · 7 layers · 29 constraints · 4 views". Three tabs:

**Constraints**. The **Catalogue** lists the expectations by expectation
area (a coloured chip with the area's name). Each entry shows the
expectation's id (for example `c_l3_invoice_to_clear_days`), its type as a
badge, its weight (**w 1.0**), a sentence, and for expectations with a
threshold **ϑ = 30 · W = 60**. The sentence patterns by type:

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
(histogram and cumulative curve) with the threshold **ϑ threshold (D)** and
the width **W width (D)** as inputs and sliders; the line under the chart
says what share of cases lies beyond ϑ. Moving them is exploration. Pressing
the commit button opens **Commit threshold as a new version** — "A threshold
is a human decision, so a one-line reason is required." — with a **note \***
field and **Create version**. Expectations without a threshold say so.

**JSON** shows the document as the library reads it. What you will see:

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

- `layers` are the expectation areas. BPIC 2019 has seven: Expected
  completion and closure, Flow-conditioned control discipline, Handovers and
  ageing, Rework and instability, Exceptions and corrections, Value and
  commercial integrity, Effort and automation friction.
- `views` are the perspectives: whose expectations count and how much. Each
  view weights the layers (Finance, Logistics, Compliance, Automation).
- `constraints` are the expectations; `params` depend on the type (table
  above); `applicability` restricts an expectation to the cases it is meant
  for (a flow type, an item category), and only those cases are *counted*
  for it.
- `scoring_mode: layer_balanced` means a case's score (0–1) averages the
  areas, so an area with many expectations does not dominate.

**Version notes**: **This version** (note, author, created, parent,
validation) and the **Lineage** of all versions.

## 7. Run, and watch the job

**Runs** (rail: S5): "A run = case table × norm version × parameters;
identical inputs return the existing run." The **All runs** table lists
**run**, **status**, **period / note**, **norm**, **case table**, **γ**,
**min cases**, **views**, **slicings**, **finished** and a **Backlog**
button for finished runs.

**New run** opens the form:

| Field | Meaning |
|---|---|
| **case table** | the built case table to score |
| **norm version** | which version of the expectations |
| **γ (shrinkage, in cases)** | caution against small groups: "A slice with n = γ keeps half of its gap." 20 for BPIC 2019; 50 is the default |
| **min cases** | groups with fewer scored cases are not ranked |
| **views** | which perspectives to score (all by default) |
| **groupings** | one per line, the case attributes to group by, separated by commas: `case Company, case Spend area text` groups by company × spend area. Only attributes ticked in the mapping are available; the hint lists them |
| **note** | a period label and the reason for γ; shown as the **period** in the ribbon |

**Start run** queues the job and opens the run monitor: the run id with a
status badge, the **Progress** card with the percentage, the current
message ("scoring cases", "backlog case Company+case Spend area text ×
Finance", …), the attempt and *live events* or *polling*; a **Cancel**
button while it runs. Scoring BPIC 2019 takes about 13 s; the tray announces
when it is done and **Open backlog** appears.

Two tabs: **Parameters and manifest** — **Parameters** (case table, norm
version, views, slicings, γ, min cases, baseline run) and **Manifest and
provenance** (norm fingerprint, content hash, mapping, params hash, wise
version, started, finished, job): "Same content hash + norm fingerprint +
params hash → identical ranked list." — and **where in the flow**, the
**Process map of the whole log** with the expectations drawn on it (section
9 explains the map).

## 8. Read the signals list

**Open the ranked list** on the dashboard, **Backlog** in the runs table or
rail S6 opens **Where is it worst?** for the run.

**The header.** Badges show **γ = 20**, the **overall average** score
(0.844) and **sorted by priority, small groups discounted ↓**. One sentence
states the ranking rule — "Ranked by how many cases × how far below
expectation, with small groups discounted (γ = 20)." — followed by the
**perspective** and **grouping** switchers and "30 groups ranked · 84.4 %
overall average score". **How to read this** unfolds a paragraph explaining
the cards.

**Filters** on the left, phrased as questions; each writes to the URL:

- **Which group? (/)** — a text filter on the group's name (`/` focuses it)
- **Only groups with at least … cases** — the minimum number of cases (20 by default; the BPIC 2019 examples use 1)
- **Only problems about …** — one expectation area, or *any expectation area*
- **Only acute / systematic / widespread** — one kind of problem, or *any kind of problem*
- **Only high-confidence ranks** — in this release every rank reads "confidence not computed", so this hides everything and says so
- **caution against small groups** — γ; changing it re-ranks with the run's case scores (the run's own γ stays in its manifest)
- **per page** — 10 to 500
- **Reset filters**

**Three tabs: Signals, Table, All groups at once.**

**Signals** is the default: one card per group, ranked. A card reads, from
the top:

> **1** · **companyID_0000 × Packaging** · widespread · many cases, slightly off · confidence not computed · (pin)
> **109,199** cases · **0.9 %** below expectation on average · mostly **Handovers and ageing** (Invoice-bearing flows should clear in a reasonable time, missed in 97 % of these cases)
> priority **945.7** [bar] · rank **1** of 30 · Automation · **Why?**

- the rank and the group's name (the values of the grouping attributes joined by ×);
- the **kind of problem** with its glyph and reading: **acute** — few
  cases, far off; **systematic** — one pattern behind it; **widespread** —
  many cases, slightly off. The kind tells you what sort of action fits: an
  acute group is a small set of cases to look at one by one, a systematic
  group has one recurring expectation area behind it, a widespread group is
  large and slightly off everywhere;
- the **confidence in rank** — high, medium, not enough cases to be sure,
  or *not computed* (this release);
- how many cases and how far below the overall average they are;
- the **most-missed expectation area**, with the single expectation missed
  most and in what share of the group's cases;
- the **priority** (small groups discounted) with a bar relative to the top
  group, the rank of n, the perspective;
- **Why?** opens the group's reasons (section 9).

Hovering a card shows its whole reading sentence.

**How the ranking works.** Each case gets a score between 0 and 1 in the
chosen perspective (1 = every applicable expectation met). A group's
**shortfall** is how far its average score lies below the overall average.
Its **priority** is shortfall × number of cases — how much is at stake. To
stop tiny groups with one bad case from topping the list, the shortfall is
pulled towards the average by γ: a group with as many cases as γ keeps half
of its shortfall; the list is sorted by this discounted priority. The raw
priority stays beside it. That is why Packaging (109,199 cases, 0.9 %
below) ranks above Real Estate (583 cases, 9 % below): 945.7 against 50.6.

**Keyboard**: `↑` `↓` move between cards, `↵` opens Why?, `p` pins the card
into the **Comparison strip** (three fixed slots above the list, with cases,
shortfall, shortfall discounted, priority, priority discounted, kind,
confidence and area; **Unpin** removes it), `f` opens Why? with the decision
pane focused, `/` focuses the group filter. The footer repeats the keys and
shows "N of 30 groups · page 1 / 3" with **Previous** and **Next**.

**Table** shows the same rows as numbers: **#**, **group**, **cases**,
**average how-well score**, **shortfall**, **shortfall, small groups
discounted**, **priority**, **priority, small groups discounted**, **kind of
problem**, **confidence in rank**, **most-missed expectation area**,
**reading**. Column headers sort; hovering a numeric cell shows a `?` —
**Explain this number** — which opens the formula (for example
`PI = n · (μ̄ − μ_s)₊`), the inputs (n, the overall average, the group's
average, γ) and caveats. The same `?` sits beside the badges in the header.

**All groups at once** draws every group with the current filters: the
**cases × shortfall** scatter ("whiskers = the cautious bound; shape = kind
of problem; size = priority") and **how much of the priority the top groups
carry** (the cumulative share of priority by rank, with the top-10 share
marked). Clicking a point opens its reasons.

## 9. Why? — the group's reasons

**Why?** opens the group's screen: **S6–S8 · Why? · back to where is it
worst**. The header repeats the group's name with the kind badge and the
confidence, then the full reading sentence, then six numbers with `?`
explanations: **cases**, **average how-well score**, **shortfall**,
**shortfall, small groups discounted**, **priority**, **priority, small
groups discounted** (with the cautious bound beneath).

Six tabs on the left, the **Decision** pane on the right.

**Which expectations are missed** (the default). First the top three
expectations behind the shortfall, each as a sentence with a bar:
"*Invoice-bearing flows should clear in a reasonable time* — missed in 97 %
of cases — explains 93 % of the shortfall". Then three charts, each with a
**Table alternative**: **Gap waterfall by constraint** ("each expectation's
contribution; the bars sum to the shortfall 0.87 %; click a bar to compare
the group with everyone else" — bars that reduce the shortfall point the
other way), **Expectation areas: this group vs everyone else** (the mean
penalty per case per area, **this group** against **everyone**), and
**Where the shortfall sits by Vendor** (a Pareto of the penalty inside the
group by a sub-key, with the cumulative share). Then **All expectations**, a
table of every expectation of the norm: **expectation**, **expectation
area**, **type**, **share of the shortfall**, **Δ**, **missed in**, **applies
to**. Shares can exceed 100 % when other expectations are met better than
average (their Δ is negative and shown green).

**Compared with everyone else**. For one expectation with a threshold (the
select lists them), the distribution of the raw signal in this group: the
histogram, the cumulative curve, **ϑ threshold** and **W width** as inputs
and sliders, and the share beyond ϑ. For Packaging and
`c_l3_invoice_to_clear_days`: ϑ = 30 days, W = 60, 96.7 % of the group's
invoices clear later than 30 days, median 83 days. Changing ϑ or W here is
exploration; the link takes you to the norm's calibration lens to commit a
threshold with a note. **Table alternative** lists the bins.

**Cases**. **cases furthest off**: the twenty cases with the lowest score,
each with the expectations it missed (▲ badges). Clicking a case id shows
**what happened in the case**: a timeline of its events with missed
expectations marked ▲ (hover an event to highlight its expectation in the
table above), the case's attributes as badges, and a table with **#**,
**activity**, **timestamp**, **Δ prev**, **resource**, **violates**.

**Can the data be trusted?** The validation row of this group: **Reading**
(*stable signal*, or *high event replication: verify logging before
acting*), **still open at the end of the data** (share of cases), **duplicated
events** (share of cases with header events copied onto them), **shortfall
kept without open cases** and **shortfall without open cases**. Then **Checks
before acting**: *still open at the end of the data* (pending above 10 %),
*duplicated events* (failed at 50 % or more), *plausibility* ("awaiting the
owner's reading"). Passing, failing or waiving a check with a note arrives
with the next release; here the checks are read-only.

**Where in the flow**. The process map of this group with the expectations
drawn on it: activities as boxes inside their stages (Request, Order,
Receive, Invoice, Match, Pay), paths as arrows, badges for presence and
singularity expectations, arcs for durations and precedence, hatching for
exclusions and a tint on activities with a missed expectation. The line
above says "109,199 cases · 583,981 events · 9 of 28 activities shown · 9
placed in stages". The library's controls set how many activities and paths
are shown (rarely used activities are folded away), **compare with everyone
else** recolours the paths by the difference to the whole log without
moving any activity, **table alternative** lists activities, paths and
overlays as text, and a legend explains the marks. Expectations about case
attributes rather than activities are listed under the map as having no
place on it.

**Possible gain** is a placeholder table in this release (one row per
expectation area, no values yet).

**The Decision pane** stays on the right while you scroll. It shows the
**Computed reading** (kind and area), lets you override the **kind of
problem** (**override needs a note** — a **why override \*** field appears),
set a **disposition** — **investigate** (proceeds to mechanism analysis),
**defer** (stays in the backlog), **waive** (accepted shortfall), **not a
hotspot** (returns a threshold to elicitation) — with a **note \***, and an
**owner** (no note needed). **Save finding** is enabled once the required
notes are written; **Clear** removes the finding. Findings are stored in
your browser in this release ("Findings stay in this browser until the
review endpoints arrive") and are listed on the dashboard under **Open
findings**; they also move S6 and S7 on the journey rail.

## 10. Filters and the URL

Every filter, tab and selection lives in the address bar, so a link
reproduces exactly what you saw and reloading keeps it. The ranked list:

```
/p/<project>/runs/<run>/backlog?slicing=case Company+case Spend area text&view=Automation&minCases=1&kind=systematic&layer=L4_rework_instability&q=Logi&gamma=20&sort=-stable_PI&tab=table&page=1&pageSize=10&pins=…&row=…
```

| Parameter | Filter |
|---|---|
| `slicing` | the grouping (the case attributes joined by `+`) |
| `view` | the perspective |
| `minCases` | Only groups with at least … cases (default 20) |
| `kind` | `acute`, `systematic` or `widespread` (`hotspotType=severity|mechanism|reservoir` from older links still works) |
| `layer` | Only problems about … (the expectation area's id) |
| `confident` | Only high-confidence ranks |
| `q` | Which group? |
| `gamma` | caution against small groups, when it differs from the run's |
| `sort` | `-stable_PI` by default; a column name, `-` for descending |
| `tab` | `signals`, `table` or `scatter` |
| `page`, `pageSize` | paging |
| `pins` | up to three pinned groups |
| `row` | the active card |

The Why? screen carries `slicing`, `view`, `tab` (`drivers`,
`distributions`, `cases`, `validation`, `flow`, `headroom`), `constraint`
(the lens), `case` (the open trace) and `pins`. Defaults are left out so
links stay short.

## 11. The command palette and help

`⌘K` (`Ctrl K` on Windows and Linux) or the magnifier opens the **Command
palette**: type to filter, `↑` `↓` `↵` to jump. It lists the screens
(**Dashboard**, **Data and mapping**, **Norms**, **Runs**, **Where is it
worst? · run_…**), the context switches (**Switch perspective to
Automation**, **Group by case Company+case Spend area text**), **Help and
glossary** and **Theme**. Searching for groups, expectations and cases from
the palette is a later release.

`?` or the question-mark icon opens the **Help** drawer with three tabs:
**Glossary** (every term in both vocabularies with its definition, and a
search box), **Formulas** (Gap, Priority Index, Shrinkage, Stable gap,
Stable PI, Lower bound, Soft violation) and **Keyboard**. `Esc` closes it.

## 12. The two vocabularies

| Plain label | Method term | Meaning |
|---|---|---|
| group | slice | a set of cases that share a value, e.g. one vendor or one spend area |
| expectation | constraint | a rule the process is expected to follow |
| expectation area | layer | a family of expectations, e.g. timeliness, completeness, change discipline |
| perspective | view | whose expectations count and how much, e.g. Finance or Logistics |
| cases missing the expectation | violation share | the share of cases in the group that do not meet the rule |
| how well a case meets expectations (0–1) | score | 1 means every applicable expectation is met |
| shortfall | gap | how far the group's average is below the overall average |
| shortfall, small groups discounted | stable gap | the shortfall after pulling small groups towards the average (γ) |
| priority | PI | shortfall × number of cases: how much is at stake |
| priority, small groups discounted | stable PI | the priority used for ranking |
| caution against small groups | γ | how strongly small groups are pulled towards the average |
| acute: few cases, far off | hotspot type: severity | a small group with a large shortfall |
| systematic: one pattern behind it | hotspot type: mechanism | a group whose shortfall comes from one recurring expectation area |
| widespread: many cases, slightly off | hotspot type: reservoir | a large group with a small shortfall each, big in total |
| confidence in rank | stability | whether the rank held when the cases were resampled |
| most-missed expectation area | dominant layer | the expectation area that explains most of the shortfall |
| expectation behind the shortfall | driver | one missed expectation and how much of the shortfall it explains |
| share of the shortfall | contribution | how much of the shortfall this expectation accounts for |
| applies to / counted | applicability / in scope | which cases an expectation is meant for |
| still open at the end of the data | right-censored | cases that had not finished when the data was extracted |
| duplicated events | replication | the same event copied onto several cases (e.g. a header line) |
| possible gain | headroom | how much the group would improve if this expectation were fully met |
| data caveats | readiness | what in the data could distort the results |
| where is it worst | backlog | the ranked list of groups |
| where in the flow | process map | activities and paths with the expectations drawn on them |
| what happened in the case | trace | the events of one case in time order with the expectations it missed |
| cases furthest off | worst cases | the cases with the lowest score in the group |

## 13. Known limits of this release

- **Confidence in rank** is never computed: every card reads "confidence
  not computed", and **Only high-confidence ranks** hides everything.
- **Possible gain** is a placeholder table.
- **Findings** (kind override, disposition, owner) live in your browser,
  not on the server, and the checks under **Can the data be trusted?**
  cannot be passed, failed or waived yet.
- **Norm builder forms** do not exist: norms come from the preset, from the
  calibration lens or from the API as JSON.
- **Knowledge packs** are used only for the stage boxes on the process map;
  activity names are not canonicalised in the mapping screen.
- The first **Why?**, the first lens and the first group map of a run after
  the server starts take about 13 s on BPIC 2019 (the run is re-scored in
  memory once); afterwards they answer in under a second.
- **XES** files need `pm4py`, which is not installed; **Postgres** and a
  login do not exist; the server listens on `127.0.0.1` only.
- The process map needs the flow library checkout next to the repository;
  without it the Flow tabs show a notice.
- One language (English), one process template (purchase-to-pay) with
  stage boxes; the order-to-cash pack exists but has no preset.
