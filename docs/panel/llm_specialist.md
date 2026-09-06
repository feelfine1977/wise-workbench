# WISE Workbench — Assistant layer (local LLM via Ollama)

Panel report, LLM application specialist. Scope: the optional assistant of the WISE Workbench (Python backend + web frontend, local-first, on-premises data). Grounded in `wise-lib` (`README.md`, `src/wise/norm.py`, `src/wise/constraints.py`, `examples/bpic19_norm.json`) and the paper (Sec. I, III, VI).

## 0. Design stance

1. **The library is the oracle.** Every number, id, activity label, threshold and slice key the assistant utters originates from a tool result computed by `wise-lib`. The model asks, composes, proposes and explains; it never computes and never guesses a value.
2. **The assistant proposes, people decide.** Its only "writes" are *staged proposals* (constraints, weights, hypotheses, report drafts) that a person accepts, edits or rejects in the same forms the no-LLM app already has. Accepted constraints pass `Norm.from_dict`; the norm gets a new version and `Norm.fingerprint()`; the proposal's audit id is stored in `Norm.metadata.provenance`.
3. **Everything works without it.** Each use case has a deterministic fallback (Sec. 7). The LLM adds dialogue, business language and synthesis on top of deterministic computations, never instead of them.
4. **Log text is untrusted and possibly personal.** Activity labels, attribute values and resource names enter prompts only sanitised, id-addressed and (for resources) pseudonymised.

## 1. Use cases

### 1.1 Shared inputs: digests
Compact JSON built by the backend from `wise-lib` objects, with stable ids so the model references instead of restating. Sizes are approximate tokens for the BPIC'19 norm.

| Digest | Built from | Content |
|---|---|---|
| `NormDigest` (≈2.2k) | `Norm.to_dict()`, `describe()`, `layer_weight_table()` | name, version, fingerprint[:12], scoring_mode, layers `{id,name,n}`, views `{name,layer_weights}`, constraints `{id,layer,type,params,weight,app,desc}` |
| `LogDigest` (≈1.5k) | `EventLog.validate()`, `activity_labels`, case table | n_cases, n_events, window, activities `[{aid,label,case_share}]` (top 60), attributes `[{name,kind,cardinality,top:[{vid,value,share}]}]` (top 12 values), quality flags |
| `DistSummary` (≈150) | `derive.compute_recipe` (`lag`, `count`, `agg`, `ratio`), `EventLog.count/first_ts/first_after/total` | n_evaluable, n_missing_a/b, quantiles p50..p99, `candidates:[{label,value}]`, share above each candidate |
| `BacklogDigest` (≈60/row) | `prioritize`, `concentration`, `hotspot_table`, `layer_drivers` | params (view, by, gamma, volume, baseline), global_mean, rows `{sid,keys,n_cases,mean_score,stable_gap,stable_PI,pi_share,hotspot,dominant_layer}`, concentration 80/95 |
| `SliceDigest` (≈600) | backlog row, `layer_drivers`, `constraint_drivers`, `validation_table`, `worst_cases(n=5)` | layers `{contrib,delta}`, constraints `{cid,mean_penalty,mean_violation,violated_share,in_scope_share,evaluated_share}`, `{censored_share,replicated_share,retained,reading}`, case ids |
| `CaseDigest` (≈400) | `ScoreResult.trace`, `violations`, `contributions` | events `{aid,ts,res_pseudo}` (cap 60), violations by cid, layer contributions |
| `JourneyState` (≈150) | app DB | stage, artefact versions, open proposals, outstanding validation flags, last re-score, period comparison available? |

Ids: `aid` (activity), `vid` (attribute value), `cid` (constraint), `sid` (slice, e.g. `s:company=ID_0001|spend_area=Packaging`), `case_id`. The model outputs ids; the frontend resolves them to labels.

### 1.2 Use-case matrix

