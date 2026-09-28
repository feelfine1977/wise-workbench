# Order-to-cash pack (draft, 2026-09-05)

Evidence: the ICPM 2026 hackathon extract (SAP SD/MM, Jan 2023 – Jan 2026;
use permitted by the owner, raw files not redistributed) — 51,164 sales
order items with 267,071 events over 16 activities, 59,629 stock
movements, purchase orders and material master; vocabulary for the stages
the extract does not cover (invoice, payment, dunning) from the OCEL 2.0
Order Management log and SAP SD documentation. The original measurements
use `tools/profile_log.py` and a short pandas script; they seed the
failure-mode catalogue and are **not** thresholds.

The count and quantity corrections below were checked on 2026-09-28
against the full `Sales_Eventlog.csv` import: 51,164 sales order items,
267,071 events, SHA256
`9c887faa36c9203ca6f8d1f357af3956ca17b592548d95238eeb45a8bdf1758c`.
They concern the sales event log, without cohort filters; companion
stock-movement and purchase-log counts were not rechecked in that audit.

## 1. Scope and stage model

| Stage | Canonical activities (draft ids) | Evidence in the extract |
|---|---|---|
| capture | `o2c.order_create` (Create Order), `o2c.item_create` (Create Order Item), `o2c.confirmation_send` (Send Order Confirmation) | 51,154 / 51,164 items have Create Order; 51,154 / 51,164 have Create Order Item; 2,044 / 51,164 have Send Order Confirmation. Absence alone does not distinguish missing logging from missing business activity |
| commit | `o2c.schedule_confirm` (schedule line confirmed quantity changed/removed), `o2c.schedule_request_change`, `o2c.avail_date_change` (Changed Mat.Avail.Date), `o2c.delivery_date_postpone`, `o2c.delivery_date_prepone`, `o2c.incoterms_change`, `o2c.delivery_block_change`, `o2c.rejection_change` (Changed RejectionReason) | changes in 13.7 % of items, 2.3 change events on average among them; postponed 3.2 %, preponed 7.8 %, availability date changed 9.9 %, confirmed quantity removed 1.5 %, rejection set 3.1 %, incoterms 0.8 %, block 0.1 % |
| fulfil | `o2c.delivery_create` (Create Delivery Item), `o2c.pick` (Picking Completed), `o2c.pack` (Packing Completed), `o2c.goods_issue` (Goods issue) | 48,753 / 48,485 / 119 / 48,703 distinct items, each out of 51,164; 2,461 items have no recorded goods issue (not proof that every one is open) |
| return | `o2c.return_delivery`, `o2c.return_to_own_stock`, `o2c.delivery_reversal` | companion stock movements: returns delivery 59, returns to own stock 110, goods delivery reversal 397; the sales event log has 10 distinct items flagged X across 16 event rows, with no return-receipt activity |
| invoice, pay | `o2c.invoice_create`, `o2c.invoice_cancel`, `o2c.payment_receive`, `o2c.dunning` | not in the extract; vocabulary from OCEL Order Management and SAP SD |

Case notion: sales document item (`Sales Document Number` + `Item`); the
header event *Create Order* is present on 51,154 of the 51,164 items and must be
typed as a header event (replication diagnostic). Deliveries and stock
movements link by document and item; returns are separate items.

## 2. Failure-mode catalogue (first entries)

