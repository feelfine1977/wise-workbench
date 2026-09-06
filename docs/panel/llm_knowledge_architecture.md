# WISE Workbench — Knowledge architecture for the assistant

Follow-up to `llm_specialist.md`. Questions answered here: is retrieval
augmented generation (RAG) or a knowledge graph the right way to make a
local model useful; what to do about MCP, LangChain and similar; and how a
model comes to "understand" a particular process such as purchase-to-pay
(P2P), order-to-cash (O2C), order management or production.

Position in one paragraph: the largest gain is not a retrieval technology
but **canonicalisation** — mapping the log's activity labels and the norm's
constraints onto a curated reference model of the process, so that every
digest the model sees carries stage, canonical activity and failure-mode
context. Retrieval over company documents is a second, genuinely useful
layer and is built embedded (no vector-database service). The knowledge
graph is the *data model* of the curated knowledge, not a separate graph
database. Frameworks are not adopted; MCP is adopted as a second transport
for the tool registry that already exists.

## 1. Four layers of knowledge

| Layer | Content | Size, volatility | Delivery | Retrieval |
|---|---|---|---|---|
| L0 method | what constraints, layers, views, PI, shrinkage, hotspot types and validation readings mean; the allowed vocabulary | ~1.5k tokens, stable | system prompt per use case, golden few-shots | none |
| L1 reference process | ontology of activities and stages per process, variants, failure-mode catalogue, KPI definitions, glossary, question playbooks, norm templates, slicing guidance | hundreds of entries per process, versioned with the app | structured tools + a **process profile** assembled per project with a token budget | deterministic lookup by id; embeddings only for label matching and glossary search |
| L2 company | SOPs, work instructions, BPMN exports, ERP customisation notes, owner registry, previous A3s and decisions, meeting notes, tickets | tens to thousands of pages per project, changes | RAG over uploaded documents; project memory over structured records | hybrid lexical + vector, metadata filters, citations |
| L3 evidence | the log, case table, norm versions, runs, backlogs, drivers, validation | large, exact | typed tools over `wise` and `wise-analytics` | never by similarity; numbers only from tools |

The layers map onto the trust rules of `llm_specialist.md`: L3 numbers are
cited to tool results, L1/L2 statements are cited to knowledge entries or
document chunks, L0 is the model's own competence and is checked by golden
tests.

## 2. Reference process knowledge base (PKB)

A curated, human-authored package (`packages/process-knowledge`, superseding
`process-templates`, which becomes one of its parts). Per process:

| Part | Content | Example (P2P) |
|---|---|---|
| Ontology | canonical activities with ids, stage, description, synonyms, **system-specific label packs** (SAP MM/SRM, Ariba, Coupa, Oracle, D365, generic), object types they touch | `p2p.gr` "Record Goods Receipt", stage *receive*, SAP `WE`, synonyms "GR", "Wareneingang" |
| Stage model | ordered stages with expected orderings and allowed loops; variants | request → approve → order → receive → invoice → match → pay; variants: 2-way match, service entry, consignment, framework order |
| Failure-mode catalogue | name, signature in event terms, the **WISE constraint pattern** that detects it, typical causes (as candidates), typical remedies, evidence to check before acting, owner role | *price change after PO* — `Change Price` after `Create PO Item`; presence/count constraint in layer *change discipline*; causes: quotations expired, catalogue prices stale, negotiations after ordering; check: vendor concentration, material group |
| KPI definitions | formula in WISE terms where possible, unit, direction | touchless rate, three-way-match first-time rate, PO cycle time, DPO |
| Glossary | terms with definitions, both languages | "Sperrgrund", "payment block", "MIRO" |
| Playbooks | questions per journey stage, typical hypotheses per hotspot type, workshop scripts | "Ask the buyer whether the change came before or after the vendor's confirmation" |
| Norm templates | `wise` norms with thresholds flagged uncalibrated (as before) | `p2p_baseline.json` |
| Slicing guidance | recommended keys, their owner roles, identification pitfalls | vendor, purchasing org, material group, document type; never single users |
| Sources | citations for every entry (APQC PCF, vendor process documentation, BPI Challenge reports, literature) | — |

