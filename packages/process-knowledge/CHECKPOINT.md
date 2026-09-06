# CHECKPOINT — workstream D, knowledge packs (CP-D1)

How to try the feature by hand. Paths assume the workbench at
`~/code/PhD/WISE/wise-workbench` and the library checkout at
`~/code/PhD/WISE/wise-lib`. Every command below was run on 2026-09-05 with
Python 3.13.9; the expected output is what appeared.

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
cross references (stages, activities, roles, kpis, templates, mapping files)
and loads every template with `wise.Norm.from_dict` + `validate()`. Exit
code 1 with a list of `[error] file at path: message` lines otherwise
(`--json` for a machine-readable report). Pass criterion: `VALID`.

## CP-D1 — BPIC 2019 labels matched to canonical activities

```bash
.venv/bin/wise-knowledge match p2p --labels-from ~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv --oracle-id bpic2019
```

The label column `event concept:name` is guessed from the header; only that
column is read (about 3 s for the 527 MB file). Expected: a table with one
row per distinct label (42), sorted by event count, with columns
`label, events, canonical_id, stage, confidence, tier, method, alternative`,
for example

```
label                                events  canonical_id                        stage    confidence  tier  method               alternative
Record Goods Receipt                 314097  p2p.gr                              receive  1.00        high  label_pack:bpic2019  p2p.ir (0.76)
Create Purchase Order Item           251734  p2p.po_item_create                  order    1.00        high  label_pack:bpic2019  p2p.po_item_reactivate (0.80)
...
Change Rejection Indicator           2       p2p.po_change_rejection_indicator   order    1.00        high  label_pack:bpic2019  p2p.po_change_delivery_indicator (0.51)

pack p2p; key ['event concept:name']; label packs ['bpic2019', 'ocel2_p2p', 'hackathon', 'sap_mm']; 42 distinct keys
tiers: high 42, medium 0, low 0, unmatched 0
oracle bpic2019: top-1 42/42 = 100.0%, top-3 42/42 = 100.0%
```

Pass criterion (IMPLEMENTATION_PLAN CP-D1): at least 90 % of the BPIC 2019
labels matched top-1 to the curated mapping `p2p/mappings/bpic2019.yaml`.
Result: 42/42 = 100 %.

The same without any system label pack (canonical names and synonyms,
token overlap and fuzzy ratio only):

```bash
.venv/bin/wise-knowledge match p2p --labels-from ~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv --no-label-packs --oracle-id bpic2019
```

Expected last lines:

```
pack p2p; key ['event concept:name']; label packs none; 42 distinct keys
tiers: high 42, medium 0, low 0, unmatched 0
oracle bpic2019: top-1 42/42 = 100.0%, top-3 42/42 = 100.0%
```

## The other label files

```bash
# hackathon sales extract, 16 labels, O2C pack
.venv/bin/wise-knowledge match o2c --labels-from ~/code/PhD/WISE/WISE/hackathon_2026/outputs_icpm2026/Sales_Eventlog.csv --column activity --oracle-id hackathon_sales
# hackathon purchase extract, 10 labels, P2P pack
.venv/bin/wise-knowledge match p2p --labels-from ~/code/PhD/WISE/WISE/hackathon_2026/outputs_icpm2026/Purchase_Eventlog.csv --column activity --oracle-id hackathon_purchase
# OCEL 2.0 P2P, 10 event types, key = type + lifecycle
.venv/bin/wise-knowledge match p2p --labels-from ~/code/PhD/WISE/OC-WISE/data/ocel2.ocel.events.csv --column type --key lifecycle=lifecycle --oracle-id ocel2_p2p
```

Expected summary lines:

```
oracle hackathon_sales: top-1 16/16 = 100.0%, top-3 16/16 = 100.0%
oracle hackathon_purchase: top-1 10/10 = 100.0%, top-3 10/10 = 100.0%
oracle ocel2_p2p: top-1 10/10 = 100.0%, top-3 10/10 = 100.0%
```

In the OCEL run every label appears as `Create Goods Receipt [complete]`:
the lifecycle transition is part of the matching key (docs/DATASETS.md
§5.1); label-pack entries that fix a lifecycle are skipped when the observed
transition contradicts them.

Ad-hoc labels, German and transaction codes:

```bash
.venv/bin/wise-knowledge match p2p --label "Wareneingang buchen" --label "MIGO" --label "Goods reciept" --label "Quarterly strategy offsite"
```

Expected: `p2p.gr` (synonym:de, 0.95), `p2p.gr` (tcode, 0.97), `p2p.gr`
(0.83, medium, through the synonym text "Goods receipt"), and `unmatched`
for the last one.

## Browsing a pack

```bash
.venv/bin/wise-knowledge show p2p stages            # 7 stages, 6 variants with DF1/DF2/2-way/Consignment codes
.venv/bin/wise-knowledge show o2c failure-modes     # 22 entries; observed shares from o2c/README.md, e.g. 0.0320 of order items
.venv/bin/wise-knowledge show p2p glossary --lang de
.venv/bin/wise-knowledge show o2c label-packs       # hackathon 16, ocel2_order_management 11, sap_sd 31
```

