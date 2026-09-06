# ADR 0002 — FastAPI service with its own crash-safe job table and worker processes

Status: accepted (2026-09-05)

## Context
Scoring large logs, diagnostics, exports and LLM calls take seconds to
minutes and must not block the UI. The app must run on a laptop without a
message broker and on a small server with several workers.

## Decision
One FastAPI (async, pydantic v2) process serves the API and the SPA. Long
work goes through a `jobs` table (lease with heartbeat and expiry, retries,
cancel flag, progress) processed by separate worker processes. SQLite uses
`BEGIN IMMEDIATE` leases; Postgres uses `FOR UPDATE SKIP LOCKED`. Progress and
assistant tokens stream over SSE.

## Alternatives rejected
FastAPI `BackgroundTasks` (dies with the process, blocks the event loop);
Celery, RQ, arq (need Redis or RabbitMQ, unacceptable on desktop); Litestar
and Django (smaller ecosystem or sync ORM and unneeded weight).

## Consequences
Identical behaviour in desktop and server mode; jobs survive crashes;
artefacts are written to `tmp/` and renamed atomically with the manifest
last.
