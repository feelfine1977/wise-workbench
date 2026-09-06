# Start here — running the application

Updated at the end of every cycle by the release step. State: after
increment 0 and the interrupted cycle 1 integration (2026-09-06); the
one-command start arrives with the cycle 1 release.

## Start (current state)

Backend on the verified BPIC 2019 workspace:

```bash
cd ~/code/PhD/WISE/wise-workbench/apps/backend && WISE_WORKSPACE=~/code/PhD/WISE/wise-workbench-data/workspace_verify .venv/bin/wise-workbench serve
```

Frontend against it (second terminal):

```bash
cd ~/code/PhD/WISE/wise-workbench/apps/frontend && VITE_API_URL=http://127.0.0.1:8000 npm run dev
```

Open http://127.0.0.1:5173. Without `VITE_API_URL` the frontend runs on
mock data. Stop both with Ctrl-C.

## What is new

- Increment 0: see `docs/IMPLEMENTATION_PLAN.md` §8.
- Cycle 1 (partial): signals list and plain-language layer may be
  present but unverified until the release step runs.

## What to try

The checkpoint files (`apps/backend/CHECKPOINT.md`,
`apps/frontend/CHECKPOINT.md`) list the steps with pass criteria.

## Where to write remarks

the owner's notes, a dated heading, free text; the
questions in the walkthrough guide in the owner's notes help.
