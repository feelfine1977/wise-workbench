# Report-inspired diagnostic norm extension

This opt-in extension adds observable screening constraints to a **new draft**
norm. It leaves the input norm's rules, recipes, layers and view definitions
unchanged. The separate **Report candidates** view uses only the added layers;
existing views give these layers zero weight. It does not assert business
ownership, policy approval, avoidable labor, duplicate payment or contractual
lateness.

Load this optional template through `wise_knowledge.report_patterns`. Existing
template selection continues to use the template index and `guidance.yaml`.

## Files and reuse

- `src/wise_knowledge/data/p2p/templates/p2p_report_patterns.json`: executable
  canonical activity template, 14 constraints in four layers, including one
  optional validated automation metric.
- `src/wise_knowledge/data/p2p/report-pattern-catalogue.json`: per-constraint
  report sources, measurement contracts, draft threshold proposals, context
  needs, qualifications and unsupported gaps.
- `src/wise_knowledge/data/p2p/mappings/bpic2019_report_patterns.json`: an
  explicit dataset binding, separate from the reusable builder/engine.
- `src/wise_knowledge/report_patterns.py`: pure extension builder. Missing
  activity/attribute/flow mappings omit affected rules with a recorded gap;
  it never guesses a label or creates evidence from missing data. Identifier
  collisions, including selected recipe names that overlap existing case
  attributes, fail without modifying the input.

```python
from wise_knowledge.report_patterns import extend_report_patterns

draft, coverage_contract = extend_report_patterns(
    original_norm_document,
    activity_mapping=canonical_id_to_observed_labels,
    attribute_mapping=semantic_attribute_to_case_column,
    flow_values={
        "all_items": reviewed_item_flow_values,
        "invoice_bearing": reviewed_invoice_flow_values,
    },
    available_activities=observed_activity_labels,
    available_attributes=case_attribute_names,
)
```

Each activity mapping is a nonempty **list** of labels. Multiple mapped labels
form a union: counts sum and anchors use the earliest timestamp. Review that
meaning before combining labels. `flow_type` must map to a real case attribute.
The `invoice_bearing` and `all_items` value sets are proposed screening
applicability, not approved business policy. Service/framework/installment
patterns remain reviewable; occurrence alone does not classify them as defects.
Pass the complete set of existing case attribute names as
`available_attributes`, including attributes outside `attribute_mapping`.
The builder rejects selected recipe names that collide with those attributes,
because overwriting a raw value could change an original metric's score.

Optional automation recovery requires explicit mappings for numeric
`automation_recovery_count`, boolean `automation_evidence_validated`, and
boolean `automation_eligible`. Both booleans must be true at case level to
score it. No user-name regex or identity-to-labor conversion is introduced.
The independent transfer-failure screen uses an explicit failure event and
covers only the mapped interface, not general automation suitability.

## Measurement semantics

**Complete-clock prerequisite:** before evaluating these timestamp-dependent
screens, verify that every relevant mapped event has a valid timestamp.
The metadata-only builder cannot perform this event-level check. If complete
clocks cannot be established, withhold the affected screens; their zero values
must not be presented as measured compliance. The following installed-core
limitations remain unresolved:

- A `count` recipe uses timestamp-valid events even without an explicit time
  scope. One dated invoice receipt plus one clockless receipt can therefore
  produce a derived count of one, admitting a repeated-receipt case into the
  proposed single-receipt population. Raw occurrence counts and these recipe
  counts are not equivalent on incomplete clocks.
- Precedence's `missing_b="skip"` checks event occurrence, while its ordering
  count excludes clockless response events. A dated PO and a clockless vendor
  invoice can consequently score zero for invoice-before-order. Scoped change
  and cancellation counts likewise cannot establish compliance when relevant
  events lack clocks. Absent-event tests do not establish clockless-event safety.

These are requirements and limitations, not automatic completeness guards or
corrected core semantics. Recipes and missing-endpoint settings do not repair
them. The semantics below require the complete-clock prerequisite.

- Correction incidence is a union of price/quantity events per item. A case
  with three corrections counts once as affected; raw event counts remain
  separate. Repetition screens start at two events.
- Scoped changes/cancellation screens use events at timestamps **strictly
  after the first anchor**. Ties are excluded, absent anchors unmeasured.
  They do not match documents or cycles.
- Invoice-capture lag requires exactly one vendor-creation and one recorded
  receipt event. It uses first activation and first overall response, skips
  reversed/missing endpoints and measures calendar days. The proposed
  14-day target and 14-day width are uncalibrated. Vendor creation is not
  actual AP arrival or actionable queue entry.
- Invoice-recording-to-clearing lag similarly requires one event at each
  endpoint, uses receipt only as the start, and proposes 30 days with a
  60-day width. Without invoice-specific terms and bank settlement it cannot
  assess contractual lateness. Neither lag describes open WIP or FIFO cycles.
