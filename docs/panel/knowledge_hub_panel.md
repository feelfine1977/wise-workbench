# Stakeholder guidance on layers and a knowledge hub per process — panel discussion

*Panel: SAP P2P process expert, procurement process owner, procurement
clerk, Lean Six Sigma Master Black Belt, process-mining expert, knowledge
and assistant specialist, UI/UX designer. Date: 2026-09-06. Trigger: the
owner's input that stakeholders should, when they define layers, also say
what is expected and what the layer means (for example "maverick buying"
with an explanation), and that each process type should have a knowledge
hub with a sequence of "what exactly this means → what is usually the
reason → what is usually the action to improve".*

## 0. Where the gap is

The knowledge packs (`packages/process-knowledge`) already hold failure
modes with a signature, typical causes, remedies and evidence to check.
Two things are missing. First, the **layers and expectations of a norm
carry no guidance of their own**: a layer is a name and a weight, an
expectation is a rule with a threshold; nobody wrote down what the
stakeholders meant by it, why it matters and what it means when it is
missed. Second, there is **no place in the application where a person
reads the chain** meaning → usual reasons → usual actions for the thing in
front of them; the chain is scattered over the reason screen, the
catalogue and the glossary.

**Process owner.** "When the analyst said 'flow discipline', I nodded. I
would have said 'maverick buying'. Those are the same thing to me, and I
want the tool to say it my way and tell me what it usually comes from."

**Clerk.** "Show me one order that broke the rule and what I should have
done in the system. Then I understand the rule."

**Master Black Belt.** "Usual reasons are hypotheses, not findings. Fine —
as long as the hub says so and lists what to check. The action list
should name the countermeasure type: policy, system setting, standard
work, training, catalogue, contract."

**Process-mining expert.** "Every 'usual reason' must say whether the log
can show it. Missing framework contract: visible through vendor and
document type. Requester in a hurry: not in the log; mark it 'outside the
log, ask'."

**Knowledge and assistant specialist.** "This is the knowledge graph we
designed, given a face. The hub pages are the digests the assistant will
read; if people write them, the assistant explains in their words."

**SAP P2P expert.** "I can seed all seven layers of the paper's norm and
every constraint in P2P. Maverick buying, invoice before goods receipt,
price changes after ordering, payment blocks — each has a well-known
story: what it is, where it comes from, what buyers do about it."

**UI/UX designer.** "One template for every page in the hub, one paragraph
per block, the same order everywhere, reachable from any card, driver or
layer in one click, and editable by the people who own the process."

## 1. The guidance object

Guidance is a structured text block attached to a **layer**, an
**expectation** (constraint or constraint pattern), a **failure mode** and
a **process template**, in two tiers: the pack's generic guidance
(reviewed, versioned with the pack) and a **project overlay** written by
the company's stakeholders ("in our company this is usually …"), with
author, date and review status. Both tiers have the same blocks:

| Block | Question it answers | Example (layer *flow discipline*, plain name *buying channel and sequence*) |
|---|---|---|
| `plain_name` | what the stakeholders call it | "Maverick buying and out-of-sequence invoicing" |
| `expectation` | what is expected, one sentence | "Purchases go through a requisition and an approved purchase order before the invoice arrives, and invoices follow the goods receipt in three-way flows." |
| `meaning_when_missed` | what it means when the expectation is missed | "Goods or services were bought outside the agreed channel, or invoices were processed before delivery was confirmed; the purchase order was created after the fact to pay the invoice." |
| `why_it_matters` | the business consequence | "Off-contract prices, no leverage over the vendor, payment for goods not received, audit findings; effort in accounts payable to repair documents." |
| `how_detected` | which expectations and thresholds detect it, in plain words | "Invoice before goods receipt in three-way flows; purchase order created after the invoice date; item without requisition or shopping cart." |
| `usual_reasons` | candidate causes with evidence in the log or outside it | "Urgent needs bypass the requisition (check: share of orders with invoice date before PO date, by requester and material group); catalogue does not cover the item (check: free-text items, spend area); approvals take too long (check: requisition-to-PO lag); vendor relationship held by the requester (outside the log: ask)." |
| `usual_actions` | improvement actions with countermeasure type and owner role | "Catalogue coverage for the top free-text items (catalogue, purchasing); guided buying with approval SLAs (system setting, IT and purchasing); no-PO-no-pay policy with exceptions list (policy, finance); framework contracts for recurring off-contract vendors (contract, category management)." |
| `what_to_check_first` | the first three checks | "Share by requester and vendor; whether after-the-fact POs cluster in one spend area; whether the invoices were still paid on time." |
| `examples` | a violating case and a compliant case in words, with a link to a trace | "PO 4507xxxxxx item 10: invoice received 12 days before the goods receipt; cleared after a block was removed." |
| `kpis` | related indicators | "Touchless rate, share of POs after invoice, three-way match first-time rate." |
| `owner_role` | who is usually accountable | "Purchasing; category management." |
| `stakeholders` | who defined the layer and who owns the guidance | "Defined by the procurement lead and the AP manager on 2026-09-06; owner: procurement lead." |
| `sources` | references | "BPI Challenge 2019 reports; SAP MM documentation; internal policy P-12." |

