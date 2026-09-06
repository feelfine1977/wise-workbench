# WISE Workbench — Visualisation and UI/UX design panel

*Joint report of a dedicated design team: a product designer for
analytical tools, an interaction designer for data-heavy interfaces, an
information designer (visual analytics), a design-system and accessibility
engineer, and a service designer for workshops. The process-flow and BPMN
specialist's technical report is `visualisation_specialist.md`; this
report covers the experience around those visuals and the product as a
whole. Date: 2026-09-05.*

## 0. Panel verdict

The product's value is a defensible, explainable backlog that people act
on. The interface must therefore make three things effortless at every
step: **see the evidence behind a number**, **know which decision is
mine**, and **compare** (slice vs rest, period vs baseline, norm vs norm).
Everything else — the method's vocabulary, the parameters, the assistant —
is revealed progressively. The panel's suggestions are numbered UX-1 to
UX-30 in §9 with tiers; the ten marked MVP are conditions for a usable
first release, not polish.

## 1. Users and contexts

| Context | Who | Constraints the design must respect |
|---|---|---|
| Desk analysis | analyst, Black Belt; large screens, keyboard-heavy, hours at a time | density, keyboard navigation, linked views, undo, persistent context |
| Owner review | process owner on a laptop, 20 minutes, arrives from a link | the link lands on a self-explaining screen: what, how bad, since when, what is asked of me |
| Workshop | facilitator with a projector; 6–10 participants | presenter mode: large type, one decision per screen, dispositions recorded live, no parameter panels |
| Sponsor reading | governance pack on a tablet or paper | exported figures with captions, run ids, method appendix; no interactive-only meaning |

## 2. Information architecture and navigation

- **Journey rail** (left): the twelve stages as a stepper with states *not
  started / in progress / gated / done*; a gated stage shows why (data
  readiness, censoring, replication) and where to fix it. Stages can be
  visited in any order; the rail records where evidence is missing rather
  than blocking exploration.
- **Context ribbon** (top, always visible): project · dataset version ·
  mapping version · norm version · run · view · slice key · period. Every
  element is a switcher; changing one re-scopes the screen and the URL.
  Nothing on a screen is ambiguous about its inputs.
- **Command palette** (`⌘K`): jump to a slice, constraint, case, finding,
  action or screen; run commands ("re-score with γ = 30", "export pack").
- **Job tray** (bottom right): running and finished jobs with progress,
  cancel, and "open result".
- **Three view modes** everywhere a result appears: *Explore* (dense,
  interactive), *Review* (presenter mode), *Report* (print layout preview).

## 3. Screen concepts

### 3.1 Backlog explorer (S6)

```
┌ context ribbon ──────────────────────────────────────────────────────┐
│ P2P 2018 · log v3 · map v2 · norm v7 (approved) · run 41 · view: Ops · by: vendor · period: 2018 ▾ │
├───────────────┬──────────────────────────────────────────────────────┤
│ filters       │  volume × gap scatter (whiskers = bootstrap)  [pin ⚲] │
│ hotspot type  │  ● ● ●            ▲ concentration curve (top 10 = 48%) │
│ stability     ├──────────────────────────────────────────────────────┤
│ layer         │ rank │ slice        │ n   │ gap  │ PI  │ type   │ stab │
│ owner         │  1   │ vendor 0128  │ 945 │ .18  │ 170 │ severity│ ●●● │
│ min cases     │  2   │ vendor 0093  │ 294 │ .21  │  62 │ mechanism│ ●●○ │
│               │  …   │              │     │      │     │        │      │
│ [review mode] │ row hover → sparkline (gap by month), dominant layer   │
└───────────────┴──────────────────────────────────────────────────────┘
```

Rules: numbers carry a formula popover (UX-3); the typology badge has a
one-line reading; the stability dots come from the bootstrap; pinning up
to three slices opens a comparison strip; the URL holds every filter.

### 3.2 Slice detail (S6–S8)