- Precedence counts response timestamps strictly before the first activation.
  Absent endpoint events are skipped; equal valid timestamps satisfy chronology.
  Invoice-before-order is not the exact report's starts-with-vendor cohort
  and cannot establish unauthorized purchasing.
- Repeated clearing with at most one receipt is a **broader repetition
  screen**. Installed constraints cannot encode immediately adjacent clearing;
  the reported 626-case cohort remains an explicit gap. It is never labelled
  duplicate payment. Cancellation-to-clearing also lacks document linkage and
  is not claimed to reproduce the report's separately filtered 2,492 cases.

Coverage has three separate quantities: explicit applicability (`casesInScope`),
finite evaluated observations (`casesEvaluated`), and positive candidate cases.
Missing anchors are not measured compliance. Native precedence counts can be
zero with an absent response even when scoring skips it; the API tool queries
response-present coverage separately and writes both native and evaluated n.
The native threshold share is not interchangeable with WISE's evaluated-case
violation share. Never sum overlapping candidate counts.

## Isolated draft-creation tool

From the repository root, prepare a local reviewable draft with GET requests only:

```sh
apps/backend/.venv-next/bin/python tools/create_report_pattern_draft.py \
  --output /private/tmp/report-pattern-preview
```

After reviewing the prepared draft, append `--apply` to create a **new draft and
new run** via the existing API. This evaluation tool is restricted to localhost
8010 and its configured BPIC19 project/baseline identities. It never updates
the original norm, modifies mappings, uploads datasets, changes status, or
restarts a server. The new observed run becomes the dashboard's latest run;
that is expected. Creation receipts prevent accidental duplicate application
to the same output directory. An ambiguous POST failure must be inspected by
GET; do not blindly repeat it.

Outputs include the draft, mappings/gaps, creation receipt, run, aggregate
signals, coverage and summary. If the run exceeds the polling limit, its ID
is retained for GET polling. No raw case/event export is written.

## Verification

```sh
apps/backend/.venv-next/bin/python -m pytest \
  packages/process-knowledge/tests/test_report_patterns.py \
  packages/process-knowledge/tests/test_templates.py \
  packages/process-knowledge/tests/test_schemas.py -q

cd apps/frontend
./node_modules/.bin/vitest run \
  src/routes/norms/reportPatternsPreview.test.tsx
```

Tests execute the installed next `wise` semantics, including threshold
boundaries, ties, missing PO and invoice events, repeated cycles, consignment,
unknown flows, mapping omissions, optional automation evidence, input
immutability, old-view score parity, and the GET/new-draft/new-run API contract.
The UI fixture in
`apps/frontend/src/routes/norms/reportPatternsPreview.test.tsx` verifies that
native threshold shares and evaluated WISE shares remain distinct. It is also
included automatically in the normal frontend Vitest suite.

## Report sources

The following original BPI Challenge 2019 reports motivate the questions.
Printed page numbers are followed by page numbers in the supplied merged
report collection where available.

- Rząd, Wojnecka, Rutkowski and Guliński (PwC), **Investigating Purchase-to-Pay
  process using Process Mining in a multinational corporation** (2019),
  pp.14–15 and 17 (merged pp.60–61 and 63): invoice-first cases and corrections.
- Meyer zu Wickern et al., **Analysis and prediction of purchasing
  compliance using process mining** (2019), p.19, Fig.7 (merged p.96):
  affected items and correction-event counts.
- Badakhshan et al., **Process Mining in the Coatings and Paints Industry:
  The Purchase Order Handling Process** (2019), p.20 (merged p.205):
  corrections and final flow conformance.
- Augusto, Leno and Reissner, **BPI Challenge 2019 Report: a Purchase-to-Pay
  Process Analysis** (2019), p.15, Table 7 and pp.22–23 (merged pp.175,
  182–183): invoice intervals and settlement review cohorts.
- Bekker and Kisjes, **Ninth International Business Process Intelligence
  Challenge — Submission in the Non-Student Category** (2019), p.17, Fig.24
  (merged p.331): purchase-order versus line-level reconciliation.
- Porter et al. (CKM Analytix), **Balancing Efficiency and Risk in Procure to
  Pay: Safely Realizing Cost Savings Using Process Mining Techniques** (2019),
  pp.10–19, especially p.14, Table 5 (merged pp.349–358, especially p.353):
  invoice capture, automation evidence and payment calendars.
- Hüser and Heisenberger, **BPI Challenge 2019** (2019), pp.19–20
  (merged pp.251–252): variation in recorded automation by vendor.

**Local reproduction note:** template thresholds, explicit mappings and tests
are implementation proposals. Run-specific counts and parity checks belong
in the evaluation output, separately from the original report evidence.
Report numbers are reference findings, not acceptance targets for differently
filtered current-run populations.