| # | Use case | Trigger | Model sees | Tools | Output contract | Human step | On LLM failure |
|---|---|---|---|---|---|---|---|
| U1 | Norm elicitation | "Draft norm" wizard, or free text in the norm editor | `LogDigest`, current `NormDigest`, layer catalogue (paper Table II), dialogue so far | `get_log_digest`, `summarize_lag`, `summarize_count`, `summarize_attribute`, `summarize_balance`, `validate_constraints`, `search_docs(templates)` | `ConstraintProposal` (1.3) | Proposal cards → accept/edit/reject per constraint; weights via sliders | Open the constraint form pre-filled with whatever passed validation; else empty form |
| U2 | Norm review | "Review norm" button; automatically after import | `NormDigest`, `lint_norm` output, `preview_constraints` stats | `lint_norm`, `preview_constraints`, `get_log_digest`, `search_docs` | `NormReview` (1.4) | Findings list; each suggested change is a proposal card | Show `lint_norm` findings with canned explanations |
| U3 | Result narration | Backlog or slice screen opened; "Explain" | `BacklogDigest` (top 12) or `SliceDigest`, params | `get_backlog`, `get_slice`, `get_validation`, `compare_views` | `Narrative` (1.5) | Marked "AI draft" until analyst ticks "reviewed"; editable | Template narration (Sec. 7) with the same numbers |
| U4 | Action hypotheses | "Propose hypotheses" on a slice | `SliceDigest`, top cases' `CaseDigest` (≤3), playbook passages | `get_slice`, `get_cases`, `get_trace`, `get_validation`, `search_docs(playbooks)` | `ActionHypotheses` (1.6) | Hypothesis cards: assign owner, status, next check; nothing executes | Playbook lookup keyed by (layer, type, hotspot, validation) |
| U5 | Q&A over results | Chat box on any results screen | Screen context (view, by, sid), digests on demand | all read tools | `Answer` (1.7) | Follow-up chips; "open in screen" links | "I can't answer that; here is the relevant table" + filter UI |
| U6 | Journey guidance | "What next?"; stage change | `JourneyState`, backlog/validation summary | `get_journey_state`, `get_validation`, `compare_periods` | `NextStep` | Buttons that navigate to the screen/action | Static checklist state machine |
| U7 | Report drafting | "Draft report" in the governance screen | Digests of everything reviewed + accepted hypotheses + narratives marked reviewed | read tools only | `ReportDraft` (sections of `Narrative`) | Editor with tracked provenance; export | Template report (tables + template sentences) |

### 1.3 U1 Norm elicitation
Interview stages, one question per turn: goal (e.g. "reduce processing cost 10 % without increasing financial risk") → concerns per layer (completeness, timeliness, effort, risk/discipline, control; paper Table II) → per expectation: activities (must be `aid`s from `LogDigest`), constraint type, applicability (flow type / document type `vid`s), thresholds → views (layer weights per role) → slice keys (ownership attributes). Thresholds: the model must call a `summarize_*` tool and pick a `candidate` from its result; `threshold_source` is required. Rule of thumb offered to the user, never silently applied: `delta = p75`, `width = p95 − p75` for lags; `k = p90 count`, `K = 2` for singularity; `tau` from the p90 of relative differences for balance; exclusion for "should never happen"; presence for "must happen"; precedence for "not before".

Tool-loop exchange (Ollama `/api/chat`, abbreviated):
```json
{"model":"qwen3:8b","stream":true,"think":false,"keep_alive":"30m",
 "options":{"temperature":0,"seed":7,"num_ctx":16384,"num_predict":1024},
 "messages":[{"role":"system","content":"<elicitation/v3 prompt>"},
   {"role":"user","content":"Invoices on standard POs should be cleared within a month of receipt."}],
 "tools":[{"type":"function","function":{"name":"summarize_lag","description":"Distribution of time from first a to first b per case; use before proposing any lag threshold.",
   "parameters":{"type":"object","properties":{"a":{"type":"array","items":{"type":"string"}},"b":{"type":"array","items":{"type":"string"}},
   "unit":{"type":"string","enum":["D","h","W"]},"applicability":{"type":"object"}},"required":["a","b","unit"]}}}]}
```
Model reply: `tool_calls:[{"function":{"name":"summarize_lag","arguments":{"a":["A012"],"b":["A019"],"unit":"D","applicability":{"flow_type":["V01","V02","V03"]}}}}]`. The app validates args (ids exist, unit in enum, applicability passes `_normalise_applicability`), runs the tool, appends `{"role":"tool","tool_name":"summarize_lag","content":"{\"n_evaluable\":181204,\"n_missing_b\":21377,\"quantiles\":{\"p50\":9.1,\"p75\":21.4,\"p90\":38.0,\"p95\":52.6,\"p99\":91.2},\"candidates\":[{\"label\":\"p75\",\"value\":21.4},...],\"share_above\":{\"30\":0.16}}"}` and makes the final call **without `tools` and with `format` = the schema below** (Ollama enforces the schema by grammar; do not combine `tools` and `format` in one call).

