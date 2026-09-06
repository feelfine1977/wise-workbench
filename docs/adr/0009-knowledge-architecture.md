# ADR 0009 — Knowledge architecture: canonicalisation first, embedded RAG, graph as data model, no framework, MCP as second transport

Status: accepted (2026-09-05)

## Context
A local model must reason about a particular process (P2P, O2C, order
management, production) without seeing raw data or inventing facts.
Options discussed: RAG, knowledge graphs, LangChain-style frameworks, MCP,
fine-tuning.

## Decision
1. A curated **process knowledge base** (`packages/process-knowledge`:
   ontology with system label packs, stage models, failure-mode catalogue
   linked to WISE constraint patterns, KPIs, glossary, playbooks, norm
   templates, slicing guidance; every entry versioned with sources).
2. **Activity canonicalisation** at mapping time, human-confirmed and
   versioned; digests carry canonical ids and stages.
3. **Embedded RAG** over company documents and long-text knowledge (hybrid
   BM25 + vector, metadata and graph-constrained filters, citations;
   LanceDB or DuckDB `vss`; embeddings through the same provider). Never
   over the event log.
4. The **knowledge graph** is the data model of the knowledge base and of
   project memory (node/edge tables, `networkx` in memory, graph tools); no
   graph database.
5. **No LangChain/LlamaIndex**; a thin in-house loop with pydantic schemas
   and Ollama's schema-constrained output; PydanticAI is the only library
   considered later; DSPy offline only.
6. **MCP**: server role in v1 (tool registry over stdio/HTTP), client role
   in v2 (allow-listed knowledge connectors, read-only).
7. Fine-tuning only after v1 evaluation shows persistent failures.

## Consequences
The no-LLM path also improves (templates and failure modes apply through
the mapping); content curation becomes a scheduled activity with a review
workflow; retrieval and profiles are part of the audit record; the trust
rules of ADR 0005 and 0007 are unchanged.
