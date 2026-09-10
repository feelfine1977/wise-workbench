# Feature API clients

Import queries, mutations and view types from the feature that owns them:

| Module | Responsibility |
|---|---|
| `runs` | Run scope, flow-type runs and run manifests |
| `exploration` | Backlogs, slices, filter and slicing previews |
| `flow` | Flow queries, focused paths and BPMN URLs |
| `analytics` | Analytics jobs and signal distributions |
| `board` | Facets/KPIs and their existing older-server fallbacks |
| `norms` | Norm versions, inventory, guidance questions and constraint checks |
| `readiness` | Readiness decisions and previews |
| `review` | Findings, hypotheses, actions and gates |
| `knowledge` | Hub pages, guidance and organisation overlays |
| `notebook` | Snapshots, image URLs and exports |

`transport` contains the existing fetch transport. `compatibility` identifies
missing-operation responses (404/405/501). `filter-types` is a type-only leaf;
filter normalization remains in `lib/filter.ts`, avoiding a runtime import cycle.

Named response fields derive from `@wise/api-schema`. Local view types refine
open content, filters and client-only flags. Snapshot creation is a multipart
client input with an optional Blob. Review request bodies remain open records;
this extraction does not rename their keys or tighten accepted inputs.
`ConstraintCheck.activities[].cases` retains the client's existing optionality,
although the generated server DTO requires the count.

Selected existing hooks are re-exported from their feature module. Their
implementations, query keys and job/SSE behavior remain in `lib/queries.ts`.
The openapi-fetch transport in `lib/api.ts` is unchanged. Do not replace one
transport with the other without explicitly reviewing serialization and headers.

Raw filter parameters remain raw where existing callers used them; canonical
parameters remain canonical where already used. Query-key omissions, cache
options, error propagation and invalidation prefixes are preserved. Board
fallbacks retain their current population boundaries, flags and wording; they
are not new backend capabilities.