Rules: plain language first, method term second (`guidance_and_insight_panel.md`
§2); every "usual reason" says *in the log* (with the check) or *outside the
log* (ask whom); actions name a countermeasure type; readings stay
descriptive; the norm's version records which guidance version it was
written with.

## 2. Where the guidance lives

- **Norm files**: the library's norm JSON keeps its schema; guidance
  travels in the norm's `metadata.guidance` block keyed by layer id and
  constraint id, so a norm exported from the app carries its stakeholders'
  words. Templates in the packs ship with the generic tier filled.
- **Knowledge packs**: `guidance.yaml` per pack with entries for every
  layer of the pack's templates, every constraint pattern and every
  failure mode, validated by a JSON Schema; the graph builder links them.
- **Project overlay**: stored with the project (metadata database),
  versioned, with review status draft / reviewed / approved; shown above
  the generic tier with "your organisation's note".

## 3. The knowledge hub

One hub per process type, one page per node, one template for every page:

```
[plain name]                                          [method term · id]
What this means · Why it matters · How we detect it
What usually causes it (in the log: check … | outside the log: ask …)
What usually helps (countermeasure type · owner role · expected effect area)
What to check first · Examples (a violating case, a compliant case)
Related: stage · expectations · failure modes · KPIs · playbook questions
Your organisation's note (project overlay, editable, with review status)
```

Navigation: stage → expectation area (layer) → expectation → failure mode
→ reasons → actions, and back; a search box; "What does this mean?"
chips on every card, driver bar, layer bar, badge and gate in the
application open the matching hub page in a side panel without leaving
the screen. The reason screen (`guidance_and_insight_panel.md` §3.2) and
the remedy screen (§3.3) draw their texts from the hub, so the hub is the
single source of the words people read.

Contribution: stakeholders edit the project overlay in place (Analyst
mode and Guided mode for owners); edits carry author and date and enter
review; approved overlays can be proposed back to the pack (generic tier)
as a curated contribution.

## 4. Guidance elicitation during norm definition

When a layer or expectation is created in the norm builder or the
workshop wizard (S3–S4), the wizard asks, after the rule itself, five
short questions: what do we call this; what do we expect, in one sentence;
what does it mean when it is missed; what usually causes it here; what do
we usually do about it and who owns it. Answers become the project
overlay. The generic tier is shown as a starting text the stakeholders
can accept, edit or reject. A norm version cannot be approved while a
layer has no guidance.

## 5. Seed guidance for the seven P2P layers (SAP P2P expert)

