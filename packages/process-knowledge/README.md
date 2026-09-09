# packages/process-knowledge

Curated, human-authored process knowledge, one folder per process, plus the
Python package `wise_knowledge` that validates, loads, graphs and matches it
and serves the knowledge hub. Two packs ship under `src/wise_knowledge/data`: `p2p/` (purchase-to-pay,
evidenced by BPI Challenge 2019, the OCEL 2.0 P2P vocabulary and the
hackathon purchase extract) and `o2c/` (order-to-cash, evidenced by the ICPM
2026 hackathon sales extract; invoice and payment stages from vocabulary).
Later packs (`application_handling/` with variants credit, permits,
subsidies, expense claims, `itsm/`, `production/`, `healthcare/`) follow the
same layout; `datasets.yaml` and `docs/DATASETS.md` list their evidence logs.

Every entry carries `id`, `version`, `sources` and `review_status`; content
is owned by the domain lead, schema and loaders by engineering. Measured
shares in the catalogues are seeds, never thresholds; every template
threshold is flagged uncalibrated until an owner sets it on the empirical
distribution (F8). User-visible text follows `docs/CUSTOMER_JOURNEY.md` §8
and the plain-language rule of `docs/panel/guidance_and_insight_panel.md`
§2: the plain words first, the method term second.

## Installed resources

`src/wise_knowledge/data/` is the single source for schemas, packs, mappings,
presets, templates and `datasets.yaml`; edit content there. Wheels and sdists
include it as package data. `knowledge_root()` resolves it with
`importlib.resources`, including when running outside the checkout. Pack and
template paths remain usable for the process lifetime. Both built-in entry
points (`p2p` and `o2c`) resolve to these same resources.

`WISE_KNOWLEDGE_ROOT` remains an explicit override for a complete custom
content tree containing `schema/` and the pack directories. Third-party packs
can still register the `wise_knowledge.packs` entry-point group.

Build with `python -m build`. The backend's
[distribution smoke test](../../apps/backend/DISTRIBUTION.md) verifies the
knowledge sdist → wheel → installed-resources path alongside the application
wheel. Actual dataset tests require explicitly configured `WISE_BPIC19_CSV`,
`WISE_HACKATHON_DIR` or `WISE_OCEL2_P2P_EVENTS`; there is no author-directory
fallback. `WISE_LIB_BPIC19_NORM` optionally checks an external reference norm;
the ordinary test checks the known public classic v0.1.0 SHA-256 without it.

## Layout

