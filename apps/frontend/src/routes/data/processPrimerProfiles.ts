/** Educational content only: no event-log inference, scoring rules or target thresholds. */
export type ProcessPrimerId = "p2p" | "o2c";

export interface PrimerSource {
  title: string;
  url: string;
  supports: string;
}

export interface ProcessPrimerProfile {
  id: ProcessPrimerId;
  name: string;
  purpose: string;
  boundary: string;
  perspectives: readonly { name: string; goal: string; expectation: string }[];
  stages: readonly { name: string; team: string }[];
  handoffs: readonly { from: string; to: string; pass: string; value: string }[];
  expectations: readonly { name: string; description: string }[];
  problems: readonly { name: string; evidence: string; caution: string }[];
  variants: string;
  sources: readonly PrimerSource[];
}

export const PROCESS_PRIMER_METHOD_SOURCES: readonly PrimerSource[] = [
  {
    title: "OMG · Business Process Model and Notation",
    url: "https://www.omg.org/bpmn/",
    supports: "BPM: shared process understanding across business and technical roles. These figures are simplified guides, not BPMN models.",
  },
  {
    title: "Lean Enterprise Institute · Value-stream mapping",
    url: "https://www.lean.org/lexicon-terms/value-stream-mapping/",
    supports: "Lean: consider both work and information flow; distinguish the current state from a target state.",
  },
  {
    title: "ASQ · DMAIC",
    url: "https://asq.org/quality-resources/dmaic",
    supports: "Six Sigma: define the question and validate measurements before analyzing causes or testing changes.",
  },
];

