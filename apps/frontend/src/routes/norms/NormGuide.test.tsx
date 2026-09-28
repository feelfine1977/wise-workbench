import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import type { NormVersionCreate } from "@wise/api-schema";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, makeTestQueryClient } from "@/test/utils";
import { NormGuide, type NormGuideProps } from "./NormGuide";
import type { NormDocument } from "./normAuthoring";

const original: NormDocument = {
  name: "Order promises", scoring_mode: "layer_balanced", extra: { keep: true },
  layers: [{ id: "time", name: "Delivery promises" }, { id: "quality", name: "Document quality" }],
  constraints: Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, layer: "time", type: "lag", description: `Delivery expectation ${index + 1}`, params: { a: ["Order"], b: ["Deliver"], delta: 5, width: 3 } })),
  views: [{ name: "Finance", layer_weights: { time: 2 } }, { name: "Logistics", constraint_weights: { c0: 3 } }],
  metadata: {
    calibration_pending: ["c0", "c1"],
    calibration: { c0: { rationale: "Keep the existing decision", owner: "Delivery owner" } },
    not_applicable: { archived: { constraint: { id: "archived", layer: "quality", type: "presence", params: {} } } },
    authoring: { situation: "new", goal: "Understand delivery promises", evidence: "Source policy", openQuestions: "Which timestamp records receipt?", caseTableId: "ct_orders", future: { keep: true } },
    guidance: { layers: {
      time: { expectation: "Keep the agreed delivery promise.", why_it_matters: "Customers plan against that date.", what_to_check_first: ["Check timestamp meaning", "Check linked orders", "Check partial delivery", "Check remaining questions"], owner_role: "order_management", stakeholders: "Existing stakeholder note" },
      quality: { expectation: "Keep document references consistent.", why_it_matters: "Invoices need traceable references." },
    } },
  },
};

