# WISE Workbench — UI design specification, third release: the flow as the instrument and the explore board

*Product design specification for two screens of the third release: the
**Flow** step, where the process map is the screen and every action on it
works, and the **explore board**, where selecting context changes the flow
and every number beside it at once. It covers placement, layout and
sizing, the shared context-and-filter model, what every click does, the
BPMN model view, keyboard operation, states, wireframes at 1440 × 900 and
at 1024 wide, the panel contract that the later dashboard builder will
use, and the acceptance tests.*

*Binding elsewhere: the second-release specification
(`docs/panel/ui_design_cycle2.md`) stays in force for typography (§2.5),
palette (§2.6), the number rules (§2.7), cards, the analysis stepper and
the back control (§2.2), the ribbon (§2.3), the Refine drawer (§2.4), the
chart rules (§4) and the state patterns (§3.8). Nothing here overrides
them; where this document is silent, that one decides. Design tokens:
`packages/design-tokens/tokens.json`. Numbers in the examples come from
the BPI Challenge 2019 run `run_0mtoq44vd14f208ur` (company × spend area,
Automation perspective, γ = 20) as it is served today.*

The one sentence this specification serves: **a person selects a piece of
context — a flow type, a period, a vendor, an activity — and the process
flow and every number around it answer for that selection, within a
second, with the selection visible and removable.**

---

## 1. What the flow must become

Read against the served build at 1440 × 900.

**The map is a widget inside a tab inside a card.** On the Run step's
*where in the flow* tab the map canvas is 1120 × 550 inside a card that
starts 300 px down the page, and the drawing itself uses about a third of
that canvas: the top 140 px of the canvas are empty, the activity labels
are 4 px high and unreadable, and 42 activities are reduced to 9 without
the reader being told what the other 33 are. On the *Why* screen's Flow
tab it is worse: the map shares the row with a 340 px decision pane and a
200 px legend, so the canvas is 725 px wide, the drawing occupies about
690 × 150 px of it, and the whole map begins 545 px down the page — below
the fold on a 900 px screen. Measured as area, the map region is 47 % of
the frame on the Run step and about 5 % on the Why screen. A person
cannot analyse with that; the first thing to fix is simply *make the
map the screen*.

**The chrome outweighs the instrument.** What surrounds the map today is
a card title, a detail slider, a *table alternative* button, a 200 px
legend that explains four encodings at once, a line of raw expectation
ids (`c_l6_high_exposure_memo`, `c_l7_manual_touches`, …) under the
canvas, and a *React Flow* watermark. What is missing is the one control
a map needs: a filter bar that says how many cases are in and out, and
chips that say why.

**Actions are invisible or silent.** The map answers a click with a card,
but the card's actions are two buttons; the full action set exists only
in a right-click menu that a first-time reader never finds; a filter that
removes no case looks like a broken button; an activity whose paths are
all below the detail level reports no paths at all rather than *n paths
are hidden at this detail*; and there is no full-window control, so the
map cannot be made larger than the card that holds it.

**There is no place to compare.** Every number lives on the screen of its
own question: the ranked list on Signals, the distribution on Compared,
the flow types on the dashboard, the caveats on Data. Choosing a vendor,
a period or a flow type and watching all of them move together is not
possible anywhere. That is the explore board of §4.

---

## 2. One instrument, one filter, three placements

Before the two screens: the model they share. Everything in §3 and §4
reads and writes the same three objects, and no screen keeps a private
copy.

### 2.1 Context and filter

- **Context** is what the ribbon already carries (§2.3 of the second
  release): project, run, perspective, grouping, scope (all flows or one
  flow type). Context chooses *which population and which measure* is
  being read. Changing it re-reads every screen and clears nothing else.
- **Filter** is a list of clauses joined by AND, in the flow library's
  canonical form (`Filter`, `FilterClause`, `canonicalFilter`): time
  window, case attribute, slice, activity, follows, lag, count, open or
  closed, expectation state, and an `any` group for OR. Filter chooses
  *which cases* are read. It is the single object behind the chips, the
  URL, the map, every board panel and every export caption.
- **Selection and focus** are not filters. Selecting an activity opens
  its card; focusing it draws its paths; neither changes a count until an
  action is chosen. This distinction is what makes a click safe.

Same field, several values, reads as OR: clicking DF2 and then DF1 in the
breakdown gives one chip *flow type: DF2 or DF1*, not two chips.
Different fields read as AND. Clicking an element that is already in the
filter removes it (the chip disappears) — a second click never doubles a
clause, because the canonical form removes duplicates.

### 2.2 Chips

Chips are the only visible representation of the filter, and they are the
same component on both screens and in the exports.

- One chip per clause, in the order added, plain words, with `×`:
  *with Record Goods Receipt ×*, *flow type: DF2 ×*, *2018 Q4 ×*,
  *invoices cleared late: only violating ×*, *closed items only ×*.
- Chips, counts and announcements speak in the run's case noun — here
  *purchase order items*, elsewhere *cases* — and never in the method's
  vocabulary.
- A chip's tooltip carries its effect: *removes 143,300 items on its own;
  142,913 of them are already removed by another chip*.
- A clause that changes the content of cases rather than their selection
  (`events_inside`, *exclude the event*, a sub-process boundary) is drawn
  with the second chip style and the word *changes cases*.
- `Reset all` appears at the right end of the chips row from the second
  chip on. Removing the last chip returns exactly the unfiltered screen.
- The chips row is present even when empty, as one muted line
  *no filter yet* — the place never moves, so nothing shifts when the
  first chip appears.

### 2.3 URL and sharing

`…/flow?view=Automation&slicing=…&scope=DF2&detail=3&sel=activity:Record+Goods+Receipt&f=<canonical filter>&fh=<hash>`
and the same for `…/board` plus `period`, `area`, `group`, `panel`,
`board=<saved board id>`. Rules: the canonical form means two people who
clicked the same things produce byte-identical URLs; `fh` is the short
hash for share links and caches; every state change that a person would
expect the browser's back button to undo pushes one history entry
(a filter change does, a hover does not); a pasted URL reproduces the
screen including chips, selection, detail level and rendering mode.

### 2.4 Never silent

Every action reports, in the same three places, within one second:

1. the **count line** (*in 108,930 of 251,734*) changes, or says
   explicitly *no items removed* for two seconds when the action removes
   none;
2. a **chip** appears or disappears;
3. the **live region** announces the sentence: *Filter added: items with
   Record Goods Receipt — 108,930 of 251,734 remain; six panels updated.*

