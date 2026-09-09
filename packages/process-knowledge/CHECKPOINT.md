# CHECKPOINT — workstream D, knowledge packs (CP-D1, CP-D2)

> Historical checkpoint. Current packaging, resource paths and install commands are in [README.md](README.md). Content now ships under `src/wise_knowledge/data/`; the old checkout-only distribution note below is superseded.

How to try the features by hand. Paths assume the workbench at
`~/code/PhD/WISE/wise-workbench` and the library checkout at
`~/code/PhD/WISE/wise-lib`. Every command below was run on 2026-09-06 with
Python 3.13.9 and wise-pm 0.1.0; the expected output is what appeared.

## Setup

```bash
cd ~/code/PhD/WISE/wise-workbench/packages/process-knowledge
python3 -m venv .venv
.venv/bin/pip install -e ~/code/PhD/WISE/wise-lib
.venv/bin/pip install -e '.[dev]'
```

## CP-D1 — both packs valid

```bash
.venv/bin/wise-knowledge validate
```

Expected:

```
knowledge root: /Users/ula/code/PhD/WISE/wise-workbench/packages/process-knowledge
datasets.yaml: OK
pack o2c: OK
pack p2p: OK
VALID: 2 pack(s), 0 error(s)
```

`validate` checks every YAML file against `schema/*.schema.json`, then the
cross references (stages, activities, roles, kpis, templates, mapping files,
presets), loads every template with `wise.Norm.from_dict` + `validate()`,
and checks the guidance (every pack layer, every constraint of every
template and every failure mode has exactly one entry with all blocks; roles,
layers and KPIs resolve; every reason says `log` or `outside` with a check;
every action names a countermeasure; a violating and a compliant example;
no constraint id in the plain-language blocks). Exit code 1 with a list of
`[error] file at path: message` lines otherwise (`--json` for a
machine-readable report). Pass criterion: `VALID`.

## CP-D1 — BPIC 2019 labels matched to canonical activities

```bash
.venv/bin/wise-knowledge match p2p --labels-from ~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv --oracle-id bpic2019
```

The label column `event concept:name` is guessed from the header; only that
column is read (about 3 s for the 527 MB file). Expected: a table with one
row per distinct label (42), sorted by event count, with columns
`label, events, canonical_id, stage, confidence, tier, method, alternative`,
and the summary

```
pack p2p; key ['event concept:name']; label packs ['bpic2019', 'ocel2_p2p', 'hackathon', 'sap_mm']; 42 distinct keys
tiers: high 42, medium 0, low 0, unmatched 0
oracle bpic2019: top-1 42/42 = 100.0%, top-3 42/42 = 100.0%
```

Pass criterion (IMPLEMENTATION_PLAN CP-D1): at least 90 % of the BPIC 2019
labels matched top-1 to the curated mapping. Result: 42/42 = 100 %. The
same holds with `--no-label-packs`, and for the hackathon sales (16/16),
hackathon purchase (10/10) and OCEL P2P (10/10, key = type + lifecycle)
files:

```bash
.venv/bin/wise-knowledge match o2c --labels-from ~/code/PhD/WISE/WISE/hackathon_2026/outputs_icpm2026/Sales_Eventlog.csv --column activity --oracle-id hackathon_sales
.venv/bin/wise-knowledge match p2p --labels-from ~/code/PhD/WISE/WISE/hackathon_2026/outputs_icpm2026/Purchase_Eventlog.csv --column activity --oracle-id hackathon_purchase
.venv/bin/wise-knowledge match p2p --labels-from ~/code/PhD/WISE/OC-WISE/data/ocel2.ocel.events.csv --column type --key lifecycle=lifecycle --oracle-id ocel2_p2p
.venv/bin/wise-knowledge match p2p --label "Wareneingang buchen" --label "MIGO" --label "Goods reciept" --label "Quarterly strategy offsite"
```

The last one gives `p2p.gr` (synonym:de, 0.95), `p2p.gr` (tcode, 0.97),
`p2p.gr` (0.83, medium) and `unmatched`.

## CP-D2 — guidance for every layer, expectation and failure mode (RK-1, R1-05)

```bash
.venv/bin/wise-knowledge show p2p guidance | tail -1
.venv/bin/wise-knowledge show o2c guidance | tail -1
```

Expected:

```
pack p2p: 79 guidance entries; layer 8, constraint 42, failure_mode 29
pack o2c: 59 guidance entries; layer 7, constraint 30, failure_mode 22
```