Header with the reading sentence ("945 cases · gap 0.18 · driven by
*change discipline*; 62 % of the penalty from three constraints"). Then a
tabbed evidence area: **Drivers** (gap waterfall, layer bars vs global,
penalty Pareto), **Flow** (process map with overlays and the diff toggle),
**Distributions** (ECDF slice vs rest with threshold markers), **Cases**
(worst cases → trace timeline), **Validation** (gates with evidence),
**Headroom**. A right-hand *decision pane* holds the finding form
(hotspot-type override with note, disposition, owner, hypotheses) — the
only place where the analyst writes, and it never scrolls away.

### 3.3 Norm builder (S3–S4)

Three panes: catalogue (layers → constraints, drag to reorder, status
chips), editor (type-specific form on the left, live evidence on the
right: distribution with draggable ϑ and W, live share of cases in scope
and violating, "sentence" preview in plain language), views & weights
(matrix with row/column totals and an agreement preview). A **model tab**
shows the BPMN reference model with the current norm's constraints pinned
to tasks and flows (visualisation V3); selecting on the model pre-fills
the editor (v1, V4). Every save creates a version with a note; the diff
view reads like a changelog, not a JSON diff.

### 3.4 Review session (S6/S8, presenter mode)

Full-screen, one slice per screen: reading sentence, three evidence
panels (waterfall, map or distribution, worst case), the validation
status, and four disposition buttons (*investigate, defer, waive, not a
hotspot*) with a mandatory note and the names of those present. A session
summary lists dispositions and open items and exports to the pack.

### 3.5 Owner portal (S8–S10)

A landing page per owner from a link: "your slices" with trend
sparklines, open actions, gates awaiting evidence, and the last review's
notes; no parameters, no JSON, no assistant unless enabled.

## 4. Interaction patterns

| Pattern | Where | Detail |
|---|---|---|
| Explain this number | every metric | popover: formula, inputs with links, uncertainty, caveats |
| Direct manipulation of thresholds | distribution lens, norm editor | drag ϑ and W on the histogram; the violation share updates live; commit creates a version |
| Linked highlighting | map ↔ table ↔ charts ↔ traces | hover or select a constraint, activity, slice or case and every view highlights it |
| Pin and compare | backlog, slices, periods, norms | up to three pinned objects in a comparison strip with a stable layout |
| Progressive disclosure | parameters, method terms | defaults visible as chips ("γ = 50 · layer-balanced"), details behind one click, never in the way |
| Undo and versions | norm, mapping, findings | undo within a session; explicit versions with notes across sessions |
| Guard rails, not walls | gates | a failed gate shows evidence and what would pass; hypotheses can be drafted but are marked "blocked by gate" |
| Confirmation with note | human decisions | thresholds, weights, γ, exclusions, overrides, waivers, re-baselining ask for a one-line reason; nothing else asks |
| Next best action | empty states, stage end | one suggested step with a reason, one alternative |
| Keyboard-first tables | backlog, cases, constraints | arrows, enter to open, `p` pin, `f` finding, `/` filter |

## 5. Vocabulary and microcopy

- Descriptive, never causal: "coincides with", "driven by (in the score)",
  "candidate cause (from the knowledge base)"; "root cause" only after
  a validated hypothesis, written by a person.
- One-sentence definitions for method terms on first use per session
  ("gap: how far this slice's mean score is below the overall mean");
  glossary in the help drawer; the same sentences in `en` and `de`.
- Numbers: two significant figures in prose, full precision in tables and
  popovers; counts before rates ("945 cases, 18 % violating").
- Assistant text is visually distinct (card with source chips) and never
  styled like system text.

## 6. Design system

- Tokens: 4 px spacing scale, 8-step type scale with tabular numerals,
  radii 4/8, three elevations, motion 120/200 ms, density modes
  *comfortable* and *compact*.
- Type: a humanist sans with tabular figures (e.g. Inter or IBM Plex Sans)
  for UI, a monospace for ids and JSON.
- Colour: neutral UI palette; semantic scales — sequential (violation
  share, score), diverging (deltas), categorical per layer (stable by
  hashed layer id, max 8), fixed colours for three hotspot types and four
  gate states; every colour has a pattern or glyph twin; light and dark
  themes; print theme (greyscale-safe).
- Components (on shadcn/ui): metric with popover, badge set (hotspot,
  stability, gate, status), evidence card, decision pane, comparison
  strip, context ribbon, journey rail, job tray, reading sentence,
  distribution lens, table shell; visual components from `@wise/flow`.
- Figma: one library file with tokens synced from `packages/design-tokens`
  (Tokens Studio), one file per journey stage; design reviews use the
  checklist in §10.

## 7. Accessibility and inclusivity

WCAG 2.2 AA: keyboard operability for maps, tables and charts; visible
focus; ARIA descriptions and a table alternative for every visual;
contrast ≥ 4.5:1; no colour-only meaning; reduced-motion respected;
resizable text without loss; screen-reader announcements for job events;
touch targets ≥ 24 px in presenter mode; language attributes for `en`/`de`.

## 8. Onboarding, help and workshops

- First project in ten minutes on a public log preset (BPIC 2019 with the
  reference norm): the journey rail guides, each screen has a "method
  card" (what this is, what to decide, what to ignore now).
- Help drawer: glossary, method primer with the paper's formulas rendered,
  keyboard map, "why is this gated" explanations.
- Workshop kit: presenter mode, annotation layer on maps, parking lot,
  timer, attendance and dispositions, minutes export; a facilitator
  checklist per stage from the process panel's playbooks.

## 9. Suggestions

| ID | Suggestion | Tier |
|---|---|---|
| UX-1 | Context ribbon with switchers and URL state on every screen | MVP |
| UX-2 | Journey rail with gate states and "why gated" | MVP |
| UX-3 | "Explain this number" popover on every metric | MVP |
| UX-4 | Reading sentence at the top of backlog rows and slice detail | MVP |
| UX-5 | Decision pane that never scrolls away; mandatory notes only for human decisions | MVP |
| UX-6 | Distribution lens with draggable ϑ and W and live share | MVP |
| UX-7 | Linked highlighting across map, table, charts and traces | MVP |
| UX-8 | Pin and compare (three objects) with stable layouts | MVP |
| UX-9 | Presenter (review) mode with dispositions and attendance | MVP |
| UX-10 | Public-log onboarding with method cards | MVP |
| UX-11 | Owner portal landing from a link | v1 |
| UX-12 | Command palette | v1 |
| UX-13 | Norm diff as a changelog | v1 |
| UX-14 | BPMN model tab in the norm builder; authoring on the model | v1 |
| UX-15 | Workshop kit: annotation layer, parking lot, minutes | v1 |
| UX-16 | Density modes and dark theme | v1 |
| UX-17 | Report preview mode with figure captions and run ids | v1 |
| UX-18 | Glossary and bilingual method sentences | MVP (en) / v1 (de) |
| UX-19 | Keyboard map and full keyboard operability of maps | v1 |
| UX-20 | Assistant cards visually distinct with source chips and accept/edit/reject | v1 |
| UX-21 | Empty states with next best action | MVP |
| UX-22 | Job tray with cancel and "open result" | MVP |
| UX-23 | Comparison strip for periods with baseline note | v1 |
| UX-24 | Small multiples in backlog rows | v1 |
| UX-25 | Print and greyscale-safe theme | v1 |
| UX-26 | Figma library synced from design tokens | Phase 0 |
| UX-27 | Usability test rounds (5 analysts) at MVP and v1; task metrics | MVP / v1 |
| UX-28 | Design review checklist enforced in PR template | Phase 0 |
| UX-29 | Localisation of number and date formats via `Intl` | MVP |
| UX-30 | Touch-friendly presenter mode for tablets | v2 |

## 10. Design review checklist and metrics

Checklist per screen: context ribbon present; every number explainable;
human decisions ask for a note, nothing else does; colour has a twin;
keyboard path exists; table alternative exists; empty, loading and error
states designed; reading sentence uses the descriptive vocabulary;
exported figure carries caption and run id.

Metrics: time to first backlog on a public log (target ≤ 30 minutes for a
new analyst), task success on "find the driver of slice X" (≥ 90 %),
review-session throughput (slices per hour), share of dispositions with
notes (100 % by construction), SUS ≥ 75 at v1, zero colour-only findings
in accessibility audits.

## 11. Risks

Method vocabulary overwhelms first-time users (method cards, progressive
disclosure); dense screens fail in workshops (presenter mode is a separate
layout, not a zoom); comparison views mislead when layouts move (stable
layout is a hard requirement on `@wise/flow`); the assistant's text blends
with evidence (distinct cards, source chips); design debt when components
are built ad hoc (design system and checklist from Phase 0).