An action that cannot be carried out is never a dead control: it is
disabled with a reason in its tooltip (*no path below this detail level*)
or it opens the state that explains it.

---

## 3. The Flow step

### 3.1 Placement

The flow becomes a step of the analysis, between Signals and Why. The
stepper (§2.2 of the second release, unchanged in its rules) reads:

```
 ● Data ─▶ ● Norm ─▶ ● Run ─▶ ● Signals ─▶ ◉ Flow ─▶ ○ Why ─▶ ○ What to do    ⋯ All stages
                                              ▲ you are here
```

- URL `/p/:project/runs/:run/flow`; the board of §4 is the second
  arrangement of the same step, `/p/:project/runs/:run/board`, and shows
  as the second line *Board* under the step.
- The page header carries one segmented control, **`Flow | Board`**:
  *Flow* is the map alone, filling the frame; *Board* is the map with its
  linked panels around it. Context, filter, chips and selection survive
  the switch untouched.
- Three placements, one implementation: the Flow step, the *Flow* tab of
  the Why screen (§3.13) and the map panel of the board. They differ only
  in the frame they are given; the rules below hold in all three.
- The Run step's *where in the flow* tab and the dashboard's four small
  maps become doorways: they open the Flow step with the scope already
  set, never a second map with its own behaviour.

### 3.2 Layout and sizing

Five bands, in this order, and nothing else on the screen:

| Band | Height at 1440 × 900 | Content |
|---|---|---|
| ribbon | 40 | context switchers, caveats chip, notebook, freeze, help |
| stepper | 56 | the seven steps and the second line |
| page header | 68 | back control, title, one reading sentence, `Flow | Board`, freeze |
| filter bar | 44 | count in / out, chips, detail slider, rendering toggle, full window |
| **map frame** | **the rest, ≥ 568** | map canvas + legend column + zoom controls |
| activity card | 100, only when something is selected | the selected element and its actions |

- **The map frame is the page.** It has no card, no title, no padding of
  its own; it runs from the page margin to the page margin (1376 px at
  1440) and is bounded only by a 1 px border. Nothing floats over it: the
  legend is a column beside the canvas, the zoom controls sit inside the
  canvas's bottom-left corner (32 px, translucent, and they are the only
  thing that overlaps the drawing).
- **The 60 % rule.** At load, on a 1440 × 900 viewport, the map frame
  (canvas plus legend column) covers at least 60 % of the viewport area.
  The design above gives 1376 × 568 = 60.3 % with the activity card open
  and 1376 × 640 = 67.9 % with it closed. When a viewport is too short
  for the rule, the activity card collapses to a one-line strip first,
  then the page header's reading sentence moves into the title's tooltip;
  the map frame is never the band that gives way.
- **Fit on load.** The graph is fitted to the frame with 4 % padding on
  first render and after every detail change; the empty band above
  today's drawing is a fit defect, not a layout choice. Zoom and pan are
  kept while a filter changes, so the reader keeps their place; *Fit* in
  the zoom controls (and `0`) returns.
- **Labels are readable or the map is smaller.** The detail level offers
  only levels at which every drawn activity label fits its box at the
  fitted zoom; a level that would draw unreadable labels is not offered
  and the slider stops there with the caption *more activities than fit
  this screen — open the full window*.
- Below the map frame, one line of muted text names what has no place on
  the map, in plain words, never as ids: *7 expectations are about the
  case as a whole (memos on high-value items, manual touches, hands on
  the item, …). Open them in the board.*

### 3.3 Wireframe — 1440 × 900

```
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │ W  Demo ▾  Baseline 2018 · 5 Sep ▾  Automation ▾  Company × Spend area ▾  all flows ▾     │ 40
 │                                                          ⚠ 6 caveats  ▣ 2  📷  ?  ⌘K     │
 ├──────────────────────────────────────────────────────────────────────────────────────────┤
 │ ●Data ─▶ ●Norm ─▶ ●Run ─▶ ●Signals ─▶ ◉Flow ─▶ ○Why ─▶ ○What to do          ⋯ All stages │ 56
 │                                          ▲ you are here                                   │
 ├──────────────────────────────────────────────────────────────────────────────────────────┤
 │ ← Back to Where is it worst                                    [ Flow | Board ]   📷      │ 68
 │ Where in the flow · all flows · 251,734 purchase order items, 1,414,432 events            │
 ├──────────────────────────────────────────────────────────────────────────────────────────┤
 │ in 251,734 of 251,734 · no filter yet     detail ───●──── 9 of 42   [Map|Model|Table]  ⤢  │ 44
 ├────────────────────────────────────────────────────────────────────────┬─────────────────┤
 │  Request     Order        Receive        Invoice       Match      Pay   │ LEGEND       ▾  │
 │                                                                         │ path width      │
 │  ○→[Create PR]→[Create PO item]→[Record GR]═════▶[Record IR]→[Clear Inv]→○ ── 15 k ▬ 200 k│
 │        │             ╰──────────╮     ╰── late in 96 %, 30 d ──╯        │ path colour     │
 │        ╰→[Change Quantity] ▲72 %  ╰─────▶[Remove Payment Block]          │ ░▒▓ 0–100 % miss│ 568
 │                                                                         │ ▲ worst here    │
 │                                                                         │ ⌗ out of scope  │
 │  (+) (−) (⛶) (0)                                    9 of 42 activities  │ areas: ✓ ageing │
 │                                                                         │ ✓ effort  ○ risk│
 ├────────────────────────────────────────────────────────────────────────┴─────────────────┤
 │ Record Goods Receipt · Receive stage · 108,930 items (99.8 %) · 2.1 events each ·          │ 100
 │ worst expectation here: invoices cleared late (96 %)                                       │
 │ [Filter to] [Exclude] [Paths in / out] [Distribution] [Worst cases] [Pin]        ≡  ×     │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
 7 expectations are about the case as a whole and have no place on the map. Open them in the board.
```

### 3.4 The filter bar

One 44 px band, four things, left to right:

1. **Count** — `in 108,930 of 251,734` in the case noun of the run
   (*purchase order items*), the *in* number semibold. Under a filter it
   is followed by `· 142,804 out`. The number is the running result of
   the whole filter, not of the last clause.
2. **Chips** — §2.2, scrolling horizontally in one line with a
   `+3 more ▾` overflow; never wrapping to a second line (the map must
   not move when a chip is added).