The 42 P2P constraint entries cover the 29 constraints of the paper's norm,
the 31 of draft v1.1 (28 shared, 3 new) and the 32 of the baseline (22 through
`aliases`, 10 of its own); every entry has all blocks of `knowledge_hub_panel.md` §1.
The table above the summary line lists every entry with its plain name,
missed label, templates, number of reasons and actions, owner and status.

A hub page in the §3 template:

```bash
.venv/bin/wise-knowledge guidance p2p layer L2_flow_discipline --template p2p_bpic19
```

Expected head:

```
Buying channel and sequence (maverick buying)
  [Flow-conditioned control discipline · layer flow_discipline (L2_flow_discipline in p2p_bpic19, L2_flow_discipline in p2p_bpic19_v1_1, flow_discipline in p2p_baseline)]
  when missed a card says: steps out of order for this flow type

What this means
  Requisition, order, receipt and invoice happen in the order the flow type prescribes: ...
  When missed: Goods or services were bought or paid outside the agreed channel, ...
Why it matters
  Off-contract prices, no leverage over the vendor, payment for goods not received, ...
How we detect it
  Order rules per flow type: invoice evidence not before the first receipt in GR-based flows; ...
What usually causes it (candidates to test, not findings)
  - The vendor issues the invoice at dispatch, ... — in the log: check compare the share of early invoices by vendor invoice date with the share by invoice posting date ...
  ...
  - Urgent needs bypass the requisition and the buyer — outside the log: ask the requesters and the category manager which spend areas run on phone orders
What usually helps
  - No-purchase-order-no-pay policy with a maintained exception list (policy · Finance and controlling · effect on Buying channel and sequence (maverick buying))
  ...
What to check first
  1. Which evidence is early, the vendor's invoice date or the invoice posting
  ...
Examples
  - violating: A GR-based item whose invoice was posted twelve days before the goods receipt and cleared after a block was removed by hand.
  - compliant: A GR-based item with receipt on Monday, invoice posted on Thursday, matched without a block and cleared within terms.
Related
  expectations: Invoice after the goods (GR-based flow); Block released after the goods (invoice-first flow); No receipt on two-way items; Consignment settled, not paid per item; Vendor invoices after delivering (GR-based flow); Invoice posted after the goods (GR-based flow); Paid after the goods arrived
  failure modes: ...
  KPIs: ...
  playbook S8 (...): ...
Your organisation's note
  (none yet; the project overlay is written by the stakeholders and reviewed before it is shown here)

owner: Purchasing (buyer, purchasing group) · stakeholders: Seeded from the P2P pack ... · sources: ... · draft v1
```

`--json` prints the same page in the contract's shape (`node`, `guidance`
as `GuidanceBlock`, `related`, `overlay: null`). Other pages:

```bash
.venv/bin/wise-knowledge guidance p2p constraint c_l6_change_price --json
.venv/bin/wise-knowledge guidance p2p failure_mode p2p.fm.block_release_logging_asymmetry
.venv/bin/wise-knowledge guidance o2c failure_mode o2c.fm.delivery_date_postponed --lang de
.venv/bin/wise-knowledge guidance o2c constraint o_deliv_days_late
```

Pass criterion (RK-1, RK-3): `validate` passes; every layer and constraint
of both packs' templates and every failure mode has guidance with all blocks
(checked by `tests/test_guidance.py`); every such node opens as a hub page.

## CP-D2 — hub export (RK-2, RK-3)

```bash
.venv/bin/wise-knowledge hub p2p
.venv/bin/wise-knowledge hub o2c
.venv/bin/wise-knowledge hub o2c --json | head -c 400
.venv/bin/wise-knowledge hub p2p --out /tmp/p2p_hub.json
```

Expected:

```
hub p2p: 597 nodes, 1123 edges
nodes: action 177, expectation 92, failure_mode 29, kpi 18, layer 8, reason 266, stage 7
edges: contains 92, detects 92, in_stage 29, measures 23, precedes 6, related_kpi 116, usual_action 312, usual_reason 453
template p2p_bpic19: guidance complete
template p2p_bpic19_v1_1: guidance complete
template p2p_baseline: guidance complete
hub o2c: 275 nodes, 447 edges
nodes: action 71, expectation 30, failure_mode 22, kpi 16, layer 7, reason 123, stage 6
edges: contains 30, detects 31, in_stage 22, measures 24, precedes 5, related_kpi 66, usual_action 97, usual_reason 172
template o2c_baseline: guidance complete
```

