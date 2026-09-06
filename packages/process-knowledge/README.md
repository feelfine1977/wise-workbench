# packages/process-knowledge

Curated, human-authored process knowledge, one folder per process, plus the
Python package `wise_knowledge` that validates, loads, graphs and matches it.
Two packs ship in increment 0: `p2p/` (purchase-to-pay, evidenced by BPI
Challenge 2019, the OCEL 2.0 P2P vocabulary and the hackathon purchase
extract) and `o2c/` (order-to-cash, evidenced by the ICPM 2026 hackathon
sales extract; invoice and payment stages from vocabulary). Later packs
(`application_handling/` with variants credit, permits, subsidies, expense
claims, `itsm/`, `production/`, `healthcare/`) follow the same layout;
`datasets.yaml` and `docs/DATASETS.md` list their evidence logs.

Every entry carries `id`, `version`, `sources` and `review_status`; content
is owned by the domain lead, schema and loaders by engineering. Measured
shares in the catalogues are seeds, never thresholds; every template
threshold is flagged uncalibrated until an owner sets it on the empirical
distribution (F8). User-visible text follows `docs/CUSTOMER_JOURNEY.md` §8.

## Layout

```
process-knowledge/
  README.md, CHECKPOINT.md          this file; how to try CP-D1 with expected output
  pyproject.toml                    package wise-knowledge, script wise-knowledge
  datasets.yaml                     registry of evidence logs (validated by schema/datasets.schema.json)
  schema/                           JSON Schemas (draft 2020-12)
    common.schema.json              shared $defs: ids, texts en/de, sources, evidence, review status
    ontology.schema.json  stages.schema.json  failure_modes.schema.json  kpis.schema.json
    glossary.schema.json  playbooks.schema.json  slicing.schema.json  templates.schema.json
    datasets.schema.json
  p2p/, o2c/                        one folder per process
    ontology.yaml                   canonical activities (id, name en/de, stage, description, synonyms en/de,
                                    object types, granularity header/item, tags, tcodes) and system label packs
    stages.yaml                     case notion, ordered stages with allowed loops, expected orderings, variants
    failure_modes.yaml              layers, failure modes: signature, WISE constraint patterns with template and
                                    constraint refs, observed shares, evidence, cause and remedy candidates,
                                    evidence to check, owner role, sources
    kpis.yaml                       definitions in WISE terms, unit, direction, linked failure modes
    glossary.yaml                   terms en/de with definitions, aliases, links
    playbooks.yaml                  questions, hypotheses per hotspot type and workshop scripts per journey stage S0..S12
    slicing.yaml                    roles, recommended slice keys with owners, never-slice-by, exposure, pitfalls
    templates/index.yaml            template index (calibration, activity label kind, evidence)
    templates/*.json                wise norms (library format, schema_version 2)
    mappings/*.yaml                 curated label -> canonical id mappings (test oracles and public-log presets)
  o2c/README.md                     the O2C draft with the measured shares (input; kept as is)
  src/wise_knowledge/
    paths.py      root and pack discovery (built-in folders, WISE_KNOWLEDGE_ROOT, entry point wise_knowledge.packs)
    schema.py     JSON Schema validation plus cross-reference checks; template norms loaded with wise
    models.py     typed dataclasses (Pack, Activity, Stage, FailureMode, WisePattern, Kpi, ...)
    loaders.py    load_pack, load_datasets, load_mapping
    graph.py      knowledge graph as node and edge tables, explain(constraint), optional networkx export
    matching.py   activity canonicalisation: normalisation, label packs, token overlap, fuzzy ratio
    labels.py     distinct activity keys from a CSV (pandas usecols, csv fallback)
    cli.py        wise-knowledge validate | match | show | graph | explain
  tests/                            schema, loader, template, matching, graph and CLI tests
```

Label packs: `p2p` has `bpic2019` (all 42 labels of the challenge CSV plus
the two spellings used by the paper's norm), `ocel2_p2p` (10 event types,
lifecycle `complete`), `hackathon` (10 purchase labels) and `sap_mm`
(transaction vocabulary, English and German, with tcodes); `o2c` has
`hackathon` (16 sales labels), `ocel2_order_management` (11 activities) and
`sap_sd`.

Templates: `p2p/templates/p2p_bpic19.json` is a verbatim copy of the paper's
norm (`wise-lib/examples/bpic19_norm.json`, 29 constraints, raw BPIC 2019
labels, calibrated for that log only); `p2p_baseline.json` and
`o2c/templates/o2c_baseline.json` use canonical ids as activity labels and
carry a `metadata.meta` block with `calibration: uncalibrated` and the list
of parameters to calibrate (the block sits inside `metadata` because the
library rejects unknown top-level keys). Every failure-mode pattern names
the template constraint that implements it and every template constraint
is referenced by a failure mode; a test checks that types, activities and
parameters agree.

Knowledge graph (`graph.py`): node types activity, stage, constraint
pattern, failure mode, cause candidate, remedy, kpi, role; edge types
`in_stage`, `precedes` (stage chain and expected activity orderings),
`detected_by`, `typical_cause`, `typical_remedy`, `owned_by`, plus
`involves` (pattern -> activity) and `measures` (kpi -> failure mode).
Curated edges carry the entry's sources; `explain(constraint_ref)` returns
the path constraint -> failure mode -> candidate causes and remedies,
evidence to check and owner, for the explanation panel.

## Install and use

```bash
cd packages/process-knowledge
python3 -m venv .venv
.venv/bin/pip install -e ~/code/PhD/WISE/wise-lib      # wise-pm, used to validate and score the templates
.venv/bin/pip install -e '.[dev]'                        # pyyaml, jsonschema, rapidfuzz, networkx, pandas, pytest, ruff

.venv/bin/wise-knowledge validate                        # datasets.yaml and every pack
.venv/bin/wise-knowledge match p2p --labels-from <log.csv> --column activity [--key lifecycle=<col>] [--oracle-id bpic2019]
.venv/bin/wise-knowledge match p2p --label "Wareneingang buchen" --label "MIGO"
.venv/bin/wise-knowledge show o2c failure-modes          # also: stages | glossary | activities | kpis | label-packs
.venv/bin/wise-knowledge graph p2p --out /tmp/kg         # node and edge CSVs
.venv/bin/wise-knowledge explain p2p c_l6_change_price   # explanation path for a template constraint
.venv/bin/python -m pytest -q
```

```python
from wise_knowledge import load_pack, Matcher, MatchKey, build_graph

pack = load_pack("p2p")                       # validated; PackError lists every issue otherwise
pack.activity("p2p.gr").stage                 # 'receive'
pack.failure_modes_for_constraint("c_l6_change_price", template="p2p_bpic19")
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
`templates/`, `mappings/`) is discovered through the entry-point group
`wise_knowledge.packs` or by passing its path to `load_pack`.

## Not in this increment

BPMN reference models (`bpmn/*.bpmn`), embedding candidates for matching
and label packs for Ariba, Coupa, Oracle and D365 are listed in
`CHECKPOINT.md` under "Not done".
