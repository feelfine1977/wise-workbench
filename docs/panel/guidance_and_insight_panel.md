# Guidance, insight and visualisation — panel discussion on the owner's findings

*Panel: a process-improvement lead (Lean Six Sigma Master Black Belt), a
procurement process owner, a procurement clerk, an analyst who has never
read the WISE paper, a process-mining expert, a visual sense-making
expert, a UI/UX designer. Date: 2026-09-05. Trigger: the owner tried the
backlog explorer and slice detail of increment 0 and reported that it is
hard to know what to look for, and that "type", "stability" and "dominant
layer" mean nothing to someone who does not know WISE.*

## 0. What went wrong, in the panel's words

**Process owner.** "I opened a table with eleven columns. I recognised the
vendor names. Everything else — gap, stable gap, PI, stable PI, type,
dominant layer, dots — I had to guess. Nobody told me what question this
table answers."

**Analyst (no WISE background).** "I understood that rows were ranked, but
not by what. I assumed the top row was the worst vendor. Then I saw a
vendor with 127 cases labelled *severity* above thousands of cases labelled
*mechanism* and lost confidence in my assumption."

**Master Black Belt.** "In DMAIC terms the screen skips Define and Measure
and drops the user into Analyse with the analyst's instruments. Any
improvement tool must start with the pain: which part of the process
hurts most, how much, how sure are we, then why, then what to do."

**Visual sense-making expert.** "The eye lands on the numbers with the
most decimals, which are the least meaningful ones for a newcomer. The
scatter plot competes with the table for attention and neither says what
the axes mean for the business."

**Process-mining expert.** "The method is sound: slices, expectations,
shortfall, priority with shrinkage, drivers. The presentation exposes the
machinery instead of the reading. Every one of those terms has a plain
sentence behind it. We never showed the sentence first."

**UI/UX designer.** "There is no first click. The screen offers forty
controls and no path. A guided path with three steps and plain words does
not dumb the method down; it orders it."

The panel's diagnosis, in one line: **the application answers "what does
WISE compute" when the user asks "what is wrong, why, and what can I
do".**

## 1. Principle: three questions, plain words first, method terms second

Every result screen serves three questions in this order, and every
element on it belongs to exactly one of them:

| Question | What the user needs | Method behind it |
|---|---|---|
| **Where is it worst?** | a ranked, short list of groups with a plain sentence each: how many cases, how far off, what kind of problem, how sure | slices, gap, priority with shrinkage, hotspot typology, bootstrap stability |
| **Why?** | which expectations are missed and how much of the shortfall each explains; where in the flow; how this group differs from the rest in real units; what kind of cases; whether the data can be trusted; typical causes for this pattern and what to check | constraint and layer drivers, contrast, distributions, sub-groups, readiness and gates, knowledge-base failure modes |
| **What can we do?** | improvement options for this pattern, what each would gain, who owns it, the next step | remedies from the catalogue, headroom, what-if, actions and hypotheses |

Rules:

- Plain language is the primary label everywhere; the method term appears
  in a muted secondary style with a one-sentence definition on hover, and
  a **vocabulary switch** (plain / method) in the ribbon lets analysts
  flip. Guided mode is plain-only.
- Every number a person sees is inside a sentence or next to a plain
  label; no bare column of decimals as the first thing on a screen.
