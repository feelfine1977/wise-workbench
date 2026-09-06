# Docker installation

Docker is the distribution path for teams and for single users who prefer
containers over `uv tool install` (ADR 0008). Three profiles share one
`compose.yml`; profiles differ only in which services start and in a few
environment variables — the application code is identical (ADR 0002/0003).

| Profile | Who | Services | Metadata DB | LLM |
|---|---|---|---|---|
| `single` | one analyst on a laptop or workstation | `api` (serves API + SPA, runs an in-process worker) | SQLite in the workspace volume | native Ollama on the host (recommended) or the `ollama` service |
| `team` | a department on one server | `api`, `worker` (×N), `postgres`, `caddy` (TLS, OIDC proxy) | Postgres | `ollama` service with GPU, or an existing Ollama/vLLM endpoint |
| `dev` | developers | `api` and `worker` with source mounts and reload, `postgres`, `frontend` (Vite dev server) | Postgres | host Ollama |

```
docker/
  compose.yml            services and profiles
  compose.gpu.yml        overlay: NVIDIA GPU for the ollama service
  compose.dev.yml        overlay: source mounts, reload, Vite
  Dockerfile.backend     multi-stage: uv → wheels → slim runtime, non-root
  Dockerfile.frontend    builds the SPA; output copied into the backend image
  caddy/Caddyfile        TLS (internal CA or ACME), reverse proxy, OIDC via forward_auth
  .env.example           every variable with a comment
  DEPLOYMENT.md          this file
```

## Images

- **Backend** (`ghcr.io/<org>/wise-workbench:<version>`): `python:3.12-slim`
  runtime, dependencies resolved with `uv` from the lock file, wheels only
  (no compilers in the final stage), the built SPA under `/app/static`,
  non-root user, `HEALTHCHECK` on `/healthz`, `tini` as PID 1, image size
  target under 600 MB. The same image runs `api`, `worker` and the CLI
  (`wise-workbench migrate`, `... export`, `... user add`).
- **Frontend** build stage only (Node 22 → `dist/`); not a runtime service
  except in `dev`.
- **Ollama**: the official image; models are pulled into a named volume on
  first start by an `ollama-init` one-shot service (`ollama pull
  qwen3:8b`, `bge-m3`), so the stack works offline afterwards.
- **Postgres 16**, **Caddy 2**: official images.

## Volumes and data

| Volume | Content | Backup |
|---|---|---|
| `workspace` | `projects/<id>/…` Parquet, norm JSON, manifests, reports, knowledge index; `workbench.db` in `single` | file copy or snapshot; the folder is readable without the app (ADR 0003) |
| `pgdata` | metadata in `team` | `pg_dump` via `wise-workbench backup` (dumps DB and tars the workspace with a manifest) |
| `ollama` | model weights | re-pullable, not backed up |
| `caddy` | certificates | re-issued |

Uploads go through the API into the workspace volume; a bind mount of a
host folder (`./data:/workspace`) is the simplest single-user setup and
keeps the data visible on the host.

## LLM placement

- Linux with NVIDIA: `ollama` service with the GPU overlay (NVIDIA Container
  Toolkit); AMD via the `rocm` image tag.
- macOS and Windows: containers have no GPU access, so run Ollama natively
  and point the stack at `http://host.docker.internal:11434`. This is the
  default in `single` on those platforms.
- Existing endpoint (vLLM, LM Studio, a shared Ollama): set
  `WISE_LLM_BASE_URL`; no `ollama` service.
- Missing or unreachable endpoint: the capability probe sets tier `off`
  and the app runs fully without the assistant (ADR 0005).

## Configuration

Everything through environment variables (pydantic-settings), documented in
`.env.example`: `WISE_MODE=single|team`, `WISE_WORKSPACE`,
`WISE_DATABASE_URL`, `WISE_LLM_BASE_URL`, `WISE_LLM_MODEL`,
`WISE_EMBED_MODEL`, `WISE_WORKERS`, `WISE_WORKER_MEMORY_LIMIT`,
`WISE_AUTH=token|oidc`, `WISE_OIDC_*`, `WISE_SECRET_KEY`,
`WISE_MAX_UPLOAD_MB`, `WISE_LOG_FORMAT=json`. Secrets via Docker secrets or
an env file outside the repository; the API refuses to start in `team` mode
with the default secret.

## Operations

- `docker compose --profile single up -d` → `http://localhost:8080`; first
  start runs migrations and prints the per-launch token.
- `docker compose --profile team --profile gpu up -d` → `https://<host>`
  with OIDC (Keycloak, Entra ID, Okta) through Caddy `forward_auth` or the
  built-in authlib client; roles from OIDC groups.
- Upgrades: pull the new tag, `docker compose up -d`; migrations run on
  start (Alembic) and refuse to downgrade; workspace format version is
  checked before any write.
- Resources: `api` 1 CPU / 2 GB; each `worker` 2 CPU / 4–8 GB (`WISE_WORKER_MEMORY_LIMIT`
  makes the worker refuse jobs that exceed it instead of being OOM-killed);
  `ollama` needs 6 GB RAM for an 8B Q4 model, 12 GB VRAM for 14B; Postgres 1 GB.
- Health: `/healthz` (process), `/readyz` (DB, workspace writable, worker
  heartbeat age, LLM tier); structured JSON logs to stdout; optional
  OpenTelemetry exporter.
- Air-gapped installs: `docker save` bundle of all images plus a model
  archive imported into the `ollama` volume; the app makes no outbound
  connections (ADR 0007).

## What Docker does not replace

Native desktop use stays on `uv tool install` and later the Tauri bundle:
Docker Desktop is a heavy dependency for non-technical analysts, file
dialogs and drag-and-drop from the host are awkward through volumes, and
macOS/Windows containers cannot use the GPU. Docker is the right answer for
Linux workstations, servers and anyone who already runs Docker.
