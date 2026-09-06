# ADR 0003 — Parquet + DuckDB for analytical data, SQLite or Postgres for metadata

Status: accepted (2026-09-05)

## Context
Event logs reach millions of rows; per-case result frames are wide; review
artefacts (findings, gates, actions) are small relational records.

## Decision
Events, case tables, violation matrices and backlogs are Parquet (zstd)
files queried with DuckDB; backlog pages, drill-downs and exports are
server-side DuckDB queries. Metadata and review artefacts live in SQLAlchemy 2
models on SQLite (desktop) or Postgres (server) with Alembic migrations and a
portable schema (JSON columns only). Norms are stored as the library's JSON.

## Consequences
A project folder is readable without the app; results are addressable
artefacts with checksums; the frontend never receives a whole backlog;
switching desktop → server changes settings, not code.
