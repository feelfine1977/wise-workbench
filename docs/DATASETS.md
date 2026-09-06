# Public event logs — what exists and how WISE Workbench uses them

Decision (2026-09-05): the knowledge packs and the evaluation harness start
from publicly available processes, above all the BPI Challenge logs. This
file is the inventory: what is published, what is already on disk, how each
log fits the WISE method, and which knowledge pack it feeds. Counts marked
"≈" come from the literature and are confirmed on download; the registry in
`packages/process-knowledge/datasets.yaml` records the checked values.

## 1. The BPI Challenge series

Ten editions, 2011–2020, all hosted by 4TU.ResearchData under a CC-BY 4.0
licence; the tenth edition (2020) was the last one, later ICPM editions ran
the Process Discovery Contest instead.

| Log | Organisation, process | Size | Format, attributes | WISE fit | Pack |
|---|---|---|---|---|---|
| BPIC 2011 | Dutch academic hospital, gynaecology: treatment trajectories, Jan 2005 – Mar 2008 | 1,143 patients, 150,291 events, 624 activities (verified); no resources; day precision | XES; diagnosis and treatment codes, age, department, specialism; Dutch labels with billing codes | many activities, long trajectories, case = patient; slices by diagnosis code, department; clinical expectation constraints need a physician; low priority | healthcare |
| BPIC 2012 | Dutch financial institute: personal loan / overdraft applications, 1 Oct 2011 – 14 Mar 2012 | 13,087 cases, 262,200 events, 24 activities (verified) | XES; A_ (application), O_ (offer), W_ (work item) events with lifecycle; `AMOUNT_REQ` | clean case notion; exposure = requested amount; lags application → offer → decision; rework loops (W_ items); censoring at March 2012 | application handling (credit) |
| BPIC 2013 | Volvo IT Belgium, VINST: incidents, open and closed problems, Mar 2010 – May 2012 | 7,554 incidents, 65,533 events (verified); ≈1,487 closed and ≈819 open problems | XES/CSV; activity = status (Accepted, Queued, Completed) with sub-status as lifecycle (In Progress, Awaiting Assignment, Resolved, Closed); impact, product, org line, country, support team, owner | ITSM constraints (push-to-front, wait-user loops, ownership changes); canonical activities are status + sub-status pairs; slices by org line, product, country, impact; small | ITSM |
| BPIC 2014 | Rabobank Group ICT (HP Service Manager): interactions, incidents, changes, Jan 2013 – Dec 2014 | 46,616 incidents with 466,737 activity rows over 39 activity types; 46,809 incident records; 147,004 interactions; 30,275 changes (verified) | four `;`-separated CSV tables; CI type/subtype, service component, impact, urgency, priority, category, KM number, reassignments, open/reopen/resolve/close times, closure code; changes with risk, emergency flag, CAB approval, planned vs actual times | event log = incident activities with incident details as case attributes; SLA lags per priority; change → incident linkage; slices by CI subtype, service component, assignment group | ITSM |
| BPIC 2015 | Five Dutch municipalities: building-permit applications (WABO), Nov 2009 – Aug 2015 | 1,199 / 832 / 1,409 / 1,053 / 1,156 cases; 52,217 / 44,354 / 59,681 / 47,293 / 59,083 events; 356–410 activity codes each (verified) | XES; coded activities `01_HOOFD_010` (phase, sub-process, step), case type, parts, responsible actor, SUMleges (fees); day precision | the natural cross-organisation comparison: five logs, one norm, slices = municipality × case type; deadline lags (statutory terms); exposure = fees; canonicalisation needs the code glossary from the challenge documentation | application handling (permits) |
| BPIC 2016 | UWV: clickstream of werk.nl, messages, calls, complaints | large CSV tables | CSV; sessions, pages, customer attributes | digital-channel journey, not a business process log; out of scope for the packs; possible later for "customer contact" constraints | — |
| BPIC 2017 | Same financial institute as 2012, new system: applications filed in 2016, handled until 1 Feb 2017 | 31,509 cases, 1,202,267 events, 26 activities, 42,995 offers (verified) | XES; application, offer and workflow events; lifecycle schedule / start / suspend / resume / complete / withdraw on W_ items (complete 475,306, suspend 215,402); `RequestedAmount`, `LoanGoal`, `ApplicationType`, offer attributes (credit score, monthly cost) | the reference log for credit applications: exposure, rich lifecycle (lag activation must filter on transitions), multiple offers per case, right-censoring at 1 Feb 2017, monthly periods; slices by loan goal, application type, requested-amount band | application handling (credit) |
| BPIC 2018 | German paying agency: EU direct-payment applications, May 2014 – Jan 2018 | 43,809 applications, 2,514,266 events, 41 activity labels across 9 document types and sub-processes (verified) | XES; department, year, applied amounts, basic payment, greening, cross-compliance, small farmer, penalties; per-event doctype, subprocess, success | three yearly cohorts = period comparison; document sub-processes = replication risk; canonical activity = doctype + sub-process + label; slices by department, year, application size; deadline constraints per year | application handling (subsidies) |
| BPIC 2019 | Multinational coatings company (NL): purchase-to-pay, 2018 with 2019 tail | 251,734 PO items, 1,595,923 events, 42 activities, 1,975 vendors (verified; timestamp outliers from 1948 to 2020) | CSV/XES/OCEL; vendor, purchasing org, document type, item category (four flow types), cumulative net worth, spend area, company, GR-based IV flag | the paper's evaluation; flow typing, replicated header events, right-censoring; slices by vendor, purchasing org, material/spend area | P2P |
| BPIC 2020 | TU/e travel expenses: domestic declarations (10,500 cases, 56,437 events, 17 activities), international declarations (6,449 / 72,151 / 34), travel permits (7,065 / 86,581 / 51), prepaid travel costs (2,099 / 18,246 / 29), requests for payment (6,886 / 36,796 / 19); Oct 2016 – 2019, permits to 2021 (verified) | five XES logs | amount, requested and adjusted amount, organisational entity, project, task, cost type, permit linkage; activity labels carry the actor role (EMPLOYEE, ADMINISTRATION, SUPERVISOR, BUDGET OWNER, DIRECTOR) | five related approval flows; lags submit → approve → pay; rejection loops; trip start/end for deadline rules; slices by organisational unit, amount band, approver role; permit ↔ declaration linkage | application handling (expense claims) |

