# Documentation map

## Current entry points

| Guide | Purpose |
|---|---|
| [Repository README](../README.md) | What is implemented, what remains incomplete, licence |
| [START_HERE](START_HERE.md) | Portable setup and analysis workflow |
| [DEPLOY](DEPLOY.md) | Source installation, packaged application, workspace and ports |
| [COMPATIBILITY](COMPATIBILITY.md) | Supported dependency profiles and release checks |
| [USER_GUIDE](USER_GUIDE.md) | Detailed screen reference; consult current limitations first |
| [Backend](../apps/backend/README.md) / [frontend](../apps/frontend/README.md) | Developer commands and module boundaries |

## Designs and historical evidence

`ARCHITECTURE.md`, `CUSTOMER_JOURNEY.md`, `ROADMAP.md`, `IMPLEMENTATION_PLAN.md`, `APP_MODES.md`, `DEPLOYMENT_AUTH_PLAN.md`, and `panel/` contain designs and planned work as well as earlier decisions. A proposed feature in those documents is not a promise that it is shipped. `BACKLOG.md` includes historical increments; current open product limitations are summarised in the repository README.

`adr/` records architectural decisions. Each decision's implementation state must be read separately; ADR 0012 describes planned optional extension integration.

`examples/` and package `CHECKPOINT.md` files preserve reproducibility records for specific builds and datasets. Their counts, screenshots and timings are not freshly measured release assertions. Operational notes, private datasets, development transcripts and cost logs belong outside these public repositories.