```yaml
- id: o2c.fm.delivery_date_postponed
  name: Scheduled delivery date postponed after commitment
  signature: activity o2c.delivery_date_postpone after o2c.item_create
  observed_share: 0.032        # of order items, hackathon extract
  wise_pattern: {type: presence, activity: o2c.delivery_date_postpone, max: 0, layer: commitment_discipline}
  typical_causes: [material availability changed, supplier delay on purchase side, capacity, customer request]
  evidence_to_check: [o2c.avail_date_change co-occurrence, purchase-order confirmation changes for the SKU, plant]
  owner_role: order management / supply planning
  sources: [hackathon extract, SAP SD schedule line documentation]

- id: o2c.fm.late_goods_issue
  name: Goods issue after the requested delivery date
  signature: o2c.goods_issue later than case attribute requested_delivery_date
  observed_share: 0.032        # of shipped items
  wise_pattern: {type: lag, a: o2c.item_create, b: o2c.goods_issue, threshold: from requested date via derived attribute, layer: delivery_performance}
  typical_causes: [late availability, picking backlog, carrier scheduling, date postponed upstream]
  evidence_to_check: [pick-to-issue lag, postponement events, incoterms]
  owner_role: logistics

- id: o2c.fm.long_tail_fulfilment
  name: Order items far beyond the typical order-to-issue time
  signature: lag o2c.item_create → o2c.goods_issue in the upper tail (median 1.9 days, p90 67 days in the extract)
  wise_pattern: {type: lag, a: o2c.item_create, b: o2c.goods_issue, unit: days, missing_b: censor, layer: delivery_performance}
  typical_causes: [make-to-order items, backorders, blocked items, forgotten items]
  evidence_to_check: [material planning type and lead time from the material master, open-item age at extract end]
  owner_role: order management

- id: o2c.fm.customer_cancellation
  name: Item cancelled according to customer after commitment
  signature: o2c.rejection_change with reason 80 (1,425 items) after o2c.schedule_confirm
  wise_pattern: {type: presence, activity: o2c.rejection_change, max: 0, applicability: items with a confirmed schedule line, layer: commitment_discipline}
  typical_causes: [late confirmation, price or lead-time change, duplicate orders]
  owner_role: sales

- id: o2c.fm.confirmation_withdrawn
  name: Confirmed quantity removed
  signature: o2c.schedule_confirm with confirmed quantity removed (1.5 % of items)
  wise_pattern: {type: presence, activity: schedule line confirmed quantity removed, max: 0, layer: commitment_discipline}
  owner_role: supply planning

- id: o2c.fm.change_churn
  name: Repeated changes on one item
  signature: more than one change event on the item (13.7 % of items carry changes, 2.3 each on average)
  wise_pattern: {type: balance, agg: count of change events, max: 1, layer: change_discipline}
  owner_role: order management
```

Further entries to write from the vocabulary (not evidenced in the
extract): delivery block set and released, credit block, partial delivery
and split, return without return order, invoice correction, late dunning,
payment after due date.

## 3. Slice keys, exposure, applicability

Slice keys: customer (68), SKU (71), material group and planning type
(from the material master), plant, incoterms (DAP 74 %, CPT 26 %, FCA
0.4 % — FCA is too small to slice alone), order month. Exposure: order
quantity (no value column in the sales extract; value joins are a
customer-side decision). Applicability: exclude return items and items
rejected at capture from delivery-performance constraints; make-to-order
planning types get their own lag thresholds.

## 4. Pitfalls recorded for the readiness report

Header-event replication; 2,461 / 51,164 items without recorded goods issue;
confirmation recorded for 2,044 / 51,164 items. Order and confirmed quantities
are both numeric in 267,067 event rows covering 51,162 items: 267,017 rows
agree and 50 rows differ. The latter is an event-row count, not a distinct
item count, and does not by itself establish an ATP shortfall. Change events
carry `changed_from` and `changed_to` values that the derive recipes should
keep; timestamps are second-precision with no source timezone established.

**Unresolved pick-to-issue policy:** 42,791 items have every recorded goods
issue before their first Picking Completed event. The median first-issue
minus first-pick offset is -1 second across all 48,468 items with both events.
The current template uses `first_after` plus `missing_b=censor`, which treats
those earlier issues as missing responses and scores elapsed age. Confirm
source timestamp ordering before interpreting this rule as shipment delay.
No event reordering or lag-policy correction is established by these counts;
any revised norm needs a new immutable version. Goods issue is recorded
fulfilment evidence, not customer receipt, invoice payment or full O2C closure.

## 5. Companion: P2P side of the same extract

1,412 purchase order items with 13,567 events over 10 activities (vendor
confirmations, goods receipt, delivery-date and quantity changes, deletion
flags) and 2,993 goods receipts in stock movements — a second, smaller P2P
evidence source next to BPIC 2019, with vendor country, planned lead time
and indexed order value as attributes.