3. **Detail slider** — one control, five stops, replacing every
   abstraction control: *stages only · main activities · more activities ·
   most activities · all that fit*. The caption reads `9 of 42
   activities`. Paths follow the activity level with the keep-connected
   rule always on. Moving the slider filters positions and never re-lays
   the graph out, so surviving activities do not move; `[` and `]` step
   it; the URL keeps `detail=`.
4. **Rendering toggle and full window** — `Map | Model | Table` (§3.9)
   and `⤢` (§3.8). *Refine* opens the drawer of the second release §2.4
   for the filters that are not reachable by clicking (start and end
   activity, flow type, closed cases only, activity set, time window).

### 3.5 The legend column

- Fixed 200 px column at the right of the canvas, inside the map frame,
  collapsible to a 32 px rail with `▾` (the state is remembered per
  person, not per URL).
- It lists only encodings in use, each with its twin (a width, a glyph or
  a number beside every colour), and the ramp is labelled in units:
  *path width — items on the path — 15 k ▬ 200 k*; *path colour — share
  of items missing an expectation — 0 – 100 %*.
- Every entry is clickable and toggles that overlay; the expectation
  areas are listed with a checkbox each, at most six arcs drawn at once
  (the rest behind *show all*). A toggled-off overlay leaves a muted
  entry, never disappears — otherwise the reader cannot switch it on
  again.
- Each entry's `≡` menu offers *show only this*, *filter to items
  violating any expectation of this area*, *sort the paths by this*.
- The legend never explains the method: *arc: a waiting-time or order
  expectation between two activities* is the whole sentence, and the
  method's name for it is in the tooltip.

### 3.6 The activity card and its actions

A single click selects and opens the card **under the map**, never a side
pane, never a pop-over on the drawing. Two lines and a row of buttons:

```
 Record Goods Receipt · Receive stage · 108,930 items (99.8 %) · 2.1 events each ·
 worst expectation here: invoices cleared late (96 %)
 [Filter to] [Exclude] [Paths in / out] [Distribution] [Worst cases] [Pin]     ≡  ×
```

The six buttons are the six most useful actions; `≡` opens the full menu
(the flow library's `defaultActions`, grouped identity · filter · explore
· compare · author · export, with accelerators); `×` clears the
selection. What each element offers and what happens:

| Element | Click | Actions on the card | Result of the action |
|---|---|---|---|
| **Activity** | selects, card opens | *Filter to* `f` · *Exclude* `x` · *Paths in / out* `i` · *Distribution* `d` · *Worst cases* `w` · *Pin* `p`; in `≡` also *exclude the event, keep the items*, *add an expectation here*, *analyse only from here* | filter actions add one clause, update the count, chip, map, activity card and — on the board — every panel; *paths* draws the path list beside the map; *distribution* opens the lens with the current filter; *worst cases* opens the case list ranked by score; *pin* puts the map in the comparison strip |
| **Path (A → B)** | selects the path, card shows both ends, items on it, median and p90 waiting time, the expectations on it | *Filter to items with this connection* · *Exclude* · *Path analysis A → B* · *Worst cases on it* · *Pin* · *Add a waiting-time expectation* | a `follows` clause (directly, when the path is a direct one); the path analysis opens as a sub-screen with the back control |
| **Stage band** | selects the stage | *Collapse / expand* `z` · *Filter to items entering this stage* · *Exclude* · *Paths in / out* · *Worst cases in it* · *Analyse only this stage* | collapse keeps positions; the filter is an `any` of the stage's activities |
| **Start / end event** | selects | *Only closed items* · *Only open items* · *Censoring reading* | the open / closed clause; the reading explains what the window's edge does to waiting times |
| **Expectation arc or badge** | selects the expectation, both ends highlight | *Distribution* · *Filter to violating items* · *Filter to items in scope* · *Exclude violating* · *Worst cases* · *Edit the expectation* | expectation-state clauses; *edit* opens the norm editor at that expectation |
| **Two activities** (shift-click) | pair card | *Path analysis A → B* · *Waiting time between them* · *Filter to items where B follows A* · *Add a waiting-time or order expectation* | the pair clause; the lens on the pair's waiting times |
| **Legend entry** | toggles the overlay | see §3.5 | overlay only, never a filter unless chosen from `≡` |

Two rules that answer today's defects:

- **Paths come from the full relation.** *Paths in / out* lists every
  incoming and outgoing path of the activity from the complete
  directly-follows relation, not only those drawn at the current detail.
  Paths that are not drawn are listed below a divider *hidden at this
  detail level (7)* with *show them* raising the detail. An activity such
  as *Change Quantity* therefore never reports "no paths".
- **A filter that removes nothing still happens.** The chip appears, the
  count line says *no items removed*, and the live region says so. The
  action is never a button that does nothing.

### 3.7 Comparison and overlays

- **Overlays are chosen by the question**: on a group's map the top three
  driver expectations; on the whole-log map the three most-missed;
  everything else behind the legend's checkboxes.
- **Compare with everyone else** recolours paths on the diverging scale
  (*better here — same — worse here*) without moving anything, and the
  button becomes a removable state chip *showing the difference to
  everyone else ×*.
- **Pin and diff**: pinned scenes appear as a strip of thumbnails above
  the filter bar (at most three); *diff* draws two scenes on the union
  layout so positions are identical.

### 3.8 Full-window mode