```json
{"$id":"ConstraintProposal/v1","type":"object","required":["proposals","questions"],
 "properties":{
  "proposals":{"type":"array","maxItems":5,"items":{"type":"object","required":["constraint","rationale","evidence","threshold_source"],
   "properties":{
    "constraint":{"type":"object","required":["id","layer","type","params","applicability","description"],
      "properties":{"id":{"type":"string"},"layer":{"type":"string"},
        "type":{"type":"string","enum":["presence","lag","balance","singularity","exclusion","precedence","metric"]},
        "params":{"type":"object"},"weight":{"type":"number"},"applicability":{"type":"object"},"description":{"type":"string"}}},
    "rationale":{"type":"string"},
    "evidence":{"type":"array","items":{"type":"string"}},
    "threshold_source":{"type":["object","null"],"properties":{"tool_call_id":{"type":"string"},"candidate":{"type":"string"}}},
    "confidence":{"type":"string","enum":["low","medium","high"]}}}},
  "questions":{"type":"array","maxItems":2,"items":{"type":"string"}}}}
```
Post-validation by the app, in order: (1) `aid`/`vid` substitution back to labels; (2) `constraint` merged into the working norm and checked with `Norm.from_dict` (note `_CONSTRAINT_KEYS` rejects unknown keys, so `rationale`/`evidence` live outside `constraint`); (3) `Norm.check(log)` for unknown activities/attributes; (4) numeric params must equal a candidate from the referenced tool result; (5) `preview_constraints` computes applicable share, mean violation, violated share, shown on the card ("16 % of cases would violate"). Failing (2)–(4) returns the error text to the model once; a second failure drops the proposal and logs it.

### 1.4 U2 Norm review
`lint_norm` (deterministic) finds: same activity set used by two constraints in one layer or by presence+lag with `missing_b="violate"` (double counting); constraints without applicability while `flow_type`-like attributes exist and the activity's case share differs by value > 0.3; thresholds violated by > 60 % of applicable cases (unrealistic) or < 0.5 % (vacuous); layers with one constraint; views leaving a layer at weight 0; `weight` outliers; derived attributes never referenced. The LLM receives the lint output plus `NormDigest` and produces `NormReview = {findings:[{kind: enum[double_counting, missing_applicability, unrealistic_threshold, vacuous, overlap, weight_imbalance, missing_expectation, unclear_description], constraint_ids:[cid], severity: enum[info,warn,error], explanation, suggested_change: ConstraintProposal.item|null, evidence:[tool_call_id]}]}`. It may add `missing_expectation` findings (e.g. no control layer although balance attributes exist) but every other finding must cite a lint or preview result.

### 1.5 U3 Result narration
`Narrative = {title, summary, sections:[{heading, text, claims:[{value, tool_call_id, path}]}], caveats:[string], hotspot_reading:{sid, kind: enum[reservoir,mechanism,severity], dominant_layer}}`. Every numeric token in `text` must appear in `claims` and resolve (with rounding tolerance) to `tool_results[tool_call_id][path]`; every `sid`/`cid`/`aid` must exist in the session vocabulary; `caveats` must include the `validation_table.reading` of any narrated slice with `censored_share > 0.2` or `replicated_share > 0.2`. Example section text the checker accepts: "Slice {s:company=ID_0002|spend_area=Sales} ranks first with stable PI 812.4 (7.9 % of the priority mass) and a mean score 0.11 below the global mean 0.71; the gap is driven by layer L3_timeliness_ageing (+0.06) and constraint c_l3_invoice_to_clear_days. Reading: mechanism hotspot; 24 % of its cases are right-censored, so treat the ageing signal as needing window validation."

