# Audience modes

One code base, three modes, chosen per user (role) or per session
(switcher in the context ribbon). Modes change what is shown first, how
much is asked, and which controls exist; they never change the numbers.

| | Guided | Analyst | Data expert |
|---|---|---|---|
| For | process owners, procurement or order-desk employees, sponsors | analysts, Black Belts, consultants | data engineers, process-mining specialists |
| Entry | a link to "your process" or "your slices"; the reading sentence first | the journey rail | the workspace browser and a query console |
| Choices | templates and presets; thresholds shown, not edited; γ and views fixed by the analyst | everything as designed | everything, plus raw artefacts |
| Screens | dashboard with three cards (what is worst, what changed, what is asked of me), slice pages with reading, evidence and one decision, presenter mode, findings and actions | all | all, plus DuckDB console over the workspace (read-only SQL on events, cases, frames, backlogs), raw tables with export (CSV, Parquet), norm JSON editor, run manifests, Python snippet export for a notebook |
| Explanations | always on: method cards, glossary sentences, "what this number means" inline, assistant narration when available | on demand | off by default |
| Decisions | dispositions, notes, action owners; no parameters | all | all |
| Guardrails | cannot change norms or parameters; sees the norm version and who approved it | versioning and notes | same versioning; a query cannot write |

Implementation: a `mode` in the user profile or URL (`?mode=guided`),
route-level layouts per mode, feature flags read by components (`useMode()`),
the same API. Guided mode reuses the owner portal (UX-11) and presenter
mode (UX-9); data-expert mode adds a `POST /projects/{id}/query` endpoint
(DuckDB, read-only, row limits, timeouts) and artefact download endpoints.
Planned in cycle 3 (Guided for owners), cycle 4 (Data expert), cycle 7
(Guided for employees, declarant view). The panel scores each mode
separately from cycle 3 on.