`--json` prints `{pack, process, case_noun, nodes: [{id, kind, plain_name,
method_name, ...}], edges: [{from, to, kind}], pages: {node id: page}}`;
expectation nodes exist once per template (`expectation:<template>:<id>`),
so the 92 P2P expectations are 29 + 31 + 32 (the baseline's 22
counterparts of the paper's expectations, reached through `aliases`, plus
its 10 own approval, order-to-receipt, confirmation, block and
invoice-before-order expectations).

## CP-D2 — `metadata.guidance` in the templates (RK-2)

```bash
.venv/bin/wise-knowledge embed-guidance p2p --check
.venv/bin/wise-knowledge embed-guidance o2c --check
cmp p2p/templates/p2p_bpic19.json ~/code/PhD/WISE/wise-lib/examples/bpic19_norm.json && echo byte-identical
```

Expected:

```
p2p_bpic19_v1_1: metadata.guidance up to date; complete
p2p_baseline: metadata.guidance up to date; complete
o2c_baseline: metadata.guidance up to date; complete
byte-identical
```

The paper's norm is `verbatim: true` and is never rewritten; the other three
templates carry the generic tier keyed by layer id and constraint id (with
the hub node id per entry). After editing `guidance.yaml`, run
`embed-guidance <pack>` without `--check` to rewrite the blocks; the
template files are re-serialised with an indent of 2.

## CP-D2 — norm draft v1.1 for BPIC 2019 (R1-10)

```bash
.venv/bin/python - <<'PY'
from wise import Norm
n = Norm.load("p2p/templates/p2p_bpic19_v1_1.json"); n.validate()
print(len(n.constraints), [c.id for c in n.constraints_in_layer("L2_flow_discipline")])
for c in n.metadata["meta"]["changes"]: print(c["constraint"], "-", c["change"])
PY
```

Expected:

```
31 ['c_l2_df1_vendor_invoice_after_goods', 'c_l2_df1_invoice_posting_after_goods', 'c_l2_df2_release_after_goods', 'c_l2_clear_after_goods', 'c_l2_2way_no_goods_expected', 'c_l2_consignment_no_clear_invoice']
c_l2_df1_invoice_after_goods - removed
c_l2_df1_vendor_invoice_after_goods - added
c_l2_df1_invoice_posting_after_goods - added
c_l2_clear_after_goods - added
c_l4_change_payment_terms_repeats - activity label
c_l5_credit_memo - kept
(all others) - unchanged
```

The rationale per change and the expected shares on BPIC 2019 are in the
template's `metadata.meta.changes` and in README "Norm draft v1.1".
`explain p2p c_l2_clear_after_goods --template p2p_bpic19_v1_1` reaches
`p2p.fm.invoice_before_goods_receipt` with the guidance of both.

## CP-D2 — stage lanes for the flow endpoint (R1-16)

```bash
.venv/bin/wise-knowledge stages o2c --mapping hackathon_sales
.venv/bin/wise-knowledge stages o2c --json --mapping hackathon_sales | head -c 300
.venv/bin/wise-knowledge stages p2p --variant three_way_invoice_first
```

Expected (o2c with the mapping): six lanes Capture (3 activities), Commit
(9), Fulfil (4), Return (0), Invoice (0), Pay (0) — only the 16 activities
the mapping covers are placed — and the summary
`pack o2c; case noun 'sales order items'; 16 activities, 8 expected orderings; mapping hackathon_sales; variant all`.
The JSON has `groups` (`{id: stage:<id>, kind: lane, label, parent: null}`),
`nodes` (`{id, kind: activity, label, group, metrics, tags}`), `edges`
(`kind: flow`, tagged with the variants of the expected ordering), `overlays`
and `meta` (case noun, stage order, milestones, loops, `labels` per canonical
id, variants). For the P2P invoice-first variant the Invoice lane precedes
Receive: `Request, Approve, Order, Invoice, Receive, Match, Pay`.

## CP-D2 — O2C preset (R1-13)

```bash
.venv/bin/wise-knowledge show o2c presets
```