### 1.6 U4 Action hypotheses
`ActionHypotheses = {hypotheses:[{hid, sid, layer, constraint_ids:[cid], statement, evidence:[{tool_call_id, path, value}], validation_status: enum[action_ready, needs_source_validation, window_artefact, insufficient_support], suggested_owner_role, suggested_checks:[string], confidence}]}`. Prompt rules: statements are phrased as hypotheses ("may", "consistent with"), never as causes; `validation_status` is copied from `validation_table.reading` and `n_cases < min_support` → `insufficient_support`; each hypothesis needs ≥ 2 evidence links (one driver, one validation). The playbook (`search_docs`) supplies intervention vocabulary (contract terms, master data, escalation rules, handling policies — paper Sec. I) but the model must connect it to a cited driver.

### 1.7 U5–U7
U5 `Answer = {text, claims, followups:[string], insufficient_data: bool, open_in:{screen, params}|null}`; unanswerable → `insufficient_data=true` with the nearest table. U6 `NextStep = {stage, actions:[{action, why, screen, params}], blockers:[string]}` derived from `JourneyState`; the rule engine of Sec. 7 produces the candidate list, the LLM only orders and explains it. U7 assembles reviewed `Narrative`s and accepted hypotheses into a `ReportDraft`; unreviewed material is excluded by construction.

## 2. Model and runtime

Ollama capabilities used (all present in the installed 0.33.1; minimums: tools ≥ 0.3, JSON-schema `format` ≥ 0.5, streaming tool calls ≥ 0.8, `think` ≥ 0.9, `/api/show` `capabilities`): `POST /api/chat` with `tools` (function calling), `format` (JSON schema, grammar-constrained), `options` (`temperature`, `seed`, `num_ctx`, `num_predict`), `keep_alive`, `think`; `POST /api/embed`; `POST /api/show`; `GET /api/ps`, `/api/tags`, `/api/version`. Python: the `ollama` package (`ollama.Client(host)`, `chat(..., tools=[...], format=Model.model_json_schema())`).

| Hardware class | Primary model (tag, quant, weights) | Alternatives | `num_ctx` | Expected decode / TTFT (6k prompt) |
|---|---|---|---|---|
| 8 GB (unified or VRAM) | `qwen3:4b` Q4_K_M, 2.6 GB | `llama3.2:3b`, `qwen2.5:3b` | 8192 (KV ≈ 1.2 GB) | 30–50 tok/s Apple M-series; 6–10 tok/s CPU-only; TTFT 10–25 s |
| 16–32 GB | `qwen3:8b` Q4_K_M 5.2 GB (16 GB); `qwen3:14b` Q4_K_M ≈ 9 GB or `gpt-oss:20b` MXFP4 ≈ 14 GB (32 GB) | `llama3.1:8b`, `mistral-small3.2:24b` (32 GB), `qwen3:30b-a3b` (fast MoE, 32 GB) | 16384 (KV ≈ 2.4 GB at 8B; use `OLLAMA_KV_CACHE_TYPE=q8_0` + `OLLAMA_FLASH_ATTENTION=1` to halve) | 25–60 tok/s; TTFT 8–20 s |
| 64 GB+ | `qwen3:32b` Q4_K_M ≈ 20 GB or `llama3.3:70b` Q4_K_M 42 GB (installed) | `qwen2.5:72b`, `gpt-oss:120b` (≥ 80 GB) | 32768 (70B KV ≈ 10 GB) | 70B: 8–15 tok/s on M2/M3 Ultra, TTFT 40–90 s; 32B: 15–25 tok/s |

Rules: Q4_K_M is the floor (never Q2/Q3 for tool calling); prefer Q8_0 for ≤ 8B when memory allows (measurably better JSON and argument fidelity); Gemma 3 and Phi-4 lack tool templates in Ollama, DeepSeek-R1 is slow and verbose, so they are not candidates. `think=false` by default (latency, determinism); optionally `think=true` for U1/U2 on 32B+ where the reasoning budget helps interview quality. Set `num_ctx` explicitly per request (Ollama default is 4096 unless `OLLAMA_CONTEXT_LENGTH` is set) and keep `OLLAMA_NUM_PARALLEL=1` so the KV prefix cache is reused: system prompt + digests form the stable prefix, the volatile turn goes last.