```
process-knowledge/
  README.md, CHECKPOINT.md          this file; how to try CP-D1 and CP-D2 with expected output
  pyproject.toml                    package wise-knowledge, script wise-knowledge
  src/wise_knowledge/data/           installed content root (the following content paths are relative to it)
  datasets.yaml                     registry of evidence logs (validated by schema/datasets.schema.json)
  schema/                           JSON Schemas (draft 2020-12)
    common.schema.json              shared $defs: ids, texts en/de, sources, evidence, review status
    ontology.schema.json  stages.schema.json  failure_modes.schema.json  kpis.schema.json
    glossary.schema.json  playbooks.schema.json  slicing.schema.json  templates.schema.json
    guidance.schema.json            the guidance object of the knowledge hub (blocks of knowledge_hub_panel.md §1)
    presets.schema.json             public-log presets (column mapping, prepared attributes, starting norm, slicings)
    datasets.schema.json
  p2p/, o2c/                        one folder per process
    ontology.yaml                   canonical activities (id, name en/de, stage, description, synonyms en/de,
                                    object types, granularity header/item, tags, tcodes) and system label packs
    stages.yaml                     case notion with its business noun, ordered stages with allowed loops,
                                    expected orderings, variants
    failure_modes.yaml              layers (with the layer ids of every template), failure modes: signature,
                                    WISE constraint patterns with template and constraint refs, observed shares,
                                    evidence, cause and remedy candidates, evidence to check, owner role, sources;
                                    kind process_behaviour | data_quality
    kpis.yaml                       definitions in WISE terms, unit, direction, linked failure modes
    glossary.yaml                   terms en/de with definitions, aliases, links
    playbooks.yaml                  questions, hypotheses per hotspot type and workshop scripts per journey stage S0..S12
    slicing.yaml                    roles, recommended slice keys with owners, never-slice-by, exposure, pitfalls
    guidance.yaml                   generic tier of the knowledge hub: one entry per layer, per template
                                    constraint and per failure mode (see "Guidance and knowledge hub")
    templates/index.yaml            template index (calibration, activity label kind, evidence, verbatim, derived_from)
    templates/*.json                wise norms (library format, schema_version 2); non-verbatim ones carry metadata.guidance
    mappings/*.yaml                 curated label -> canonical id mappings (test oracles and public-log presets)
    presets/*.yaml                  public-log presets (o2c/presets/icpm2026_o2c.yaml)
  o2c/README.md                     the O2C draft with the measured shares (input; kept as is)
  src/wise_knowledge/
    paths.py      root and pack discovery (built-in folders, WISE_KNOWLEDGE_ROOT, entry point wise_knowledge.packs)
    schema.py     JSON Schema validation plus cross-reference checks; template norms loaded with wise;
                  guidance completeness (every layer, template constraint and failure mode has an entry with all blocks)
    models.py     typed dataclasses (Pack, Activity, Stage, FailureMode, WisePattern, Kpi, Guidance, Preset, ...)
    loaders.py    load_pack, load_datasets, load_mapping, load_preset
    graph.py      knowledge graph as node and edge tables, explain(constraint), optional networkx export
    guidance.py   knowledge hub: index and pages in the contract's shapes, page rendering, metadata.guidance of templates
    flow.py       stage lanes with canonical activities in the FlowGraph groups shape (flow endpoint)
    matching.py   activity canonicalisation: normalisation, label packs, token overlap, fuzzy ratio
    labels.py     distinct activity keys from a CSV (pandas usecols, csv fallback)
    cli.py        wise-knowledge validate | match | show | graph | explain | guidance | hub | stages | embed-guidance
  tests/                            schema, loader, template, matching, graph, guidance/hub/stages/preset and CLI tests
```

Label packs: `p2p` has `bpic2019` (all 42 labels of the challenge CSV plus
the two spellings used by the paper's norm), `ocel2_p2p` (10 event types,
lifecycle `complete`), `hackathon` (10 purchase labels) and `sap_mm`
(transaction vocabulary, English and German, with tcodes); `o2c` has
`hackathon` (16 sales labels), `ocel2_order_management` (11 activities) and
`sap_sd`.

## Templates

`p2p/templates/p2p_bpic19.json` is a verbatim copy of the paper's norm
(`wise-lib/examples/bpic19_norm.json`, 29 constraints, raw BPIC 2019
labels, calibrated for that log only); it is marked `verbatim: true` in the
index, is never rewritten, and its guidance is served from `guidance.yaml`
only. `p2p_baseline.json` and `o2c/templates/o2c_baseline.json` use
canonical ids as activity labels and carry a `metadata.meta` block with
`calibration: uncalibrated` and the list of parameters to calibrate (the
block sits inside `metadata` because the library rejects unknown top-level
keys). Every failure-mode pattern names the template constraint that
implements it (`template`, plus `also_templates` for derived templates that
keep the constraint unchanged) and every template constraint is referenced
by a failure mode; a test checks that types, activities and parameters agree
in every template a pattern names.

### Norm draft v1.1 for BPIC 2019 (R1-10)

