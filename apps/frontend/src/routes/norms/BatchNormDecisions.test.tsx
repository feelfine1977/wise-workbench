import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import type { components, NormVersionCreate } from "@wise/api-schema";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, makeTestQueryClient } from "@/test/utils";
import { BatchNormDecisions, type BatchNormDecisionsProps } from "./BatchNormDecisions";
import { batchNumericRule } from "./normBatchPolicy";
import type { NormDocument } from "./normAuthoring";

type Calibration = components["schemas"]["NormCalibration"];
const source: NormDocument = {
  name: "Synthetic payment norm", scoring_mode: "layer_balanced", custom: { retained: true },
  layers: [{ id: "time", name: "Timing" }, { id: "quality", name: "Quality" }],
  views: [{ name: "Finance", layer_weights: { time: 1 } }, { name: "Direct", constraint_weights: { inherited: 3, c1: 1 } }],
  constraints: [
    { id: "c1", plain_name: "Pay target 1", type: "lag", layer: "time", params: { a: ["canonical:receive"], b: ["canonical:pay"], delta: 10, width: 2, unit: "D" } },
    { id: "c2", plain_name: "Pay target 2", type: "lag", layer: "time", params: { a: ["canonical:receive"], b: ["canonical:pay"], delta: 20, width: 2, unit: "D" } },
    { id: "c3", plain_name: "Hourly target", type: "lag", layer: "time", params: { a: ["canonical:receive"], b: ["canonical:pay"], delta: 12, width: 2, unit: "h" } },
    { id: "c4", plain_name: "Minimum quality", type: "metric", layer: "quality", params: { attribute: "quality", direction: "low", threshold: 0.5, width: 0.1 } },
    { id: "inherited", plain_name: "Inherited target", type: "lag", layer: "time", params: { a: ["canonical:receive"], b: ["canonical:pay"], delta: 30, width: 3, unit: "D" } },
  ],
  metadata: { calibration_pending: ["c1", "c2", "c3", "c4"], untouched: "keep", calibration: { inherited: { rationale: "Approved earlier", owner: "Original owner", decidedAt: "2026-01-01" } } },
};