Latency budgets (per turn, streamed): tool-call decision ≤ 4 s at 8B; final structured answer ≤ 15 s (≤ 600 output tokens); U1 whole turn ≤ 25 s; U3 narration ≤ 20 s; U7 report is a background job with progress. Streaming: text deltas stream to the UI; JSON-schema outputs are parsed incrementally only for progress, rendered when complete; tool calls stream as "working: summarize_lag(…)" chips.

Capability probe at startup (`assistant/capability.py`): `/api/version` → `/api/tags` → `/api/show` for the configured model (`capabilities` must contain `tools`; read `details.quantization_level`, `model_info.<arch>.context_length`) → `/api/ps` for free memory → smoke tests: (a) one trivial tool call (`echo`), (b) one `format` schema call, (c) a 300-token generation to measure `eval_count/eval_duration` and `prompt_eval_duration`. Result is a tier: **full** (tools + schema + ≥ 15 tok/s), **schema-only** (no `tools` capability: the model emits `{"tool":…,"args":…}` under a `format` schema, the app runs the loop), **slow** (tier full/schema-only but < 8 tok/s: U3/U5 only, no U1 interview, longer budgets, explicit "this may take a minute"), **off** (Ollama unreachable or no model: whole assistant hidden, fallbacks shown). The tier is displayed in the UI and re-probed on model change.

## 3. Grounding architecture

Presentation: digests (Sec. 1.1) are numeric, id-addressed and deliberately small; the model gets the top-k (12 slices, 8 constraints, 5 cases) with an explicit `truncated: true` and must call a tool for more. Every tool result is stored in the session `tool_results` store under a `tool_call_id` (`t1`, `t2`, …) that outputs reference. Digest generators live in `assistant/digests.py` and are unit-tested against `wise-lib` outputs, so a library change cannot silently change what the model sees.

Retrieval: corpus = norm templates per domain (P2P, O2C, claims, ITSM; paper Sec. VI-C), the action playbook (mechanism → typical interventions and checks), the app docs, and the organisation's own past norms/decisions. This is a few hundred chunks: embed with `/api/embed` and store vectors in SQLite; cosine search in numpy; no vector database. Embedding model: `bge-m3` (1024-d, 8k context, multilingual — German/English stakeholders) or `embeddinggemma` (300M, small, multilingual) for 8 GB machines; `nomic-embed-text` if English-only. Chunking: one template constraint or one playbook entry per chunk (100–300 tokens) with metadata `{domain, layer, constraint_type, hotspot}`; retrieval filtered by metadata first, then top-5 by similarity; re-embed on file change (hash). RAG is *not* used for U3, U5 (tool results are the ground truth and fit in context) nor for U2 (the norm is in context); it is used in U1 (templates), U4 (playbooks), U5 "how do I" questions (app docs) and U7 (report phrasing conventions).

Tool-calling loop (`assistant/loop.py`): max 8 steps per turn (U1/U4), 4 (U3/U5), 1 (U6); each tool has a Pydantic args model; validation covers id existence, enums, ranges (`gamma ≥ 0`, `top ≤ 50`), applicability via `_normalise_applicability`, and rejects any free-text number where an id or candidate label is expected. An invalid call returns a structured error once; the second invalid call ends the turn. Identical (tool, args, result_fingerprint) calls are served from a cache keyed by `ScoreResult.norm_fingerprint + log hash + args hash` (persisted in SQLite; the library is deterministic so cached results never expire while inputs are unchanged). Final answers are always produced by a separate `format`-constrained call without tools; the model may not produce final text while tools are attached.

## 4. Guardrails