`p2p/templates/p2p_bpic19_v1_1.json` is the draft the norm builder starts
from (`derived_from: p2p_bpic19`, calibration `mixed`, 31 constraints, the
paper's seven layers and four views). The differences to the paper's norm,
each with its rationale in `metadata.meta.changes`:

| Change | v1.0 | v1.1 | Why |
|---|---|---|---|
| removed | `c_l2_df1_invoice_after_goods` (invoice evidence = posting or vendor invoice date, merged) | — | on BPIC 2019 the merged rule is missed by 51.7 % of DF1 items with both evidences, almost entirely through the vendor's date: 53.6 % early by the vendor's invoice date, 0.0 % by the posting date (log primitives, 2026-09-06); one rule cannot say which it means |
| added | — | `c_l2_df1_vendor_invoice_after_goods` (commercial: the vendor's invoice date not before the first receipt, DF1, weight 0.7 placeholder) | the vendor's invoicing practice; expected about 54 % of DF1 items with both dates |
| added | — | `c_l2_df1_invoice_posting_after_goods` (compliance: the invoice posting not before the first receipt, DF1, weight 1.4 placeholder) | the GR-based invoice verification point; expected 0.0 % on BPIC 2019 (the HPI report's 5.0 % counts its own rule) |
| added | — | `c_l2_clear_after_goods` (the invoice not cleared before the first receipt, DF1 and DF2, weight 1.2 placeholder) | the challenge reports' cleared-before-goods rule (HPI rule 4, 4.58 % of DF1 cases); by posting timestamps 0.0 % of DF1 and 0.05 % of DF2 items with both events, so the reports' figure is not reproduced by timestamps and the rule will read near zero on this log |
| activity label | `c_l4_change_payment_terms_repeats` on `Change Payment Terms` (absent from the CSV) | `Change payment term` (the CSV's spelling, 7 events) | with the v1.0 spelling `Norm.check` reports an activity that never occurs and the rule is never violated |
| kept | `c_l5_credit_memo` on `Vendor creates credit memo` | unchanged | the label does not occur in the CSV; kept for logs that carry it, `Norm.check` reports it |

Everything else (thresholds, weights, applicability, layer weights) is the
paper's; in `layer_balanced` scoring the split changes the within-layer
shares of L2 (six expectations instead of four), so v1.1 backlogs differ
from v1.0 even where nothing else changed. The three new weights are listed
in `metadata.meta.uncalibrated_parameters`.

## Guidance and knowledge hub

`guidance.yaml` is the generic tier of the knowledge hub
(`docs/panel/knowledge_hub_panel.md` §§1–3): one entry per layer of the
pack, per constraint of the pack's templates (keyed by constraint id, with
`templates` and `aliases` for the same expectation under another id in a
derived template) and per failure mode. Every entry carries the same blocks:
`plain_name` (en/de), `missed_label` (what a card shows when the expectation
is missed; required for layers, R1-05), `expectation`, `meaning_when_missed`,
`why_it_matters`, `how_detected` (plain words, no constraint ids),
`usual_reasons[]` (`text`, `where: log | outside`, `check`: the check to run
in the log or whom to ask), `usual_actions[]` (`text`, `countermeasure`:
policy, system_setting, standard_work, training, catalogue, contract,
master_data, automation, review, measurement; `owner_role`; `effect_area`:
the layer where the effect is expected), `what_to_check_first[]`,
`examples[]` (a violating and a compliant case), `kpis[]`, `owner_role`,
`stakeholders`, `sources[]`, `review_status`, `version` (the last four may
come from the file's `defaults`). The project overlay ("your organisation's
note") is stored with the project and merged by the backend; the packs
carry the generic tier only.

Counts: `p2p` 79 entries (8 layers, 42 constraints covering the paper's
norm, draft v1.1 and the baseline, 29 failure modes); `o2c` 59 entries
(7 layers, 30 constraints of the baseline, 22 failure modes). The seven
layers of the paper's norm carry the plain names and missed labels of the
cycle 1 review §9: closing the loop / missing invoice or payment; buying
channel and sequence (maverick buying) / steps out of order for this flow
type; on time / waiting too long between steps; doing it once / repeated or
changed postings; exceptions stay rare / cancellations and memos; paying
what was agreed / price or quantity changed after ordering; touchless where
possible / too many manual touches.

Validation (`wise-knowledge validate`) checks the schema, that every pack
layer, every constraint of every template and every failure mode has
exactly one entry, that roles, layers and KPIs resolve, that every reason
says where it is checked, that every action names a countermeasure, that the
examples show both cases, and that the plain-language blocks name no
constraint id.

Where the guidance lives (knowledge_hub_panel.md §2): in `guidance.yaml`
(source of truth), in the `metadata.guidance` block of every non-verbatim
template (`wise-knowledge embed-guidance <pack>` writes it, `--check`
reports a stale block; keyed by layer id and constraint id, with the hub
node id per entry), and in the hub export the backend serves.

Hub (`guidance.py`, `packages/api-schema/CONTRACT_CYCLE2.md`): `build_hub(pack)`
gives the index `{nodes: [{id, kind: stage | layer | expectation |
failure_mode | reason | action | kpi, plain_name, method_name, ...}],
edges: [{from, to, kind}]}` and `hub.page(node_id)` the page `{node,
guidance, related: {stage, expectations[], failure_modes[], kpis[],
playbook[], reasons[], actions[]}, overlay}`; `render_page` prints the page
in the template of §3. Node ids: `layer:<pack layer id>`,
`expectation:<template id>:<constraint id>`, `failure_mode:<id>`,
`stage:<id>`, `kpi:<id>`, `reason:<hash>`, `action:<hash>`. `p2p`: 597
nodes and 1,123 edges; `o2c`: 275 nodes and 447 edges.

Stage lanes for the flow endpoint (R1-16, `flow.py`): `stage_lanes(pack,
mapping=, variant=)` returns `groups` (one lane per stage, in stage order),
`nodes` (canonical activities in their lane, limited to the activities a
mapping covers), `edges` (expected orderings as `flow` edges tagged with
their variants) and `meta` (case noun, stage order, milestones, allowed
loops, the log labels per canonical id, variants), in the FlowGraph shape.

Presets (R1-13, `presets/*.yaml`): `o2c/presets/icpm2026_o2c.yaml` maps
`Sales_Eventlog.csv` (case_id, activity, timestamp, the case and event
attributes of the extract), types `Create Order` as a header event, names
the curated mapping `hackathon_sales`, describes the prepared attributes
`days_late` (goods issue date minus requested delivery date), `flow_type`
(returns, rejected, partial_delivery, make_to_order, default standard, as
filter clauses of the contract) and `order_month`, sets the case noun
"sales order items", loads `o2c_baseline` as norm v1 with its uncalibrated
flags visible, and lists the slicings customer, SKU, incoterms and period
with their pitfalls.

Data-quality patterns (R1-24): `p2p.fm.block_release_logging_asymmetry`
and `p2p.fm.missing_order_confirmation` carry `kind: data_quality`; their
patterns name no template constraint because they measure logging, not
behaviour (BPIC 2019: 55,812 of the 55,839 items with a block release have
no logged block; confirmations are recorded on 12.7 % of items and 37 of
1,374 invoice-first vendors confirm in more than 70 % of their items).

## Knowledge graph

`graph.py`: node types activity, stage, layer, constraint pattern, failure
mode, cause candidate, remedy, kpi, role and guidance; edge types
`in_stage`, `precedes` (stage chain and expected activity orderings),
`in_layer`, `detected_by`, `typical_cause`, `typical_remedy`, `owned_by`,
`explained_by` (layer, constraint pattern or failure mode -> guidance
entry), plus `involves` (pattern -> activity) and `measures` (kpi -> failure
mode). Curated edges carry the entry's sources; `explain(constraint_ref)`
returns the path constraint -> failure mode -> candidate causes and
remedies, evidence to check and owner, with the guidance of the constraint
and of the failure mode, for the explanation panel.

## Install and use

```bash
cd packages/process-knowledge
python3 -m venv .venv
.venv/bin/pip install 'git+https://github.com/feelfine1977/wise-pm.git@v0.1.0' # classic template validation
.venv/bin/pip install -e '.[dev]'                        # pyyaml, jsonschema, rapidfuzz, networkx, pandas, pytest, ruff

.venv/bin/wise-knowledge validate                        # datasets.yaml and every pack (schemas, cross references, templates, guidance, presets)
.venv/bin/wise-knowledge match p2p --labels-from <log.csv> --column activity [--key lifecycle=<col>] [--oracle-id bpic2019]
.venv/bin/wise-knowledge match p2p --label "Wareneingang buchen" --label "MIGO"
.venv/bin/wise-knowledge show o2c failure-modes          # also: stages | glossary | activities | kpis | label-packs | presets | guidance
.venv/bin/wise-knowledge graph p2p --out /tmp/kg         # node and edge CSVs
.venv/bin/wise-knowledge explain p2p c_l6_change_price   # explanation path for a template constraint
.venv/bin/wise-knowledge guidance p2p layer L2_flow_discipline --template p2p_bpic19   # a hub page (--json: contract shape)
.venv/bin/wise-knowledge guidance o2c failure_mode o2c.fm.delivery_date_postponed --lang de
.venv/bin/wise-knowledge hub o2c --json                  # hub index with every page; --out file.json; --node <id>
.venv/bin/wise-knowledge stages o2c --json --mapping hackathon_sales   # stage lanes in the FlowGraph groups shape
.venv/bin/wise-knowledge embed-guidance p2p --check      # metadata.guidance of the non-verbatim templates up to date?
.venv/bin/python -m pytest -q
```

```python
from wise_knowledge import load_pack, Matcher, MatchKey, build_graph, build_hub, stage_lanes, template_guidance

pack = load_pack("p2p")                       # validated; PackError lists every issue otherwise
pack.activity("p2p.gr").stage                 # 'receive'
pack.failure_modes_for_constraint("c_l6_change_price", template="p2p_bpic19")
pack.guidance_for("layer", "L2_flow_discipline", template="p2p_bpic19").plain_name_en   # 'Buying channel and sequence (maverick buying)'
pack.guidance_for("constraint", "c_l2_clear_after_goods", template="p2p_bpic19_v1_1").as_block()   # GuidanceBlock of the contract
hub = build_hub(pack)                         # hub.index(), hub.page("layer:flow_discipline"), hub.node_for("constraint", "c_l6_change_price")
template_guidance(pack, "p2p_bpic19_v1_1")    # the metadata.guidance block keyed by layer id and constraint id
stage_lanes(load_pack("o2c"), mapping="hackathon_sales")   # groups, nodes, edges, meta for the flow endpoint
matcher = Matcher(pack, key=MatchKey(label="type", lifecycle="lifecycle"))
matcher.match("Goods receipt")                # ranked candidates with confidence, tier, stage, method
matcher.evaluate(pack.mappings["bpic2019"])   # top-1 and top-3 against the curated mapping
graph = build_graph(pack)                     # nodes and edges; graph.explain("c_l2_df1_invoice_after_goods")
```

Matching key: the label column plus optional `lifecycle`, `document_type`
and `subprocess` components (docs/DATASETS.md §5.1). Label-pack entries may
fix a component; an observed key that contradicts it is not matched by that
entry, an entry that is stricter than the observation is matched with a
small discount. Confidence tiers: high ≥ 0.85, medium ≥ 0.6, low > 0;
exact label-pack hits score 1.0, transaction codes 0.97, canonical names and
synonyms 0.95, token overlap and fuzzy ratio at most 0.9; the `method`
column names the origin of the matched text. `rapidfuzz` is optional
(difflib fallback), `networkx` is optional (`to_networkx`), pandas is
optional for reading CSVs.

Third-party packs: a directory with the seven YAML files (and optional
`guidance.yaml`, `templates/`, `mappings/`, `presets/`) is discovered
through the entry-point group `wise_knowledge.packs` or by passing its path
to `load_pack`; a pack that ships templates needs a `guidance.yaml`.

## Not in this increment

BPMN reference models (`bpmn/*.bpmn`), embedding candidates for matching,
label packs for Ariba, Coupa, Oracle and D365, the project overlay and its
approval flow (RK-5, cycle 3) and the elicitation questions of the norm
builder (RK-6, cycle 3) are listed in `CHECKPOINT.md` under "Not done".
