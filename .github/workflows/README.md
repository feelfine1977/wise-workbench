# Continuous integration

Updated 27 September 2026. [ci.yml](ci.yml) is authoritative. It runs on pushes to `main`, pull requests and manual dispatch. A new checkpoint-branch push alone may not start it.

| Job | Runtime | Required checks |
|---|---|---|
| backend | Python 3.12 / 3.13 | Classic pinned method, knowledge and analytics imports/provenance; tooling tests; Ruff/types; full backend; exact OpenAPI drift |
| backend-next | Python 3.12 / 3.13 | Explicit pinned next candidate, provenance/imports, backend/analytics/knowledge regressions and exact OpenAPI drift |
| backend-minimal | Python 3.12 / 3.13 | Deliberate no-analytics environment and explicit fallback/evidence contracts |
| analytics | Python 3.12 | Package lint, types and tests |
| knowledge | Python 3.12 | Package validation/lint and tests |
| frontend | Node 24; Python 3.13 for norm workflow | Real packaged flow artifact/provenance, clean npm install/import, lint/types/tests, generated contract parity, live build, Playwright map/board and isolated norm workflow |
| distribution | Python 3.13; built live SPA | Build application/knowledge/analytics artifacts; install outside checkout and exercise resources, health and SPA routes |

The renderer is the actual checked-in artifact, not the old stub. Exact method pins and supported startup profiles are described in [Core profiles](../../docs/CORE_PROFILES.md). The frontend lockfile and vendor provenance identify renderer bytes. Optional private-dataset checks are separate from portable required gates.

These workflow definitions do not prove that a particular working tree passed hosted CI. Record the reviewed commit, actual job result and skips. See [compatibility and release checks](../../docs/COMPATIBILITY.md).