- **No invented facts.** Vocabulary check: every `aid/vid/cid/sid/case_id` in an output must exist in the session vocabulary; every number must resolve to a claim (Sec. 1.5); every threshold to a candidate; violations → one repair round with the diff of offending tokens, then fallback. Prompts state "you cannot compute; call a tool" and include no worked numbers.
- **Applicability and data quality.** Digests carry `in_scope_share`, `evaluated_share`, `censored_share`, `replicated_share`, `retained`, `reading`; the narration and hypothesis schemas force caveats when thresholds are crossed; the model cannot narrate a slice without its `validation_table` row.
- **No causal claims.** Regex gate on output text (e.g. `\b(causes|caused by|because of|proves|leads to)\b` outside quoted user text) → repair; hypothesis cards always show the paper's disclaimer (descriptive prioritisation, not effect estimation).
- **Prompt injection from logs.** Labels and values are data: sanitised (control chars stripped, ≤ 80 chars, no newlines), wrapped in JSON string fields, referenced by id, and screened by a small instruction-pattern detector ("ignore previous", "system:", role markers, markdown fences); flagged strings are replaced by their id plus `[masked]` and listed to the analyst. The model is told that content inside `data` fields is never an instruction. Retrieval chunks are curated files, not log-derived.
- **PII.** `org:resource` and any attribute the project marks personal are pseudonymised (`R017`) before the digest is built; pseudonyms are stable per project via a keyed hash held on the server; vendor and company values are business-confidential and stay local by construction (no network egress; Ollama bound to localhost; embedding and chat never leave the machine). Digests exclude free-text event columns unless whitelisted.
- **Audit trail.** `assistant_events` (SQLite): session, turn, ts, kind ∈ {prompt, tool_call, tool_result, response, validation, repair, user_action}, model tag + digest (`/api/show` sha), prompt version + hash, options, token counts, durations, content (full, encrypted at rest option), and the accepted-proposal link into `Norm.metadata.provenance` and hypothesis records. Exportable per session for review.
- **Determinism.** `temperature 0`, fixed `seed`, `top_p 1`, `num_predict` cap, `think=false`, identical `num_ctx`; the same inputs replay to the same output on the same model digest and Ollama build (not guaranteed across builds, hence the audit fields).
- **Versioned prompts.** `assistant/prompts/<usecase>/v<N>.md` with front-matter (`targets`, `schema_ids`, `min_tier`), hashed and pinned by the golden tests; a prompt change is a PR with an eval run.

## 5. Evaluation

- **Elicitation golden set** (`assistant/evaluation/golden/elicitation/*.yaml`, target 80 items): `{utterance, context: {aids, vids, flow_types}, tool_fixtures: {summarize_lag: {...}}, expected: {type, activities, applicability, params_from: "p75"}, alternates: [...], expect_question: bool}`. Scored on type/activities/applicability exact match and on whether the threshold equals the named candidate; negatives ("we hardly ever have problems there") must yield a question, not a constraint. Seeded from paper Table II/III and the 29 BPIC'19 constraints (their descriptions are the utterances).
- **Faithfulness checks** (`assistant/evaluation/metrics.py`): share of numeric tokens resolved to claims; share of ids in vocabulary; caveat coverage (flagged slices narrated with caveat); causal-language rate; schema validity. Applied to every generated output in production too (they are the guardrails) and aggregated per prompt version.
- **Review quality**: precision of `NormReview` findings against a set of 25 deliberately flawed norms (injected double counting, missing applicability, vacuous thresholds).
- **Regression harness**: `pytest -m assistant` replays recorded cassettes (`evaluation/cassettes/<prompt_hash>/<input_hash>.json`, provider `recorded.py`) fully offline in CI; a nightly job runs the live suite against `qwen3:4b` on CPU in the `ollama/ollama` container (≈ 30 minutes for 150 cases) and against the largest configured model on a developer machine before release. Gates: schema validity 100 %, faithfulness ≥ 0.98, elicitation match ≥ 0.80 (8B) / ≥ 0.90 (32B+), zero causal-language violations.
- **Human review protocol**: per release, 20 sampled outputs per use case, two reviewers, rubric 1–5 on correctness, groundedness, usefulness, tone/safety; disagreements > 1 adjudicated; results and rationale in `docs/evals/<release>.md`. In-product thumbs-down with reason codes (wrong number, wrong slice, too generic, misleading) feeds new golden items after review.

## 6. Interfaces