Format: YAML/JSON files validated by a JSON Schema in CI; each entry has an
id, a version, sources and a review status. The domain lead owns content;
engineering owns schema and loaders. The first shipment is P2P and O2C
(the deepest public evidence: BPIC'19, BPIC'12/17 for credit variants,
SAP process documentation); order management and production follow.

### 2.1 What is distinctive per process

| Process | Case notion pitfalls | Typical failure modes to catalogue | Slice keys | Source systems |
|---|---|---|---|---|
| P2P | PO item vs PO header vs invoice; flow types (3-way, 2-way, consignment, service); replicated header events | maverick buying, price/quantity change after PO, GR after IR, payment blocks, duplicate invoices, cancelled GR, late approvals, vendor-created invoices without PO | vendor, purchasing org, material group, document type, company code | SAP MM/FI, Ariba, Coupa, Oracle |
| O2C | sales order item vs delivery vs invoice; partial deliveries and splits; returns as new cases or loops | credit blocks, delivery blocks, backorders, returns and credit memos, invoice corrections, late dunning, manual price changes | customer, sales org, distribution channel, product family, plant | SAP SD/FI, D365, Salesforce + ERP |
| Order management (e-commerce, distribution) | order vs shipment vs parcel; cancellations; address changes; multi-warehouse allocation | ATP failures, allocation churn, split shipments, carrier exceptions, cancellations after picking, returns without RMA | channel, warehouse, carrier, region, product category | OMS, WMS, carrier APIs, marketplaces |
| Production / manufacturing | production order vs batch vs serial number vs operation; planned vs actual timestamps; MES event granularity; shifts | rework loops, scrap after inspection, confirmations out of order, setup time overruns, waiting before bottleneck operations, quality notifications open at delivery, maintenance interruptions | work centre, machine, shift, product family, plant, routing version | SAP PP/QM/PM, MES, SCADA historians |

Each row becomes a stage model, an ontology and a catalogue; the norm
template is derived from the catalogue (one constraint pattern per failure
mode), which keeps templates and knowledge consistent.

## 3. Activity canonicalisation (new feature, MVP)

Pipeline at mapping time (S2), human-confirmed, stored as `ActivityMapping`:

1. normalise labels (case, separators, SAP transaction codes, language);
2. lexical candidates (token overlap, `rapidfuzz`) against the ontology and
   its label packs;
3. embedding candidates (`bge-m3` via Ollama; multilingual, so German and
   English labels meet) — only when lexical confidence is low;
4. candidate list with confidence and stage shown in the mapping screen; the
   analyst confirms, corrects or marks *custom* with a stage; unmapped
   labels stay visible as a readiness item;
5. the mapping is versioned with the case table and used everywhere:
   digests carry `canonical_id` and stage, templates and failure modes
   become applicable automatically, narratives may say "goods receipt
   before invoice" instead of quoting cryptic labels.

Optionally a small classifier trained on confirmed mappings across projects
(no LLM needed) improves the candidates over time.

## 4. Retrieval augmented generation — where it belongs

Yes for L2 documents and for the long-text parts of L1 (playbooks, glossary);
no for the event log or any number.

Design:

- **Ingestion**: PDF, DOCX, Markdown, HTML, BPMN XML, Confluence/SharePoint
  exports; structural chunking (headings, 300–500 tokens, small overlap);
  metadata per chunk: project, document type, language, process stage,
  canonical activity ids found in the chunk, owner role.
- **Embeddings**: `bge-m3` (1024 dims, multilingual) as default; `nomic-embed-text`
  as a small fallback; computed through the same `LLMProvider` (Ollama's
  embeddings endpoint); model name and version stored with the index.
- **Store**: embedded, no service — LanceDB (Parquet-native, fits the
  Parquet/DuckDB storage) or DuckDB's `vss` extension; index per project
  under `projects/<id>/knowledge/`; rebuilt when the embedding model
  changes.