Sources: the 4TU collection pages per year, the IEEE Task Force log list
(tf-pm.org/resources/logs) and the challenge reports.

## 2. Other public real-life logs (4TU, CC-BY)

| Log | Process | Size | WISE fit | Pack |
|---|---|---|---|---|
| Sepsis Cases | hospital emergency pathway of sepsis patients | 1,050 cases, 15,214 events, 16 activities (verified) | clinical lag constraints (antibiotics within an hour of triage, lactate measured), release types; small; needs medical review | healthcare |
| Road Traffic Fine Management | Italian police: fines from creation to payment or credit collection, Jan 2000 – Jun 2013 | 150,370 cases, 561,470 events, 11 activities (verified); Send Fine in 103,987 cases, Payment in 77,601 | heavy right-censoring (unpaid fines), exposure = amount, multi-year periods; a good stress test for censoring diagnostics | public sector (enforcement) |
| Hospital Billing | billing of medical services, Dec 2012 – Jan 2016 | 100,000 cases, 451,359 events, 18 activities (verified) | financial closing lags, rework (changes after billing), periods | healthcare (billing) |
| Helpdesk (Italian software company) | ticketing, Jan 2010 – Jan 2014 | 4,580 cases, 21,348 events, 14 activities (verified); seriousness, product, service level, support section, workgroup | small ITSM log with SLA-style lags, product and support-section slices | ITSM |
| Production (Levy, 2014) | manufacturing work orders on work stations, Jan–Mar 2012 | 225 cases, 4,543 events, 55 activities (verified); start and complete timestamps, worker id, quantities completed / rejected / for MRB, rework flag | the only real public production log; work-station and worker slices, rework, setup; tiny | production |
| Receipt phase of WABO permits | one municipality, environmental permits | ≈1,434 cases | complement to BPIC 2015 | application handling (permits) |

## 3. Object-centric logs (OCEL 2.0, Zenodo)

| Log | Content | Use |
|---|---|---|
| Procure-to-Pay (simulated from a real SAP system) | PO, requisition, GR, invoice, payment objects | canonical P2P vocabulary in SAP terms; tests of case-notion flattening (PO item vs invoice); already on disk as `ocel2-p2p` |
| Order Management (simulated e-commerce) | orders, items, packages, customers, employees | the only public order-management log with sales, warehousing and shipping stages; canonical vocabulary for the order-management pack |
| Logistics (container shipping) | orders, transport documents, containers, vehicles | logistics pack later |
| Hinge Production (simulated, sustainability-enriched) | production steps, machines, materials | vocabulary for the production pack; not evidence of real behaviour |
| BPIC 2019 (OCEL version) | same P2P data with objects | future object-centric case notions (F31) |

Simulated logs supply vocabulary and structure for the knowledge base but
never evidence for typical failure modes or thresholds.

Downloaded copies live outside the repository in
`~/code/PhD/WISE/wise-workbench-data/<id>/` with a manifest per dataset
(`tools/fetch_public_logs.py`); `tools/profile_log.py` produces the counts
marked "verified".

## 4. Already on disk

| Path | Content | Status |
|---|---|---|
| `~/code/PhD/WISE/WISE/Untitled/data/BPI_Challenge_2019.csv` (also `~/Downloads`, XES and OCEL versions) | BPIC 2019 | used by the library's evaluation test |
| `~/code/PhD/WISE/OC-WISE/data/ocel2-p2p.*` | OCEL 2.0 Procure-to-Pay | vocabulary source |
| `~/code/PhD/WISE/WISE/hackathon_2026/data/ICPM Data - *.csv` and `outputs_icpm2026/*_Eventlog.csv` | ICPM 2026 hackathon (SAP SD/MM extract, Jan 2023 – Jan 2026): 51,164 sales order items with 267,071 events over 16 activities (order, confirmation, schedule-line changes, delivery blocks, picking, packing, goods issue; 68 customers, 71 SKUs, 20 return items); 1,412 purchase order items with 13,567 events over 10 activities; 59,629 stock movements; material master with history | use permitted by the owner (2026-09-05); raw files stay local; the O2C pack draft built on it is `packages/process-knowledge/o2c/README.md` |
| `~/Downloads/ps_data/*` | a small sales process log (inquiry → quotation → order) with derived rework flags | demo material only |