function setup(options: { failSave?: boolean; failRead?: boolean; failSignal?: string; emptySignal?: string; selectionId?: string; responseScope?: components["schemas"]["NormEvidenceScope"] | null } = {}) {
  const document = structuredClone(source);
  const bodies: NormVersionCreate[] = [], signals: string[] = [], signatures: unknown[] = [];
  const signalRequests: URL[] = [];
  const documents = new Map<string, NormDocument>([["v1", document]]);
  let failSave = options.failSave, failRead = options.failRead, failSignal = options.failSignal;
  const onSaved = vi.fn(), onConstraint = vi.fn();
  const client = makeTestQueryClient();
  server.use(
    http.get("*/projects/batch-test/norms/:id/calibration", ({ params }) => {
      if (failRead) { failRead = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
      const doc = documents.get(String(params.id))!;
      const entries = doc.metadata?.calibration as Record<string, { rationale: string; owner: string }>;
      const missingRationale = doc.metadata?.calibration_pending as string[];
      const response: Calibration = { normVersionId: String(params.id), status: "draft", missingRationale, canLeaveDraft: !missingRationale.length, thresholds: doc.constraints!.map(c => ({ constraint_id: c.id, ...entries[c.id], changedHere: missingRationale.includes(c.id) })) };
      return HttpResponse.json(response);
    }),
    http.get("*/projects/batch-test/norms/:id/signals/:constraint", ({ params, request }) => {
      signals.push(String(params.constraint));
      const url = new URL(request.url); signalRequests.push(url);
      const selectionId = url.searchParams.get("selectionId");
      const scope = options.responseScope === null ? undefined : options.responseScope ?? (selectionId === null ? { kind: "all_cases" } : { kind: "saved_selection", selectionId, selectionName: "Selected invoices", membershipChecksum: "checksum-" + selectionId });
      if (params.constraint === failSignal) { failSignal = undefined; return HttpResponse.json({ title: "No signal" }, { status: 503 }); }
      const c = documents.get(String(params.id))!.constraints!.find(c => c.id === params.constraint)!;
      const rule = batchNumericRule(c)!;
      return HttpResponse.json({ scope, normVersionId: params.id, caseTableId: new URL(request.url).searchParams.get("caseTableId"), constraintId: c.id, type: c.type, unit: rule.unit, direction: rule.direction, threshold: rule.target, width: rule.width, casesInScope: 10, stats: { n: c.id === options.emptySignal ? 0 : 7, nCases: 10, median: 8, p90: 22, shareViolated: 0.2, casesMissing: 2 }, bins: [], ecdf: [] });
    }),
    http.post("*/projects/batch-test/norms", async ({ request }) => {
      const body = await request.json() as NormVersionCreate; bodies.push(body);
      if (failSave) { failSave = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
      const norm = structuredClone(body.norm) as NormDocument;
      norm.metadata = { ...norm.metadata, calibration: { ...norm.metadata?.calibration as object, ...body.calibration }, calibration_pending: (norm.metadata?.calibration_pending as string[]).filter(id => !body.calibration?.[id]) };
      const id = "saved_" + bodies.length; documents.set(id, norm);
      return HttpResponse.json({ id, norm, parentId: body.parentId, status: "draft" }, { status: 201 });
    }),
    http.patch("*/projects/batch-test/norms/:id", async ({ request }) => { signatures.push(await request.json()); return HttpResponse.json({}, { status: 500 }); }),
  );
  const element = (overrides: Partial<BatchNormDecisionsProps> = {}) => <QueryClientProvider client={client}><BatchNormDecisions projectId="batch-test" versionId="v1" document={document} caseTableId="ct1" selectionId={options.selectionId} onSaved={onSaved} onConstraint={onConstraint} {...overrides} /></QueryClientProvider>;
  const ui = render(element());
  return { bodies, signals, signalRequests, signatures, documents, document, client, onSaved, onConstraint, ui, element };
}
async function fillDecision(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Shared decision reason"), "Agreed service policy for these rules");
  await user.type(screen.getByLabelText("Shared decision owner"), "Process owner");
}
async function chooseDays(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Batch threshold settings" }));
  await user.selectOptions(screen.getByLabelText("Compatible threshold group"), screen.getByRole("option", { name: /lag · D · at most · Pay target 1/ }));
}

it("loads only requirements on mount and selects only visible pending rules", async () => {
  const api = setup(); const user = userEvent.setup();
  await screen.findByText(/4 pending decisions/);
  expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  expect(screen.getAllByRole("checkbox").every(input => !(input as HTMLInputElement).checked)).toBe(true);
  expect(screen.queryByRole("checkbox", { name: /Inherited/ })).not.toBeInTheDocument();
  expect(api.signals).toEqual([]); expect(api.bodies).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Open Pay target 1" }));
  expect(api.onConstraint).toHaveBeenCalledWith("c1");
  await user.selectOptions(screen.getByLabelText("Filter by layer"), "time");
  await user.selectOptions(screen.getByLabelText("Filter by rule type"), "lag");
  await user.click(screen.getByRole("button", { name: "Select visible pending" }));
  expect(screen.getByText("3 selected")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Filter by layer"), "quality");
  expect(screen.getByText("0 selected")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Filter by rule type"), "metric");
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect(api.bodies).toEqual([]); expect(api.signatures).toEqual([]);
  await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Batch norm decisions" }));
});

it("previews a shared reason, preserves failed edits, and persists only chosen decisions across remount", async () => {
  const api = setup({ failSave: true }); const user = userEvent.setup();
  await screen.findByText(/4 pending decisions/);
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 2/ }));
  await fillDecision(user);
  await user.click(screen.getByRole("button", { name: "Preview selected decisions" }));
  const preview = screen.getByRole("region", { name: "Batch change preview" });
  expect(within(preview).getAllByText("Reason: Agreed service policy for these rules")).toHaveLength(2);
  expect(api.bodies).toHaveLength(0);
  await user.click(within(preview).getByRole("checkbox", { name: "Apply Pay target 2" }));
  await user.click(screen.getByRole("button", { name: "Save 1 selected decisions as new draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your selections and entries are kept");
  expect(screen.getByLabelText("Shared decision reason")).toHaveValue("Agreed service policy for these rules");
  expect(within(preview).getByRole("checkbox", { name: "Apply Pay target 1" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Save 1 selected decisions as new draft" }));
  await waitFor(() => expect(api.onSaved).toHaveBeenCalledWith("saved_2"));
  expect(api.bodies[1]).toEqual(api.bodies[0]);
  expect(api.bodies[0]).toMatchObject({ norm: source, parentId: "v1", calibration: { c1: { rationale: "Agreed service policy for these rules", owner: "Process owner" } } });
  expect(Object.keys(api.bodies[0]!.calibration!)).toEqual(["c1"]);
  expect(api.document).toEqual(source); expect(api.signatures).toEqual([]);
  expect(api.documents.get("saved_2")!.metadata?.calibration_pending).toEqual(["c2", "c3", "c4"]);
  expect((api.documents.get("saved_2")!.metadata?.calibration as Record<string, unknown>).inherited).toEqual((source.metadata?.calibration as Record<string, unknown>).inherited);
  api.ui.unmount();
  render(api.element({ versionId: "saved_2", document: api.documents.get("saved_2")! }));
  await screen.findByText(/3 pending decisions/);
  expect(screen.queryByRole("checkbox", { name: /^Pay target 1/ })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /^Pay target 2/ })).not.toBeChecked();
});

it("uses real signal responses on demand, excludes failed evidence and saves explicitly chosen before/after changes", async () => {
  const api = setup({ failSignal: "c2" }); const user = userEvent.setup();
  await screen.findByText(/4 pending decisions/); await chooseDays(user);
  expect(screen.queryByRole("checkbox", { name: /^Hourly/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /^Minimum/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 2/ }));
  expect(api.signals).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await screen.findByText(/Evidence could not be loaded/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Load selected evidence" })).toBeEnabled());
  expect(screen.getByText("7 measured / 10 in scope · 3 missing signals. Threshold shares use measured cases.")).toBeVisible();
  expect(api.signals.sort()).toEqual(["c1", "c2"]); expect(api.bodies).toHaveLength(0);
  await user.type(screen.getByLabelText("New target"), "15"); await user.type(screen.getByLabelText("New tolerance width"), "4"); await fillDecision(user);
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
  const preview = screen.getByRole("region", { name: "Batch change preview" });
  expect(within(preview).getByText("Target: 10 → 15 D (at most)")).toBeVisible();
  expect(within(preview).getByText("Full penalty: 12 → 19 D")).toBeVisible();
  expect(within(preview).getByText(/norm v1 · case table ct1 · 7\/10 measured, 3 missing/)).toBeVisible();
  expect(within(preview).getByRole("checkbox", { name: "Apply Pay target 1" })).not.toBeChecked();
  expect(within(preview).queryByRole("checkbox", { name: "Apply Pay target 2" })).not.toBeInTheDocument();
  expect(api.bodies).toHaveLength(0);
  await user.click(within(preview).getByRole("checkbox", { name: "Apply Pay target 1" }));
  await user.click(screen.getByRole("button", { name: "Save 1 selected threshold changes as new draft" }));
  await waitFor(() => expect(api.onSaved).toHaveBeenCalled());
  const body = api.bodies[0]!;
  expect(Object.keys(body.calibration!)).toEqual(["c1"]);
  expect((body.norm as NormDocument).constraints![0]!.params).toEqual({ ...source.constraints![0]!.params, delta: 15, width: 4 });
  expect((body.norm as NormDocument).constraints!.slice(1)).toEqual(source.constraints!.slice(1));
  expect(body.norm.views).toEqual(source.views); expect(body.norm.metadata).toEqual(source.metadata);
  expect(body.note).toContain("norm v1, case table ct1; c1: 7/10 measured");
  expect(api.documents.get("saved_1")!.metadata?.calibration_pending).toContain("c2");
  expect(api.signatures).toHaveLength(0); expect(api.document).toEqual(source);
});

it("blocks unavailable and empty measurements without interpreting violation counts as coverage", async () => {
  const api = setup({ emptySignal: "c1" }); const user = userEvent.setup();
  await screen.findByText(/4 pending decisions/); await chooseDays(user);
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await fillDecision(user); await user.type(screen.getByLabelText("New target"), "15"); await user.type(screen.getByLabelText("New tolerance width"), "4");
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
  expect(screen.getByRole("alert")).toHaveTextContent("No changes are ready");
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await screen.findByText("No finite measurements; no threshold proposal.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview selected threshold settings" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
  expect(screen.queryByRole("region", { name: "Batch change preview" })).not.toBeInTheDocument();
  expect(api.bodies).toHaveLength(0);
});

it("invalidates proposals on edits and data-context changes", async () => {
  const api = setup(); const user = userEvent.setup();
  await screen.findByText(/4 pending decisions/); await chooseDays(user);
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await screen.findByText(/7 measured \/ 10 in scope/);
  await waitFor(() => expect(screen.getByLabelText("New target")).toBeEnabled());
  await user.type(screen.getByLabelText("New target"), "15"); await user.type(screen.getByLabelText("New tolerance width"), "4"); await fillDecision(user);
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
  expect(screen.getByRole("region", { name: "Batch change preview" })).toBeVisible();
  await user.type(screen.getByLabelText("Shared decision owner"), " updated");
  expect(screen.queryByRole("region", { name: "Batch change preview" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
  api.ui.rerender(api.element({ caseTableId: "ct2" }));
  await screen.findByText(/case table ct2/);
  expect(screen.queryByRole("region", { name: "Batch change preview" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Shared decision reason")).toHaveValue("");
  expect(api.signals).toHaveLength(1); expect(api.bodies).toHaveLength(0);
});

it("recovers from a failed calibration preflight without allowing a write", async () => {
  const api = setup({ failRead: true }); const user = userEvent.setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("Review requirements could not be checked");
  expect(screen.getByRole("button", { name: "Select visible pending" })).toBeDisabled();
  await user.type(screen.getByLabelText("Shared decision reason"), "Keep this draft reason");
  await user.click(screen.getByRole("button", { name: "Retry requirements" }));
  await screen.findByText(/4 pending decisions/);
  expect(screen.getByLabelText("Shared decision reason")).toHaveValue("Keep this draft reason");
  expect(api.bodies).toHaveLength(0); expect(api.signals).toHaveLength(0);
});

it("preserves an explicit lower-bound proposal on save failure and subtracts the width", async () => {
  const api = setup({ failSave: true }); const user = userEvent.setup();
  await screen.findByText(/4 pending decisions/);
  await user.click(screen.getByRole("button", { name: "Batch threshold settings" }));
  await user.selectOptions(screen.getByLabelText("Compatible threshold group"), screen.getByRole("option", { name: /metric · quality · at least/ }));
  await user.click(screen.getByRole("button", { name: "Select visible rules" }));
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await screen.findByText(/7 measured \/ 10 in scope/);
  await waitFor(() => expect(screen.getByLabelText("New target")).toBeEnabled());
  await user.type(screen.getByLabelText("New target"), "0.6"); await user.type(screen.getByLabelText("New tolerance width"), "0.2"); await fillDecision(user);
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
  expect(screen.getByText("Target: 0.5 → 0.6 quality (at least)")).toBeVisible();
  expect(screen.getByText("Full penalty: 0.4 → 0.4 quality")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Choose all previewed changes" }));
  await user.click(screen.getByRole("button", { name: "Save 1 selected threshold changes as new draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your selections and entries are kept");
  expect(screen.getByLabelText("New target")).toHaveValue(0.6);
  expect(screen.getByRole("checkbox", { name: "Apply Minimum quality" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Save 1 selected threshold changes as new draft" }));
  await waitFor(() => expect(api.onSaved).toHaveBeenCalledWith("saved_2"));
  expect(api.bodies[1]).toEqual(api.bodies[0]);
  expect((api.bodies[0]!.norm as NormDocument).constraints![3]!.params).toEqual({ attribute: "quality", direction: "low", threshold: 0.6, width: 0.2 });
  expect(api.signatures).toEqual([]);
});

// These existing decision/signature regressions use the explicit Expert requirements.
beforeEach(() => localStorage.setItem("wise-norm-authoring-preferences", JSON.stringify({ mode: "expert", skipReasonOwner: true })));


async function previewScopedThreshold(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/4 pending decisions/); await chooseDays(user);
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await screen.findByText(/7 measured \/ 10 in scope/);
  await waitFor(() => expect(screen.getByLabelText("New target")).toBeEnabled());
  await user.type(screen.getByLabelText("New target"), "15");
  await user.type(screen.getByLabelText("New tolerance width"), "4");
  await fillDecision(user);
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
}

it("requests selected-cohort signals and persists their exact scope in the supported version note", async () => {
  const selectionId = "cohort / A";
  const api = setup({ selectionId }); const user = userEvent.setup();
  await previewScopedThreshold(user);
  expect(api.signalRequests[0]!.searchParams.get("selectionId")).toBe(selectionId);
  expect(api.signalRequests[0]!.searchParams.get("caseTableId")).toBe("ct1");
  const preview = screen.getByRole("region", { name: "Batch change preview" });
  expect(preview).toHaveTextContent("selected cohort Selected invoices");
  await user.click(within(preview).getByRole("checkbox", { name: "Apply Pay target 1" }));
  await user.click(screen.getByRole("button", { name: "Save 1 selected threshold changes as new draft" }));
  await waitFor(() => expect(api.onSaved).toHaveBeenCalledWith("saved_1"));
  const body = api.bodies[0]!;
  expect(body.note).toContain(JSON.stringify({ kind: "saved_selection", selectionId }));
  expect(body.note).toContain(JSON.stringify({ constraintId: "c1", scope: { kind: "saved_selection", selectionId, selectionName: "Selected invoices", membershipChecksum: "checksum-" + selectionId } }));
  expect(Object.keys(body.calibration!.c1!).sort()).toEqual(["owner", "rationale"]);
  expect(body.norm.metadata).toEqual(source.metadata);
  expect(api.document).toEqual(source);
});

it("records cohort review context for confirmation-only decisions without claiming measured evidence", async () => {
  const api = setup({ selectionId: "cohort-a" }); const user = userEvent.setup();
  await screen.findByText(/4 pending decisions/);
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await fillDecision(user);
  await user.click(screen.getByRole("button", { name: "Preview selected decisions" }));
  await user.click(screen.getByRole("button", { name: "Save 1 selected decisions as new draft" }));
  await waitFor(() => expect(api.onSaved).toHaveBeenCalled());
  expect(api.bodies[0]!.note).toContain('"requestedScope":{"kind":"saved_selection","selectionId":"cohort-a"}');
  expect(api.bodies[0]!.note).toContain("No signal evidence loaded for these decisions");
  expect(api.signals).toEqual([]);
  expect(api.bodies[0]!.norm).toEqual(source);
});

it.each([
  [undefined, "cohort-a"], ["cohort-a", "cohort-b"], ["cohort-a", undefined],
])("resets evidence, entries and preview when population changes from %s to %s", async (initial, next) => {
  const api = setup({ selectionId: initial }); const user = userEvent.setup();
  const fetchQuery = vi.spyOn(api.client, "fetchQuery");
  await previewScopedThreshold(user);
  await user.click(screen.getByRole("checkbox", { name: "Apply Pay target 1" }));
  api.ui.rerender(api.element({ selectionId: next }));
  await screen.findByText(/4 pending decisions/);
  expect(screen.queryByRole("region", { name: "Batch change preview" })).not.toBeInTheDocument();
  expect(screen.getByText("0 selected")).toBeVisible();
  expect(screen.getByLabelText("Shared decision reason")).toHaveValue("");
  expect(screen.getByLabelText("Shared decision owner")).toHaveValue("");
  await chooseDays(user);
  expect(screen.getByLabelText("New target")).toHaveValue(null);
  expect(screen.getByLabelText("New tolerance width")).toHaveValue(null);
  expect(screen.queryByText(/7 measured \/ 10 in scope/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await screen.findByText(/7 measured \/ 10 in scope/);
  expect(api.signalRequests.map(url => url.searchParams.get("selectionId"))).toEqual([initial ?? null, next ?? null]);
  expect(fetchQuery.mock.calls.map(([options]) => options.queryKey)).toEqual([
    ["projects", "batch-test", "norms", "v1", "signals", "ct1", "c1", initial ?? null],
    ["projects", "batch-test", "norms", "v1", "signals", "ct1", "c1", next ?? null],
  ]);
  expect(api.bodies).toEqual([]);
});

it.each([
  { selectionId: "cohort-a", responseScope: null },
  { selectionId: "cohort-a", responseScope: { kind: "all_cases" as const } },
  { selectionId: "cohort-a", responseScope: { kind: "saved_selection" as const, selectionId: "cohort-b" } },
  { selectionId: undefined, responseScope: { kind: "saved_selection" as const, selectionId: "cohort-a" } },
])("rejects an evidence response from a different or unknown population: %j", async options => {
  const api = setup(options); const user = userEvent.setup();
  await screen.findByText(/4 pending decisions/); await chooseDays(user);
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await screen.findByText("Evidence belongs to a different or unknown population. Reload it for this selection.");
  expect(screen.queryByText(/7 measured \/ 10 in scope/)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("New target")).toBeEnabled());
  await user.type(screen.getByLabelText("New target"), "15"); await user.type(screen.getByLabelText("New tolerance width"), "4"); await fillDecision(user);
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
  expect(screen.getByRole("alert")).toHaveTextContent("No changes are ready");
  expect(screen.queryByRole("region", { name: "Batch change preview" })).not.toBeInTheDocument();
  expect(api.bodies).toEqual([]);
});

it("ignores a late response after switching cohorts while evidence is loading", async () => {
  const api = setup({ selectionId: "old" }); const user = userEvent.setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requested: string[] = [];
  server.use(http.get("*/projects/batch-test/norms/v1/signals/c1", async ({ request }) => {
    const selectionId = new URL(request.url).searchParams.get("selectionId")!;
    requested.push(selectionId);
    if (selectionId === "old") await gate;
    return HttpResponse.json({ normVersionId: "v1", caseTableId: "ct1", constraintId: "c1", type: "lag", unit: "D", direction: "high", threshold: 10, width: 2,
      scope: { kind: "saved_selection", selectionId }, casesInScope: 10, stats: { n: selectionId === "old" ? 9 : 2, nCases: 10 }, bins: [], ecdf: [] });
  }));
  await screen.findByText(/4 pending decisions/); await chooseDays(user);
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await waitFor(() => expect(requested).toEqual(["old"]));
  api.ui.rerender(api.element({ selectionId: "new" }));
  await screen.findByText(/4 pending decisions/); await chooseDays(user);
  await user.click(screen.getByRole("checkbox", { name: /^Pay target 1/ }));
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await screen.findByText(/2 measured \/ 10 in scope/);
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(api.client.isFetching({ queryKey: ["projects", "batch-test", "norms", "v1", "signals"] })).toBe(0));
  expect(requested).toEqual(["old", "new"]);
  expect(screen.queryByText(/9 measured/)).not.toBeInTheDocument();
  expect(screen.getByText(/2 measured \/ 10 in scope/)).toBeVisible();
  expect(api.bodies).toEqual([]);
});
