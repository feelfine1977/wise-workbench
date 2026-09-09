# Installation and deployment

The supported distribution is a local application served by one Python process. Use Python 3.12/3.13 and Node 24 LTS for source builds. Node 22 is also in the renderer's supported test matrix. The old Node 18/20 setup is outside current support ([Node release lifecycle](https://nodejs.org/en/about/previous-releases)).

## Install a source checkout

```bash
git clone https://github.com/feelfine1977/wise-workbench.git
cd wise-workbench
tools/install.sh --dev
```

The script creates `apps/backend/.venv` if needed, installs classic wise-pm at commit `df5db50b839cc124b489a269894f5a2bfe7dc634` (`v0.1.0`), installs this checkout's analytics, knowledge and backend packages, and runs `npm ci` for the frontend. `--dev` includes test tools; omit it for a local user installation. It does not create a global Python installation. Select an interpreter with `WISE_BOOTSTRAP_PYTHON=python3.13 tools/install.sh --dev`.

The normal product profile includes analytics, knowledge and the actual flow renderer. Knowledge is a required backend dependency. The backend without analytics remains a reduced API profile, tested separately; it is not the full product. No sibling repository and no author-specific data path is required. Renderer assets are installed from the artifact recorded in `vendor/README.md`.

## Start and create an example

```bash
apps/backend/.venv/bin/python tools/demo.py --workspace "$HOME/WISE Demo"
WISE_WORKSPACE="$HOME/WISE Demo" tools/start.sh
```

The demo refuses a nonempty directory. It generates the library's public five-case example, ingests it, imports its norm, scores it and computes analytics. These are demonstration cases, not a statistically meaningful backlog.

`tools/start.sh` builds the frontend with mocks disabled and opens `http://127.0.0.1:8000/`. The API is under `/api/v1` and interactive API documentation is at `/docs`. On subsequent starts, `--no-build` reuses the build. Stop with Ctrl-C.

For your own data, choose an empty workspace and upload a log through the Data screen. `WISE_WORKSPACE` defaults to `~/WISE Workbench`. A workspace is application data, not source code; keep it outside Git.

## Ports and rebuilds

```bash
WISE_WORKSPACE="$HOME/WISE Demo" tools/start.sh --no-build --port 8002
```

Use a space or equals sign (`--port 8002`, `--port=8002`), not a colon. An occupied-port error means a process is already listening; the build itself may have succeeded. Inspect the identified process or choose another port. Do not repeatedly rebuild to fix a port collision. `--replace` terminates the listener, so use it only when you own that process and intend to stop it.

Restart Python after backend changes. A frontend rebuild changes static files but does not reload backend code. Vite's large-chunk warning does not prevent a successful build.

## Package an application wheel

A plain backend wheel is an API package. A full application wheel must contain a live frontend build; `tools/build_release.py` creates that artifact from this checkout and the supplied build. After `npm run build:live` in `apps/frontend`, run `python tools/build_release.py --frontend-dist apps/frontend/dist --frontend-mode live --out dist`. The explicit live-mode declaration is recorded with the artifact. The builder refuses a missing frontend and works in temporary build directories; it does not depend on a user's reference workspace.

Install the resulting application wheel together with the knowledge and analytics wheels and the classic method release in a fresh environment. Keep the generated checksums and dependency versions with the release. Verify `/`, a deep SPA route, `/api/v1/system/health`, and knowledge-pack discovery from outside the checkout. The CI artifact job exercises this boundary; see [COMPATIBILITY](COMPATIBILITY.md).

The backend serves packaged `static/` when present. `WISE_STATIC_DIR=/path/to/dist` or `serve --static /path/to/dist` explicitly selects another build. Do not ship a mock build as a live application.

## Development

```bash
apps/backend/.venv/bin/python -m uvicorn wise_workbench.main:app --reload --app-dir apps/backend/src
```

In a second terminal:

```bash
cd apps/frontend
VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

Without `VITE_API_URL`, development mode uses fixture responses. `npm run build:live` disables mocks. `just` is an optional shortcut for the same Python/npm commands, not another package manager.

## Workspace, backup and configuration

SQLite holds project/job metadata; Parquet/JSON artifacts under `projects/` hold data, norms and runs. Back up the complete workspace while the application is stopped. Restore the database and project artifacts together. Cache and temporary files can be rebuilt.

| Setting | Meaning |
|---|---|
| `WISE_WORKSPACE` | Workspace directory, default `~/WISE Workbench` |
| `WISE_HOST`, `WISE_PORT` | Default `127.0.0.1:8000` |
| `WISE_STATIC_DIR` | Override the built frontend location |
| `WISE_INPROCESS_WORKER` | Default worker in the API process; use `0` with a separate `wise-workbench worker` |
| `WISE_LOG_FORMAT`, `WISE_LOG_LEVEL` | Logging format and level |
| `WISE_BPIC19_CSV`, `WISE_BPIC19_NORM` | Explicit optional reference dataset/norm paths |
| `WISE_ANALYTICS_AUTO` | Whether scoring queues analytics automatically |

Reference logs require explicit dataset paths. The BPIC19 norm defaults to the packaged template; normal installation and the public demo need no reference log.

## Deployment limits and licences

There is no login, role-based access, or supported multi-user deployment yet. Keep the service on localhost. Postgres and Docker files describe future profiles and are not validated production distributions. The actionability extension stays separate from classic; runtime capability selection is still a design ([ADR 0012](adr/0012-optional-actionability-extension.md)).

Workbench and its flow renderer use PolyForm Noncommercial 1.0.0. Check the actual licence before organisational deployment; public source alone does not grant commercial rights. Core wise-pm is MIT. Retain dependency notices and visible BPMN attribution.