export const PROCESS_PRIMER_PROFILES: Readonly<Record<ProcessPrimerId, ProcessPrimerProfile>> = {
  p2p: {
    id: "p2p",
    name: "Procure-to-pay (P2P)",
    purpose: "Meet an internal need for goods or services, then settle the supplier’s invoice under agreed terms.",
    boundary: "From a business need to supplier payment. Confirm whether your case represents an order, an item or an invoice.",
    perspectives: [
      { name: "Finance", goal: "Settle the right amount.", expectation: "Matched documents and payment within agreed terms." },
      { name: "Logistics", goal: "Make supplies available.", expectation: "Confirmation of the goods or services received." },
      { name: "Compliance", goal: "Keep purchasing authorized.", expectation: "Required approvals and traceable exceptions." },
      { name: "Automation", goal: "Limit avoidable manual handling.", expectation: "Distinguish routine handling from necessary exceptions." },
    ],
    stages: [
      { name: "Request", team: "Requesting department" },
      { name: "Approve & order", team: "Approver / Procurement" },
      { name: "Receive", team: "Receiving / Service owner" },
      { name: "Record invoice", team: "Accounts payable" },
      { name: "Match & resolve", team: "Accounts payable / Buyer" },
      { name: "Pay & clear", team: "Finance / Treasury" },
    ],
    handoffs: [
      { from: "Requester", to: "Procurement", pass: "Need, specification and approval", value: "An agreed purchase" },
      { from: "Receiving / Service owner", to: "Accounts payable", pass: "Receipt or service confirmation", value: "Evidence of what was received" },
      { from: "Accounts payable", to: "Finance / Treasury", pass: "Approved invoice and payment terms", value: "A supplier obligation ready to settle" },
    ],
    expectations: [
      { name: "Authorized purchase", description: "Agree which approvals are needed and when they apply." },
      { name: "Consistent documents", description: "Match order, receipt and invoice where the purchasing arrangement requires it." },
      { name: "Payment within agreed terms", description: "Use the applicable due date and confirm what the payment event records." },
    ],
    problems: [
      { name: "Invoice blocked or mismatched", evidence: "Link order items, receipts and invoices; inspect quantities, values and block / release reasons.", caution: "A block may be a valid control. Check the matching category before calling it a failure." },
      { name: "Repeated corrections", evidence: "Review change events, changed fields and reasons alongside the original documents.", caution: "Repeated events may represent partial deliveries or invoices, not avoidable rework." },
      { name: "Payment appears late", evidence: "Compare the applicable due date with the payment / clearing timestamp; keep open items visible.", caution: "Invoice-to-clearing time alone does not establish lateness or its cause." },
    ],
    variants: "Receipt and invoice order can vary. BPI Challenge 2019 describes two three-way matching categories, two-way matching without a required receipt, and consignment with invoicing outside the purchase-order flow. Its cases are purchase-order items; this guide is broader.",
    sources: [
      {
        title: "SAP · Purchase order lifecycle",
        url: "https://learning.sap.com/courses/managing-purchase-orders-in-sap-ariba-buying-and-invoicing/define-the-purchase-order-lifecycle",
        supports: "The broad P2P stages, receipt / service confirmation, invoice reconciliation and supplier payment.",
      },
      {
        title: "SAP · Purchase order roles",
        url: "https://learning.sap.com/courses/managing-purchase-orders-in-sap-ariba-buying-and-invoicing/differentiate-purchase-order-roles-and-responsibilities",
        supports: "Requester, approver, receiver and purchasing roles. Department groupings here are illustrative.",
      },
      {
        title: "SAP · Invoice blocking",
        url: "https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/af9ef57f504840d2b81be8667206d485/7870b6531de6b64ce10000000a174cb4.html",
        supports: "Invoice variances and checking them with purchasing, receiving or the supplier.",
      },
      {
        title: "IEEE Task Force · BPI Challenge 2019",
        url: "https://tfpm.compute.dtu.dk/competitions-awards/bpi-challenge/2019",
        supports: "Purchase-order item scope, matching variants and the owner’s throughput and rework questions.",
      },
    ],
  },
  o2c: {
    id: "o2c",
    name: "Order-to-cash (O2C)",
    purpose: "Fulfil a customer’s order, bill for the goods or service, and reconcile the money received.",
    boundary: "From a customer order to an account settled. Confirm how orders, deliveries, invoices and payments are linked.",
    perspectives: [
      { name: "Finance", goal: "Reconcile cash with sales.", expectation: "Accurate invoices linked to customer payments." },
      { name: "Logistics", goal: "Keep customer commitments.", expectation: "Complete delivery against the agreed promise." },
      { name: "Compliance", goal: "Keep transactions accountable.", expectation: "Authorized changes and traceable billing adjustments." },
      { name: "Automation", goal: "Handle routine orders consistently.", expectation: "Review repeated entry and unmatched references; retain necessary controls." },
    ],
    stages: [
      { name: "Capture order", team: "Sales / Customer service" },
      { name: "Confirm order", team: "Sales / Order management" },
      { name: "Fulfil & deliver", team: "Logistics / Service team" },
      { name: "Bill customer", team: "Billing" },
      { name: "Receive payment", team: "Finance / Treasury" },
      { name: "Apply cash", team: "Accounts receivable" },
    ],
    handoffs: [
      { from: "Sales", to: "Logistics / Service team", pass: "Confirmed order and delivery promise", value: "A shared customer commitment" },
      { from: "Logistics / Service team", to: "Billing", pass: "Delivery or service confirmation", value: "A basis for the customer’s bill" },
      { from: "Billing", to: "Accounts receivable", pass: "Invoice reference and payment terms", value: "A balance that can be reconciled" },
    ],
    expectations: [
      { name: "Deliver the agreed order", description: "Agree how completeness and the customer’s promised date will be checked." },
      { name: "Bill accurately", description: "Use the applicable prices, delivered quantities and billing arrangement." },
      { name: "Reconcile customer payment", description: "Link receipts to invoices and review overdue or disputed balances under agreed terms." },
    ],
    problems: [
      { name: "Delivery appears late", evidence: "Compare promised and actual delivery dates for linked order items, including partial deliveries.", caution: "Dispatch is not necessarily customer receipt; validate timestamp meanings." },
      { name: "Invoice corrected or disputed", evidence: "Link invoice revisions, credit notes and dispute reasons to the order and delivery records.", caution: "A correction is a review signal; event order alone does not identify its cause." },
      { name: "Payment remains unmatched", evidence: "Link bank receipt, remittance reference, invoice and cash-application / clearing events.", caution: "Missing clearing may mean a missing link or an open item, not proof the customer has not paid." },
    ],
    variants: "This example follows a delivery-based sale. Services, subscriptions, partial deliveries and different billing arrangements can follow other paths. A log may cover only order-to-fulfil or invoice-to-cash.",
    sources: [
      {
        title: "SAP · Order-to-cash stages",
        url: "https://learning.sap.com/courses/sap-customer-experience-lead-to-cash/describing-the-order-to-cash-stage",
        supports: "Order handling, fulfilment, billing, customer payments and cash application; product and service variants.",
      },
    ],
  },
};

const normalizeLabel = (label: string) => label.normalize("NFKC").trim().toLowerCase().replace(/[\s\p{Pd}_]+/gu, " ");

const aliases: Readonly<Record<ProcessPrimerId, readonly string[]>> = {
  p2p: ["p2p", "procure to pay", "purchase to pay", "procure to pay (p2p)", "purchase to pay (p2p)", "bpic19", "bpic2019", "bpic 19", "bpic 2019", "bpi 2019", "bpi challenge 2019", "bpi challenge 2019 · purchasing"],
  o2c: ["o2c", "order to cash", "order to cash (o2c)"],
};

/** Exact normalized aliases only. BPIC by itself, other years and mixed labels stay unknown. */
export function resolveProcessPrimer(process?: string): ProcessPrimerProfile | undefined {
  const label = normalizeLabel(process ?? "");
  const id = (Object.keys(aliases) as ProcessPrimerId[]).find((candidate) => aliases[candidate].includes(label));
  return id ? PROCESS_PRIMER_PROFILES[id] : undefined;
}