```
wise_workbench/assistant/
  capability.py     probe, tiers, model registry
  providers/        base.py (Protocol: chat(messages, tools, schema, stream, options) -> events), ollama.py, recorded.py, null.py
  digests.py        NormDigest, LogDigest, BacklogDigest, SliceDigest, CaseDigest, JourneyState builders + vocabulary/id maps
  tools/            registry.py (name -> callable, Pydantic args/returns, cache policy), norm_tools.py, data_tools.py, result_tools.py, docs_tools.py, journey_tools.py
  schemas/          Pydantic models of every output contract (ConstraintProposal, NormReview, Narrative, ActionHypotheses, Answer, NextStep, ReportDraft) with json_schema export
  prompts/          <usecase>/v<N>.md + loader (front-matter, hash)
  runners/          elicitation.py review.py narration.py hypotheses.py qa.py journey.py report.py  (build context -> loop -> validate -> stage)
  loop.py           tool loop (step caps, arg validation, cache, repair round)
  guard.py          sanitiser, injection detector, pseudonymiser, vocabulary + faithfulness checker, causal-language gate
  audit.py          assistant_events store, provenance links
  fallback/         Jinja templates (narration, report), form specs (elicitation), playbook.yaml, journey rules
  evaluation/       golden/, cassettes/, harness.py, metrics.py
```

Tool schemas (args → returns; all return JSON digests; RO = read-only, cached; ST = stages a proposal):

| Tool | Args | Returns | Backed by |
|---|---|---|---|
| `get_log_digest` RO | – | `LogDigest` | `EventLog.validate`, `activity_labels`, case table |
| `get_norm_digest` RO | `norm_version?` | `NormDigest` | `Norm.to_dict/describe/layer_weight_table` |
| `summarize_lag` RO | `a:[aid], b:[aid], unit, applicability?, activation?, response?` | `DistSummary` | `derive.compute_recipe(kind="lag")` |
| `summarize_count` RO | `activity:[aid], applicability?, after?, before?` | `DistSummary` + `share_by_count{0,1,2,3+}` | `EventLog.count` / recipe `count` |
| `summarize_attribute` RO | `attribute, applicability?` | `DistSummary` or categorical `top` | case table / `derive` |
| `summarize_balance` RO | `attr_x, activities_x:[aid], attr_y, activities_y:[aid], agg?` | `DistSummary` of relative difference `d` | `EventLog.total` |
| `validate_constraints` RO | `constraints:[ConstraintDict]` | per item: `{ok, error?, check_issues:[str]}` | `Norm.from_dict` (merged), `Norm.check` |
| `preview_constraints` RO | `constraints:[ConstraintDict]` | per item: `{in_scope_share, evaluated_share, mean_violation, violated_share}` | `scoring.evaluate_constraint`, `NormConstraint.applies_to` |
| `lint_norm` RO | `norm_version?` | `findings:[{kind, cids, detail, numbers}]` | rule set over `Norm` + `preview_constraints` |
| `get_backlog` RO | `view, by:[attr], gamma?, volume?, min_cases?, top≤50` | `BacklogDigest` | `prioritize`, `concentration`, `hotspot_table`, `layer_drivers`, `estimate_gamma` (reported) |
| `get_slice` RO | `view, sid` | `SliceDigest` | `layer_drivers`, `constraint_drivers`, `validation_table`, `worst_cases` |
| `get_cases` RO | `view, sid, n≤20` | `[{case_id, score, contributions}]` | `ScoreResult.worst_cases` |
| `get_trace` RO | `case_id` | `CaseDigest` | `ScoreResult.trace`, `violations` |
| `get_validation` RO | `view, by:[attr], top?` | rows `{sid, censored_share, replicated_share, retained, reading}` | `right_censored`, `event_replication`, `validation_table` |
| `compare_views` RO | `by:[attr], k?` | `view_agreement` matrix, `top_k_overlap` | `view_agreement`, `top_k_overlap` |
| `compare_periods` RO | `view, by, previous_result_id` | rows `{sid, gap_change, PI_change}` | `compare_periods` (common `baseline`) |
| `search_docs` RO | `query, corpus ∈ {templates, playbooks, appdocs, history}, filters?` | `[{chunk_id, text, meta, score}]` | embeddings store |
| `get_journey_state` RO | – | `JourneyState` | app DB |
| `stage_proposal` ST | `kind ∈ {constraint, view_weights, hypothesis, narrative}, payload` | `{proposal_id}` | proposal store; never mutates norm/results |

