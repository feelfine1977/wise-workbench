# WISE Workbench — UI design specification, second release

*Product design specification for the screens of the second release. It
covers the diagnosis of the current screens, the layout system, every
screen with its content rules and wireframes, the chart rules for the
analytics, and the release checklist with its acceptance tests. Numbers
in the examples come from the BPI Challenge 2019 run
`run_0mtoq44vd14f208ur` (company × spend area, Automation perspective,
γ = 20). Design tokens: `packages/design-tokens/tokens.json`.*

The one sentence this specification serves: **a person who has never read
the method opens the application, sees where the process hurts most,
clicks once to learn why, and always knows where they are and how to go
back.**

---

## 1. Diagnosis of the current screens

Read against the screenshots in `docs/examples/screenshots/` and the
served build. Each paragraph answers four questions: what the eye lands on
first, what competes with it, what repeats, what is missing.

### 1.1 Dashboard (`01_dashboard.png`)

The eye lands on the project name **Demo** and, to its left, a twelve-line
journey rail whose labels (*Case notion, flow types, slice keys*,
*Validation gate*, *Institutionalisation*) are the method's stage names,
two of them marked *gated* in amber before anything has been read. The
"Where is it worst?" card holds the one useful sentence, but eight metric
boxes with three-decimal scores (0.819, 0.817, 0.871, 0.844) sit directly
beneath it and win the competition for attention because they are larger
and bolder than the sentence. The right column lists all eleven data
caveats in full prose, the tallest block on the page. The run id appears
three times (ribbon, chip row, card title); the readiness count appears
twice (banner and column). Missing: the process itself (no picture, no
flow types although the last caveat line already counts four), a single
obvious next step, and any sense of order — three equal buttons offer
"ranked list", "manifest" and "flow" as if they were peers.

### 1.2 Data and readiness (`02_data.png`, `03_dataset_mapping.png`)

The intake screen is calm; the dataset screen is not. The eye lands on the
readiness box, and inside it on raw JSON: the *timestamp precision* line
spills a forty-line array of `{"activity": …, "precision": …}` objects,
the *sentinel dates* line another dozen. Below, a 22-row column profiler
and a two-column mapping form with 27 checkboxes compete for the same
vertical space; the form's primary button sits at the bottom of a
3,300-pixel page. Every caveat repeats its machine name (`events=578 ·
earliest=1948-01-26T23:59:00 · share=…`) after its sentence. Missing: a
decision per caveat (exclude these events, treat those dates as missing,
collapse duplicates, censor open cases), a preview of what a decision
would change, the flow types shown as something to look at rather than
a count in the last line, and any indication which of the eleven lines
deserve attention now.

### 1.3 Norm (`04_norms.png`, `05_norm_constraints.png`, `06_norm_json.png`)