## Knowledge graph and explanation paths

```bash
.venv/bin/wise-knowledge graph p2p
.venv/bin/wise-knowledge graph o2c --out /tmp/kg    # writes o2c_nodes.csv and o2c_edges.csv
.venv/bin/wise-knowledge explain p2p c_l6_change_price
```

Expected:

```
pack p2p: 325 nodes, 449 edges
nodes: activity 53, cause_candidate 94, constraint_pattern 62, failure_mode 27, kpi 18, remedy 55, role 9, stage 7
edges: detected_by 62, in_stage 53, involves 102, measures 21, owned_by 27, precedes 35, typical_cause 94, typical_remedy 55
pack o2c: 219 nodes, 282 edges
nodes: activity 42, cause_candidate 62, constraint_pattern 31, failure_mode 22, kpi 16, remedy 31, role 9, stage 6
edges: detected_by 31, in_stage 42, involves 41, measures 24, owned_by 22, precedes 29, typical_cause 62, typical_remedy 31
```

and for `explain`, the failure mode *Price change after ordering* with its
candidate causes, candidate remedies, evidence to check first, owner role
and sources. Candidates are shown as candidates with sources, never as
findings.

## Tests and lint

```bash
.venv/bin/python -m pytest -q       # 60 passed (about 13 s; the three real-data tests read the CSVs above and skip when absent)
.venv/bin/ruff check src tests      # All checks passed!
.venv/bin/ruff format --check src tests
```

What the tests cover: every schema loads; both packs and `datasets.yaml`
validate; cross-reference errors are reported; label packs cover all 42
BPIC 2019 labels, the 10 OCEL P2P types, the 10 hackathon purchase and 16
hackathon sales labels and the 11 OCEL Order Management activities; every
constraint of the paper's norm (29) and of both baselines is referenced by a
failure mode, and each pattern agrees with its template constraint in type,
activities and parameters; the O2C shares of the README are kept as
`observed_share` and never reappear as thresholds; every template loads
with `Norm.from_dict` and passes `validate`; `p2p_bpic19.json` is
byte-identical to `wise-lib/examples/bpic19_norm.json`; `o2c_baseline.json`
scores a synthetic log (return items and rejected items out of scope, late
items penalised); matching reaches 100 % top-1 on all five curated mappings,
also with the difflib fallback and without label packs; the graph carries
the expected node and edge types with one `in_stage` edge per activity and
the stage chain; the CLI commands run end to end.

## Findings recorded while building the packs

- BPIC 2019 shares measured on 2026-09-05 (251,734 PO items) seed the P2P
  catalogue, for example price change 4.5 % of items (99.6 % of those after
  item creation), quantity change 7.0 %, payment block release 22.2 %
  (24.3 % of DF2), invoice cancellation 2.6 %, item deletion 3.5 %, goods
  receipt cancellation 1.0 %; median invoice-to-clearing 63.6 days; in DF1
  51.7 % of items with both evidences carry invoice evidence before goods
  evidence (the vendor-side invoice date is one of the two evidences).
- Hackathon purchase extract (1,412 PO items): 42.9 % of items have more
  than one vendor confirmation, 38.5 % of received items arrive after the
  scheduled date, median order-to-receipt 31.1 days.
- Two activity labels of the paper's norm do not occur in the BPIC 2019
  CSV: `Vendor creates credit memo` (absent) and `Change Payment Terms`
  (the CSV has `Change payment term`, 7 events). The template is kept
  verbatim; both spellings are in the `bpic2019` label pack and the
  failure-mode entries note it, so `Norm.check(log)` will report them.

## Not done

- BPMN reference models (`bpmn/*.bpmn` per process) are not produced; the
  layout in the README lists them for the increment that adds the BPMN view.
- Embedding candidates (`bge-m3` through the provider) are outside this
  package; the matcher exposes the lexical stages only.
- Label packs exist for SAP MM/SD, BPIC 2019, the OCEL logs and the
  hackathon extract; Ariba, Coupa, Oracle and D365 packs are not authored.
- Every threshold in `p2p_baseline.json` and `o2c_baseline.json` is a
  placeholder flagged in `metadata.meta.uncalibrated_parameters`; the
  paper's norm is calibrated for BPIC 2019 only.
- O2C invoice and payment failure modes, credit blocks, stock-outs, split
  deliveries, failed deliveries and returns without return order are
  vocabulary (`evidence: none`); the join between the 20 return items and
  the returns stock movements of the extract was not made.
- `days_late` for `o_deliv_days_late` must be prepared as a case attribute
  before scoring; the library's recipes have no date-difference kind.
- `p2p.fm.delivery_indicator_reopened` has a pattern without a template
  constraint.
- All entries have `review_status: draft`; the domain lead's review is
  pending. The datasets registry is unchanged apart from validation.
- No CI workflow in this directory (workstream F); packs are read from the
  checkout (or `WISE_KNOWLEDGE_ROOT`), not bundled into a wheel.
- The pandas script that measured the BPIC 2019 and hackathon shares listed
  above is not shipped; the definitions of each share are recorded in the
  `of` text of every `observed_share` entry so that `tools/profile_log.py`
  can reproduce them.