Conversation and state model: `Session {id, project_id, use_case, model, tier, prompt_version, norm_fingerprint, result_id, screen_context{view, by, sid}, turns[], tool_results{tool_call_id → json}, vocabulary, proposals[]}`. Each turn rebuilds the model context from state (system prompt + relevant digests + last 6 turns, older turns summarised deterministically as "accepted: c_x; rejected: c_y; open question: …"), so context stays within 8k–16k tokens regardless of dialogue length. Proposals have states `staged → accepted | edited | rejected` with the user's edit diff recorded. Backend API: `POST /assistant/sessions`, `POST /assistant/sessions/{id}/turns` (SSE events: `text_delta`, `tool_call`, `tool_result`, `card`, `proposal`, `validation`, `done`, `error`), `POST /assistant/proposals/{id}/{accept|reject}` (accept re-validates through `Norm.from_dict`), `GET /assistant/capability`, `GET /assistant/sessions/{id}/audit`.

Frontend rendering: the assistant is a side panel; cards are primary, prose secondary. `tool_result` → the same components as the analytical screens (backlog table with hotspot badges, layer-driver bars, constraint-driver table, distribution histogram with draggable threshold/width markers for `DistSummary`, validation flags); `proposal` → `ProposalCard` (constraint form pre-filled, preview stats, Accept / Edit / Reject); `card:hypothesis` → statement, evidence chips that deep-link to slice/constraint/case screens, owner and status controls; `card:next_step` → action buttons; `text_delta` → Markdown in which resolved references render as chips (hover shows the tool result path). Unresolved or repaired outputs render a visible "could not verify" banner, never silently.

## 7. Roadmap, risks, fallbacks

**MVP (two use cases):** U3 result narration with U5 Q&A over results (one runner, read-only tools 10–16, `Narrative`/`Answer` schemas, faithfulness checker) and U1 constraint drafting (single-expectation → `ConstraintProposal` with data-grounded thresholds; the full goal-to-views interview comes later). Rationale: narration/Q&A is highest value at lowest risk; elicitation is the bottleneck the paper names (Sec. III, VI-C). **Then:** U2 (LLM narration over `lint_norm`), U4 hypotheses (needs the validation tools stable), U6 journey ordering, U7 reports, view-weight elicitation, period comparison. **Defer:** multi-agent designs, autonomous re-scoring, fine-tuning (only if golden-set results on 8B models stay < 0.8 after prompt iteration; then a small LoRA on the elicitation set), non-Ollama providers (keep the `Provider` protocol so a remote model can be added by policy, off by default).

Risks and mitigations: unreliable tool calling on ≤ 8B models → schema-only planner tier, strict arg validation, cassette tests per tier; CPU-only latency → slow tier limits use cases and streams; threshold hallucination → candidate-only rule enforced in schema and validator; over-trust → "AI draft" states, mandatory review flags, causal-language gate; context overflow with large norms → digests truncate to top-k with tool follow-up; Ollama API drift → provider adapter with version probe and pinned minimum; injection via labels → id addressing and masking; audit store as a data-protection liability → same access control as the log, retention policy, redaction on export; prompt or model changes silently degrading quality → prompt versioning + CI gates.

No-LLM fallback per use case: U1 → guided constraint wizard: type picker with the paper's plain-language meaning, activity multi-select from the log, applicability builder (short form and `all/any/not` rules), threshold/width sliders on the live `DistSummary` histogram showing the share that would violate, weight sliders per view; U2 → `lint_norm` findings with canned explanations and one-click fixes; U3 → Jinja narration per hotspot kind ("{slice} ranks #{rank} with stable PI {pi} ({share} of mass), {n} cases, mean score {mu} vs global {mu_bar}; dominant layer {layer} (+{delta}); top constraint {cid}; validation: {reading}"); U4 → playbook table keyed by (layer, constraint type, hotspot kind, validation status) returning hypothesis templates with the same evidence chips; U5 → faceted filters and drill-down screens; U6 → checklist state machine (norm drafted → checked → scored → backlog reviewed → validated → hypotheses assigned → actions logged → re-scored) with the next unchecked item highlighted; U7 → template report from tables and the same narration templates.
