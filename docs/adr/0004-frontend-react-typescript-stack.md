# ADR 0004 — React + TypeScript SPA with TanStack, shadcn/ui and ECharts

Status: accepted (2026-09-05)

## Context
The UI is data-heavy (backlog tables with 10^5 rows, drill-down charts,
trace timelines) and must be shareable by URL, accessible and themeable.

## Decision
React 19 + TypeScript strict + Vite. TanStack Query for server state,
TanStack Router with typed search params (filters live in the URL), Zustand
for UI state, shadcn/ui (Radix + Tailwind) with design tokens, TanStack Table
+ Virtual for tables, Apache ECharts for charts, CodeMirror 6 for the norm
JSON view. REST + OpenAPI 3.1 with a generated client in
`packages/api-schema`; CI fails on schema drift.

## Alternatives rejected
Next.js (server runtime we cannot ship in a Python binary), AG Grid
(licensing and weight), Plotly/Vega-Lite (bundle size, large-data limits),
tRPC/GraphQL (TypeScript-only server or poor fit for tabular payloads).

## Consequences
All aggregation stays server-side; tables and charts are virtualised or
sampled; every screen names norm version, view, slice key and period.
