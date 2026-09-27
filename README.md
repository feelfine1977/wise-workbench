# WISE Workbench

WISE Workbench helps analysts and process owners build an evidence-based improvement roadmap aligned with business objectives. It turns event logs and explicit expectations into ranked groups, then connects investigation to findings, hypotheses, actions and an analysis notebook.

It is a working local application: FastAPI/Python backend, React/TypeScript frontend, SQLite metadata and Parquet analysis files. It does not yet optimise a roadmap under budget, capacity or dependency constraints.

## Start in a new checkout

Use Python 3.12 or 3.13 and Node 24. No sibling repositories or private reference workspace are required.

```bash
git clone https://github.com/feelfine1977/wise-workbench.git
cd wise-workbench
tools/install.sh --dev
apps/backend/.venv/bin/python tools/demo.py --workspace "$HOME/WISE Demo"
WISE_WORKSPACE="$HOME/WISE Demo" tools/start.sh
```

`tools/install.sh` installs the classic method at its pinned release commit, the local analytics and knowledge packages, and the frontend's locked dependencies. The flow renderer is included as a versioned npm artifact; see [vendor provenance](vendor/README.md). The demo uses only the library's public five-case example and refuses an existing nonempty directory. It demonstrates the workflow, not a meaningful business ranking.

If port 8000 is occupied, use `tools/start.sh --no-build --port 8002`. The syntax is `--port 8002` or `--port=8002`. The large-chunk message from Vite is a build warning, not a startup failure. Stop the foreground server with Ctrl-C.

## What you can use

- Map columns, inspect data caveats and record versioned preprocessing decisions.
- Identify flow types and compare the full population or start scoped analyses.
- Import/version norms, score logs and rank groups by WISE priority.
- Filter a process map and linked board; switch to a generated BPMN model.
- Inspect drivers, distributions, cases and validation gates; record findings, hypotheses and actions.
- Browse process knowledge and freeze analysis screens with notes; export a Markdown notebook.

## Current limits

Guided and expert norm editing, hierarchical constraint navigation, saved analysis filters, per-view membership, an automatic General benchmark and flexible groupings are implemented. Guided threshold-only draft saves may omit reason and owner while pending decisions remain pending; review/sign-off is a separate action. Names in local records are not authenticated identities.

O2C targets remain draft unless explicitly reviewed. Assessed review hypotheses currently support group-versus-rest comparisons; scenario/headroom calculations are not causal savings forecasts. Full pilot/outcome tracking, portfolio optimization, authenticated collaboration, radar, funnel and flame investigations, a dashboard designer and turnkey desktop/server distribution remain incomplete or planned. The Understand explorer includes a context Sankey; this shows attribute combinations, not process transitions.

Run locally on `127.0.0.1`; the current application has no login or multi-user access boundary. Ranking is relative to the selected population and norm, and is not evidence of causation or guaranteed savings.

## Components and ownership

| Component | Responsibility |
|---|---|
| [wise-pm](https://github.com/feelfine1977/wise-pm) | Norm semantics, scoring and prioritisation; classic runtime is the default |
| [wise-flow](https://github.com/feelfine1977/wise-flow) | Graph/layout, interaction and map/BPMN rendering |
| `apps/backend`, `apps/frontend` | Project workflow, API, investigation, review and documentation |
| `packages/wise-analytics` | Statistical analytics and data-quality diagnostics |
| `packages/process-knowledge` | Packaged schemas, guidance, presets and norm templates |
| `packages/api-schema`, `packages/design-tokens` | Generated HTTP types and shared visual tokens |

Optional evidence and object-centric method extensions remain separate development work. Installing a candidate method version does not enable those features. See [compatibility](docs/COMPATIBILITY.md).

## Documentation

This repository contains the setup, usage and maintenance essentials. Detailed architecture, research, change history and future design plans are maintained separately from application source.

- [Start here](docs/START_HERE.md) and [installation/deployment](docs/DEPLOY.md)
- [Analysis workflow and user guide](docs/USER_GUIDE.md)
- [Compatibility and release checks](docs/COMPATIBILITY.md)
- [Documentation index: current guides versus design proposals](docs/README.md)
- [Frontend development](apps/frontend/README.md) and [backend development](apps/backend/README.md)

## Licence

Workbench and wise-flow use **PolyForm Noncommercial 1.0.0**; wise-pm uses **MIT**. Public source availability does not grant unrestricted commercial use of the application or renderer. For uses not covered by the current licence, seek separate permission from the relevant copyright holder before distribution or deployment. No commercial licence is implied here. See [LICENSE](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md). BPMN model views retain the attribution required by bpmn-js.
