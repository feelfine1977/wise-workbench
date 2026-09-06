# Deployment, hosting and authentication — plan

Owner request (2026-09-06): plan how the application will be deployed and
hosted and how users authenticate, for the later phases of the loop.
Design basis: ADR 0008 (distribution), `docker/DEPLOYMENT.md` (profiles),
ADR 0007 (local-first, no telemetry), `docs/APP_MODES.md` (audience
modes and roles).

## 1. Deployment stages

| Stage | When | What | Who uses it |
|---|---|---|---|
| D0 developer run | now | backend `serve`, frontend `vite`, Storybook; data on the owner's Mac | owner, reviewers |
| D1 single-user install | cycle 6 | `uv tool install wise-workbench` starts the service on a loopback port with a per-launch token and opens the browser; Ollama native; workspace under `~/WISE Workbench`; one command to back up the workspace folder | owner on her Mac; later colleagues on their laptops |
| D2 Docker single profile | cycle 6 | `docker compose --profile single up` with SQLite in a volume and the host's Ollama; same behaviour as D1 for people who prefer containers or Linux workstations | owner, pilot users |
| D3 team server | cycle 8 | `docker compose --profile team`: api, workers, Postgres, Ollama with GPU overlay on Linux, Caddy with TLS; OIDC login; project roles; backups with `wise-workbench backup`; health endpoints | a department or a research group |
| D4 hosted pilot | cycle 9 | the team profile on a rented Linux VM (4 vCPU, 16 GB, 100 GB SSD is enough for BPIC-sized logs) or a university server; domain and TLS through Caddy; data stays on that machine; the assistant runs on the same VM (CPU, 8B model) or a GPU VM when needed | pilot customers and reviewers, by invitation |
| D5 desktop bundle | after cycle 10 | Tauri shell with the backend as a sidecar and auto-update | non-technical analysts |

Hosting choices, in order of preference for a pilot: (1) a Linux VM at a
European provider with Docker and a domain, about 20–40 EUR per month,
fully under the owner's control; (2) a university server if one is
available; (3) the owner's Mac reachable through a tunnel for a demo only.
No managed cloud services are required; nothing leaves the machine except
what the user downloads.

## 2. Authentication and authorisation

| Mode | Stage | Mechanism | Notes |
|---|---|---|---|
| Local token | D1, D2 | a per-launch token in the URL opened by the CLI; loopback binding only | no user accounts; one person, one machine |
| Pilot invitations | D3, D4 | passwordless sign-in: an invitation link creates the account and a magic link sent by e-mail signs in (SMTP configured by the operator); session cookies, CSRF protection, rate limits | no passwords to store; simplest for external reviewers |
| OIDC | D3, D4 | the workbench as an OIDC client of the organisation's identity provider (Entra ID, Google Workspace, Keycloak self-hosted on the same VM); groups mapped to roles | the standard for companies; Keycloak gives a self-hosted option for the pilot |
| API tokens | D3+ | per-user tokens for the API and the MCP server, revocable, scoped to projects | for the data-expert mode and integrations |

Roles (per project): viewer, analyst, owner, admin; audience mode is a
preference, not a permission. Every write carries the user id (already
required by ADR 0007 for human decisions). Audit log of logins and of
changes to norms, gates, actions and guidance overlays. Data protection:
logs may contain personal resource ids; the redaction list per project and
the assistant's share level stay in force; backups are encrypted at rest
on the VM; retention is a project setting.

## 3. Work items by cycle

| Cycle | Items |
|---|---|
| 6 | D1 `uv tool` packaging with the CLI launcher; D2 Docker single profile built in CI; backup and restore commands; the owner installs D1 on her Mac (owner walkthrough 2 uses it) |
| 8 | D3 team profile: Postgres path tested, workers, Caddy TLS, OIDC client with Keycloak in the compose file, roles and per-project permissions, audit log, health and readiness endpoints, first hosted test on a VM |
| 9 | D4 pilot hosting: VM provisioning script, domain and TLS, invitations with magic links, SMTP, user administration screen, encrypted backups, retention setting, load test with two workers on BPIC 2018 |
| 10 | hardening: security review checklist (OWASP ASVS level 1), dependency audit, rate limits, session settings, documentation for operators; D5 planning |

Effort: about six work packages across cycles 7, 9, 10 and 12 plus the
owner's own installation and hosting steps (an afternoon for the VM).