- The ranking rule is written on the screen in one sentence ("ranked by
  how many cases × how far below expectation, with small groups discounted").
- Each screen opens with a one-paragraph "how to read this" that can be
  collapsed and reopened.

## 2. The plain-language layer

| Method term | Plain label | One-sentence definition (hover) |
|---|---|---|
| slice | group | a set of cases that share a value, e.g. one vendor or one spend area |
| constraint | expectation | a rule the process is expected to follow, e.g. "invoice cleared within 30 days of receipt" |
| layer | expectation area | a family of expectations, e.g. timeliness, completeness, change discipline |
| view | perspective | whose expectations count and how much, e.g. Finance or Logistics |
| violation share | cases missing the expectation | the share of cases in the group that do not meet the rule |
| score | how well a case meets expectations (0–1) | 1 means every applicable expectation is met |
| gap | shortfall | how far the group's average is below the overall average |
| stable gap | shortfall, small groups discounted | the shortfall after pulling small groups towards the average (γ) |
| PI | priority | shortfall × number of cases: how much is at stake |
| stable PI | priority, small groups discounted | the priority used for ranking |
| γ | caution against small groups | how strongly small groups are pulled towards the average |
| hotspot type: severity | **acute**: few cases, far off | a small group with a large shortfall |
| hotspot type: mechanism | **systematic**: one pattern behind it | a group whose shortfall comes from one recurring expectation area |
| hotspot type: reservoir | **widespread**: many cases, slightly off | a large group with a small shortfall each, big in total |
| stability: stable | high confidence in the rank | the rank held in at least 80 % of resamples |
| stability: fragile | medium confidence | the rank moved in resamples |
| stability: insufficient support | not enough cases to be sure | fewer cases than the rule needs |
| dominant layer | most-missed expectation area | the expectation area that explains most of the shortfall |
| driver | expectation behind the shortfall | one missed expectation and how much of the shortfall it explains |
| contribution | share of the shortfall | how much of the shortfall this expectation accounts for |
| applicability | applies to | which cases an expectation is meant for |
| in scope | counted | cases the expectation applies to |
| right-censored | still open at the end of the data | cases that had not finished when the data was extracted |
| replication | duplicated events | the same event copied onto several cases (e.g. a header line) |
| headroom | possible gain | how much the group would improve if this expectation were fully met |
| readiness | data caveats | what in the data could distort the results |

Worked example of a plain sentence card (numbers from run
`run_0mtoq44vd14f208ur`, company × spend area, Automation, γ = 20):

> **Packaging** · 109,199 order items · 0.9 % below expectation on average
> · **widespread**: many cases, slightly off · mostly **timeliness and
> ageing** (invoices cleared late) · confidence in rank: high · priority
> 945.7, rank 1 of 30.

> **Workforce Services** · 127 order items · 11 % below expectation · **acute**:
> few cases, far off · mostly **flow discipline** (invoice before goods
> receipt in a three-way match) · confidence: not enough cases to be sure ·
> priority 12.5, rank 9.

The two cards explain in one glance why a group with 127 cases sits below
one with 109,199 and why the second still deserves attention.

## 3. The guided path: signal → reason → remedy

### 3.1 "Where is it worst?" — the signals list

- A ranked list of sentence cards (§2), ten per page, with a short bar for
  priority, a colour and a glyph for the kind of problem, and a confidence
  mark. The scatter plot moves to a secondary tab ("see all groups at once").
- One line under the title states the ranking rule and the perspective in
  plain words, with a switch for perspective (Finance / Logistics / …) and
  for the grouping (vendor / spend area / flow type).
- Filters phrased as questions: "only groups with at least … cases", "only
  problems about … (expectation area)", "only widespread / systematic /
  acute", "only high-confidence ranks".
- Every card has one button: **Why?**

### 3.2 "Why?" — the reason chain

One screen, five blocks, each with a plain heading and a sentence:

1. **Which expectations are missed.** The top three expectations with the
   share of cases missing them and the share of the shortfall they
   explain, as a horizontal bar list ("Invoice cleared within 30 days —
   missed in 42 % of cases — explains 61 % of the shortfall"). The full
   waterfall sits behind "show all".
2. **Where in the flow.** A small process map with the activities of those
   expectations highlighted and the lag arcs marked; clicking opens the
   activity panel (waiting, loops, deterministic or not).
3. **Compared with everyone else.** For each top expectation the real-unit
   comparison: "invoices take 63 days here vs 21 days elsewhere"; a
   two-colour distribution strip with the expectation line drawn.
4. **What kind of cases.** Sub-groups inside the group that carry the
   shortfall (flow type, material group, document type), with counts.
5. **Can the data be trusted?** The readiness caveats that touch this group
   in plain words ("14 % of these cases were still open when the data was
   extracted; late invoices may be a data artefact") and the gate status.

Below: **Typical causes for this pattern** from the knowledge base,
labelled as candidates to be checked, each with "evidence to check" as a
checklist, and a button **What can we do?**

### 3.3 "What can we do?" — the remedy screen

- **Options** from the failure-mode catalogue for the missed expectations,
  each with the mechanism, the owner role, and the **possible gain** from
  headroom in plain words ("if invoices for Packaging were cleared within
  30 days, the shortfall of this group would fall by 60 %").
- **What if** sliders for the scenarios the process expert defined (cap a
  lag, remove a change activity, move a flow type), with the outcome in the
  same sentence form.
- **Next step**: create an action with owner and due date, record a
  hypothesis to test, or add the group to the next review session.
- **Similar situations** from earlier projects when they exist.

## 4. Visualisations that serve the questions

| Question | Show first | Show on demand | Do not show first |
|---|---|---|---|
| Where worst | ranked sentence cards with priority bars, kind-of-problem colour and confidence marks; small multiples of shortfall over time per card | scatter of size × shortfall; concentration curve; agreement between perspectives | the raw table with eleven metric columns |
| Why | horizontal bar list of missed expectations with plain sentences; mini flow map with highlights; two-colour distribution strips with the expectation line; sub-group bars; caveat chips | full waterfall; layer bars vs global; penalty Pareto; ECDF overlays; trace timelines | formulas, contribution decimals |
| What to do | option cards with possible-gain bars; what-if sliders with sentence outcomes; action cards | headroom table; sensitivity envelopes | parameter panels |

Visual rules from the sense-making expert: one dominant element per
screen; colour means one thing per screen (kind of problem on the list,
missed vs met on the reason screen, gain on the remedy screen); every axis
has a plain label with the unit; expectation lines are drawn on every
distribution; the group is always shown against "everyone else"; text
before charts, charts before tables.

## 5. Onboarding and help

- First visit: a sixty-second walk on the BPIC 2019 example (three
  screens, one sentence each) that ends on a real signals list.
- "How to read this" paragraph on every screen, collapsible, reopened
  from a `?` in the title.
- Method cards per screen for Analyst mode: what is computed, what to
  decide, what to ignore now; the glossary holds both vocabularies.
- Empty and error states in plain words with the next step.

## 6. Modes

Guided mode (default for a new user and for owners and clerks): plain
vocabulary only, the three-screen path, no parameters. Analyst mode: both
vocabularies with the switch, the full journey and instruments. Data
expert: as designed. The vocabulary switch and the guided path are the
first two things to build, before any new analytic.

## 7. Requirements

| ID | Requirement | Acceptance | Priority | Cycle |
|---|---|---|---|---|
| RG-1 | Plain-language vocabulary layer with the translation table of §2, a ribbon switch plain / method, and method terms as muted secondary labels with hover definitions | five people without WISE knowledge read a signals card and answer "how many cases, how far off, what kind of problem, how sure" correctly | P1 | 1 (resume) |
| RG-2 | Signals list as the default backlog view: sentence cards, priority bars, kind-of-problem glyphs, confidence marks, ranking rule in one line, filters phrased as questions; table and scatter as secondary tabs | first-click test: a newcomer clicks **Why?** on the top card without help | P1 | 1 (resume) |
| RG-3 | "Why?" reason chain screen (§3.2) with the five blocks and the knowledge-base candidate causes and evidence checklist | the top expectation, its real-unit comparison and one caveat are visible without scrolling | P1 | 2 |
| RG-4 | "What can we do?" screen (§3.3) with options, possible gain from headroom in sentences, what-if sliders for defined scenarios, next-step actions | a process owner creates an action from an option in under two minutes | P1 | 2 |
| RG-5 | "How to read this" paragraph on every screen; method cards in Analyst mode; glossary with both vocabularies | every screen has the paragraph; the glossary covers the §2 table | P1 | 2 |
| RG-6 | Readiness caveats rendered as plain chips on cards and on the reason screen | the censoring and replication caveats of BPIC 2019 appear on the Packaging card | P1 | 2 |
| RG-7 | Kind-of-problem labels renamed in the data model and tokens: acute / systematic / widespread, with the method names kept as aliases | contract, backend, frontend and knowledge packs use the new labels; tests pass | P1 | 1 (resume) |
| RG-8 | Sub-group block on the reason screen (flow type, material group, document type inside the group) | sub-groups with counts and shortfall shown for the Packaging slice | P2 | 3 |
| RG-9 | Sixty-second onboarding walk on BPIC 2019 | a new user reaches the signals list after three screens | P2 | 3 |
| RG-10 | Vocabulary and comprehension test as part of every cycle's panel review: five readers, three questions per card, target ≥ 80 % correct | the review reports the score | P1 | every cycle from 2 |
| RG-11 | Assistant narration and answers use the plain layer by default and the method layer in Analyst mode | golden narratives pass the vocabulary check in both layers | P2 | 4 |
| RG-12 | Visual redesign per §4: one dominant element per screen, one meaning per colour per screen, expectation lines on every distribution, text before charts | the visual sense-making review scores ≥ 4 on the three screens | P2 | 2 |

## 8. What this changes in the plan

- `CUSTOMER_JOURNEY.md` §8: plain language first, method terms second,
  translation table §2 is normative.
- Cycle 1: the integration workstream's frontend work includes RG-1,
  RG-2 and RG-7; the panel's review includes the comprehension test.
- Cycle 2: RG-3 to RG-6 and RG-12 join the O2C work.
- The audience modes (`APP_MODES.md`) take Guided as the default for new
  users.