Expected: one row `icpm2026_o2c | icpm2026_hackathon | Sales_Eventlog.csv |
sales order items | o2c_baseline | Create Order | days_late, flow_type,
order_month | Customer ID, SKU ID, Incoterms (Part 1), order_month`. The
file `o2c/presets/icpm2026_o2c.yaml` validates against
`schema/presets.schema.json` and its cross references (template, mapping
`hackathon_sales`, dataset, slice keys, attribute aliases); the CSV header
was checked on 2026-09-06 (`case_id, activity, activity_id, timestamp,
changed_from, changed_to, SKU ID, Order Item Created On, Order Quantity,
Material ID, Returns Item, Requested delivery date, Incoterms (Part 1),
Customer ID, Rejection/Cancellation Status, Confirmed Quantity, Scheduled
delivery date`). Ingesting the file is the backend's job (`POST
/projects/{p}/datasets/presets/icpm2026_o2c`).

## CP-D2 — data-quality patterns (R1-24)

```bash
.venv/bin/wise-knowledge show p2p failure-modes | grep -E 'logging_asymmetry|missing_order_confirmation'
.venv/bin/wise-knowledge guidance p2p failure_mode p2p.fm.missing_order_confirmation
```

Expected: both rows with `kind data_quality`, patterns without a template
constraint, and observed shares from BPIC 2019 (0.9995 of items with a
release have no logged block; 0.1274 of items carry a recorded
confirmation). The pages say that the pattern is a readiness check, not a
scored expectation.

## Knowledge graph and explanation paths

```bash
.venv/bin/wise-knowledge graph p2p
.venv/bin/wise-knowledge graph o2c --out /tmp/kg    # writes o2c_nodes.csv and o2c_edges.csv
.venv/bin/wise-knowledge explain p2p c_l6_change_price
```

Expected:

```
pack p2p: 428 nodes, 647 edges
nodes: activity 53, cause_candidate 99, constraint_pattern 67, failure_mode 29, guidance 79, kpi 18, layer 8, remedy 59, role 9, stage 7
edges: detected_by 67, explained_by 101, in_layer 67, in_stage 53, involves 114, measures 23, owned_by 29, precedes 35, typical_cause 99, typical_remedy 59
pack o2c: 285 nodes, 373 edges
nodes: activity 42, cause_candidate 62, constraint_pattern 31, failure_mode 22, guidance 59, kpi 16, layer 7, remedy 31, role 9, stage 6
edges: detected_by 31, explained_by 60, in_layer 31, in_stage 42, involves 41, measures 24, owned_by 22, precedes 29, typical_cause 62, typical_remedy 31
```

and for `explain`, the failure mode *Price change after ordering* with its
candidate causes, candidate remedies, evidence to check first, owner role
and sources; the path dictionary also carries the guidance of the
constraint and of the failure mode. Candidates are shown as candidates with
sources, never as findings.

## Browsing a pack

```bash
.venv/bin/wise-knowledge show p2p stages            # 7 stages, 6 variants with DF1/DF2/2-way/Consignment codes
.venv/bin/wise-knowledge show o2c failure-modes     # 22 entries; observed shares from o2c/README.md
.venv/bin/wise-knowledge show p2p glossary --lang de
.venv/bin/wise-knowledge show o2c label-packs       # hackathon 16, ocel2_order_management 11, sap_sd 31
```

## Tests and lint

```bash
.venv/bin/python -m pytest -q       # 77 passed (about 38 s; the three real-data tests read the CSVs above and skip when absent)
.venv/bin/ruff check src tests      # All checks passed!
.venv/bin/ruff format --check src tests
```

What the tests cover, in addition to CP-D1 (schemas, cross references,
label packs, matching at 100 % top-1 on all five curated mappings, graph
structure, CLI): the guidance schema accepts a complete entry and rejects a
missing block, a reason without `where`/`check`, an unknown countermeasure
and a stray property; every layer, every constraint of every template and
every failure mode of both packs has guidance with every block of the
contract's `GuidanceBlock`, roles, layers and KPIs resolve, examples show
both cases, plain blocks name no constraint id; the entry counts (79 and
59); the plain names and missed labels of the seven paper layers (R1-05);
constraint guidance resolves through templates and aliases; the
`metadata.guidance` of every non-verbatim template equals
`template_guidance()` (stale blocks fail) and the verbatim template is never
rewritten; draft v1.1 loads with `wise`, has the split, the added and the
respelled expectations with unchanged parameters elsewhere, `changes` with
rationale, `uncalibrated_parameters` for the new weights and complete
guidance; every constraint of both BPIC 2019 norms is referenced by a
failure mode and every pattern agrees with the constraint in every template
it names; the two data-quality patterns; hub index and pages in the
contract's shapes for both packs (every layer, expectation and failure mode
opens as a page with guidance), navigation from template ids to hub nodes,
page rendering with the §3 headings; guidance nodes and `explained_by`
edges in the graph; stage lanes in the FlowGraph shape with a mapping and
with a variant; the O2C preset; the CLI commands `guidance`, `hub`,
`stages`, `embed-guidance --check`, `show ... guidance | presets`.

## Findings recorded while building the packs

- BPIC 2019 shares measured on 2026-09-05 (251,734 PO items) seed the P2P
  catalogue, for example price change 4.5 % of items (99.6 % of those after
  item creation), quantity change 7.0 %, payment block release 22.2 %
  (24.3 % of DF2), invoice cancellation 2.6 %, item deletion 3.5 %, goods
  receipt cancellation 1.0 %; median invoice-to-clearing 63.6 days; in DF1
  51.7 % of items with both evidences carry invoice evidence before goods
  evidence (the vendor-side invoice date is one of the two evidences).
- BPIC 2019 log primitives measured on 2026-09-06 for R1-10 and R1-24
  (first evidence against the first goods or service receipt): DF1 items
  with both dates: vendor invoice before goods 53.6 % (10,722 items; 37.9 %
  of all 15,182 DF1 items), invoice posting before goods 0.0 % (11,128),
  cleared before goods 0.0 % (9,675), block release before goods 0.0 %
  (2,230). DF2: posting before goods 8.2 % (199,242), vendor invoice before
  goods 61.5 %, cleared before goods 0.05 % (173,133), release before goods
  0.65 % (53,400). `Remove Payment Block` 57,136 events on 55,839 items,
  `Set Payment Block` 124 events on 122 items; 55,812 items with a release
  have no logged block (99.95 %). `Receive Order Confirmation` 32,065 events
  on 32,061 items (12.74 %; DF2 14.2 %, DF1 0.3 %, consignment 5.1 %, 2-way
  0.0 %); 97 of 1,975 vendors have any confirmation; 37 of the 1,374 DF2
  vendors confirm in more than 70 % of their items (the RWTH report
  counted 43). `Change payment term` 7 events, `Vendor creates credit memo`
  0.
- Hackathon purchase extract (1,412 PO items): 42.9 % of items have more
  than one vendor confirmation, 38.5 % of received items arrive after the
  scheduled date, median order-to-receipt 31.1 days.
- Two activity labels of the paper's norm do not occur in the BPIC 2019
  CSV: `Vendor creates credit memo` (absent) and `Change Payment Terms`
  (the CSV has `Change payment term`, 7 events). The template is kept
  verbatim; draft v1.1 uses the CSV's spelling for the payment-term
  expectation and keeps the credit-memo expectation.

## Not done

- The project overlay ("your organisation's note") with author, date and
  review status (RK-5), its approval flow and the contribution path back to
  the pack (RK-11), and the elicitation questions of the norm builder
  (RK-6) are cycle 3; the hub pages carry `overlay: null` and the placeholder
  line.
- The backend endpoints (`GET /projects/{p}/guidance/{kind}/{id}`,
  `/knowledge/hub`, the flow endpoint's `groups`, the preset ingestion) and
  the hub screens and "What does this mean?" chips (RK-2 to RK-4, RK-7) are
  the backend and frontend workstreams; this package provides the loaders
  and exports they read.
- Draft v1.1 was not scored with the library on BPIC 2019 here; the
  expected shares in its `changes` come from log primitives, and the scoring
  run (R1-10 acceptance: the DF1 posting share near 0 % and the vendor-date
  share near 54 % as two drivers) is the backend's check. Its three new
  weights are placeholders.
- The O2C preset was validated against the schema and the CSV header, not
  executed: `days_late`, `flow_type` and `order_month` are prepared by the
  backend at case-table build; the `make_to_order` flow type needs the
  material master join, which the extract does not carry, so no item is
  typed make-to-order until then.
- Guidance texts: `plain_name` and `missed_label` are bilingual; the long
  blocks are English only. Examples are cases in words with `trace: null`;
  no trace links yet. All entries have `review_status: draft`; the domain
  lead's review and the comprehension test on one hub page (RK-10) are
  pending.
- `p2p.fm.delivery_indicator_reopened` has a pattern without a template
  constraint; the O2C return join (20 return items against the returns
  stock movements) was not made, and the O2C invoice and payment
  expectations stay vocabulary.
- Hub `reason` and `action` nodes are keyed by a hash of their text, so
  identical texts across entries merge and near-identical ones do not.
- BPMN reference models, embedding candidates and label packs for Ariba,
  Coupa, Oracle and D365 are not produced; no CI workflow in this
  directory (workstream F); packs are read from the checkout (or
  `WISE_KNOWLEDGE_ROOT`), not bundled into a wheel.
- The pandas scripts that measured the shares above are not shipped; the
  definitions are recorded in the `of` text of every `observed_share`
  entry and in the `changes` of draft v1.1 so that `tools/profile_log.py`
  can reproduce them.