The eye lands on identifiers: `c_l1_invoice_present`, `w 1.2`,
`presence`, the fingerprint
`e17ca18ed3c1a30114694c29455b86def27480bb34000e797e1e06a82dc644b0` in
the header. The plain sentence of each expectation is present but set
smaller and greyer than its id. In the calibration lens the histogram is
a single bar squeezed against the left axis with an x-axis label reading
`0.027777777778`, the cumulative curve hugs 100 %, the threshold and
width lines overlap the axis, and beneath the chart nine statistics
(`n 183,293.00 · shareViolated 0.89 · ecdfAtThreshold 0.11`) are printed
in method notation. The lens has no back control: arriving from the
"Compared with everyone else" tab, the only way back is the browser. Not
shown: what the expectation means in real units ("89 % of invoices take
longer than 30 days; half take longer than 64"), the layers as a picture,
and the reason a person is here.

### 1.4 Run (`07_runs.png`, `08_run_monitor.png`, `09_run_flow.png`)

The eye lands on `run_0mtoq44vd14f208ur` in 36-pixel monospace. The
useful thing, the whole-log process map, is hidden under a second tab;
the default tab shows hashes and ids in two cards, and the primary action
**Open backlog** is a small button in the top-right corner. On the map
tab the map occupies a quarter of the viewport; an *Abstraction* control
box and a *Legend* box float over its corners. Repeated: the case-table
id and norm-version id from the ribbon. Missing: one sentence saying what
this run is ("251,734 order items scored against 29 expectations in four
perspectives, γ = 20"), the flow types, and the next step.

### 1.5 Signals list (`10_signals_list.png`, `22`, `23`)

The eye lands on the filter panel: seven controls in a column on the left,
each with a plain label *and* a grey method term (*slice*, *min cases*,
*dominant layer*, *hotspot type*, *stability*, *γ*), before the first card.
The cards themselves carry five numbers each (cases, per cent below,
"missed in 97 %", priority, rank n of 30) plus a bar, three badges, and a
pin icon; the primary action **Why?** is the smallest element on the card,
at the far right of its last line. Every card repeats *confidence not
computed*, *of 30*, *Automation*, the method alias of its kind
(*reservoir*, *mechanism*), and a parenthesised description of the
expectation area. The header repeats the ranking rule, γ, the overall
average and the sort order as separate chips. Missing: a first click that
is obvious, the flow-type scope of the list, and any breathing room
between cards.

### 1.6 Slice detail and its tabs (`13`–`19`)

The eye lands on a six-line paragraph that restates the card, then on six
metric boxes (cases, average how-well score 0.836, shortfall 0.9 %,
shortfall discounted 0.9 %, priority 945.9, priority discounted 945.7 with
"cautious 903.8"): twelve numbers before the first tab, three of them
saying 0.9 % or 945. The tab row is ordered by the method's artefacts
(*Which expectations are missed* first, then *Compared with everyone
else*, *Cases*, *Can the data be trusted?*, *Where in the flow*, *Possible
gain*) and wraps onto two lines. **Which expectations**: the bar list is
right, but under it a waterfall whose y-axis reads 0.01 seven times, two
small charts, and a 29-row table of ids. **Compared**: a lens with
sliders but the sentence "96.9 % beyond ϑ" is written in method
notation. **Cases**: a wall of red `c_l4_…` badges. **Data trust**:
readable, but the four numbers (14.4 %, 0.0 %, 167 %, 1.4 %) are unlabelled
in plain words. **Flow**: the map sits below the fold with two panels
floating over it. **Gain**: a placeholder. The **Decision** pane offers
three radio groups and a disabled button on every tab. Missing: a
back control that returns where one came from (the link at the top goes
to the list with its filters lost), a next step, the real-unit comparison
in the first screenful, caveats as chips, and one dominant element.

### 1.7 Flow (`09_run_flow.png`, `17_why_flow.png`, `18_why_flow_compare.png`)

The eye lands on the *Abstraction* box (two sliders at 1 % and 3 %, two
buttons, a checkbox), not on the map. The map shows 9 of 28 activities as
small boxes with orange arcs crossing three stage lanes; arcs from
*Record Goods Receipt* to *Clear Invoice* fan into a bundle that cannot be
read. The legend explains six activity colours by stage, a path-width
scale and a path-colour scale, all at once. Repeated: the header sentence
of the slice, the case count. Missing: a filter bar ("cases through
this activity", "in / out"), click actions on an activity, the flow types
as a first split, and a way to make the map the screen rather than a
widget in a card.

---

## 2. Layout system

### 2.1 Page grid

- Viewport target 1440 × 900; minimum supported width 1180. Content
  region is a 12-column grid with 24 px gutters and 32 px page margins,
  maximum content width 1360 px, centred.
- The left journey rail is retired. The primary navigation is the
  analysis stepper (§2.2) in the header band; the twelve stages of the
  method are reachable from *All stages* in the stepper's overflow, for
  analysts only.
- Three vertical bands on every screen, in this order: **ribbon** (40 px),
  **stepper** (56 px), **page**. Nothing else is fixed. The readiness
  banner is removed; its count becomes a chip in the ribbon (§2.3).
- Page header: title (2xl), one reading sentence (md, muted), one primary
  action on the right, optional secondary actions behind a `⋯` menu.
  Never more than one primary button per screen.
- Two layout templates:
  - **Reading** (dashboard, readiness, signals, notebook): a single main
    column spanning 12 columns, cards stacked with 16 px gaps; side
    content only inside cards.
  - **Evidence + decision** (slice detail, flow): main 8 columns, right
    pane 4 columns (min 340 px, max 400 px), the pane sticky under the
    stepper.
- Cards: radius `md` (8), border `border`, no shadow at rest (elevation 1
  on hover only for clickable cards), padding 20 px, title `base`
  semibold, body `md`.

### 2.2 The analysis stepper

The stepper is the workflow. Six steps, left to right, joined by arrows:

```
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │  ● Data  ─▶  ● Norm  ─▶  ● Run  ─▶  ◉ Signals  ─▶  ○ Why  ─▶  ○ What to do      ⋯ All stages │
 │                                     ▲ you are here                                          │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

Rules:

- Each step is a button. States: `done` (filled neutral dot ●), `current`
  (accent ring ◉ and the label in accent, plus the caption *you are here*
  under it), `not started` (hollow ○), `gated` (⊘ with an amber caption of
  at most five words, e.g. *needs a finished run*). Gated steps are still
  clickable and land on a screen that says what is missing and where to
  fix it.
- The arrows are drawn (▶ glyph, 12 px, `textSubtle`), not implied by
  spacing: the owner asked for the position to be "visualised with
  arrows".
- Every step maps to one URL: Data `/p/:project/data`, Norm
  `/p/:project/norms`, Run `/p/:project/runs`, Signals
  `/p/:project/runs/:run/signals`, Why `/p/:project/runs/:run/groups/:key`,
  What to do `/p/:project/runs/:run/groups/:key/actions`. Why and What to
  do stay hollow until a group has been chosen; clicking them then opens
  the last group visited.
- **Sub-screens** (the norm lens, the norm JSON, the case trace, the
  distribution of one expectation, the readiness report, the notebook,
  the run manifest) never occupy a step of their own. They show as a
  second line under the current step:

```
 │  ● Data  ─▶  ● Norm  ─▶  ● Run  ─▶  ◉ Signals  ─▶  ◉ Why  ─▶  ○ What to do              │
 │                                                    └ Packaging · distribution of         │
 │  ← Back to Why · Packaging                           "invoice cleared within 30 days"     │
```

- **Back control.** Every sub-screen and every step screen except Data
  carries `← Back to <origin>` as the first element of its page header,
  keyboard `Alt+←`. The origin is the screen the person came from, taken
  from the application's own navigation stack (route plus query string, so
  filters, tab and pins survive). When the stack is empty (deep link,
  reload), the origin is the parent step with the same run, perspective
  and grouping. The browser back button performs the same navigation
  because every state change that opens a sub-screen pushes a history
  entry.
- Keyboard: `Alt+1` … `Alt+6` jump to steps; `Tab` order is ribbon →
  stepper → back control → page.

### 2.3 Context ribbon, reduced per step

The ribbon shows only the switchers a step needs. Everything else lives
in a `⋯` menu at the right end.

| Step | Switchers shown | In `⋯` |
|---|---|---|
| Data | project · dataset | mapping version, words |
| Norm | project · norm version | dataset, words |
| Run | project · run | norm, mapping, words |
| Signals, Why, What to do | project · run · perspective · grouping · **scope** (all flows / one flow type) | dataset, mapping, norm, γ, words |
| Notebook | project | — |

Always on the right, in this order: **caveats chip** (`6 caveats` with the
warning glyph; opens the readiness screen; hidden when there are none),
**Notebook** (`▣ 4`, count of snapshots), **Freeze this** (camera glyph;
§3.7), help `?`, `⌘K`. Density, theme and the *plain / method* words
switch move into `⋯`. Ids are never shown in the ribbon: the run switcher
reads the run's note and date (*Baseline 2018 · 5 Sep*), the mapping
switcher reads *case table v2 · 251,734 cases*; the id is in the tooltip.

### 2.4 The Refine drawer

Filters leave the page. Each list screen has one button **Refine** (funnel
glyph, secondary style) at the right of the list header; it opens a 360 px
drawer from the right edge, over the page, with a scrim, closed by `Esc`,
the `×`, or a click outside. Active filters appear as **chips** in a row
under the list header, each with a `×`; the chips row is the only place
filters are visible when the drawer is closed.

```
 Where is it worst?                                          [ Refine ▾ ]
 Ranked by how many cases × how far below expectation, small groups discounted.
 ┌ chips ───────────────────────────────────────────────────────────────┐
 │ scope: all flows ×   at least 20 cases ×   only widespread ×   Reset │
 └──────────────────────────────────────────────────────────────────────┘
```

Drawer content, in this order, as questions: *Which group?* (text),
*At least how many cases?* (number, default 20), *Only problems about …*
(expectation area), *Only acute / systematic / widespread*, *Only
high-confidence ranks* (switch), *Caution against small groups (γ)* — the
last one under a *More* disclosure, analyst mode only. Method terms are
not printed in the drawer; they are in the tooltip of each label. The
drawer has an *Apply* button only when a filter is expensive (γ); every
other change applies live and writes to the URL.

### 2.5 Spacing and type scale

Tokens as in `tokens.json`; usage rules:

| Role | Token | Size / line | Weight |
|---|---|---|---|
| Page title | `2xl` | 28 / 36 | semibold |
| Reading sentence (header, cards) | `md` | 16 / 24 | regular; numbers semibold |
| Card title (group name) | `lg` | 18 / 26 | semibold |
| Body, tables, drawer | `base` | 14 / 20 | regular |
| Captions, chips, stepper labels | `sm` | 13 / 18 | medium |
| Method term (secondary, on hover only in plain mode) | `xs` | 12 / 16 | regular, `textSubtle` |

- Vertical rhythm on the 4 px scale: 32 px between page header and
  content, 24 px between sections, 16 px between cards, 12 px inside a
  card between the sentence and its strip, 8 px between chips.
- Line length: reading sentences wrap at 72 characters (max-width 64ch);
  this is what makes "at most two lines" hold on the card widths of the
  grid.
- Tabular figures everywhere a number appears (`tnum`). Thousands
  separators as narrow spaces or commas by locale.
- Comfortable density is the only density on reading screens; compact
  applies to tables and the case list only.

### 2.6 Palette: calm, one accent

- Surfaces: `bg #F6F6F3`, cards `surface #FFFFFF`, borders `border`.
  Text `text`, secondary `textMuted`. No coloured card backgrounds.
- **One accent, `accent #2456A6`**, reserved for: the current step, the
  single primary action of a screen (*Why?*, *Open the ranked list*,
  *Apply*), links, focus rings, the "here" series in charts (§4.1), and
  the priority bar. Nothing else is blue.
- **Kind of problem** keeps its three fixed colours (tokens `semantic.kind`)
  but only as a 14 px glyph-plus-word chip (▲ acute, ◆ systematic,
  ● widespread), never as a card border, bar or background. The glyph is
  the twin of the colour.
- **Expectation areas** keep the categorical set only inside charts and as
  a 8 px square before the area's name; never as tinted text.
- State colours (`warning`, `danger`, `success`) appear only in chips and
  gate glyphs, at most one state chip per card.
- Charts: series "here" = accent; "everyone else" = `chartAxis #8A8A83` at
  60 % opacity; violation scale = `semantic.sequential.violation`
  (orange-red) for map edges and drivers only; deltas =
  `semantic.diverging.delta`.
- Dark theme uses the dark tokens with the same rules.

### 2.7 Where numbers appear, and in what form

Numbers appear in three places and nowhere else:

1. **Inside a sentence** (cards, headers, chart captions): at most three
   per sentence on a card, one per clause, semibold. Counts with
   separators (109,199); shares as whole per cent above 10 % (97 %) and
   one decimal below (0.9 %); durations in the expectation's unit as whole
   numbers (83 days); priority as a whole number (946); scores as a per
   cent (84 %), never as 0.844.
2. **In a compact strip** under a header (§3.4): label above, value below,
   at most four cells, the same rounding as in prose.
3. **In tables and popovers** (Table tab, *Explain this number*): full
   precision, method notation allowed, right-aligned tabular figures.

Forbidden anywhere visible by default: six-decimal values, three-decimal
scores, the same rounded value repeated on an axis, an id in place of a
name, a number without a unit or a plain label, and more than one number
in a heading.

---

## 3. Per-screen specification

### 3.1 Dashboard

Purpose: in five seconds, what the process is, how it splits, where it is
worst, and the one thing to do next.

```
 ┌ ribbon: Demo ▾ · run Baseline 2018 ▾ · perspective Automation ▾ · grouping Company × Spend area ▾ · scope all ▾   ⚠ 6 caveats  ▣ 4  📷  ?  ⌘K ┐
 ┌ stepper: ● Data ─▶ ● Norm ─▶ ● Run ─▶ ◉ Signals ─▶ ○ Why ─▶ ○ What to do ┐

 Where does the purchase-to-pay flow fall short of expectations?
 251,734 order items · 29 expectations · Automation perspective · 84 % of expectations met on average.

 ┌ Your process ──────────────────────────────────────────────────────────────────────────────┐
 │ The log has four flow types. Compare them together or analyse each on its own.              │
 │                                                                                             │
 │ ┌ DF2 · 3-way match, invoice before goods ─┐ ┌ DF1 · 3-way match, invoice after goods ─┐   │
 │ │ 221,010 cases · 88 %                      │ │ 15,182 cases · 6 %                        │   │
 │ │ [ small map: 6 stages, 3 edges tinted ]   │ │ [ small map, same layout ]                │   │
 │ │ 82 % of expectations met                  │ │ 90 % of expectations met                  │   │
 │ │                     Analyse this flow →   │ │                     Analyse this flow →   │   │
 │ └───────────────────────────────────────────┘ └───────────────────────────────────────────┘   │
 │ ┌ Consignment ──────────────────────────────┐ ┌ 2-way match ─────────────────────────────┐   │
 │ │ 14,498 cases · 6 %  [ small map ]  91 %   │ │ 1,044 cases · 0.4 %  [ small map ]  87 %  │   │
 │ │                     Analyse this flow →   │ │                     Analyse this flow →   │   │
 │ └───────────────────────────────────────────┘ └───────────────────────────────────────────┘   │
 │                                                                                             │
 │ ( ● Compare all flows together )   ( ○ Analyse per flow type )          [ Open the ranked list ] │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘

 ┌ Where is it worst ──────────────────────────────────────────────┐ ┌ Next step ──────────────────┐
 │ 1 ● Packaging — 109,199 cases, 0.9 % below expectation, mostly   │ │ Open Packaging's reasons:    │
 │   invoices cleared late.                                 Why? → │ │ it carries 46 % of the       │
 │ 2 ◆ Logistics — 5,242 cases, 5.6 % below, mostly fragmented      │ │ priority.          [ Why? ]  │
 │   receipts.                                              Why? → │ │ Alternative: read the 6 data │
 │ 3 ◆ Additives — 18,318 cases, 1.0 % below, mostly manual work.   │ │ caveats first.               │
 │                                          See all 30 groups →    │ └─────────────────────────────┘
 └─────────────────────────────────────────────────────────────────┘
 ┌ Open findings (0) · Notebook (4 snapshots) · Data caveats (6, 2 undecided) ───────────────────┐
```

Content rules:

- The steering question is the page title; the sentence under it is the
  only place the overall average appears, as a per cent.
- **Your process** is the dominant element. One card per flow type, in
  descending case count, four across (two across below 1280 px). Each
  card: name and a plain description from the mapping's flow-type rule;
  cases and share; one small map (§4.4, 240 × 120 px, same layout for all
  cards); the per cent of expectations met in the current perspective;
  one link *Analyse this flow →*. When the log has one flow type the
  section collapses to one card and the choice control is hidden. When
  the mapping has no flow typing, the card reads *Flow types not detected
  yet — choose an attribute* with a link to the readiness screen.
- The choice **Compare all flows together / Analyse per flow type** is a
  segmented control; it writes `scope` to the ribbon and the URL.
  *Analyse per flow type* opens a sub-analysis per flow type (its own case
  table, applicability-scoped norm, own ranked list) and the ribbon's
  scope switcher lists them; *Compare all* shows the flow types side by
  side on the Signals step (§3.3, comparison view).
- **Where is it worst** shows the top three cards in one-line form (name,
  three numbers, one plain phrase for the most-missed expectation), each
  with *Why?*; then *See all 30 groups*.
- **Next step** is one suggestion with its reason and one alternative; it
  is computed from state: no run → *Score the log*; run and no finding →
  the top group's *Why?*; undecided caveats with level warn → *Decide the
  data caveats*.
- The old perspective boxes, cases-evaluated, finished date and the full
  caveat list are removed; they live on the run screen and readiness
  screen. The bottom bar is a single line of three counters as links.

### 3.2 Data and readiness

Purpose: load a log, then take the decisions the data asks for, one per
caveat, with a preview before applying.

```
 ← Back to Dashboard
 Data                                                              [ Validate and build case table ]
 BPI_Challenge_2019.csv · 1,595,923 events · 251,734 cases · mapped as purchase-order items.

 ┌ Data caveats · 6 need a decision, 2 decided, 3 for information ─────────────────────────────┐
 │                                                                                             │
 │ ⚠ 578 events lie outside the observation window (stamps from 1948 and 2020).                │
 │   Durations touching them are unreliable.                                                   │
 │   Decision:  ( ● Drop these events )  ( ○ Keep them )  ( ○ Treat their dates as missing )   │
 │   Preview: removes 578 events in 412 cases · 3 expectations affected · durations recomputed │
 │                                                                              [ Apply ]      │
 │ ─────────────────────────────────────────────────────────────────────────────────────────── │
 │ ⚠ 180,913 events are exact duplicates. Counts are inflated for 2 expectation areas.         │
 │   Decision:  ( ● Collapse duplicates )  ( ○ Keep them )                                     │
 │   Preview: 180,913 events fewer · 61,220 cases change · 5 expectations affected  [ Apply ]  │
 │ ─────────────────────────────────────────────────────────────────────────────────────────── │
 │ ⚠ 34,947 cases (13.9 %) were still open at the end of the data.                             │
 │   Decision: ( ● Censor: ignore missing closures ) ( ○ Exclude open cases ) ( ○ Keep as is ) │
 │   Preview: 34,947 cases treated as open · 4 expectations affected            [ Apply ]      │
 │ ─────────────────────────────────────────────────────────────────────────────────────────── │
 │ ✓ Header events typed away · decided in case table v2                              Change   │
 │ ✓ Flow types assigned from Item category · 4 types                                 Change   │
 │ ─────────────────────────────────────────────────────────────────────────────────────────── │
 │ ▸ 3 lines for information (window, tied timestamps, zero exposure)                          │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘

 ┌ Your process · 4 flow types ───────────── [ small maps as on the dashboard ] ───────────────┐
 ▸ Column mapping (prefilled from the column names)             ▸ Column profiler · 22 columns
```

Content rules:

- The readiness report is a **list of decisions**, sorted: undecided
  warnings first, then decided items as one-line confirmations with
  *Change*, then informational lines collapsed under a disclosure. Every
  item is: glyph (⚠ / ✓ / ○), one sentence in plain words with the count
  and the consequence, a radio group of the allowed decisions, one
  **Preview** line, one **Apply** button. The raw values (arrays, stamps,
  shares) sit behind a `details` disclosure per item, analyst mode only.
- Decisions per caveat, exactly these: outside-window events (drop / keep
  / dates as missing), sentinel dates (treat as missing, with a
  multi-select of the activities concerned / keep), day-precision
  activities (mark: lag thresholds on them in days only / ignore), exact
  duplicates (collapse / keep), header replication (type these activities
  away, prefilled / keep), open cases (censor / exclude / keep), zero
  exposure (ignore in exposure-weighted priorities / count), flow types
  (assign from attribute … / from rules … / none).
- **Preview** is computed before Apply, on the sample or on the full
  table when it takes under two seconds; it always names cases and events
  affected and the number of expectations affected. Preview text uses the
  same rounding as prose.
- **Apply** stores a versioned mapping decision with a one-line note
  (prefilled with the sentence, editable) and starts the case-table
  rebuild as a job; the item turns into a ✓ line with the version; the
  ribbon's mapping switcher gains the new version. Applying several items
  before rebuilding is allowed: the button then reads *Apply 3 decisions
  and rebuild*.
- The column mapping and the profiler are collapsed by default once a
  case table exists; they open expanded on a fresh dataset. The mapping's
  primary button is the only primary button on the page.
- Flow types are shown here as the same cards as on the dashboard, so
  that the split is seen at the data step, before the norm.

### 3.3 Signals list ("Where is it worst?")

Purpose: a ranked list a newcomer reads without help and where the first
click is *Why?*.

```
 ← Back to Dashboard
 Where is it worst?                                                          [ Refine ▾ ]  ⋯
 Ranked by how many cases × how far below expectation, small groups discounted. 30 groups, Automation.
 scope: all flows ×   at least 20 cases ×                                  [ Signals | Table | All at once ]

 ┌────────────────────────────────────────────────────────────────────────────────────────────┐
 │ 1  Packaging                                                              ● widespread     │
 │    109,199 cases · 0.9 % below expectation · invoices cleared late in 97 % of them.        │
 │    ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  priority 946 · confidence high             [ Why? ]  more ▾ │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌────────────────────────────────────────────────────────────────────────────────────────────┐
 │ 2  Logistics                                                              ◆ systematic     │
 │    5,242 cases · 5.6 % below expectation · fragmented goods receipts in 77 % of them.       │
 │    ▇▇▇▇▇▇▇▇▇  priority 294 · confidence medium · ⚠ 73 % duplicated events   [ Why? ]  more ▾ │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌────────────────────────────────────────────────────────────────────────────────────────────┐
 │ 9  Workforce Services                                                     ▲ acute          │
 │    127 cases · 11 % below expectation · invoice before goods in 86 % of them.               │
 │    ▇  priority 13 · not enough cases to be sure                             [ Why? ]  more ▾ │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
                                   10 of 30 · Next →
```

Card anatomy, top to bottom:

1. **Rank and name** (`lg` semibold). The name is the grouping value(s);
   the company part is dropped when every group shares it (as on
   BPIC 2019), otherwise written *Real Estate · company 0003*. The kind
   chip (glyph + word) sits at the right end of the same line; its reading
   (*many cases, slightly off*) is the tooltip.
2. **The sentence** (`md`, at most two lines at 64ch): *cases · share
   below expectation · the most-missed expectation as a plain phrase with
   its share*. Exactly three numbers, all in the first line where the
   width allows. The phrase comes from the expectation's `plain` label
   (a new field in the norm; fallback: the description with the trailing
   full stop removed, lower-cased). No expectation area name, no id, no
   parenthesis.
3. **The strip**: priority bar (accent, relative to rank 1, 6 px high),
   *priority 946*, the **confidence word** (high / medium / not enough
   cases to be sure; *not computed* only when the run predates the
   analytics), and at most one caveat chip (⚠ with a four-word reading)
   when a per-group check fails or is pending above its threshold.
4. **Actions**: `Why?` is the single primary button (accent, 32 px);
   `more ▾` is a text button that expands a panel inside the card with:
   the method terms and full precision (gap 0.0087, stable PI 945.7,
   raw 945.9, rank 1 of 30, γ = 20), the expectation area with its colour
   square, the second and third missed expectations, *pin for comparison*,
   *open in table*, *freeze this card*.

Rules:

- **Why?** opens the group's screen on the first click; the row-focus
  handler must not consume the click. The whole card is not clickable
  (avoids the two-click ambiguity); `↵` on a focused card equals *Why?*.
- Nothing repeats between cards: the perspective, *of 30*, γ, the
  ranking rule and the vocabulary aliases appear once in the header.
- Ten cards per page, 16 px apart; the list has no side panel.
- The comparison strip (pins) appears above the list only when a pin
  exists, as three compact cards with the same sentence form.
- **Table** and **All at once** tabs keep today's content; the scatter's
  axes read *cases (log scale)* and *below expectation (%)*, its caption
  is one sentence, and the shape legend uses the kind glyphs.
- **Comparison view** (`scope: all flows` with *Compare all flows
  together* chosen on the dashboard): a fourth tab **By flow type** shows
  the four flow types as columns of small multiples (§4.5): the top three
  groups per flow type as one-line cards, under a small map per column.
- Empty states: no run → *Nothing ranked yet. Score the log first.*
  [Go to Run]; filters hide everything → *No group matches. The
  "high-confidence only" filter hides all groups because confidence is
  not computed for this run.* [Remove that filter].

### 3.4 Slice screen ("Why?")

Purpose: the reason chain for one group, one question per tab, with the
decision within reach but not in the way.

```
 ← Back to Where is it worst (page 1, widespread only)                                      📷 Freeze this
 Packaging                                                                            ● widespread · confidence high
 109,199 cases · 0.9 % below expectation · invoices cleared late in 97 % of them; the shortfall is 93 % this one expectation.
 ┌ strip ─────────────────────────────────────────────────────────────────────────┐
 │ priority 946   rank 1 of 30   average 84 % met (everyone 84 %)   ⚠ 14 % still open │  more ▾
 └────────────────────────────────────────────────────────────────────────────────┘

 [ Why | Compared | Flow | Cases | Data trust | Gain ]                       ┌ Decision ───────────────┐
                                                                             │ Reading: widespread,     │
 ┌ Why: which expectations are missed ────────────────────────────────────┐ │ invoices cleared late.   │
 │ Invoices cleared within 30 days of receipt                              │ │                          │
 │   missed in 97 % of cases · explains 93 % of the shortfall              │ │ What next?               │
 │   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  │ │ ( ● Investigate )        │
 │ Payment block removed promptly after goods receipt (DF2)                │ │ ( ○ Defer )              │
 │   missed in 81 % · explains 24 %                                        │ │ ( ○ Accept the shortfall)│
 │   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇                                                     │ │ ( ○ Not a problem )      │
 │ Few hand-overs between people                                           │ │ note * ______________    │
 │   missed in 85 % · explains 21 %                                        │ │ owner   ______________   │
 │   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇                                                      │ │           [ Save ]       │
 │                                             Show all 29 expectations ▾  │ │ ▸ Change the kind        │
 └─────────────────────────────────────────────────────────────────────────┘ │ ▸ Method terms           │
 ┌ Compared with everyone else, for the top expectation ───────────────────┐ └──────────────────────────┘
 │ Invoices here take 83 days from receipt to clearing; everywhere else 21. │
 │ [ distribution lens: two colours, expectation line at 30, band to 90 ]   │
 │                                              Open the full comparison →  │
 └─────────────────────────────────────────────────────────────────────────┘
 ┌ Can the data be trusted? ───────────────────────────────────────────────┐
 │ ⚠ 14 % of these cases were still open when the data was extracted.       │
 │   Without them the shortfall stays (167 % of its size). Check pending.   │
 │ ✓ No duplicated header events in this group.                             │
 └─────────────────────────────────────────────────────────────────────────┘
 ┌ Typical causes for this pattern ─ candidates, to be checked ─────────────┐
 │ · Payment terms of 60–90 days in the master data → check the terms.      │
 │ · Queue in invoice verification → check the hand-over to clearing.       │
 │                                                    [ What can we do? → ] │
 └─────────────────────────────────────────────────────────────────────────┘
```

Header rules:

- **Back control** names the origin and, in parentheses, the state it
  restores (page, one filter word) when the origin is the list.
- **One-sentence header** (`md`, two lines max, 64ch): the card's sentence
  plus one clause about how concentrated the shortfall is. No second
  paragraph. The old six-line reading and the six metric boxes are
  removed.
- **Compact strip**: four cells at most — priority, rank, average met
  with "everyone" in parentheses, one caveat cell (or *no data caveats*).
  `more ▾` opens the full metric set (cases, score 0.836, gap, stable gap,
  PI, stable PI, cautious bound, γ) with *Explain this number* popovers.
- The kind chip and the confidence word sit at the right of the title
  line, once.

Tabs, renamed and in this order, each answering one question:

| Tab | Question | Content (first screenful) | Behind a disclosure |
|---|---|---|---|
| **Why** | which expectations are missed | drivers bar list (top 3, §4.2); the top expectation's comparison sentence with a small lens; two caveat lines; typical causes; the *What can we do?* button | *Show all 29* table; waterfall; area strips (§4.3); vendor Pareto renamed *Where inside this group* |
| **Compared** | how this group differs, in real units | one expectation at a time (select prefilled with the top driver): the sentence *Invoices here take 83 days; everywhere else 21*, the distribution lens (§4.1) with "here" and "everyone else", the sentence with the share beyond the expectation | sliders for ϑ and W (exploration; analyst mode), the bins table, *Recalibrate in the norm →* |
| **Flow** | where in the flow | the group's process map (§3.5 layout inside the tab, 560 px tall), overlays limited to the top-three driver expectations, *compare with everyone else* toggle | full activity list, table alternative |
| **Cases** | what kind of cases | sub-group bars (flow type, vendor, document type inside the group, with counts and shares) then *cases furthest off* as ten rows: case, score as per cent met, **number** of missed expectations and the top two as plain phrases | the full missed list per case; the trace (a sub-screen with a back control) |
| **Data trust** | can the data be trusted | the checks as three lines (open cases, duplicated events, plausibility) each with glyph, plain sentence, status word and, when allowed, *pass / fail / waive with a note* | the four diagnostic numbers with labels; method names |
| **Gain** | what would be gained | one sentence per expectation area: *If invoices for Packaging were cleared within 30 days, the group's shortfall would fall by 60 %*, with a gain bar | the headroom table |

Tab rules: tabs fit one line (six short words); the active tab is
underlined in accent; the URL keeps `tab=why|compared|flow|cases|trust|gain`
(old values map onto these). Method words appear only in the `more ▾` of
the strip and in tooltips.

**Decision pane**, simplified:

- Title *Decision*, one line *Reading:* (kind and the top expectation in
  plain words).
- One question, **What next?**, with four radio options in plain words
  (*Investigate*, *Defer*, *Accept the shortfall*, *Not a problem*; the
  method's dispositions are the tooltips), a note field (required for all
  four; placeholder *why, in one line*), an owner field, one **Save**
  button enabled once the note has text.
- *Change the kind* and *Method terms* are disclosures; the kind override
  keeps its required note.
- The pane is sticky, 340–400 px wide, and collapses to a *Decision* pill
  at widths under 1280 px.
- After Save: the pane shows the saved finding as one sentence with
  *Edit*, and the **Next step** line appears: *Freeze this screen for the
  notebook* / *Open What can we do?*.

### 3.5 Flow screen

Purpose: the map is the screen. Used as the Run step's *Where in the flow*
(whole log or one flow type) and as the Flow tab of a group.

```
 ← Back to Why · Packaging                                                        📷 Freeze this
 Where in the flow · Packaging                                       [ compare with everyone else ]
 109,199 cases · 584 k events · showing the 12 most frequent activities and the paths of 3 % of cases.

 ┌ filter bar ─────────────────────────────────────────────────────────────────────────────────┐
 │ cases in: 109,199 of 109,199   chips: (none)                          [ Refine ▾ ]  detail ─●──  │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌ map ───────────────────────────────────────────────────────────────────────────┬ legend ─────┐
 │  Request ─────── Order ──────── Receive ──────── Invoice ──────── Match ── Pay  │ path width  │
 │  [Create PR] → [Create PO item] → [Record GR] ═══════════> [Record IR] → [Clear] │ ─ 5 k ▬ 90 k │
 │                                    ╰──── arc: 96 % late, 30 d ──────╯          │ path colour │
 │                                                                                 │ ░▒▓ 0–100 % │
 │                                                                                 │ missed      │
 │  ( + ) ( − ) ( ⤢ )                                                              │ ▲ badge     │
 ├─────────────────────────────────────────────────────────────────────────────────┴─────────────┤
 │ 3 expectations about case attributes have no place on the map: hand-overs, manual share, … │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌ selected: Record Goods Receipt ──────────────────────────────────────────────────────────────┐
 │ 108,930 cases (99.8 %) · 2.1 events per case · worst expectation touching it: invoice cleared │
 │ late (96 %).   [ Filter to cases with it ] [ Exclude cases with it ] [ Paths in / out ] [ Lens ] │
 └─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Rules:

- **Map first.** The map fills the width and at least 560 px of height;
  no control box floats over it. Zoom controls sit in the map's
  bottom-left corner, 32 px, translucent.
- **Filter bar** above the map: *cases in: n of N* is the running count
  after the active filters; every applied filter is a chip (*with Record
  Goods Receipt ×*, *without Cancel Invoice ×*, *ends with Clear Invoice
  ×*); the **detail** slider replaces the two abstraction sliders (one
  control from *stages only* to *all activities*; paths follow the
  activity level with the keep-connected rule always on). *Refine* opens
  the drawer with the flow filters (start / end activity, flow type,
  only closed cases, activity set).
- **Activity actions.** A single click selects an activity and opens the
  *selected* card under the map (not a side pane) with its sentence and
  the four actions as buttons; a right click or `↵` opens the full menu
  (filter to / exclude / exclude the event / paths in / out / worst cases
  / lens / add expectation / pin). *Filter to cases with it* adds a chip,
  recounts *cases in*, and re-renders the map, the ranked list of this
  scope and the analytics; the live region announces *Filter added: cases
  with Record Goods Receipt — 108,930 of 109,199 remain*. Filtering an
  activity that changes nothing visible must still change the count and
  the chip, so that the action is never silent.
- **Stage lanes** are drawn as light horizontal bands with the stage name
  at the left edge (Request, Order, Receive, Invoice, Match, Pay), always
  in the same order; activities sit in their lane.
- **Overlays** are limited to what the current question needs: on a
  group's map, the arcs and badges of the top-three driver expectations;
  on the whole-log map, the three most-missed expectations. *Show all
  expectations* and per-area toggles live in the legend.
- **Compare with everyone else** recolours edges by the difference (§4.4)
  without moving anything; the button becomes a labelled state *showing
  the difference to everyone else* with an `×`.
- Flow types: on the Run step the header carries a segmented control
  *all flows | DF2 | DF1 | consignment | 2-way* that swaps the map on the
  same layout; the four small maps of the dashboard link here.
- The legend is a fixed column at the right (200 px) and lists only the
  encodings in use.

### 3.6 What to do

Purpose: the sixth step; options for the pattern found, in sentences.

```
 ← Back to Why · Packaging
 What can we do about Packaging?
 Invoices here take 83 days from receipt to clearing; the expectation is 30.

 ┌ Options ────────────────────────────────────────────────────────────────────┐
 │ 1 Check the payment terms in the master data. If terms are 60–90 days, the   │
 │   expectation is mis-set: recalibrate it (owner: procurement master data).   │
 │   possible gain if the expectation is met: shortfall −60 %  ▇▇▇▇▇▇▇▇▇▇▇▇     │
 │                                                        [ Create an action ]  │
 │ 2 Look at the hand-over from invoice receipt to clearing (owner: accounts    │
 │   payable). possible gain: −60 %  ▇▇▇▇▇▇▇▇▇▇▇▇         [ Create an action ]  │
 └──────────────────────────────────────────────────────────────────────────────┘
 ┌ What if ──────── (scenarios defined by the process expert) ─────────────────┐
 │ Cap invoice-to-clearing at 45 days: shortfall −38 %   ●────────              │
 └──────────────────────────────────────────────────────────────────────────────┘
 ┌ Next step: create an action · record a hypothesis · add to the next review ─┐
```

Rules: options come from the failure-mode catalogue for the missed
expectations, at most five, each a two-line sentence with an owner role
and a gain bar; sliders exist only for defined scenarios and write a
sentence, never a table; the create-action form asks for owner and due
date only.

### 3.7 The notebook

Purpose: freeze any analysis screen as documentation and write about it.

**Freeze this** (camera glyph, in the ribbon and in the page header of
every analysis screen) opens a small dialog anchored to the button:

```
 ┌ Freeze this screen ────────────────────────────────┐
 │ [ preview thumbnail of the current screen, 320 px ] │
 │ title   Packaging — invoices cleared late          │
 │ note    ___________________________________________ │
 │         ___________________________________________ │
 │ context Baseline 2018 · Automation · Company × Spend │
 │         area · Why · Packaging · tab Why · 2 filters │
 │                                [ Cancel ] [ Freeze ] │
 └────────────────────────────────────────────────────┘
```

- The snapshot stores the screenshot (client-side capture of the page
  region below the stepper; server-side rendering when the client cannot),
  the data behind the screen as JSON, the context (run, perspective,
  grouping, scope, screen, tab, filters, URL), the title and the note.
  The title is prefilled from the header sentence; the note is optional.
- After *Freeze* the ribbon counter increments and a toast reads *Frozen
  as snapshot 5 · Open the notebook*.

The **Notebook** screen (ribbon `▣`, `/p/:project/notebook`):

```
 ← Back to Why · Packaging
 Notebook · Demo                                                   [ Export Markdown ]  ⋯ (PowerPoint later)
 5 snapshots · last frozen 5 Sep, 14:02

 ┌ 1 ≡ ┌ thumbnail ┐  Your process — four flow types                                   Edit · Delete ┐
 │     │           │  DF2 carries 88 % of the cases; DF1 and consignment are small. We  │
 │     └───────────┘  analyse DF2 first.                                                │
 │                    Dashboard · Baseline 2018 · 5 Sep 13:40                            │
 ├ 2 ≡ ┌ thumbnail ┐  Where is it worst — Packaging first                                              ┤
 │     └───────────┘  note: (none) ✎                                                                    │
 ├ 3 ≡ ┌ thumbnail ┐  Packaging — invoices cleared late                                                 ┤
 │     └───────────┘  Median 83 days against 30. Top three vendors carry 37 %; not one vendor.         │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Snapshots are listed in order with a drag handle (`≡`; keyboard
  `Alt+↑/↓` reorders), a 160 px thumbnail (click opens the full image in
  a lightbox with the context line and *Open this screen again*, which
  navigates to the stored URL), the title (editable inline), the note
  (editable inline, autosaved on blur, Markdown allowed), and the context
  line.
- **Export Markdown** writes one file with the title, one section per
  snapshot (heading, image, note, context footer) and the images beside
  it. The PowerPoint export is listed in `⋯` as *coming later*, disabled.
- Empty state: *Nothing frozen yet. Press the camera on any analysis
  screen to keep it here with a note.*

### 3.8 Empty, loading and error states

One pattern, three parts: a sentence in plain words, the reason, one next
step (button or link). Never a bare spinner, never a stack trace.

| Situation | Sentence | Next step |
|---|---|---|
| No dataset | *No log yet. Drop a file or load the public example.* | Load the public log |
| Dataset ready, no case table | *Columns are mapped; the case table is not built.* | Validate and build |
| No norm | *No expectations yet.* | Import the reference norm |
| No run | *Nothing scored yet. A run scores every case against the norm (about 15 s for 250 k cases).* | Score the log |
| Run running | skeleton cards in the list's shape with the progress sentence *Scoring cases · 62 %* | Cancel |
| First Why? after start (13 s) | the header renders at once from the list's data; tabs show skeletons with *Preparing the reasons for Packaging (first time after start takes about 15 s)* | — |
| Map layout (2–4 s) | the map area shows the stage lanes immediately and *Placing 12 activities…* | — |
| Filter hides all | *No group matches these filters.* with the culprit chip named | Remove that filter |
| Confidence not computed | on the card: *confidence not computed*; in the drawer the switch is disabled with *needs a run with resampling* | Re-run with resampling |
| Flow library missing | *The process map needs the flow library; it is not installed on this server.* | Table alternative |
| Job failed | *Scoring failed at "backlog Company × Spend area".* with *Show details* (log) | Retry · Open the job |
| Deep link to a missing object | *This run does not exist in this workspace.* | Go to Runs |

Loading uses skeletons in the final layout (no layout shift); the
skeleton's sentence line is the one place that may show a method-free
progress message. Errors use the `danger` chip once, in the page header,
never a red banner over the whole screen.

---

## 4. Chart rules for the analytics

General: text before charts, charts before tables; every chart has a
one-sentence caption stating what it shows and for whom (*Packaging
against everyone else, 76,613 cases with a value*); axes carry plain
labels with units; one dominant chart per screenful; a *table alternative*
disclosure under every chart; SVG export with the caption and the run note
in the footer.

### 4.1 The distribution lens

```
 Invoices here take 83 days from receipt to clearing; everywhere else 21.
 97 % of Packaging's invoices clear later than the expected 30 days (everyone else: 34 %).

 cases ▲                    ┊ expected ≤ 30 d ░░░░ tolerance to 90 d ░░░░
       │        ▄▄          ┊░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
       │      ▄▄██▄▄   ▄▄▄▄▄┊░░░░░░░░░░░ Packaging (accent) ░░░░░░░░░░
       │  ▄▄▄▄████████▄█████┊██████▄▄▄▄░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
       │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒┊▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ everyone else (grey)
       └────────────────────┊──────────────────────────────────────────▶ days from invoice receipt to clearing
         0        30        60        90       120      150   (1 % of cases beyond 150 d, not drawn)
```

- Two series only: **here** (the group, accent) and **everyone else**
  (grey, 60 % opacity, drawn behind). Both are density-normalised so that
  a group of 76,613 and a rest of 160,000 compare by shape. A legend of
  two words sits in the top-right corner.
- The **expectation line** (ϑ) is a dashed vertical line labelled
  *expected ≤ 30 d*; the **width band** (ϑ to ϑ + W) is a light hatched
  band labelled *tolerance to 90 d*. Both are always drawn, never optional.
- The x-axis is in the expectation's unit with the unit in the label;
  the domain is clipped at the 99th percentile of the union and the
  caption states what is not drawn. Bins: 40 at most, computed on the
  union so both series share edges.
- The share beyond the threshold is **a sentence above the chart**, with
  the group and everyone else, not a statistic row. The full statistic
  set (n, mean, p90, p95, max, mean soft violation) is behind
  *more ▾*, and there in plain labels.
- **Sliders only in exploration**: on the norm's calibration lens and, in
  analyst mode, on the Compared tab under a *Try another threshold*
  disclosure; moving them updates the sentence live and shows *exploring:
  not saved* until *Recalibrate in the norm* is pressed (which requires a
  note and creates a version). In guided mode the lens has no sliders.
- The cumulative curve is a toggle (*show cumulative*), not a second
  y-axis by default.

### 4.2 The drivers bar list

```
 Invoices cleared within 30 days of receipt
   missed in 97 % of cases · explains 93 % of the shortfall
   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
 Payment block removed promptly after goods receipt (DF2)
   missed in 81 % · explains 24 %
   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
 Few hand-overs between people
   missed in 85 % · explains 21 %
   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
                                                          Show all 29 expectations ▾
```

- One row per expectation: the plain phrase (`base` semibold), a line
  with two shares in words, one bar whose length is the share of the
  shortfall (accent, 8 px high, on a 100 % track). No raw ids; the id is
  in the tooltip and in the *Show all* table.
- Three rows by default; *Show all* expands to the full list sorted by
  share, with expectations that reduce the shortfall shown below a
  divider *met better than everyone else here* with a grey bar to the
  left. Shares above 100 % are drawn to the track's end with the number
  written; the caption explains once: *shares add to more than 100 %
  because other expectations are met better than average here.*
- The waterfall chart is retired from the first screenful; it is available
  under *Show all* as *see as a waterfall* with a y-axis in per cent of the
  shortfall (whole numbers), never in score units.

### 4.3 Layer strips (expectation areas)

```
 Handovers and ageing         here ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  5.6 %
                              all  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒     4.5 %
 Effort and automation        here ▇▇▇▇▇▇▇▇▇▇         3.1 %
                              all  ▒▒▒▒▒▒▒▒▒▒▒        3.4 %
```

- One pair of thin bars (6 px) per area: **here** (accent) over
  **everyone** (grey), same scale, the value at the right end as the
  per cent of cases' score lost in that area (labelled once in the
  caption: *share of the score lost per case*). The area's colour square
  precedes its name; the bars themselves are not coloured by area.
- Sorted by the "here" value; areas with no applicable expectation read
  *does not apply here* in `textSubtle`.
- Used on the Why tab behind *Show all*, on the run screen as the whole
  log's profile, and in the flow-type comparison as the per-column strip.

### 4.4 The process map

- **Edge width** encodes the number of cases on the path, three steps
  (thin ≤ 5 % of cases, medium, thick ≥ 50 %), with the legend showing
  the three widths and their thresholds in cases. Continuous widths are
  not used; the eye cannot read them.
- **Edge colour** encodes the share of cases on the path that miss an
  expectation touching it, sequential `violation` scale in five steps,
  legend as a labelled ramp *0 – 100 % missed*. Edges with no expectation
  are neutral grey. In **compare** mode the colour switches to the
  diverging `delta` scale (*worse here – same – better here*) with the
  legend swapped; widths stay.
- **Activities**: white boxes with a 1 px border; a missed-expectation
  tint is not used (the badge carries it). Badges: one per activity at
  most, the worst expectation's share as a number with the ▲ glyph;
  further badges collapse into *+2*.
- **Arcs** (lag, precedence): drawn above the lanes, width by coverage in
  the same three steps, colour by missed share; the label is the plain
  phrase and the share (*late in 96 %*), shown on hover and when the arc
  belongs to a driver.
- **Overlays limited to the question**: a group's map shows the driver
  expectations of that group; the run map shows the top three of the
  log; a *Show all expectations* toggle and per-area toggles live in the
  legend. Never more than six arcs at once without the toggle.
- **Stage lanes**: horizontal bands in the canonical stage order, name at
  the left edge, `surfaceSunken` fill alternating with `surface`; the
  layout is computed on the union graph so that a group's map and the
  whole log's map keep the same positions.
- **Legend** is always visible, lists only the encodings in use, and each
  entry is clickable (toggles the overlay). The stage colours of the
  current build are removed; stage membership is position in a lane.
- Small map (§3.1, §4.5): stages as six columns, the top three edges by
  cases drawn, coloured by missed share, no labels except the stage
  initials; a tooltip names the flow type and its three numbers.

### 4.5 Small multiples for flow types

```
 DF2 · 221,010 cases        DF1 · 15,182            Consignment · 14,498    2-way · 1,044
 [ small map ]              [ small map ]           [ small map ]           [ small map ]
 82 % met  ▇▇▇▇▇▇▇▇▇▇▇▇     90 % met  ▇▇▇▇▇▇▇▇▇▇▇▇▇ 91 % met  ▇▇▇▇▇▇▇▇▇▇▇▇▇ 87 % met ▇▇▇▇▇▇▇▇▇▇▇▇
 1 ● Packaging  0.9 %       1 ◆ Additives 1.2 %     1 ◆ Solvents 0.6 %      1 ▲ Real Estate 9 %
 2 ◆ Logistics  5.6 %       2 ◆ Latex     1.7 %     …                       …
```

- Same layout, same scales, same bin edges, same colour ramp across all
  columns; a shared legend once under the row. Columns are in descending
  case count; at most five columns, the rest under *other flow types*.
- Each column: name and cases, small map, a per-cent-met bar, the top
  three groups in one-line form. Clicking a column header sets the scope
  to that flow type (ribbon switcher) and opens its ranked list.

### 4.6 What never to show

- Raw ids (`c_l3_invoice_to_clear_days`, `run_0mtoq…`, `vendorID_0136` in
  place of a name) in plain mode; ids live in tooltips, the *more*
  panels and the Table tab.
- Six-decimal or three-decimal numbers; axis ticks that round to the same
  value (a y-axis reading 0.01 seven times is a defect).
- More than one dominant element per screenful (a chart next to a table
  of equal size; two charts side by side at the top of a tab).
- Colour without a twin: every colour encoding has a glyph, a pattern, a
  width or a label alongside; the map's legend must make sense in
  greyscale.
- A chart without an expectation line where a threshold exists.
- A group without "everyone else" on the same chart.
- Method notation (ϑ, W, γ, PI, μ̄) outside the *more* panels, the norm
  editor and the formula popovers.
- Sliders on a screen that is not about setting a threshold.

---

## 5. Release checklist and acceptance tests

### 5.1 Checklist per screen

Tick every line before a screen ships; a screen with an unticked line does
not ship.

**Orientation**
- [ ] The stepper shows the current step with the accent ring and *you are
      here*; sub-screens show their second line.
- [ ] `← Back to <origin>` is the first element of the page header and
      restores the origin's filters, tab and page; `Alt+←` and the browser
      back button do the same.
- [ ] The ribbon shows only the switchers of this step; no id is visible.
- [ ] One primary button on the screen, in accent; everything else is
      secondary or in `⋯`.
- [ ] A *Next step* suggestion exists on the dashboard and after every
      saved decision.

**Reading**
- [ ] Every reading sentence is at most two lines at 64ch and holds at
      most three numbers.
- [ ] Numbers follow §2.7 (rounding, units, no three-decimal scores).
- [ ] No method term is visible in plain mode outside *more* panels and
      tooltips; the plain phrase of every expectation exists.
- [ ] Nothing repeats between cards (perspective, *of n*, γ, aliases).
- [ ] *How to read this* exists, collapsed, reopened from `?` in the title.

**Layout and visuals**
- [ ] One dominant element per screenful; charts come after text and
      before tables.
- [ ] Spacing follows the 4 px scale as in §2.5; cards 16 px apart;
      no box floats over a chart or a map.
- [ ] Colour: accent only for the current step, primary action, links,
      "here" series and priority bar; every other colour has a twin.
- [ ] Every chart has a caption, plain axis labels with units, the
      expectation line where one exists, "everyone else" beside the
      group, and a table alternative.
- [ ] The map's legend lists only encodings in use; overlays limited to
      the current question; lanes in canonical order.

**States and access**
- [ ] Empty, loading and error states designed per §3.8, with a next
      step; skeletons in the final layout.
- [ ] Keyboard path: stepper, back, drawer, cards, map and tabs operable
      without a mouse; focus visible; live-region announcement for every
      filter and freeze.
- [ ] Contrast ≥ 4.5:1 in both themes; reduced motion respected.
- [ ] *Freeze this* is present and captures the screen with its context.
- [ ] The URL holds the full state; a pasted link reproduces the screen.

### 5.2 Acceptance tests

Run with five readers who have not read the method (owners, clerks,
analysts of other processes) and one analyst; record time and outcome.
A test passes at four of five readers unless stated otherwise.

| # | Test | Procedure | Pass criterion |
|---|---|---|---|
| A1 | **First-click on the signals card** | Open the ranked list; say only "find out why the first group is worst". | The first click is *Why?* on card 1 and the reason screen opens on that click (no second click), within 10 s. |
| A2 | **Five-second dashboard** | Show the dashboard for five seconds, then hide it; ask: what is the process, how many flow types, which group is worst, what would you do next? | Three of four answers correct for each reader. |
| A3 | **Find the way back from the lens** | From the list, open Packaging → Compared → *Recalibrate in the norm* (the norm lens). Ask the reader to return to the list they came from, with its filters. | The reader uses the on-screen back control (not the browser) and lands on the list with the same page and chips, within 15 s; the browser back button gives the same result when tried. |
| A4 | **Card comprehension without method knowledge** | Show one card (rank 1 and rank 9 for different readers); ask: how many cases, how far off, what kind of problem, how sure, what is missed. | Four of five answers correct, in the reader's own words; no reader asks what a word means. |
| A5 | **Decide a caveat** | On the readiness screen, ask the reader to make open cases not count against closure. | The reader chooses *Censor*, reads the preview, presses Apply, and can say how many cases were affected; under 60 s. |
| A6 | **Flow filter does something** | On the flow screen, ask the reader to see only cases that pass through Record Goods Receipt. | After the action the count *cases in* changes, a chip appears, the map re-renders, and the reader confirms what happened; under 30 s. |
| A7 | **Flow types first** | New workspace with the public log; ask "what kinds of flows are in this process?". | The reader answers from the dashboard's *Your process* without navigating; names four and the largest. |
| A8 | **Freeze and annotate** | Ask the reader to keep the Packaging reason screen for a report with a one-line remark, then find it again. | Snapshot created with note, found in the notebook, reopened to the same screen; under 90 s. |
| A9 | **Position awareness** | At any point during A1–A8, ask "where are you in the analysis?". | The reader points to the stepper and names the step; three checks per reader, all correct. |
| A10 | **Visual review** | Two reviewers score each of the seven screens on: one dominant element, spacing, palette discipline, numbers rule, repetition. | Mean ≥ 4 of 5 on every screen; no screen below 3 on any criterion. |
| A11 | **Vocabulary check** | Fifteen questions across three cards (three per card, five readers). | ≥ 80 % correct. |
| A12 | **Deep-link and reload** | Paste a Why URL with `tab=compared` and a filter chip into a fresh tab. | The screen matches the original, the back control reads *Back to Where is it worst*, and the stepper marks Why. |

Metrics recorded with every release: time to first *Why?* for a new reader
(target ≤ 30 s from the dashboard), A2 score, A4 score, number of
back-navigation failures (target 0), snapshot count per session.