function setup(options: { document?: NormDocument; failSave?: boolean; failCalibration?: boolean; failInventory?: boolean; caseTableId?: string | null; coverageWarnings?: number | null; calibration?: Record<string, unknown> } = {}) {
  const bodies: NormVersionCreate[] = [];
  const versionReads: string[] = [];
  const inventoryReads: string[] = [];
  const calibrationReads: string[] = [];
  const onTab = vi.fn(); const onConstraint = vi.fn(); const onSaved = vi.fn();
  let failSave = options.failSave; let failCalibration = options.failCalibration; let failInventory = options.failInventory;
  server.use(
    http.get("*/projects/:project/norms/:version/calibration", ({ params }) => {
      calibrationReads.push(`${params.project}:${params.version}`);
      if (failCalibration) { failCalibration = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
      return HttpResponse.json(options.calibration ?? { normVersionId: params.version, status: "draft", canLeaveDraft: false, missingRationale: Array.from({ length: 12 }, (_, index) => `c${index}`), thresholds: [{ constraint_id: "c0", rationale: "Previously entered reason", owner: null }] });
    }),
    http.get("*/projects/:project/norms/inventory", ({ request }) => {
      const table = new URL(request.url).searchParams.get("caseTableId") ?? ""; inventoryReads.push(table);
      if (failInventory) { failInventory = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
      return HttpResponse.json({ caseTableId: table, caseNoun: "order items", cases: table === "ct_empty" ? 0 : 120, events: table === "ct_empty" ? 0 : 500, activities: [{ label: "Order", cases: 120, events: 120 }], attributes: [{ name: "promised_date", missing: 4, distinct: 5, kind: "text", values: [] }] });
    }),
    http.get("*/projects/:project/norms/:version", ({ params }) => {
      const id = String(params.version); versionReads.push(id);
      return HttpResponse.json({ id, version: id === "nv_parent" ? 1 : 2, parentId: id === "nv_original" ? "nv_parent" : null, status: "draft", note: id === "nv_parent" ? "Prior delivery decision" : "Current draft", norm: options.document ?? original });
    }),
    http.post("*/projects/:project/norms", async ({ request }) => {
      const body = await request.json() as NormVersionCreate; bodies.push(body);
      if (failSave) { failSave = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
      return HttpResponse.json({ id: "nv_child", norm: body.norm, parentId: body.parentId, status: "draft", version: 3 }, { status: 201 });
    }),
  );
  let props: NormGuideProps = { projectId: "p", versionId: "nv_original", document: options.document ?? structuredClone(original), process: "o2c", datasetName: "Selected order log", caseTableId: options.caseTableId === null ? undefined : options.caseTableId ?? "ct_orders", caseNoun: "order items", coverageWarnings: options.coverageWarnings, onTab, onConstraint, onSaved };
  const client = makeTestQueryClient();
  const ui = (hidden = false) => <QueryClientProvider client={client}><main hidden={hidden}><NormGuide {...props} /></main></QueryClientProvider>;
  const view = render(ui());
  return { ...view, bodies, onTab, onConstraint, onSaved, versionReads, inventoryReads, calibrationReads, rerenderGuide: (patch: Partial<NormGuideProps> = {}, hidden = false) => { props = { ...props, ...patch }; view.rerender(ui(hidden)); } };
}

it("keeps the guide compact, reuses saved layer meaning and offers flexible editor jumps without per-constraint requests", async () => {
  const api = setup(); const user = userEvent.setup();
  expect(screen.getByText(/30 constraints are already defined/)).toBeVisible();
  expect(await screen.findByText(/12 constraints need a reason/)).toBeVisible();
  expect(api.calibrationReads).toEqual(["p:nv_original"]);
  expect(api.versionReads).toEqual([]); expect(api.inventoryReads).toEqual([]);
  expect(screen.getByRole("link", { name: "Explore process data first" })).toHaveAttribute("href", "/p/p/data?caseTable=ct_orders");
  expect(screen.queryByText("Keep the agreed delivery promise.")).not.toBeInTheDocument();
  await user.click(screen.getByText("Explore the purpose of 2 layers"));
  expect(await screen.findByText("Keep the agreed delivery promise.")).toBeVisible();
  expect(screen.getByText("order management")).toBeVisible();
  expect(screen.queryByText("Keep document references consistent.")).not.toBeInTheDocument();
  expect(screen.queryByText("Check remaining questions")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Layer to understand"), "quality");
  expect(screen.getByText("Keep document references consistent.")).toBeVisible();
  await user.click(screen.getByText("Required decisions · first 5 of 12"));
  const shortlist = screen.getByRole("list", { name: "Decision shortlist" });
  expect(within(shortlist).getAllByRole("button")).toHaveLength(5);
  expect(within(shortlist).getByText("Needs owner")).toBeVisible();
  await user.click(within(shortlist).getByRole("button", { name: "Delivery expectation 1" }));
  expect(api.onConstraint).toHaveBeenCalledWith("c0");
  for (const [label, tab] of [["Open constraints", "constraints"], ["Edit layers and views", "structure"], ["Open norm map", "map"], ["Open review", "review"]]) {
    screen.getByRole("button", { name: label }).focus(); await user.keyboard("{Enter}");
    expect(api.onTab).toHaveBeenLastCalledWith(tab);
  }
  expect(api.bodies).toEqual([]);
  expect(screen.queryByRole("button", { name: /approve|mark reviewed|sign version/i })).not.toBeInTheDocument();
});

it("saves only the working brief in an immutable child, keeps failure entries and reads the unchanged form back", async () => {
  const source = structuredClone(original); const api = setup({ document: source, failSave: true }); const user = userEvent.setup();
  await user.click(screen.getByText("Working brief"));
  expect(screen.getByLabelText("Purpose / goal")).toHaveValue("Understand delivery promises");
  expect(screen.getByRole("button", { name: "Save working brief as new draft" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("Your starting point"), "known");
  await user.selectOptions(screen.getByLabelText("How you will contribute"), "async");
  await user.type(screen.getByLabelText("Participants / roles"), "Logistics; sales");
  await user.type(screen.getByLabelText("Brief owner"), "Order lead");
  await user.type(screen.getByLabelText("Open questions"), " Confirm partial shipments.");
  await user.click(screen.getByRole("button", { name: "Save working brief as new draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your entries are kept");
  expect(screen.getByLabelText("Open questions")).toHaveValue("Which timestamp records receipt? Confirm partial shipments.");
  await user.click(screen.getByRole("button", { name: "Save working brief as new draft" }));
  await waitFor(() => expect(api.onSaved).toHaveBeenCalledWith("nv_child"));
  const body = api.bodies[1]!;
  expect(body).toEqual(api.bodies[0]);
  expect(body.parentId).toBe("nv_original");
  expect(body.calibration).toBeUndefined(); expect(body.notApplicable).toBeUndefined(); expect(body.author).toBeUndefined();
  expect(body.norm).toEqual({ ...source, metadata: { ...source.metadata, authoring: { future: { keep: true }, caseTableId: "ct_orders", situation: "known", goal: "Understand delivery promises", collaboration: "async", participants: "Logistics; sales", owner: "Order lead", evidence: "Source policy", openQuestions: "Which timestamp records receipt? Confirm partial shipments." } } });
  expect(source).toEqual(original);
  api.rerenderGuide({ versionId: "nv_child", document: body.norm as NormDocument });
  await user.click(screen.getByText("Working brief"));
  expect(screen.getByLabelText("Your starting point")).toHaveValue("known");
  expect(screen.getByLabelText("Participants / roles")).toHaveValue("Logistics; sales");
  expect(screen.getByLabelText("Open questions")).toHaveValue("Which timestamp records receipt? Confirm partial shipments.");
  expect(screen.getByRole("button", { name: "Save working brief as new draft" })).toBeDisabled();
});

it("retains a local brief across hidden tabs and resets it for another project or version", async () => {
  const api = setup(); const user = userEvent.setup();
  await user.click(screen.getByText("Working brief"));
  await user.type(screen.getByLabelText("Brief owner"), "Unsaved owner");
  api.rerenderGuide({}, true); api.rerenderGuide({}, false);
  expect(screen.getByLabelText("Brief owner")).toHaveValue("Unsaved owner");
  api.rerenderGuide({ projectId: "other", document: { ...original, metadata: { authoring: { owner: "Other owner" } } } });
  await user.click(screen.getByText("Working brief"));
  expect(screen.getByLabelText("Brief owner")).toHaveValue("Other owner");
  expect(screen.getByLabelText("Purpose / goal")).toHaveValue("");
  expect(api.bodies).toEqual([]);
});

it("keeps inventory failure distinct from observations and uses the selected table on retry and context change", async () => {
  const api = setup({ failInventory: true }); const user = userEvent.setup();
  await user.click(screen.getByText("Inspect the selected data inventory"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Inventory could not be read");
  expect(screen.queryByText(/120 order items/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry inventory" }));
  expect(await screen.findByText(/120 order items · 500 events/)).toBeVisible();
  expect(screen.getByText(/Inventory counts are not conformance results/)).toBeVisible();
  expect(api.inventoryReads).toEqual(["ct_orders", "ct_orders"]);
  api.rerenderGuide({ caseTableId: "ct_empty" });
  expect(await screen.findByText("This case table has no recorded cases.")).toBeVisible();
  expect(screen.queryByText(/120 order items · 500 events/)).not.toBeInTheDocument();
  expect(api.inventoryReads.at(-1)).toBe("ct_empty");
});

it("does not query inventory without a case table and recovers review requirements independently", async () => {
  const api = setup({ failCalibration: true, caseTableId: null }); const user = userEvent.setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("Review requirements could not be checked");
  await user.click(screen.getByText("Inspect the selected data inventory"));
  expect(await screen.findByText("Select a mapped case table in Data before checking observability.")).toBeVisible();
  expect(api.inventoryReads).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Retry review requirements" }));
  expect(await screen.findByText(/12 constraints need a reason/)).toBeVisible();
  expect(api.calibrationReads).toHaveLength(2);
  expect(api.bodies).toEqual([]);
});

it("does not turn omitted inventory fields into zero observations", async () => {
  setup(); const user = userEvent.setup();
  server.use(http.get("*/projects/p/norms/inventory", () => HttpResponse.json({ caseTableId: "ct_orders", cases: 120, events: 500 })));
  await user.click(screen.getByText("Inspect the selected data inventory"));
  expect(await screen.findByText(/Activity list unavailable · Attribute list unavailable/)).toBeVisible();
  expect(screen.getByText(/Attribute completeness was not supplied/)).toBeVisible();
  expect(screen.queryByText(/0 attributes report missing values/)).not.toBeInTheDocument();
});

it("scopes reassessment queries to the active version even when an earlier parent resolves late", async () => {
  const api = setup(); const user = userEvent.setup();
  let releaseParent!: () => void;
  const held = new Promise<void>(resolve => { releaseParent = resolve; });
  let parentRequested = false;
  server.use(http.get("*/projects/p/norms/:version", async ({ params }) => {
    const version = String(params.version);
    if (version === "nv_parent") { parentRequested = true; await held; }
    return HttpResponse.json({ id: version, version: version === "nv_other_parent" ? 7 : 1, parentId: version === "nv_original" ? "nv_parent" : version === "nv_other" ? "nv_other_parent" : null, status: "approved", note: version === "nv_parent" ? "Stale parent note" : "Relevant parent note", norm: original });
  }));
  await user.selectOptions(screen.getByLabelText("Your starting point"), "reassess");
  await waitFor(() => expect(parentRequested).toBe(true));
  expect(screen.getByText("Loading the previous decision…")).toBeVisible();
  api.rerenderGuide({ versionId: "nv_other" });
  expect(screen.getByLabelText("Your starting point")).toHaveValue("new");
  await user.selectOptions(screen.getByLabelText("Your starting point"), "reassess");
  expect(await screen.findByText("Previous version 7 · approved")).toBeVisible();
  await user.click(screen.getByText("Previous version 7 · approved"));
  expect(screen.getByText("Relevant parent note")).toBeVisible();
  await act(async () => { releaseParent(); await held; });
  expect(screen.queryByText("Stale parent note")).not.toBeInTheDocument();
  expect(screen.queryByText("nv_parent")).not.toBeInTheDocument();
});

it("shows bounded sourced P2P/O2C examples without changing the brief or data and keeps disclosed controls accessible", async () => {
  const api = setup(); const user = userEvent.setup();
  await user.click(screen.getByText("Process examples and sources"));
  expect(screen.getByRole("link", { name: "SAP · Order-to-cash stages" })).toHaveAttribute("href", "https://learning.sap.com/courses/sap-customer-experience-lead-to-cash/describing-the-order-to-cash-stage");
  await user.selectOptions(screen.getByLabelText("Illustrative process example"), "p2p");
  expect(screen.getByRole("link", { name: "SAP · Purchase order lifecycle" })).toHaveAttribute("href", "https://learning.sap.com/courses/managing-purchase-orders-in-sap-ariba-buying-and-invoicing/define-the-purchase-order-lifecycle");
  expect(screen.getByText("Order-to-cash (O2C)", { selector: "dd" })).toBeVisible();
  expect(screen.getByText("Selected order log")).toBeVisible();
  await user.click(screen.getByText("Working brief"));
  expect(screen.getByRole("button", { name: "Save working brief as new draft" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("How you will contribute"), "workshop");
  expect(screen.getByText(/Record proposals, objections and the accountable owner/)).toBeVisible();
  await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Norm authoring guide" }));
  expect(api.bodies).toEqual([]); expect(api.versionReads).toEqual([]); expect(api.inventoryReads).toEqual([]);
});

it("separates nine coverage warnings, zero missing calibration decisions, and an unsigned draft", async () => {
  const api = setup({ coverageWarnings: 9, calibration: { normVersionId: "nv_original", status: "draft", missingRationale: [], canLeaveDraft: true } });
  const user = userEvent.setup();
  expect(await screen.findByText(/0 constraints are reported as needing calibration rationale/)).toBeVisible();
  const coverage = screen.getByRole("group", { name: "Coverage and applicability review" });
  expect(coverage).toHaveTextContent("9 constraints have coverage or applicability warnings on this log.");
  const signoff = screen.getByRole("group", { name: "Version sign-off" });
  expect(signoff).toHaveTextContent("Saved version status: draft. This draft has not been signed off.");
  expect(signoff).toHaveTextContent("Sign-off still requires an explicit review action.");
  await user.click(within(coverage).getByRole("button", { name: "Inspect coverage and applicability" }));
  expect(api.onTab).toHaveBeenLastCalledWith("constraints");
  await user.click(screen.getByRole("button", { name: "Review calibration decisions" }));
  expect(api.onTab).toHaveBeenLastCalledWith("review");
  expect(api.bodies).toEqual([]);
  await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Norm authoring guide" }));
});

it("keeps omitted review counts and unknown coverage distinct from an explicit zero", async () => {
  const api = setup({ coverageWarnings: null, calibration: { normVersionId: "nv_original", status: "draft" } });
  expect(await screen.findByText(/Missing calibration rationale count is unknown/)).toBeVisible();
  expect(screen.getByText("Coverage/applicability warning count is unknown.")).toBeVisible();
  expect(screen.getByText("Sign-off eligibility is unknown.")).toBeVisible();
  expect(screen.queryByText(/\b0 constraints/)).not.toBeInTheDocument();
  for (const count of [undefined, -1, NaN, 1.5]) {
    api.rerenderGuide({ coverageWarnings: count });
    expect(screen.getByText("Coverage/applicability warning count is unknown.")).toBeVisible();
  }
  api.rerenderGuide({ coverageWarnings: 0 });
  expect(screen.getByText("0 constraints have coverage or applicability warnings on this log.")).toBeVisible();
  expect(screen.getByText(/Missing calibration rationale count is unknown/)).toBeVisible();
});

it("does not claim zero requirements while loading or after failure and keeps coverage independent", async () => {
  const api = setup({ failCalibration: true, coverageWarnings: 9 });
  expect(screen.getByText("Checking saved calibration requirements…")).toBeVisible();
  expect(screen.queryByText(/0 constraints are reported/)).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Review requirements could not be checked");
  expect(screen.getByRole("group", { name: "Coverage and applicability review" })).toHaveTextContent("9 constraints");
  expect(screen.getByRole("group", { name: "Version sign-off" })).toHaveTextContent("Saved version review status is unknown.");
  expect(api.bodies).toEqual([]);
});

it("ignores calibration counts returned for a different version", async () => {
  setup({ calibration: { normVersionId: "wrong_version", status: "approved", missingRationale: [], canLeaveDraft: true } });
  expect(await screen.findByText(/Missing calibration rationale count is unknown/)).toBeVisible();
  expect(screen.queryByText(/Saved version status: approved/)).not.toBeInTheDocument();
  expect(screen.queryByText(/0 constraints are reported/)).not.toBeInTheDocument();
});