- **Retrieval**: hybrid — BM25 (DuckDB `fts`) and vector search merged by
  reciprocal rank fusion, metadata filters (stage, activity ids, document
  type), optional cross-encoder re-ranking (`bge-reranker-v2-m3`, optional
  extra) on the top 30, 6–8 chunks passed to the model.
- **Graph-constrained retrieval**: entities mentioned in the question or
  present in the current screen (canonical activities, constraints, slice
  keys) are expanded one to two hops in the knowledge graph (§5) and used
  as filters and as boosts before vector search — this is the useful part of
  "GraphRAG" without its community-summary machinery.
- **Citations**: every chunk carries document id, page or heading; answers
  cite `[doc:page]`; the UI shows the snippet; uncited claims are removed by
  the faithfulness check.
- **Project memory** (findings, gates, hypotheses, actions, decisions,
  previous narratives) is structured and reached through tools, not
  vectors; free-text notes are additionally indexed.
- **Evaluation**: a labelled question set per process (retrieval recall@k,
  citation faithfulness, answer groundedness judged by a larger local
  model) runs in the evaluation harness; regressions block prompt or
  index changes.
- **Rules**: documents are untrusted input (injection screening, quote-only
  rendering); no cross-project retrieval unless a document is placed in the
  workspace library on purpose; embeddings never leave the workspace.

## 5. Knowledge graph — a data model, not a database

Node types: process, stage, canonical activity, object type, role/system,
constraint, layer, failure mode, cause (candidate), remedy, KPI, document,
finding, hypothesis, action, slice signature. Edge types: `precedes`,
`in_stage`, `performed_by`, `detected_by` (failure mode → constraint
pattern), `typical_cause`, `typical_remedy`, `evidenced_by`, `addresses`,
`owned_by`, `similar_to`.

What it buys:

- grounding: labels → canonical activities → stages, used by digests and
  narration;
- candidate hypotheses: constraint → failure mode → typical causes and
  remedies, surfaced as *candidates with sources*, never as findings; the
  causal-language gate and the human validation gate stay in force;