| Layer (paper's norm) | Plain name | Expectation in one sentence | Usual reasons (in the log / outside) | Usual actions |
|---|---|---|---|---|
| L1 closure completeness | closing the loop | every ordered item is received, invoiced and cleared | open items at extract end (in the log: censoring); service entry sheets missing (in the log); vendors invoicing late (in the log: lag) | dunning of missing invoices; SES discipline; period-end review of open items |
| L2 flow discipline | buying channel and sequence (maverick buying) | requisition → order → receipt → invoice in that order, in three-way flows | after-the-fact POs (in the log: PO date after invoice); free-text items (in the log); urgency (outside) | catalogue coverage; guided buying; no-PO-no-pay; framework contracts |
| L3 timeliness and ageing | on time | receipts, invoices and clearing within the agreed days | payment blocks (in the log); vendor invoicing behaviour (in the log: vendor × lag); approval queues (in the log where approvals are logged) | payment-term review; block root-cause review; AP workload levelling |
| L4 rework and instability | doing it once | no repeated changes, cancellations or re-postings on an item | price and quantity changes after ordering (in the log); cancelled receipts (in the log); master-data quality (outside: ask) | confirm price and quantity before ordering; vendor confirmations; master-data cleanup |
| L5 exceptions and corrections | exceptions stay rare | credit memos, cancellations and deletions are the exception | disputed deliveries (in the log: cancellations near receipts); duplicate invoices (in the log) | quality gates at receipt; duplicate-invoice check; vendor scorecards |
| L6 value and commercial integrity | paying what was agreed | invoiced values match ordered and received values | price changes after PO (in the log); tolerance settings (outside: system configuration) | tolerance review; price agreements; contract price loading |
| L7 effort and automation | touchless where possible | items pass without manual touches | manual interventions (in the log: change events, blocks); SRM transfer failures (in the log) | automation of matching; error-proofing in the buying front end |

The knowledge workstream extends this to every constraint of the paper's
norm and to the O2C pack (delivery reliability, commitment discipline,
change churn, returns).

## 6. Requirements

| ID | Requirement | Acceptance | Priority | Cycle |
|---|---|---|---|---|
| RK-1 | Guidance schema (§1) in the packs: `guidance.yaml` per pack, JSON Schema, loaders, graph links; generic tier for all P2P layers and constraints of the paper's norm and for the O2C baseline | `wise-knowledge validate` passes; every layer and constraint of both templates has guidance with all blocks | P1 | 2 |
| RK-2 | `metadata.guidance` convention in norm JSON; backend serves guidance by layer id, constraint id and failure mode id (`GET /projects/{id}/guidance/{kind}/{id}`) merging generic tier and project overlay | the paper's norm exported from the app carries guidance; the endpoint returns both tiers | P1 | 2 |
| RK-3 | Knowledge hub screens per process type with the page template of §3, navigation and search | every layer, expectation and failure mode of the P2P pack opens as a hub page | P1 | 2 |
| RK-4 | "What does this mean?" chips on cards, driver bars, layer bars, badges and gates opening the hub page in a side panel | the chip is present on the signals list, the reason screen and the slice detail | P1 | 2 |
| RK-5 | Project overlay: stakeholders edit guidance in place with author, date and review status; approval flow; "your organisation's note" shown first | an owner edits the note for *buying channel and sequence* and it appears on the reason screen | P1 | 3 |
| RK-6 | Guidance elicitation in the norm builder and workshop wizard (§4); a norm version cannot be approved while a layer lacks guidance | the five questions appear when a layer is created; approval is blocked without answers | P1 | 3 |
| RK-7 | Reason and remedy screens draw their texts from the hub | one source of text; changing a hub page changes the screens | P1 | 2 |
| RK-8 | Assistant grounding on the hub: digests and narration use the plain names and the guidance blocks, citing the hub page | narration for a Packaging driver cites the hub page id | P2 | 4 |
| RK-9 | Hub pages of the drivers included in the governance pack | the pack's appendix lists the guidance of every driver named | P2 | 3 |
| RK-10 | Comprehension test (RG-10) extended to one hub page per cycle | reported in every review | P1 | 2 |
| RK-11 | Contribution path: approved overlays proposed back to the pack with review | a proposal file is produced from an approved overlay | P3 | 5 |

## 7. What this changes in the plan

Cycle 2 gains RK-1 to RK-4, RK-7 and RK-10 (knowledge, backend and frontend
workstreams); cycle 3 gains RK-5, RK-6 and RK-9; cycle 4 RK-8. The
guidance panel's reason and remedy screens are the hub's consumers, not a
second source of text. `docs/BACKLOG.md` section A2 and the cycle table
are updated accordingly.
