# ADR 0005 — The LLM assistant is optional, tool-grounded, and only proposes

Status: accepted (2026-09-05)

## Context
Norm elicitation and result narration benefit from natural language, but
stakeholder artefacts must stay auditable and data must stay on premises.

## Decision
The assistant sits behind an `LLMProvider` protocol (Ollama locally;
recorded provider for tests; null provider when absent). The library is the
only source of numbers: the model calls typed tools mapped to library
functions, receives compact id-addressed digests, and must cite tool results
for every number and id. Outputs are structured (JSON schemas) and become
staged proposals accepted through the same forms as the no-LLM path;
accepted constraints pass `Norm.from_dict`, create a new norm version and are
linked to the audit record. Thresholds, widths, weights, γ, readings, causes
and owners are never set by the model. Every prompt, tool call and response
is stored; prompts are versioned and gated by golden tests. Log text is
treated as untrusted and pseudonymised where personal.

## Consequences
The app works fully without a model; the no-LLM fallbacks (wizard, lint
list, template narration, playbook, checklist) are the same code the LLM
path depends on and are built first.
