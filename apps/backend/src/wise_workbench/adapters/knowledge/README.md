# adapters/knowledge

Document library and retrieval: ingestion (PDF, DOCX, Markdown, HTML, BPMN
XML, wiki exports), structural chunking with metadata (project, document
type, language, stage, canonical activity ids), embeddings through the
`LLMProvider` (`bge-m3` default, `nomic-embed-text` fallback), embedded
index per project (LanceDB or DuckDB `vss`), hybrid BM25 + vector retrieval
with reciprocal rank fusion, metadata and graph-constrained filters,
optional cross-encoder re-ranking, citations `[doc:page]`. Never indexes the
event log. Documents are untrusted input.