- `⤢` in the filter bar, `F`, or the map's own `⛶` control. The map frame
  grows to the whole browser viewport: the ribbon, stepper and page
  header leave, the filter bar stays (it is the instrument's own chrome),
  the activity card stays as an overlaid strip at the bottom with a
  translucent surface.
- The frame then covers ≥ 95 % of the viewport. The graph is refitted on
  entering and on leaving, keeping the zoom ratio so the reader does not
  lose their place.
- `Escape` leaves. When something is selected, the first `Escape` clears
  the selection and the second leaves — the announcement says which.
  Browser full screen is offered in `⋯` as *use the whole screen* and is
  a separate thing; leaving it does not leave the mode.
- The state is in the URL (`full=1`), so a frozen snapshot and a shared
  link reproduce it.

### 3.9 `Map | Model | Table`

The same scene rendered three ways. The toggle sits at the right end of
the filter bar and never changes the filter, the selection, the detail
level or the chips.

- **Map** — the process map (`ProcessMap` of the flow library), stage
  lanes in canonical order.
- **Model** — the BPMN view (`BpmnView`) of the same process:
  - the diagram comes from the project's model when one is linked, else
    it is generated from the stage model, else from the log at the
    current detail level; a chip says which: *model from the log ·
    generated*;
  - **the same overlays**, projected through the activity mapping:
    violation badges on tasks, expectation arcs on sequence flows,
    hatching for out-of-scope tasks, the same colour ramps and the same
    legend column;
  - **the same actions**: a task offers the activity actions of §3.6, a
    sequence flow the path actions, a lane the stage actions; a gateway
    selects the activities it maps to and offers *compare branches*;
  - **positions stay comparable**: lanes are the stages in the same
    left-to-right order as the map's bands, the selected activity stays
    selected and is scrolled into view on the switch, and switching
    issues no new query — both renderings read the scene already loaded;
  - unmapped elements are named under the diagram: *3 activities have no
    task in the model: Change Quantity, … — show them as generated
    tasks*;
  - the wording never claims conformance: overlays show missed
    expectations, never fitness or alignment.
- **Table** — the table alternative: activities and paths as rows with
  the same numbers and the same per-row actions. It is also what a screen
  reader and a print stylesheet get.
- **Export ▾** (in `⋯`): *BPMN 2.0 (.bpmn)*, *SVG*, *PNG*, *numbers as
  CSV*. Every export carries the context line and the chips as its
  caption; a map without its filter caption is not exportable.

### 3.10 Keyboard

Nothing on this screen needs a mouse.

| Key | Effect |
|---|---|
| `Tab` | back control → filter bar → chips → detail slider → rendering toggle → map → legend → activity card |
| arrows | move focus between activities; `Alt` + arrow follows a path (the path is focused, then the next activity) |
| `Space` | select; `Shift` + arrow extends the selection |
| `Enter` | open the actions menu of the focused element |
| `f` `x` `i` `d` `w` `p` `c` `z` | filter to · exclude · paths · distribution · worst cases · pin · add an expectation · collapse |
| `[` `]` | detail level down and up; `0` fits the graph |
| `F` | full window; `Escape` clears the selection, then leaves |
| `M` | cycles `Map → Model → Table` |
| `/` | focus the filter bar; `Backspace` there removes the last chip |
| `?` | the keyboard map; `Alt+←` back |

Focus is always visible (2 px accent ring, also on canvas elements); the
live region announces selection, focus of a path, every filter change
with its count, entering and leaving the full window, and the rendering
switch. Reduced motion removes the fit animation, never the fit.

### 3.11 Empty, loading and error states

Pattern as in the second release §3.8 — a sentence, the reason, one next
step.

| Situation | Sentence | Next step |
|---|---|---|
| Layout being computed (2–4 s) | the stage lanes are drawn at once and *Placing 12 activities…* inside the frame | — |
| Filter empties the map | *No items match. "without Clear Invoice" removes all 109,199.* | Remove that chip |
| Detail level hides the selection | *Record Goods Receipt is not drawn at this level.* | Raise the detail |
| Activity with no drawn path | *All 7 paths of Change Quantity are below this detail level.* | Show them |
| No model linked | *No model is linked to this project.* | Show the model generated from the log · Upload a model |
| Model without a mapping | *4 of 28 activities have no task in the model; their numbers are listed below the diagram.* | Map them |
| Map library missing | *The process map needs the flow library; it is not installed on this server.* | Open the table |
| Run not scored | *Nothing scored yet, so the map has no colours. The paths are still shown.* | Score the log |

Loading never replaces the frame with a spinner: the lanes, the legend
and the filter bar render first, the drawing arrives into them.

### 3.12 Narrow width — 1024

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ W  Demo ▾  Baseline ▾  Automation ▾  ⋯                    ⚠6 ▣2 📷 ? ⌘K│ 40
 ├────────────────────────────────────────────────────────────────────────┤
 │ ●Data ▸ ●Norm ▸ ●Run ▸ ●Signals ▸ ◉Flow ▸ ○Why ▸ ○What to do      ⋯    │ 48
 ├────────────────────────────────────────────────────────────────────────┤
 │ ← Back to Where is it worst                     [ Flow | Board ]  📷   │ 60
 │ Where in the flow · all flows · 251,734 items                          │
 ├────────────────────────────────────────────────────────────────────────┤
 │ in 251,734 of 251,734   detail ──●─── 9 of 42   [Map|Model] ▤ legend ⤢ │ 44
 ├────────────────────────────────────────────────────────────────────────┤
 │  Request    Order      Receive     Invoice    Match     Pay            │
 │  ○→[Create PR]→[Create PO]→[Record GR]═══▶[Record IR]→[Clear Inv]→○    │ 520
 │       ╰→[Change Quantity] ▲72 %      ╰── late in 96 % ──╯              │
 │  (+) (−) (⛶) (0)                              9 of 42 activities      │
 ├────────────────────────────────────────────────────────────────────────┤
 │ Record Goods Receipt · 108,930 items (99.8 %) · worst: cleared late 96 %│ 84
 │ [Filter to] [Exclude] [Paths] [Distribution]                    ≡  ×  │
 └────────────────────────────────────────────────────────────────────────┘
```

- The legend becomes a `▤ legend` button opening a 280 px pop-over
  anchored at the map's top-right; the map frame takes the full width
  (960 px) and 520 px of height — 51 % of a 1024 × 768 frame, 55 % when
  the activity card is closed. Below 1024 the rule relaxes to 50 % and
  the header sentence is dropped first.
- The activity card keeps four actions; the rest move into `≡`.
- The detail slider keeps its caption but loses the stop labels (they
  stay in the tooltip).
- Below 900 px width the map is offered with *open the full window* as
  the primary action, because a smaller instrument is not worth reading.

### 3.13 The flow on the Why screen

The Why screen keeps its Flow tab, and the tab is the same instrument in
a smaller frame, not a second map:

- While the Flow tab is active the decision pane collapses to its
  *Decision* pill at the right edge, so the map frame spans all 12
  columns (1376 px) and 520 px of height — the dominant element of the
  screen by a wide margin.
- The group is a chip (*group: Packaging ×*) like any other clause;
  removing it widens the map to the whole run without leaving the screen.
- `Open full` in the tab's corner goes to the Flow step with the same
  chips, selection and detail level, and the back control reads *← Back
  to Why · Packaging*.

---

## 4. The explore board

### 4.1 Purpose and placement

One screen where the map and the numbers that explain it are visible at
once and answer the same selection. It is the second arrangement of the
Flow step (`Flow | Board`), URL `/p/:project/runs/:run/board`, and it
carries the second line *Board* under the step.

The board is for the question *what changes when I look at this slice of
the process?* — and for the reader who wants to try that question twenty
times in five minutes.

### 4.2 Wireframe — 1440 × 900

```
 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 │ W  Demo ▾  Baseline 2018 ▾  Automation ▾  Company × Spend area ▾  all flows ▾  ⚠6 ▣2 📷 ?│ 40
 ├──────────────────────────────────────────────────────────────────────────────────────────┤
 │ ●Data ─▶ ●Norm ─▶ ●Run ─▶ ●Signals ─▶ ◉Flow ─▶ ○Why ─▶ ○What to do          ⋯ All stages │ 56
 │                                          └ Board                                          │
 ├──────────────────────────────────────────────────────────────────────────────────────────┤
 │ ← Back to Where is it worst                                  [ Flow | Board ]  📷  ⋯      │ 64
 │ Explore · what changes when you select                                                    │
 │ flow type [DF2 ▾]  period [2018 ▾]  expectation area [all ▾]  group [all ▾]   Reset all   │ 40
 │ with Record Goods Receipt ×   flow type: DF2 ×              in 96,431 of 251,734 · 155,303 out│ 36
 ├──────────────────┬──────────────────┬──────────────────┬──────────────────────────────────┤
 │ ITEMS IN VIEW    │ BELOW EXPECTATION│ PRIORITY AT STAKE│ STILL OPEN                       │ 88
 │ 96,431           │ 3.1 %            │ 1,204            │ 14 %                             │
 │ 38 % of 251,734  │ all items 2.1 %  │ 38 % of all      │ all items 13.9 %              ⓘ │
 ├──────────────────┴──────────────────┴──────────┬───────────────────────────────────────────┤
 │ WHERE IN THE FLOW              [Map|Model] ⤢ ⓘ │ WHERE IS IT WORST            10 of 30  ⤢ │
 │  Request  Order   Receive  Invoice  Match  Pay │ 1 Packaging     96,431 items · 0.9 % ●   │
 │  ○→[PR]→[PO item]→[GR]═══▶[IR]→[Clear]→○       │   ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  priority 946       │
 │      ╰→[Change Qty] ▲72 %   ╰ late 96 % ╯      │ 2 Logistics      5,242 items · 5.6 % ◆   │ 296
 │                                                 │   ▇▇▇▇▇  priority 294                    │
 │  (+)(−)(⛶)  9 of 42 · legend ▤                 │ 3 Additives      3,180 items · 1.2 % ◆   │
 │ 96,431 items on the drawn paths                 │ click a group to filter · Why? on ↵      │
 ├─────────────────────────────────────────────────┼───────────────────────────────────────────┤
 │ HOW FAR OFF · invoices cleared within 30 days ⓘ │ BREAKDOWN  [flow type|period|attribute]ⓘ │
 │ here 83 days, everyone else 21 · 97 % beyond    │ DF2      ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇  3.1 %       │
 │  items ▲      ▄▄        ┊ expected ≤ 30 d       │ DF1      ▇▇▇▇▇▇▇▇          1.4 %         │ 232
 │        │   ▄▄████▄▄▄▄▄▄▄┊████▄▄▄░░░░░░░░        │ Consign. ▇▇▇▇▇             0.6 %         │
 │        └───┴────┴────┴──┊─┴────┴────┴──▶ days   │ 2-way    ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇ 9.0 %    │
 │        0   30   60   90  120  150               │ click a bar to filter · 4 of 4 shown     │
 ├─────────────────────────────────────────────────┴───────────────────────────────────────────┤
 │ Baseline 2018 · Automation · Company × Spend area · DF2 · 2 filters · 96,431 items ·        │ 32
 │ computed 5 Sep, 20:36            [ Freeze this board ]  [ Save as… ]  [ Why? Packaging → ]  │
 └──────────────────────────────────────────────────────────────────────────────────────────┘
```

The first screenful (900 px) holds the ribbon, stepper, header,
selectors, chips, the four tiles and the top of the map and ranked list;
the distribution and the breakdown are one short scroll below and are
loaded eagerly so that scrolling never waits.

### 4.3 The panel grid

Twelve columns, 24 px gutters, 32 px page margins, a row unit of 88 px
with 16 px gaps. The third release ships two fixed arrangements (this one
and a two-column variant at 1024); the panels are already written against
the contract of §5, so the later builder adds movement and configuration,
not new panels.

| Panel | Question it answers | Size (cols × units) | Chart |
|---|---|---|---|
| **KPI tiles** ×4 | how big, how far off, how much is at stake, how much is unfinished | 3 × 1 each | number, comparison line, sparkline over periods on hover |
| **Where in the flow** | where in the process does it happen | 7 × 3 | process map, `Map \| Model` toggle |
| **Where is it worst** | which groups carry it | 5 × 3 | ranked one-line cards with priority bars (the signals card of the second release §3.3, one line) |
| **How far off** | how far from the expectation, against everyone else | 6 × 2 | distribution with the expectation line and the tolerance band |
| **Breakdown** | by flow type, by period, by attribute | 6 × 2 | horizontal bars, one tab per dimension |

- Panel chrome is one line: the title as a plain question, the `ⓘ`
  explanation, `⤢` to expand the panel to the full window (the map's
  expansion is the Flow step's instrument), and — when the panel is not
  linked to the board's filter — a lock chip (§5.1).
- Every panel carries its sentence above the chart and its share of the
  source line at the foot of the board, never per panel (one context, one
  line).
- Panels never scroll internally except the ranked list (ten rows, then
  *next*) and the breakdown when it has more than twelve bars (top ten
  plus *other*).

### 4.4 The context selectors

Two rows, and they are different in kind:

- **The ribbon keeps what it already owns**: project, run, perspective,
  grouping, scope. Changing one of them changes the measure or the
  population of the whole analysis, so it stays where it is on every
  screen and is not duplicated on the board.
- **The board's own row** holds the four selectors that pick a piece of
  context inside the run: **flow type**, **period**, **expectation
  area**, **group** (the grouping's value: a spend area, a vendor, a
  company). Each is a searchable select showing the value, its item count
  and its share (*DF2 — 221,010 items · 88 %*); each writes one clause to
  the filter, so a selection made here and the same selection made by
  clicking a bar are the same chip.
- `Reset all` clears the chips but not the ribbon: context survives,
  selection does not.
- The row is sticky under the page header while the board scrolls, so the
  count and the chips are visible next to any panel.

### 4.5 What a click does

| Element clicked | Clause added | Chip | Notes |
|---|---|---|---|
| **Activity** on the map | items containing that activity | *with Record Goods Receipt* | second click on the same activity removes it |
| **Path** on the map | items with that connection (directly, for a direct path) | *Record GR → Record IR* | |
| **Stage band** | any of the stage's activities | *through the Receive stage* | |
| **Expectation arc or badge** | that expectation, violating | *invoices cleared late: violating* | *in scope* from the arc's menu |
| **End event** | closed items only | *closed items only* | the start event offers *starts with …* |
| **Group row** in the ranked list | that group | *group: Packaging* | `↵` or the row's *Why?* leaves the board for the Why screen instead of filtering |
| **Bar** in the breakdown, tab *flow type* | flow type in [DF2] | *flow type: DF2* | a second bar extends the same chip to *DF2 or DF1* |
| **Bar**, tab *period* | the period's window, on active items | *2018 Q4* | dragging across bars selects a range |
| **Bar**, tab *attribute* | that attribute value | *vendor: 0136* | the attribute is chosen in the tab's select |
| **Bin** in the distribution | the measure between the bin's edges | *cleared in 60–90 days* | dragging across bins selects a range |
| **Area beyond the expectation line** | that expectation, violating | *invoices cleared late: violating* | the same chip the arc produces |
| **KPI tile** | nothing | — | a tile is a readout; its click opens *how this is computed* |
| **Legend entry** | nothing | — | toggles an overlay; its `≡` offers the filter |
| **Chip** | — | — | click edits the clause, `×` removes it |

Rules: a click adds; the same click again removes; a click never opens a
new screen (only `↵`, a *Why?* button or a panel's `⤢` navigate); nothing
is a filter unless a chip appears for it.

### 4.6 Chips, counts and the one-second rule

- One click sends one round of requests, in parallel, all carrying the
  same canonical filter. The **counts** — the count line, the four tiles
  and each panel's headline number — are on screen within **one second**
  at 251,734 items. Chart bodies may follow, up to 2.5 s, as skeletons in
  their final size.
- While a panel is behind, its previous numbers stay, dimmed, with a
  small *updating* dot; nothing blanks and nothing jumps.
- A panel that fails answers alone: *This panel could not be computed for
  this selection.* with *Try again*, and the board stays usable.
- The live region announces once per click, naming the clause, the new
  count and the number of panels updated.

### 4.7 How panels stay comparable

The board's value is comparison, so filtering must change numbers and
never arrangement.

- **Stable layout.** The map's positions are computed once per (run,
  detail level, grouping) on the union graph — the whole run, unfiltered
  — and reused for every filtered view; filtering dims and recolours, it
  never re-lays-out. The same holds for the model: lanes and task
  positions come from the same source.
- **Stable order.** Bars keep the order of the unfiltered board (by
  items, descending); a bar whose rank would change carries a small
  `▲2` marker rather than moving. The ranked list is the exception: it is
  a ranking, so it re-ranks, and it says so — *ranked within the filter*.
- **Shared scales.** All panels that show the same measure share one
  domain, computed over the unfiltered population, so equal length and
  equal colour mean equal numbers between panels and between two boards
  of the same run. Axes do not rescale to the filtered data; when a
  filtered value would fall outside the domain the axis extends and the
  caption says so.
- **The baseline is always present.** Every panel that can show a
  comparison shows it: *all items* as the grey series behind the
  filtered one in the distribution, *all items 2.1 %* under each tile,
  the grey bar under each breakdown bar. A filtered number without its
  unfiltered twin is not shown.
- **The bins do not move.** The distribution's bin edges are computed on
  the unfiltered union and kept, so two selections can be compared by
  shape.
- **One measure per colour.** The violation ramp means the same thing on
  the map, the bars and the tiles.

### 4.8 Freeze and saved boards

- **Freeze this board** (the camera, as everywhere) captures the whole
  board as one snapshot: the image of the board region, the context, the
  chips, every panel's sentence and its numbers, and the URL. In the
  notebook it appears as one entry titled from the header sentence, with
  the chips as its subtitle, and *Open this board again* returns to the
  exact state.
- **Save as…** stores a board per project: a name, the panel arrangement,
  the context, the selectors' defaults and, optionally, the chips
  (*save with the current selection* / *save empty*). Saved boards are
  listed in the step's `⋯` and on the dashboard as one card each.
- An open saved board that has been changed shows *modified* beside its
  name with *Save* and *Reset to the saved state*. Nothing autosaves.
- A saved board is shareable as a link (context and filter in the URL);
  a person without the run sees the board's empty state naming the run
  they lack.

### 4.9 What never to show on the board

In addition to the second release §4.6:

- A pie or donut of many groups, a treemap of shares, a stacked-100 bar
  across more than three categories, any 3-D chart.
- Two measures on two y-axes; a truncated y-axis without a marked break.
- More than twelve bars without a *top ten and other* rule.
- A panel without its sentence, or a board without its source line.
- A number that has been filtered next to one that has not, unless the
  unfiltered one carries the lock chip and the word *all items*.
- Raw ids, fingerprints, hashes, run ids or endpoint names anywhere on
  the board; the *how this is computed* pop-over may show them.
- A spinner in place of a panel, a layout that reflows while numbers
  update, or an animation that moves a panel's position.
- More than one primary action on the screen: on the board it is the
  next step (*Why? Packaging →*).

### 4.10 Narrow width — 1024

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ ribbon · stepper · header (as §3.12) with [ Flow | Board ]             │
 ├────────────────────────────────────────────────────────────────────────┤
 │ flow type [DF2 ▾] period [2018 ▾] area [all ▾] group [all ▾]  Reset all│ 40
 │ with Record Goods Receipt ×  flow type: DF2 ×      in 96,431 of 251,734│ 36
 ├───────────────────────────────┬────────────────────────────────────────┤
 │ ITEMS 96,431  38 % of all     │ BELOW EXPECTATION 3.1 %  all 2.1 %     │ 76
 ├───────────────────────────────┼────────────────────────────────────────┤
 │ PRIORITY AT STAKE 1,204       │ STILL OPEN 14 %  all 13.9 %            │ 76
 ├───────────────────────────────┴────────────────────────────────────────┤
 │ WHERE IN THE FLOW                              [Map|Model]  ▤  ⤢  ⓘ   │
 │  ○→[PR]→[PO]→[GR]═══▶[IR]→[Clear]→○                                   │ 300
 │  (+)(−)(⛶)  9 of 42 · 96,431 items on the drawn paths                 │
 ├────────────────────────────────────────────────────────────────────────┤
 │ WHERE IS IT WORST  10 of 30                                       ⤢ ⓘ │ 240
 │ 1 Packaging 96,431 · 0.9 % ●  ▇▇▇▇▇▇▇▇▇  946     …                    │
 ├────────────────────────────────────────────────────────────────────────┤
 │ HOW FAR OFF · invoices cleared within 30 days                      ⓘ  │ 200
 ├────────────────────────────────────────────────────────────────────────┤
 │ BREAKDOWN [flow type|period|attribute]                             ⓘ  │ 200
 ├────────────────────────────────────────────────────────────────────────┤
 │ Baseline 2018 · Automation · DF2 · 2 filters · 96,431 items           │
 │ [Freeze this board] [Save as…]              [ Why? Packaging → ]       │
 └────────────────────────────────────────────────────────────────────────┘
```

- Panels become one column of full-width panels in the order map →
  ranked list → distribution → breakdown; the tiles pair up two by two.
- The selector row wraps to two lines and stays sticky; the chips row
  never wraps (it scrolls).
- Panel expansion (`⤢`) is the main way to read a panel at this width and
  is offered in every panel's corner.

### 4.11 Empty, loading and error states

| Situation | Sentence | Next step |
|---|---|---|
| Board opened before a run | *Nothing scored yet, so there is nothing to explore.* | Score the log |
| First load | every panel a skeleton in its final size; the map skeleton draws the lanes; the tiles show their labels | — |
| A selection with no items | *No items match these four chips. "2-way" and "with Record Goods Receipt" have nothing in common.* | Remove that chip · Reset all |
| A panel that does not apply | *This expectation does not apply to 2-way items, so there is nothing to show.* | Choose another expectation |
| Period breakdown without dates | *This run has no period column, so the period breakdown is empty.* | Map a period column |
| Slow panel (> 2.5 s) | previous numbers dimmed with *updating*; after 8 s: *Still computing. The other panels are up to date.* | Cancel |

### 4.12 The board still closes the loop

A board that only looks is a dead end, so:

- The board's single primary action is the **next step**: *Why?* on the
  group at the top of the ranked list, carrying the chips into the Why
  screen as its scope.
- Every panel's `≡` offers *freeze this panel with a note*, which writes
  into the notebook with the context and the chips.
- A finding is never written on the board; findings belong to the Why
  screen's decision pane, and the board links to it.

---

## 5. The panel contract

Written now so the later dashboard builder — a panel library, a
drag-and-resize grid, per-panel data and chart choice, saved boards — is
an addition rather than a rewrite. Every panel in §4 already obeys it.

### 5.1 What a panel declares

| Field | Meaning | Example |
|---|---|---|
| `id`, `title` | the title is the question in plain words, never a noun phrase of the method | `flow-map`, *Where in the flow?* |
| `source` | one data source with the parameters it fills from the context; a panel makes at most one request per selection | the run's flow, with slicing, detail level and filter |
| `binding` | **linked** (default: the board's filter), **fixed** (a filter frozen when the panel was configured; shows a lock chip and the words that name it), **baseline** (never filtered; the words *all items*) | linked |
| `shape` | the shape of the answer, which decides the charts allowed (§5.3) | distribution |
| `chart` | one of the kinds allowed for the shape | histogram with the expectation line |
| `sentence` | one line above the chart: what is shown and for whom, at most three numbers, no ids | *Invoices here take 83 days from receipt to clearing; everyone else 21.* |
| `source line` | run note · perspective · grouping · scope · number of filters · items · when computed; once per board, or per panel when a panel is not linked | *Baseline 2018 · Automation · Company × Spend area · DF2 · 2 filters · 96,431 items · computed 5 Sep, 20:36* |
| `emits` | the clause a click on each element adds (§4.5); a panel that emits nothing says so in its `ⓘ` | activity → items containing it |
| `size` | minimum and default columns × row units | min 4 × 2, default 7 × 3 |
| `states` | its own empty, loading, not-applicable and error sentences | §4.11 |

Two rules bind every panel: it renders from pre-aggregated numbers (no
raw events reach the browser), and it has a table alternative with the
same numbers and the same actions.

### 5.2 The panel library

Shipping in this release, with their sources:

| Panel | Source | Shape | Emits |
|---|---|---|---|
| Where in the flow | the run's flow (slicing, slice key, detail level, filter, focus) | graph | activity, path, stage, expectation clauses |
| On our model | the same scene through the model mapping | graph | the same |
| Where is it worst | the run's ranked groups (slicing, perspective, γ, minimum items, sort, filter) | rows | group clause |
| How far off | one expectation's distribution (slicing, slice key, filter, scale) | distribution | range and expectation-state clauses |
| Breakdown | the run's counts by a facet under the same filter — flow type, period, any case attribute | categories × measure | attribute and time clauses |
| KPI tiles | the run's summary and the filter preview | scalar | nothing |

Named now, added by the builder later, same contract: signals cards,
period trend, control chart, hand-over view, variant strip, case table,
notebook snapshot, text block.

Three sources are needed from the server for the board and do not exist
yet: counts by facet under the canonical filter, the four tile numbers
under the canonical filter, and the period breakdown. They take the same
filter parameter the flow and the ranked list already take, and they
return the canonical filter in their answer so the screen can print the
chips from what the server actually applied.

### 5.3 Chart kinds allowed per data shape

The builder offers only the kinds that fit the shape; the rest are not in
the menu.

| Shape | Default | Also allowed | Never |
|---|---|---|---|
| One number in context | KPI tile: number, comparison to all items, unit | tile with a sparkline over periods; a gauge when an expectation exists | a bare number; a one-value pie |
| ≤ 12 categories × one measure | horizontal bars, sorted by the measure, value at the end | dot plot; rows table; small multiples when a second dimension exists | pie, donut, treemap, stacked-100 across many categories |
| > 12 categories | top ten and *other n* | concentration curve; searchable table | thirty unreadable labels |
| Categories × two measures (here / everyone) | paired bars, here over everyone | dumbbell dots with the difference labelled | two y-axes; overlapping translucent bars |
| Distribution of one value | histogram with the expectation line and the tolerance band, both series | cumulative curve as a toggle; box plot in analyst mode | a distribution without its expectation line; a curve without its bins |
| A value over periods | line with points (≥ 8 periods), bars (< 8), slope for two | control chart with limits when the measure is monitored | smoothing; a truncated axis without a marked break |
| A graph | process map | BPMN model; table alternative | a map without legend or scale |
| Rows | table, tabular figures, at most seven columns | grouped rows | a table where a chart of the same data fits |

### 5.4 What the builder adds later

Movement and configuration only: add a panel from the library, move and
resize it on the same twelve-column grid (with keyboard equivalents:
`Alt` + arrows to move, `Shift` + `Alt` + arrows to resize), choose each
panel's data and its binding, choose its chart from the kinds allowed,
rename its title, duplicate a board, share it, freeze it into the
notebook, export it. What must not become configurable: the sentence and
the source line (every panel keeps them), the shared scales, the stable
map layout, the chip model, and the list of §4.9.

---

## 6. Release checklist and acceptance tests

### 6.1 Checklist

**The Flow step**
- [ ] The map frame covers ≥ 60 % of a 1440 × 900 viewport at load and
      ≥ 50 % at 1024 × 768; no box floats over the drawing except the
      zoom controls.
- [ ] The graph is fitted with no empty band; every drawn label is
      readable at the fitted zoom.
- [ ] The filter bar shows items in and out, chips, the detail slider
      with its count, the rendering toggle and full window — and nothing
      else.
- [ ] Every action of §3.6 works end to end on the served build against
      the live backend, and each one changes the count, a chip and the
      live region — including the actions that remove no item.
- [ ] *Paths in / out* lists paths from the full relation and names the
      ones hidden at the current detail.
- [ ] Full window fills the viewport and `Escape` leaves it.
- [ ] `Model` shows the same overlays, the same selection and the same
      stage order as `Map`, and exports BPMN 2.0.
- [ ] The whole screen is operable from the keyboard, with focus visible
      and every result announced.
- [ ] Empty, loading and error states as §3.11, each with a next step.

**The board**
- [ ] One click updates every panel's count within one second, with one
      round of requests and one announcement.
- [ ] Chips are the only filter state; removing the last chip restores
      the unfiltered board exactly.
- [ ] The URL reproduces the board: context, chips, selectors, panel
      expansion.
- [ ] Scales, bin edges and map positions come from the unfiltered
      population; nothing is re-laid out or re-sorted by a filter, except
      the ranked list, which says it is ranked within the filter.
- [ ] Every panel has its sentence; the board has its source line; no
      ids, no hashes.
- [ ] Freeze captures the whole board; a saved board reopens identically
      and shows *modified* after a change.
- [ ] Nothing from §4.9 is on the screen.

### 6.2 Acceptance tests

Run with five readers who have not read the method and one analyst, on
the served build with the live backend and the public log; record time
and outcome. A test passes at four of five readers unless stated
otherwise; the measured tests (F1, F3, B1, B2, B4) must pass every time.

| # | Test | Procedure | Pass criterion |
|---|---|---|---|
| **F1** | **The map is the screen** | Load the Flow step at 1440 × 900 and measure the map frame's bounding box. | Frame area ÷ viewport area ≥ 0.60 at load, with the activity card open; ≥ 0.50 at 1024 × 768; the drawing is fitted (no empty band wider than 8 % of the frame on any side). |
| **F2** | **An action does something** | "Show only the items that pass through Record Goods Receipt." | Within one second: the count changes to 108,930 of 251,734, a chip appears, the map re-renders, the announcement is made; the reader can say what happened. Repeat with an activity that removes no item: the chip appears and the count line says *no items removed*. |
| **F3** | **Every path is reachable** | Select Change Quantity and ask for its paths in and out. | The path list names every path of the activity from the full relation; those not drawn are listed as hidden at this detail with a control that shows them. No reader sees "no paths". |
| **F4** | **Full window** | "Make the map as large as you can, then go back." | The reader finds `⤢` or presses `F`, the map fills the viewport, `Escape` returns, and the zoom and selection survive both ways; under 20 s. |
| **F5** | **The model** | "Show this on our process model." | `Model` renders the diagram with the same overlays; the selected activity is still selected and visible; the reader can name one task that is missing from the model; switching back changes nothing else. |
| **F6** | **Keyboard only** | With the mouse unplugged: reach the map, focus Record Goods Receipt, filter to it, undo the filter. | Completed with the keyboard alone, every step announced; under 60 s for the analyst. |
| **F7** | **Deep link** | Paste a Flow URL with two chips, a selection and `detail=3` into a fresh tab. | The screen reproduces exactly, the back control names its origin, the stepper marks Flow. |
| **B1** | **One click moves everything** | On the board, click the activity Record Goods Receipt on the map. | Within **one second** the count line, all four tiles, the ranked list's headline count, the distribution's caption and the breakdown's numbers all show the filtered values; one chip appeared; one announcement was made; no panel is blank and no panel moved. |
| **B2** | **A chip restores** | Remove the chip added in B1. | Every panel returns to the values it had before B1, number for number; the URL returns to the pre-click URL; under one second. |
| **B3** | **Two selections read as OR** | Click DF2, then DF1 in the breakdown. | One chip reads *flow type: DF2 or DF1*; the count is the sum of the two; clicking DF2 again leaves *flow type: DF1*. |
| **B4** | **The model keeps positions comparable** | With a filter and a selection active, switch the board's map panel to `Model` and back. | The stage order, the selection and every chip are unchanged; the selected activity is in view in both; the mapped task's overlay value equals the map's badge value; no new request is issued. |
| **B5** | **Comparability** | Filter to DF2 and read the breakdown and the distribution. | Bars keep the unfiltered order (rank changes marked, not moved), the bin edges are unchanged, every panel shows its *all items* twin, and the axis domains are the unfiltered ones. |
| **B6** | **Five-second board** | Show the board for five seconds, then hide it; ask: how many items are in view, how far off are they, where in the flow does it happen, which group is worst. | Three of four answers correct per reader. |
| **B7** | **Freeze and return** | "Keep this board for a report with one remark, then find it again." | Snapshot with the note in the notebook; *Open this board again* restores context, chips and panel arrangement; under 90 s. |
| **B8** | **Save and share** | Save the board as *Late clearing, DF2*, change a selector, reset, and send the link to the analyst. | The saved board reopens identically for both people; after the change it reads *modified*; *Reset to the saved state* restores it. |

Measured with every release: the time from a click to the last panel's
count (target ≤ 1 s at 251,734 items, ≤ 2.5 s for chart bodies), the map
frame's share of the viewport, the number of actions that produce no
visible change (target 0), the number of readers who reach the Flow step
without help, and the number of boards saved per project.
