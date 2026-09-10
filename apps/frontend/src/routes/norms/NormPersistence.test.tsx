import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import type { NormVersion, NormVersionCreate, components } from "@wise/api-schema";
import { server } from "@/mocks/node";
import { db } from "@/mocks/db";
import { buildDistribution } from "@/mocks/fixtures/distribution";
import { renderApp } from "@/test/utils";
import { SignVersion } from "./SignVersion";
import { makeTestQueryClient } from "@/test/utils";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { App } from "@/app/providers";
import { inventoryFor } from "@/mocks/fixtures/cycle4";
import { act, render } from "@testing-library/react";

const PATH = "/p/p2p2018/norms/nv_7?tab=constraints&constraint=c_save";
// Route code, the norm response and the log inventory load independently. Keep their
// local UI deadline consistent with Builder tests; no global testing timeout changes.
const LOAD = { timeout: 8000 };
const DATE = "2026-09-10T08:15:00Z";
type Calibration = components["schemas"]["NormCalibration"];
type Document = { constraints: { id: string; type: string; layer: string; params: Record<string, unknown>; description: string; plain_name?: string; applicability?: Record<string, unknown> }[]; metadata?: Record<string, unknown>; views: { name: string; constraint_weights?: Record<string, number> }[] };

/** A small stateful API double: it records only explicit decisions and serves them back on fresh reads. */
function persistenceApi(options: { saveFailure?: number | "network"; signFailure?: number; missingCalibration?: boolean } = {}) {
  const original = db.norms.find(n => n.id === "nv_7")!;
  const doc: Document = {
    constraints: [
      { id: "c_save", type: "lag", layer: "L3", params: { a: ["Record Goods Receipt"], b: ["Clear Invoice"], delta: 30, width: 90, unit: "D" }, description: "Invoice timing", applicability: { attr: "company", in: ["A"] } },
      { id: "c_keep", type: "presence", layer: "L3", params: { activity: ["Record Goods Receipt"], m: 1 }, description: "Goods receipt" },
    ],
    metadata: { untouched: "retain me" },
    views: [{ name: "Automation", constraint_weights: { c_save: 0.6, c_keep: 0.4 } }],
  };
  Object.assign(original, { status: "draft", author: "Original author", norm: { ...original.norm, ...doc } });
  const saved = new Map<string, Calibration>();
  const bodies: NormVersionCreate[] = [];
  const signatures: { status: string; author: string }[] = [];
  const signals: { version: string; caseTable: string; constraint: string }[] = [];
  let rejectSave = options.saveFailure;
  let rejectSign = options.signFailure;
  const refusal = (status: number, detail: string) => HttpResponse.json({ status, title: "Cannot save this decision", detail, code: "norm.rationale_required", errors: [{ field: "c_save", message: "Required" }] }, { status });
  server.use(
    http.get("*/projects/p2p2018/norms/:version/signals/:constraint", ({ params, request }) => {
      const caseTableId = new URL(request.url).searchParams.get("caseTableId")!;
      signals.push({ version: String(params.version), caseTable: caseTableId, constraint: String(params.constraint) });
      const version = db.norms.find(v => v.id === params.version);
      const constraint = (version?.norm as Document | undefined)?.constraints.find(c => c.id === params.constraint);
      if (!constraint) return HttpResponse.json({ status: 404, title: "Unavailable" }, { status: 404 });
      return HttpResponse.json({ ...buildDistribution("c_save"), threshold: Number(constraint.params.delta ?? 0), width: Number(constraint.params.width ?? 0), constraintId: constraint.id, normVersionId: version!.id, caseTableId } satisfies components["schemas"]["NormSignalDistribution"]);
    }),
    http.get("*/projects/p2p2018/norms/:id/calibration", ({ params }) => {
      if (options.missingCalibration) return refusal(503, "Read unavailable");
      return HttpResponse.json(saved.get(String(params.id)) ?? { normVersionId: params.id, status: "draft", thresholds: [], notApplicable: [], missingRationale: [] });
    }),
    http.post("*/projects/p2p2018/norms", async ({ request }) => {
      const body = await request.json() as NormVersionCreate; bodies.push(body);
      // Match the classic parser's supported label field; display metadata is not a norm input.
      if ((body.norm as Document).constraints.some(c => "plain_name" in c)) return HttpResponse.json({ status: 422, title: "Invalid norm", code: "norm.invalid", detail: "Constraint contains unsupported plain_name; use description." }, { status: 422 });
      if (rejectSave) { const status = rejectSave; rejectSave = undefined; return status === "network" ? HttpResponse.error() : refusal(status, "Give this threshold a rationale and an owner."); }
      const id = `nv_saved_${bodies.length}`;
      const norm = structuredClone(body.norm) as Document;
      const removed: Record<string, unknown>[] = [];
      const excluded: Record<string, unknown> = {};
      for (const [cid, entry] of Object.entries(body.notApplicable ?? {})) {
        const constraint = norm.constraints.find(c => c.id === cid);
        excluded[cid] = { ...entry, decidedAt: DATE, constraint };
        removed.push({ constraint_id: cid, ...entry, decidedAt: DATE });
        norm.constraints = norm.constraints.filter(c => c.id !== cid);
        norm.views = norm.views.map(v => ({ ...v, constraint_weights: Object.fromEntries(Object.entries(v.constraint_weights ?? {}).filter(([key]) => key !== cid)) }));
      }
      norm.metadata = { ...norm.metadata, not_applicable: excluded };
      const parent = db.norms.find(n => n.id === body.parentId)!;
      const created: NormVersion = { ...parent, id, version: parent.version + 1, norm, note: body.note, parentId: parent.id, status: "draft", author: body.author ?? null, createdAt: DATE };
      db.norms.push(created);
      saved.set(id, { normVersionId: id, status: "draft", thresholds: Object.entries(body.calibration ?? {}).map(([cid, entry]) => ({ constraint_id: cid, ...entry, decidedAt: DATE, changedHere: true, threshold: norm.constraints.find(c => c.id === cid)?.params ?? {} })), notApplicable: removed, missingRationale: ((norm.metadata?.calibration_pending ?? []) as string[]).filter(id => !body.calibration?.[id]) });
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch("*/projects/p2p2018/norms/:id", async ({ request, params }) => {
      const body = await request.json() as { status: "reviewed" | "approved"; author: string }; signatures.push(body);
      if (rejectSign) { const status = rejectSign; rejectSign = undefined; return refusal(status, "This threshold still needs a recorded rationale."); }
      const version = db.norms.find(n => n.id === params.id)!;
      if (saved.get(version.id)?.missingRationale?.length) return refusal(422, "A changed threshold is still awaiting calibration.");
      if (body.status !== version.status) Object.assign(version, body);
      return HttpResponse.json(version);
    }),
  );
  return { bodies, signatures, saved, signals };
}

async function openRule() {
  const user = userEvent.setup();
  const app = renderApp(PATH);
  await screen.findByTestId("norm-builder", {}, LOAD);
  await user.click(screen.getByRole("button", { name: "the rule" }));
  await screen.findByTestId("rule-editor", {}, LOAD);
  const value = screen.getByLabelText("within");
  await user.clear(value); await user.type(value, "42");
  await user.type(screen.getByLabelText("why this change (required)"), "  The agreed service target  ");
  await user.type(screen.getByLabelText("who owns it (required)"), "  Calibration owner  ");
  return { user, app };
}

async function openExclusion() {
  const user = userEvent.setup(); const app = renderApp(PATH);
  await screen.findByTestId("norm-builder", {}, LOAD);
  await user.click(screen.getByRole("button", { name: "who it applies to" }));
  await user.click(screen.getByLabelText(/Not applicable to this log/));
  await user.type(screen.getByLabelText("why this change (required)"), "Keep unevaluable rules out");
  await user.type(screen.getByLabelText("who owns it (required)"), "Decision owner");
  return { user, app };
}

it("saves typed calibration from the rule editor and reads the actual reason, owner and date after a fresh render", async () => {
  const api = persistenceApi(); const { user, app } = await openRule();
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  const decision = await screen.findByTestId("saved-calibration");
  expect(decision).toHaveTextContent("The agreed service target"); expect(decision).toHaveTextContent("Calibration owner");
  expect(decision.querySelector("time")).toHaveAttribute("datetime", DATE);
  expect(api.bodies[0]).toMatchObject({ parentId: "nv_7", calibration: { c_save: { rationale: "The agreed service target", owner: "Calibration owner" } }, norm: { metadata: { untouched: "retain me" } } });
  expect(api.bodies[0]?.author).toBeUndefined(); expect(api.bodies[0]?.notApplicable).toBeUndefined();
  expect((api.bodies[0]?.norm as Document).constraints[1]).toEqual({ id: "c_keep", type: "presence", layer: "L3", params: { activity: ["Record Goods Receipt"], m: 1 }, description: "Goods receipt" });
  app.unmount(); renderApp("/p/p2p2018/norms/nv_saved_1?tab=constraints&constraint=c_save");
  expect(await screen.findByTestId("saved-calibration")).toHaveTextContent("Calibration owner");
});

it("the threshold dialog uses the same calibration contract and preserves both chosen numbers", async () => {
  const api = persistenceApi(); const user = userEvent.setup(); renderApp(PATH);
  await screen.findByTestId("norm-builder", {}, LOAD);
  const threshold = await screen.findByLabelText(/ϑ threshold/); await user.clear(threshold); await user.type(threshold, "44");
  const width = screen.getByLabelText(/W width/); await user.clear(width); await user.type(width, "95");
  await user.click(screen.getByRole("button", { name: /Commit as version/ }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("why this threshold (required)"), "Agreed after inspection");
  await user.type(within(dialog).getByLabelText("who owns it (required)"), "Threshold owner");
  await user.click(within(dialog).getByRole("button", { name: "Save as the next version" }));
  await screen.findByTestId("saved-calibration");
  expect(api.bodies[0]?.calibration).toEqual({ c_save: { rationale: "Agreed after inspection", owner: "Threshold owner" } });
  expect((api.bodies[0]?.norm as Document).constraints[0]?.params).toMatchObject({ delta: 44, width: 95 });
});

it.each([422, "network"] as const)("keeps rule edits and visible refusal on %s, then retries without losing input", async failure => {
  const api = persistenceApi({ saveFailure: failure }); const { user } = await openRule();
  const button = screen.getByRole("button", { name: "Save as the next version" }); await user.click(button);
  expect(await screen.findByTestId("norm-save-error")).toHaveAttribute("role", "alert");
  expect(screen.getByTestId("norm-save-error")).toHaveTextContent(failure === 422 ? "Add a reason and an owner for “Invoice timing”." : "could not be reached");
  expect(screen.getByLabelText("within")).toHaveValue(42);
  expect(screen.getByLabelText("who owns it (required)")).toHaveValue("  Calibration owner  ");
  expect(screen.getByLabelText("why this change (required)")).toHaveValue("  The agreed service target  ");
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("version 7");
  await user.click(button); await screen.findByTestId("saved-calibration"); expect(api.bodies[1]).toEqual(api.bodies[0]);
});

it("sends exclusion separately, retains its note on refusal, and reads it after save and reload", async () => {
  const api = persistenceApi({ saveFailure: 422 }); const { user, app } = await openExclusion();
  const save = screen.getByRole("button", { name: "Save as the next version" }); expect(save).toBeEnabled();
  await user.click(save); expect(screen.getByLabelText("why (required)")).toHaveFocus();
  expect(api.bodies).toHaveLength(0);
  await user.type(screen.getByLabelText("why (required)"), "   "); await user.click(save);
  expect(screen.getByLabelText("why (required)")).toHaveAttribute("aria-invalid", "true");
  expect(api.bodies).toHaveLength(0);
  await user.type(screen.getByLabelText("why (required)"), "No invoice events here  ");
  await user.click(save); await screen.findByTestId("norm-save-error");
  expect(screen.getByLabelText(/Not applicable to this log/)).toBeChecked();
  expect(screen.getByLabelText("why (required)")).toHaveValue("   No invoice events here  ");
  await user.click(save); const record = await screen.findByTestId("saved-exclusions");
  expect(record).toHaveTextContent("Invoice timing"); expect(record).toHaveTextContent("No invoice events here"); expect(record).toHaveTextContent("Decision owner");
  expect(record.querySelector("time")).toHaveAttribute("datetime", DATE);
  expect(api.bodies[0]?.notApplicable).toEqual({ c_save: { note: "No invoice events here", author: "Decision owner" } });
  expect(api.bodies[0]?.calibration).toBeUndefined();
  expect((api.bodies[0]?.norm as Document).constraints[0]?.applicability).toEqual({ attr: "company", in: ["A"] });
  expect((api.bodies[0]?.norm as Document).constraints).toHaveLength(2);
  app.unmount(); renderApp("/p/p2p2018/norms/nv_saved_2?tab=history"); expect(await screen.findByTestId("saved-exclusions")).toHaveTextContent("No invoice events here");
});

it("unchecking exclusion leaves the original library applicability intact", async () => {
  const api = persistenceApi(); const { user } = await openExclusion();
  await user.click(screen.getByLabelText(/Not applicable to this log/));
  await user.click(screen.getByRole("button", { name: "Save as the next version" })); await screen.findByTestId("saved-calibration");
  expect(api.bodies[0]?.notApplicable).toBeUndefined(); expect((api.bodies[0]?.norm as Document).constraints[0]?.applicability).toEqual({ attr: "company", in: ["A"] });
});

it("shows a readback failure instead of implying that no decisions were saved", async () => {
  persistenceApi({ missingCalibration: true }); renderApp(PATH);
  expect(await screen.findByRole("alert")).toHaveTextContent("Saved decisions could not be read");
});

describe("explicit signing and recovery", () => {
  it.each([422, 409])("retains the signer on %s then displays the returned signer after reload", async status => {
    const api = persistenceApi({ signFailure: status }); const user = userEvent.setup(); const app = renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Mark reviewed" }));
    const dialog = screen.getByTestId("sign-norm");
    await user.type(within(dialog).getByLabelText("Who signs it"), "  Explicit reviewer  ");
    await user.click(within(dialog).getByRole("button", { name: "Mark reviewed" }));
    expect(await screen.findByTestId("sign-error")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("sign-error")).toHaveTextContent("Add a reason and an owner for “Invoice timing”.");
    expect(within(dialog).getByLabelText("Who signs it")).toHaveValue("  Explicit reviewer  ");
    expect(screen.getByText("draft — not yet signed")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Mark reviewed" }));
    await waitFor(() => expect(screen.queryByTestId("sign-norm")).not.toBeInTheDocument());
    expect(api.signatures).toEqual([{ status: "reviewed", author: "Explicit reviewer" }, { status: "reviewed", author: "Explicit reviewer" }]);
    app.unmount(); renderApp(PATH); expect(await screen.findByText("signed by Explicit reviewer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Approve this version" }));
    await user.type(screen.getByLabelText("Who signs it"), "Final approver");
    await user.click(within(screen.getByTestId("sign-norm")).getByRole("button", { name: "Approve this version" }));
    expect(await screen.findByText("signed by Final approver")).toBeInTheDocument();
  });

  it("does not allow a whitespace-only signer", async () => {
    const user = userEvent.setup(); render(<QueryClientProvider client={makeTestQueryClient()}><SignVersion projectId="p2p2018" version={{ id: "nv_7", version: 7, status: "reviewed" }} onDone={() => undefined} /></QueryClientProvider>);
    await user.type(screen.getByLabelText("Who signs it"), "   ");
    await user.click(screen.getByRole("button", { name: "Approve this version" }));
    expect(screen.getByLabelText("Who signs it")).toHaveFocus();
    expect(screen.getByLabelText("Who signs it")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter your name to sign this version.")).toBeVisible();
  });
});

it("saves a new threshold under its own id, retaining the previously selected expectation", async () => {
  const api = persistenceApi(); const user = userEvent.setup(); renderApp(PATH);
  await screen.findByTestId("norm-builder", {}, LOAD);
  await user.click(screen.getByRole("button", { name: "Add your own expectation" }));
  await user.type(screen.getByLabelText("what it is called"), "Payment target");
  await user.click(screen.getByRole("button", { name: "Add it" }));
  const editor = await screen.findByTestId("rule-editor", {}, LOAD);
  const first = within(editor).getByRole("group", { name: "First this" });
  await user.click(within(first).getByRole("option", { name: /Record Goods Receipt/ }));
  const second = within(editor).getByRole("group", { name: "Then this" });
  await user.click(within(second).getByRole("option", { name: /Clear Invoice/ }));
  await user.type(screen.getByLabelText("why this change (required)"), "Agreed target for the new rule");
  await user.type(screen.getByLabelText("who owns it (required)"), "New rule owner");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  expect(await screen.findByTestId("saved-calibration")).toHaveTextContent("New rule owner");
  expect(api.bodies[0]?.calibration).toEqual({ c_own_payment_target: { rationale: "Agreed target for the new rule", owner: "New rule owner" } });
  const constraints = (api.bodies[0]?.norm as Document).constraints;
  expect(constraints).toHaveLength(3);
  expect(constraints.find(c => c.id === "c_own_payment_target")?.description).toBe("Payment target");
  expect(constraints.find(c => c.id === "c_own_payment_target")).not.toHaveProperty("plain_name");
  expect(constraints.find(c => c.id === "c_save")?.params.delta).toBe(30);
  expect(constraints.find(c => c.id === "c_own_payment_target")?.params).toMatchObject({ a: ["Record Goods Receipt"], b: ["Clear Invoice"], delta: 1, width: 3 });
});

it("keeps the explicitly selected mapped table through tabs, constraint selection, save and reload before any run", async () => {
  const api = persistenceApi();
  db.runs = [];
  db.jobs.clear();
  for (const project of db.projects) delete project.latestRunId;
  const table = { ...db.caseTables[0]!, id: "ct_explicit_before_run" };
  db.caseTables.push(table);
  const inventoryRequests: string[] = [];
  server.use(http.get("*/projects/p2p2018/norms/inventory", ({ request }) => {
    const id = new URL(request.url).searchParams.get("caseTableId")!;
    inventoryRequests.push(id);
    return HttpResponse.json(inventoryFor(id, table.cases ?? 0, table.events ?? 0));
  }));
  const user = userEvent.setup();
  const history = createMemoryHistory({ initialEntries: [`${PATH}&caseTable=${table.id}`] });
  const app = render(<App queryClient={makeTestQueryClient()} history={history} />);
  await screen.findByTestId("norm-builder", {}, LOAD);
  await user.click(screen.getByRole("tab", { name: "JSON" }));
  await user.click(screen.getByRole("tab", { name: "Constraints" }));
  await user.click(screen.getByRole("button", { name: /^Goods receipt/ }));
  await user.click(screen.getByRole("button", { name: /^Invoice timing/ }));
  expect(new URL(history.location.href, "http://localhost").searchParams.get("caseTable")).toBe(table.id);
  await user.click(screen.getByRole("button", { name: "the rule" }));
  await screen.findByTestId("rule-editor", {}, LOAD);
  await user.clear(screen.getByLabelText("within"));
  await user.type(screen.getByLabelText("within"), "42");
  await user.type(screen.getByLabelText("why this change (required)"), "Before the first score");
  await user.type(screen.getByLabelText("who owns it (required)"), "Mapped table owner");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await screen.findByTestId("saved-calibration");
  await waitFor(() => expect(history.location.pathname).toContain("nv_saved_1"));
  const savedUrl = history.location.href;
  expect(new URL(savedUrl, "http://localhost").searchParams.get("caseTable")).toBe(table.id);
  expect(api.bodies[0]?.calibration).toEqual({ c_save: { rationale: "Before the first score", owner: "Mapped table owner" } });
  app.unmount();
  render(<App queryClient={makeTestQueryClient()} history={createMemoryHistory({ initialEntries: [savedUrl] })} />);
  await screen.findByTestId("saved-calibration");
  await user.click(screen.getByRole("button", { name: "the rule" }));
  await screen.findByTestId("rule-editor", {}, LOAD);
  expect(screen.getByLabelText("within")).toHaveValue(42);
  expect(inventoryRequests.length).toBeGreaterThanOrEqual(2);
  expect(new Set(inventoryRequests)).toEqual(new Set([table.id]));
  expect(db.runs).toHaveLength(0);
});

it("renames the whole norm as a new version, keeps pending calibration, and preserves the title through threshold and exclusion saves", async () => {
  const api = persistenceApi(); const original = db.norms.find(n => n.id === "nv_7")!;
  original.norm.name = "Policy 2024 — target 30";
  original.norm.metadata = { calibration_pending: ["c_save"] };
  const runs = structuredClone(db.runs);
  const user = userEvent.setup(); renderApp(PATH);
  await user.click(await screen.findByRole("button", { name: "Rename norm" }));
  const dialog = screen.getByRole("dialog", { name: "Rename norm" });
  const name = within(dialog).getByLabelText("Norm name");
  await user.clear(name); await user.type(name, "  ");
  await user.click(within(dialog).getByRole("button", { name: "Save as the next version" }));
  expect(name).toHaveFocus(); expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription("Enter a name for this norm."); expect(api.bodies).toHaveLength(0);
  await user.clear(name); await user.type(name, "Policy 2025 — target 30");
  expect(name).not.toHaveAttribute("aria-invalid");
  await user.click(within(dialog).getByRole("button", { name: "Save as the next version" }));
  expect(within(dialog).getByLabelText("why this change (required)")).toHaveFocus();
  await user.type(within(dialog).getByLabelText("why this change (required)"), "The agreed title");
  await user.type(within(dialog).getByLabelText("who owns it (required)"), "Title owner");
  await user.click(within(dialog).getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Policy 2025 — target 30");
  expect(api.bodies[0]?.calibration).toBeUndefined();
  expect(api.bodies[0]?.norm.metadata).toEqual({ calibration_pending: ["c_save"] });
  expect(original.norm.name).toBe("Policy 2024 — target 30");
  await user.click(screen.getByRole("button", { name: "Mark reviewed" }));
  await user.type(screen.getByLabelText("Who signs it"), "Reviewer");
  await user.click(within(screen.getByTestId("sign-norm")).getByRole("button", { name: "Mark reviewed" }));
  expect(await screen.findByTestId("sign-error")).toHaveTextContent("Add a reason and an owner");
  await user.click(within(screen.getByTestId("sign-norm")).getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "the rule" }));
  await screen.findByTestId("rule-editor", {}, LOAD);
  await user.clear(screen.getByLabelText("within")); await user.type(screen.getByLabelText("within"), "44");
  await user.type(screen.getByLabelText("why this change (required)"), "Explicit calibration");
  await user.type(screen.getByLabelText("who owns it (required)"), "Rule owner");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await screen.findByTestId("saved-calibration");
  expect(api.bodies[1]?.norm.name).toBe("Policy 2025 — target 30");
  expect(api.bodies[1]?.calibration?.c_save).toEqual({ rationale: "Explicit calibration", owner: "Rule owner" });
  await user.click(screen.getByRole("button", { name: "who it applies to" }));
  await user.click(screen.getByLabelText(/Not applicable to this log/));
  await user.type(screen.getByLabelText("why (required)"), "Outside the agreed scope");
  await user.type(screen.getByLabelText("why this change (required)"), "Scope decision");
  await user.type(screen.getByLabelText("who owns it (required)"), "Scope owner");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await screen.findByTestId("saved-exclusions");
  expect(api.bodies[2]?.norm.name).toBe("Policy 2025 — target 30");
  expect(db.runs).toEqual(runs);
});

it("renames an expectation without changing its id, arbitrary title numbers or unresolved calibration", async () => {
  const api = persistenceApi(); const original = db.norms.find(n => n.id === "nv_7")!;
  (original.norm as Document).constraints[0]!.plain_name = "Invoice timing";
  original.norm.metadata = { calibration_pending: ["c_save"] };
  const user = userEvent.setup(); renderApp(PATH);
  await user.click(await screen.findByRole("button", { name: "the rule" })); await screen.findByTestId("rule-editor", {}, LOAD);
  const name = screen.getByLabelText("Expectation name"); await user.clear(name);
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  expect(name).toHaveFocus(); expect(name).toHaveAccessibleDescription("Enter a name for this expectation.");
  expect(api.bodies).toHaveLength(0);
  await user.type(name, "Invoice 30 — agreed in 2024");
  expect(name).not.toHaveAttribute("aria-invalid");
  await user.type(screen.getByLabelText("why this change (required)"), "Clarify the display name");
  await user.type(screen.getByLabelText("who owns it (required)"), "Name owner");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("version 8"));
  const next = (api.bodies[0]?.norm as Document).constraints.find(c => c.id === "c_save")!;
  expect(next.description).toBe("Invoice 30 — agreed in 2024"); expect(next).not.toHaveProperty("plain_name"); expect(next.params.delta).toBe(30);
  expect(api.bodies[0]?.calibration).toBeUndefined();
  expect(api.bodies[0]?.norm.metadata).toEqual({ calibration_pending: ["c_save"] });
  expect((original.norm as Document).constraints[0]?.description).toBe("Invoice timing");
});

it("an empty new expectation name is highlighted on submit and clears as the name is corrected", async () => {
  persistenceApi(); const user = userEvent.setup(); renderApp(PATH);
  await user.click(await screen.findByRole("button", { name: "Add your own expectation" }));
  await user.click(screen.getByRole("button", { name: "Add it" }));
  const name = screen.getByLabelText("what it is called");
  expect(name).toHaveFocus(); expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription("Enter a name for the new expectation.");
  await user.type(name, "New expectation"); expect(name).not.toHaveAttribute("aria-invalid");
  await user.click(screen.getByRole("button", { name: "Add it" }));
  expect(await screen.findByLabelText("Expectation name")).toHaveValue("New expectation");
});

it("previews only the selected norm and table, resets lens values between versions and shows no old-data fallback on refusal", async () => {
  const api = persistenceApi(); const table = db.caseTables[0]!;
  const version = db.norms.find(n => n.id === "nv_7")!;
  const next = structuredClone(version); next.id = "nv_preview"; next.version = 8;
  (next.norm as Document).constraints[0]!.params.delta = 12;
  (next.norm as Document).constraints[0]!.params.width = 20;
  const refused = { ...next, id: "nv_refused", version: 9 };
  db.norms.push(next, refused);
  let oldRequests = 0;
  server.use(
    http.get("*/projects/p2p2018/runs/:runId/signals/:id", () => { oldRequests++; return HttpResponse.json({ ...buildDistribution("c_save"), threshold: 999 }); }),
    http.get("*/projects/p2p2018/norms/nv_refused/signals/:id", () => HttpResponse.json({ status: 422, title: "Cannot evaluate this norm" }, { status: 422 })),
  );
  const history = createMemoryHistory({ initialEntries: [`${PATH}&caseTable=${table.id}`] });
  render(<App queryClient={makeTestQueryClient()} history={history} />);
  expect(await screen.findByLabelText(/ϑ threshold/)).toHaveValue(30);
  expect(api.signals[0]).toEqual({ version: "nv_7", caseTable: table.id, constraint: "c_save" });
  await act(async () => { history.push(`/p/p2p2018/norms/nv_preview?caseTable=${table.id}&constraint=c_save`); });
  await waitFor(() => expect(screen.getByLabelText(/ϑ threshold/)).toHaveValue(12));
  expect(screen.getByLabelText(/W width/)).toHaveValue(20);
  expect(screen.getByTestId("norm-builder")).toHaveTextContent("Preview of norm version 8 on the selected data");
  expect(screen.getByTestId("norm-sentence")).toHaveTextContent("with 20 days of tolerance");
  await act(async () => { history.push(`/p/p2p2018/norms/nv_refused?caseTable=${table.id}&constraint=c_save`); });
  const builder = await screen.findByTestId("norm-builder", {}, LOAD); await within(builder).findByRole("alert");
  expect(within(builder).queryByLabelText(/ϑ threshold/)).not.toBeInTheDocument(); expect(oldRequests).toBe(0);
});


it("waits for a held norm response before editing, then saves and rereads the decision with an empty query cache", async () => {
  const api = persistenceApi();
  let release!: () => void;
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  server.use(http.get("*/projects/p2p2018/norms/nv_7", async () => {
    requested = true;
    await responseGate;
    return HttpResponse.json(db.norms.find(n => n.id === "nv_7")!);
  }));
  // Observe rejection immediately too: restoring the old helper must fail this test,
  // not produce an unhandled promise while the response is deliberately withheld.
  const opening = openRule().then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  try {
    await waitFor(() => expect(requested).toBe(true), LOAD);
    expect(screen.queryByTestId("norm-builder")).not.toBeInTheDocument();
    expect(screen.getAllByRole("status").some(el => el.getAttribute("aria-busy") === "true")).toBe(true);
    // Negative control: the old one-second DOM deadline expires while a real GET
    // remains pending. The scoped lifecycle wait must still allow its eventual result.
    await expect(screen.findByTestId("norm-builder")).rejects.toThrow(/Unable to find/);
    expect(api.bodies).toHaveLength(0);
  } finally {
    release();
  }
  const outcome = await opening;
  if (outcome.error) throw outcome.error;
  const { user, app } = outcome.value!;
  expect(screen.getByLabelText("within")).toHaveValue(42);
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  expect(await screen.findByTestId("saved-calibration")).toHaveTextContent("The agreed service target");
  expect(api.bodies[0]?.calibration).toEqual({ c_save: { rationale: "The agreed service target", owner: "Calibration owner" } });
  app.unmount();
  const fresh = renderApp("/p/p2p2018/norms/nv_saved_1?tab=constraints&constraint=c_save");
  expect(fresh.queryClient).not.toBe(app.queryClient);
  const decision = await screen.findByTestId("saved-calibration", {}, LOAD);
  expect(decision).toHaveTextContent("Calibration owner");
  expect(decision.querySelector("time")).toHaveAttribute("datetime", DATE);
});
