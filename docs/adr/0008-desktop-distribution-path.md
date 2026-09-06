# ADR 0008 — Desktop distribution: CLI first, Tauri shell later; no PyInstaller

Status: accepted (2026-09-05)

## Context
Analysts need a single-user desktop installation; teams need a server.

## Decision
Phase A: `uv tool install wise-workbench` provides a CLI that starts the
service on a loopback port with a per-launch token and opens the browser.
Phase B: a Tauri 2 shell bundling the backend as a `python-build-standalone`
sidecar with wheels and auto-update. Docker ships from Phase A with one
`compose.yml` and three profiles (`docker/DEPLOYMENT.md`): `single`
(api with in-process worker, SQLite, host Ollama), `team` (api, workers,
Postgres, Ollama with GPU overlay, Caddy with OIDC), `dev`. The backend
image is the same for api, worker and CLI; macOS/Windows users keep Ollama
native because containers there have no GPU.

## Alternatives rejected
PyInstaller (hidden imports for numpy/pandas/duckdb, large one-file bundles,
slow start, antivirus false positives, multiprocessing traps, notarisation
effort); Electron (a second browser).