## 5. What this means for the knowledge packs

Real public evidence exists for P2P, credit applications, ITSM, permit and
subsidy handling, expense claims and healthcare. For O2C the hackathon
extract is the evidence (owner's permission, 2026-09-05); order management
beyond it and production rest on simulations and one tiny log. The MVP
therefore ships P2P and O2C, both exercised end-to-end by the hackathon
extract, with credit applications as the first v1 pack:

| Order | Pack | Evidence logs | Knowledge sources besides the logs |
|---|---|---|---|
| 1 (MVP) | P2P | BPIC 2019, OCEL P2P, hackathon purchase orders | BPIC 2019 winner reports, SAP MM documentation, the paper's evaluation |
| 2 (MVP) | O2C (order-to-delivery evidenced; invoice and payment stages from vocabulary) | hackathon sales and stock data, OCEL Order Management | SAP SD documentation, APQC PCF; draft in `packages/process-knowledge/o2c/` |
| 3 (v1) | Application handling: credit | BPIC 2012, BPIC 2017 (BPIC 2017 already serves the MVP as the censoring stress test) | BPIC 2012/2017 reports, credit-process literature |
| 4 (v1) | ITSM | BPIC 2013, BPIC 2014, Helpdesk | ITIL 4 practice guides, BPIC 2013/2014 reports |
| 5 (v1) | Application handling: permits, subsidies, expense claims | BPIC 2015, BPIC 2018, BPIC 2020, WABO receipt | challenge reports, statutory deadlines |
| 6 (v2) | Production | Production (Levy), Hinge Production OCEL, hackathon stock movements | MES literature, OEE definitions |
| 7 (v2) | Healthcare pathways and billing | BPIC 2011, Sepsis, Hospital Billing | clinical guidelines, with a clinician reviewer |
| stress tests | — | Road Traffic Fine (censoring), BPIC 2018 (replication, periods), BPIC 2015 (cross-organisation) | — |

Packs 3 and 5 share one stage model ("receive, check, decide, deliver, with
approvals and rework"), so they are designed as one generic
application-handling pack with credit, permit, subsidy and expense
variants.

### 5.1 Findings from the downloaded files that shape canonicalisation

- BPIC 2013 stores the status as activity and the sub-status as lifecycle
  transition; BPIC 2017 uses five lifecycle transitions on work items;
  BPIC 2018 repeats activity labels across document types and
  sub-processes; BPIC 2015 uses coded labels; BPIC 2020 encodes the actor
  role in the label. The canonical-activity mapping (F33) therefore has to
  operate on a configurable key (label, lifecycle, document type,
  sub-process), not on the label alone — a requirement for the mapping
  screen and for the library's flow-typing recipes.
- Day-precision timestamps (BPIC 2011, 2015, Road Traffic Fine) make
  sub-day lag thresholds meaningless; the readiness report must detect
  timestamp precision per activity.
- Every BPIC log except 2011 carries resources on all or most events, so
  hand-off recipes are testable on public data.

## 6. What each log exercises in the app

| Capability | Logs |
|---|---|
| Flow typing and case-notion pitfalls (F4) | BPIC 2019, BPIC 2014, BPIC 2018, BPIC 2020 |
| Cross-organisation comparison with one norm | BPIC 2015 (five municipalities), BPIC 2020 (five flows) |
| Period comparison and monitoring (F20, F23) | BPIC 2018 (three years), Road Traffic Fine, Hospital Billing, BPIC 2019 (months) |
| Right-censoring diagnostics (F17) | BPIC 2017, BPIC 2019, Road Traffic Fine |
| Replication diagnostics | BPIC 2019 (header events), BPIC 2018 (documents), BPIC 2015 (sub-phases) |
| Exposure weighting (F27) | BPIC 2017 (amount), BPIC 2019 (net worth), BPIC 2020 (amount), Road Traffic Fine (fine) |
| SLA-style lag constraints | BPIC 2014, BPIC 2013, Helpdesk, Sepsis |
| Rework and loop constraints | BPIC 2012/2017 (W_ items), BPIC 2019 (changes), Hospital Billing |
| Resource hand-offs (later) | BPIC 2013 (support teams), BPIC 2015 (actors), Production |

## 7. Registry and reproducibility

`packages/process-knowledge/datasets.yaml` lists every log with DOI,
licence, files, checksums after download, the column-mapping preset, the
canonical-activity mapping and the reference norm. The workbench offers
these as one-click "public log presets" (feature F41) for demos, training
and the evaluation harness. Logs are never redistributed inside the
repository; presets reference the DOI and the expected checksum.