- explanation paths shown in the UI ("this driver detects *price change
  after PO*; typical causes …; evidence to check …");
- cross-project memory: violation signatures of resolved hotspots linked to
  the actions that worked.

Implementation: node and edge tables in the metadata database, loaded into
`networkx` in memory for traversal, exposed as tools (`graph.neighbors`,
`graph.path`, `graph.explain(constraint_id)`). No Neo4j and no separate
graph service; revisit only if the graph exceeds ~10^5 nodes. Curated edges
carry sources; learned edges (from project history) are marked as such and
require a minimum number of confirmations before they are shown.

## 6. Frameworks

| Option | Role | Verdict |
|---|---|---|
| LangChain | chains, agents, integrations | not adopted: abstraction churn, hidden prompts, hard to audit, wide dependency tree; our loop is small and must be fully traceable |
| LangGraph | stateful agent graphs | not needed: the journey state machine lives in the domain layer; the tool loop is one function |
| LlamaIndex, Haystack | RAG pipelines | not adopted for the same reasons; their chunkers and retrievers are reimplemented in ~500 lines with DuckDB/LanceDB and stay testable |
| PydanticAI | typed agents, structured outputs, tools, Ollama support | acceptable if a library is wanted; small, typed, auditable; keep it behind the provider/loop interface |
| Instructor | structured outputs via pydantic | redundant once Ollama's schema-constrained `format` is used |
| Outlines, guidance | constrained decoding | redundant on Ollama (llama.cpp grammar enforces the JSON schema); relevant only for a vLLM server profile |
| DSPy | prompt optimisation against metrics | optional, offline: tune prompt variants against the golden sets; results are committed as ordinary versioned prompts |
| Semantic Kernel | .NET/Python orchestration | not relevant |
| vLLM, llama.cpp server, LM Studio | alternative runtimes | supported through the OpenAI-compatible provider; vLLM is the server-mode option when throughput matters |

Decision: a thin in-house loop (provider, tool registry, schema-validated
outputs, retries with error feedback, audit) plus pydantic models; Ollama's
`format` with a JSON Schema for every structured output; `PydanticAI` as
the only library considered if the loop grows.

## 7. Model Context Protocol (MCP)

Two roles, both cheap because the tool registry already has JSON schemas:

- **Server** (v1): expose the read-only tools and the staging tool over MCP
  (stdio for desktop hosts, streamable HTTP with the per-launch token in
  server mode). Any MCP host — an IDE assistant, a desktop LLM client, a
  future agent — can then query norms, backlogs and slices and stage
  proposals through the same audited path. "One registry, two transports."
- **Client** (v2): consume external MCP servers as knowledge connectors
  (wiki, document management, ticketing, ERP metadata). Servers are
  allow-listed per workspace, their content is untrusted, results are
  indexed like uploaded documents, and no write tools are enabled.

Agent-to-agent protocols and multi-agent orchestration are not adopted; one
loop with process-specific profiles is enough for the use cases.

## 8. Fine-tuning

Not before the v1 evaluation. Reasons: a LoRA pins a model version, needs
1–2k verified examples per task, and most failures observed with small
models are context or schema problems that canonicalisation, profiles and
schema-constrained decoding fix. Candidate tasks if golden sets still fail
on 4B–8B models: constraint-proposal drafting and narration style. Ollama
loads adapters through a Modelfile; training would use `unsloth` or
`llama.cpp` offline on the evaluation corpus and synthetic logs.

## 9. Context assembly — the process profile

`assistant/context_builder.py` assembles, per turn and within the model's
context (`num_ctx` 8k, 16k or 32k):

| Block | 8k budget | 16k budget | Selection rule |
|---|---|---|---|
| system + method (L0) | 1.2k | 1.2k | per use case |
| process profile (L1) | 1.5k | 3k | stages present in the log; failure modes whose constraint patterns are in the norm; glossary terms present in labels |
| mapping table | 0.5k | 1.5k | canonical id, label, stage; top-N by frequency |
| digests (L3) | 1.5k | 3k | per use case, id-addressed |
| retrieved chunks (L2) | 1.5k | 4k | hybrid retrieval, cited |
| history | 1k | 2k | last turns, summarised |

Profiles are cached per (project, norm fingerprint, mapping version) and
their content is part of the audit record.

## 10. Placement, entities, features, roadmap deltas

Modules: `packages/process-knowledge` (PKB content, schema, loaders,
graph builder); `adapters/knowledge` (document ingestion, chunking,
embeddings, LanceDB/DuckDB index, hybrid retrieval); `adapters/mcp`
(server and client transports for the tool registry); `assistant/
context_builder.py`; tools `kb.*`, `docs.*`, `graph.*`. Entities:
`ActivityMapping`, `Document`, `DocumentChunk`, `KnowledgeNode`,
`KnowledgeEdge`, `Retrieval` (audit of what was retrieved for each turn).

| ID | Feature | Tier |
|---|---|---|
| F33 | Activity canonicalisation with candidates and human confirmation; system label packs | M |
| F34 | Process knowledge base: P2P and O2C (ontology, stages, failure modes, KPIs, glossary, playbooks, templates) | M |
| F35 | Explanation paths and candidate hypotheses from the knowledge graph, with sources | S |
| F36 | Document library with grounded, cited Q&A (hybrid retrieval, embedded index) | S |
| F37 | MCP server exposing the tool registry | S |
| F38 | Order management and production knowledge packs; ITSM | S |
| F39 | MCP client connectors; cross-project memory of signatures and actions | L |
| F40 | LoRA adapters for weak local models | research |

Roadmap: F33 and F34 join the MVP (they also improve the no-LLM path:
templates and failure modes apply through the mapping); F35–F38 join v1
with the assistant; F39–F40 are v2/research.

Risks: curated content is the bottleneck (mitigate with the two-process
start, a review workflow and sources per entry); wrong canonical mappings
propagate (mitigate with confidence display, readiness item, versioning);
retrieval returns stale SOPs (document versions and dates shown; the
answer names the document version); larger contexts need memory (profile
budgets per tier; 8k floor works without documents).
