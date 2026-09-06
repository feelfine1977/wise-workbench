# API contract additions for cycle 2 (prose contract)

The backend workstream implements these operations and regenerates
`openapi.yaml` at the end of the cycle; the frontend workstream codes
against this file with hand-written types and MSW mocks, and regenerates
its types when the backend's file lands. Names and shapes here are
binding; details not written here follow the existing conventions
(RFC 9457 errors, JSON-array slice keys, real column names in `slicing`,
library column names in backlog rows).

## Filters (RF-01, RF-09, RF-10)

`filter` is a URL-safe JSON object accepted by backlog, slice detail,
flow, diagnostics, signals, traces and analytics endpoints:

```json
{"and": [
  {"kind": "time", "field": "case_start", "from": "2018-01-01", "to": "2018-06-30"},
  {"kind": "attribute", "field": "case Item Category", "in": ["3-way match, invoice after GR"]},
  {"kind": "activity", "op": "contains" | "starts_with" | "ends_with" | "never", "activity": "Record Goods Receipt"},
  {"kind": "follows", "a": "Record Goods Receipt", "b": "Record Invoice Receipt", "directly": false},
  {"kind": "lag", "a": "…", "b": "…", "unit": "D", "min": 30},
  {"kind": "count", "activity": "Change Price", "min": 2},
  {"kind": "open", "value": false}
]}
```

`GET /projects/{p}/runs/{r}/filters/preview?filter=` → `{ "cases_in": n,
"cases_out": n, "per_clause": [{"clause": i, "removed_marginally": n}],
"in_scope_by_constraint": {"c_id": n} }`. Every response that accepted a
filter echoes it in `params.filter`. Filters never change applicability.

## Backlog and slice additions (R1-01, R1-03, R1-04, R1-06, R1-26, RG-6, RG-13, RG-15, RG-20)

Backlog rows gain: `kind` (acute | systematic | widespread), `kind_reading`,
`plain_layer` (from guidance), `layer_missed_label`, `comparison` (one
real-unit sentence from the top driver's contrast), `stability` (from
`bootstrap_backlog`: stable | fragile | insufficient_support), `caveats`
(list of `{id, share, text}` for censoring, replication, duplicates that
touch the group), `case_noun` (the mapping's business name, e.g.
"purchase order items"), `points_below` (gap in score points), and the
existing fields. `BacklogPage.params` gains `window_end`, `gamma`,
`analytics_record_ids`.

Slice detail gains: `contrast` (table: constraint, plain description with
threshold, share missed in group, share missed elsewhere, risk difference
with 90 % interval, real-unit median in group and elsewhere, shift, share
of shortfall), `headroom` (table with possible gain in points and
percent), `caveats`, `subgroups` (table: attribute, value, cases, share of
penalty mass), `guidance_refs` (layer and constraint ids with hub node
ids), `reading_plain`.

## Guidance and knowledge hub (RK-2, RK-3, RK-4)

`GET /projects/{p}/guidance/{kind}/{id}` (kind: layer | constraint |
failure_mode) → `{ "generic": GuidanceBlock | null, "overlay":
GuidanceBlock | null, "hub_node": "…" }`. `GuidanceBlock` has the fields
of `docs/panel/knowledge_hub_panel.md` §1 (`plain_name, expectation,
meaning_when_missed, why_it_matters, how_detected, usual_reasons[]
{text, where: log|outside, check}, usual_actions[] {text, countermeasure,
owner_role, effect_area}, what_to_check_first[], examples[], kpis[],
owner_role, stakeholders, sources[], review_status, version`).

`GET /projects/{p}/knowledge/hub?process=p2p` → `{ "nodes": [{id, kind:
stage|layer|expectation|failure_mode|reason|action|kpi, plain_name,
method_name}], "edges": [{from, to, kind}] }`;
`GET /projects/{p}/knowledge/hub/{nodeId}` → the page: `{ node, guidance,
related: {stage, expectations[], failure_modes[], kpis[], playbook[]},
overlay }`.

Norm versions gain `warnings[]` from `Norm.check` (activities or
attributes that never occur) and `guidance_complete: bool`.

## What-if (R1-11)

`POST /projects/{p}/runs/{r}/whatif` body `{ "name", "scenario": {"ops":
[ {"op": "cap_lag", "a", "b", "unit", "max"}, {"op": "delete_activity",
"activity", "where": filter?}, {"op": "move_event", "activity",
"relative_to", "offset", "unit"}, {"op": "set_attribute", "field",
"value", "where"}, {"op": "keep_first", "activity"} ]}, "baseline_run_id"
}` → job; result `GET /projects/{p}/whatif/{id}` → `{ scenario,
baseline_run_id, change_table: Table (slice, before, after, delta of gap,
stable_PI, kind), summary, record }`. The baseline is frozen (the
original run's backlog); the transformed log is re-scored under the same
norm; provenance recorded.

## Hypotheses, gates, findings, actions (R1-12, R1-15)

`POST/GET /projects/{p}/hypotheses` → `{ id, run_id, slicing, key, view,
constraint_id, comparison: "group_vs_rest" | "period" | "subgroup",
expected_direction, statement_plain, evidence_links[], test: {risk_difference,
interval, shift, unit, interval_method, n_group, n_rest}, outcome:
supported | not_supported | inconclusive, gate_status, author, note,
created_at }`; the backend computes `test` from analytics when created.
`GET /projects/{p}/runs/{r}/gates?slicing&key` → gates `{ id, kind:
readiness|censoring|replication|domain, status: pending|passed|failed|waived,
evidence, note, author }`; `POST .../gates/{id}` with `{ status, note }`
(note mandatory for waive/pass). Saving a hypothesis or an action on a
slice with a failed gate returns 409 with the gate id.
`POST/GET /projects/{p}/findings`, `POST/GET/PATCH /projects/{p}/actions`
(A3 fields: mechanism, remedy, countermeasure, owner_role, due, status,
links).

## Flow additions (R1-16, RF-12, RF-13)

`GET .../flow` accepts `filter` and `focus` (activity id) and returns
stage lanes as `groups` from the pack's stage model when the project has
a process pack; with `focus` the response adds `paths: {incoming: [{from,
count, cases, median_lag, violation_share}], outgoing: [...]}`.
`GET .../flow/activities/{activityId}` → activity profile skeleton `{
frequency, cases, share_of_cases, stage, predecessors[], successors[],
constraints_touching[] }` (the full reasoning panel is cycle 3).

## Presets and mapping (R1-13, R1-19)

`POST /projects/{p}/datasets/presets/{preset}` with preset `bpic2019` or
`icpm2026_o2c`; the O2C preset ingests the sales extract with `Create
Order` typed as a header event, derives `days_late` at case-table build
(goods issue date minus requested delivery date, days), sets the case
noun "sales order items", and loads `o2c_baseline.json` as norm v1. The
BPIC 2019 preset mapping includes the additional case attributes of
R1-19 and `event User` as resource.
