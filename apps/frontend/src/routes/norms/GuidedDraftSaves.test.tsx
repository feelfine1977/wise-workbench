import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, it } from "vitest";
import type { NormVersionCreate } from "@wise/api-schema";
import { db } from "@/mocks/db";
import { server } from "@/mocks/node";
import { buildDistribution } from "@/mocks/fixtures/distribution";
import { createMemoryHistory } from "@tanstack/react-router";
import { App } from "@/app/providers";
import { makeTestQueryClient, renderApp } from "@/test/utils";
import type { NormDocument } from "./normAuthoring";

const PATH = "/p/p2p2018/norms/nv_7?caseTable=ct_1&tab=constraints&constraint=c_draft";
const LOAD = { timeout: 8000 };
function setup(fail = false) {
  const source = db.norms.find(v => v.id === "nv_7")!;
  source.status = "draft";
  source.norm = { ...source.norm, constraints: [
    { id: "c_draft", layer: "L3", type: "lag", params: { a: ["Record Goods Receipt"], b: ["Clear Invoice"], delta: 30, width: 60, unit: "D" }, description: "Draft invoice target" },
    { id: "c_keep", layer: "L3", type: "presence", params: { activity: ["Record Goods Receipt"], m: 1 }, description: "Keep goods receipt" },
  ], metadata: { calibration_pending: ["c_draft"], untouched: "retained" } };
  const original = structuredClone(source);
  const writes: NormVersionCreate[] = []; const signatures: unknown[] = [];
  server.use(
    http.get("*/projects/p2p2018/norms/:id/calibration", ({ params }) => HttpResponse.json({ normVersionId: params.id, status: "draft", thresholds: [{ constraint_id: "c_draft" }], missingRationale: ["c_draft"], canLeaveDraft: false })),
    http.get("*/projects/p2p2018/norms/:id/signals/:constraint", ({ params }) => HttpResponse.json({ ...buildDistribution("c_l3_invoice_to_clear_days"), normVersionId: params.id, caseTableId: "ct_1", constraintId: params.constraint, threshold: 30, width: 60 })),
    http.post("*/projects/p2p2018/norms", async ({ request }) => {
      const body = await request.json() as NormVersionCreate; writes.push(body);
      if (fail) { fail = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
      const saved = { ...source, id: `nv_draft_${writes.length}`, version: 8, parentId: body.parentId, norm: body.norm, note: body.note, status: "draft" as const };
      db.norms.push(saved); return HttpResponse.json(saved, { status: 201 });
    }),
    http.patch("*/projects/p2p2018/norms/:id", async ({ request }) => { signatures.push(await request.json()); return HttpResponse.json({}, { status: 500 }); }),
  );
  return { source, original, writes, signatures };
}
async function openRule() {
  const user = userEvent.setup(); const app = renderApp(PATH);
  await screen.findByTestId("rule-editor", {}, LOAD);
  const target = screen.getByLabelText("within");
  await user.clear(target); await user.type(target, "42");
  return { user, app };
}

it("saves a threshold-only Guided draft, keeps pending decisions, and preserves failed edits and the source version", async () => {
  const api = setup(true); const { user, app } = await openRule();
  expect(screen.getByLabelText("why this change (optional)")).not.toBeVisible();
  expect(screen.getByLabelText("Current norm settings")).toHaveTextContent("optional");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  expect(await screen.findByTestId("norm-save-error")).toHaveTextContent("Your changes are still here");
  expect(screen.getByLabelText("within")).toHaveValue(42);
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.writes).toHaveLength(2));
  await waitFor(() => expect(screen.queryByTestId("norm-save-error")).not.toBeInTheDocument());
  expect(api.writes[1]).toEqual(api.writes[0]);
  expect(api.writes[0]).not.toHaveProperty("calibration"); expect(api.writes[0]).not.toHaveProperty("author"); expect(api.writes[0]).not.toHaveProperty("status");
  const saved = api.writes[0]!.norm as NormDocument;
  expect(saved.constraints![0]!.params.delta).toBe(42);
  expect(saved.constraints![1]).toEqual((api.original.norm as NormDocument).constraints![1]);
  expect(saved.metadata).toEqual(api.original.norm.metadata);
  expect(api.writes[0]!.note).not.toContain("owner:");
  expect(api.source).toEqual(api.original);
  app.unmount(); renderApp(PATH.replace("nv_7", "nv_draft_2"));
  await user.click(await screen.findByRole("button", { name: "Mark reviewed" }, LOAD));
  expect(await screen.findByRole("list", { name: "Required decisions" }, LOAD)).toHaveTextContent("Draft invoice target");
  expect(screen.queryByLabelText("Who signs it")).not.toBeInTheDocument();
  expect(api.signatures).toEqual([]);
});

it.each(["reason", "owner", "both"])("records optional %s in the draft note without confirming a threshold decision", async fields => {
  const api = setup(); const { user } = await openRule();
  await user.click(screen.getByText("Add reason or owner (optional)"));
  if (fields !== "owner") await user.type(screen.getByLabelText("why this change (optional)"), "Exploring a target");
  if (fields !== "reason") await user.type(screen.getByLabelText("who owns it (optional)"), "Business analyst");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0]).not.toHaveProperty("calibration");
  if (fields !== "owner") expect(api.writes[0]!.note).toContain("Exploring a target");
  if (fields !== "reason") expect(api.writes[0]!.note).toContain("Business analyst");
  expect(api.signatures).toEqual([]);
});

it("keeps lens target/width after a failure and retries without rationale or owner", async () => {
  const api = setup(true); const user = userEvent.setup(); renderApp(PATH);
  await user.click(await screen.findByRole("button", { name: "the numbers" }, LOAD));
  const target = await screen.findByLabelText("Target (days)", {}, LOAD);
  await user.clear(target); await user.type(target, "42");
  await user.click(screen.getByRole("button", { name: "Commit as version…" }));
  const dialog = screen.getByRole("dialog", { name: "Set this threshold" });
  expect(dialog).toHaveTextContent("threshold decision remains pending");
  await user.click(within(dialog).getByRole("button", { name: "Save as the next version" }));
  expect(await within(dialog).findByTestId("norm-save-error")).toBeVisible();
  expect(dialog).toHaveTextContent("42");
  await user.click(within(dialog).getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.writes).toHaveLength(2));
  expect(api.writes[1]).toEqual(api.writes[0]);
  expect(api.writes[0]).not.toHaveProperty("calibration");
  expect((api.writes[0]!.norm as NormDocument).constraints![0]!.params).toMatchObject({ delta: 42, width: 60 });
});

it("requires a business note to exclude a rule, but no invented author or extra rationale", async () => {
  const api = setup(); const user = userEvent.setup(); renderApp(PATH);
  await user.click(await screen.findByRole("button", { name: "who it applies to" }, LOAD));
  await user.click(screen.getByLabelText(/Not applicable to this log/));
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(screen.getByLabelText("why (required)")).toHaveFocus());
  expect(api.writes).toEqual([]);
  await user.type(screen.getByLabelText("why (required)"), "This preparation contains no invoice events");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0]!.notApplicable).toEqual({ c_draft: { note: "This preparation contains no invoice events" } });
  expect(api.writes[0]).not.toHaveProperty("calibration"); expect(api.signatures).toEqual([]);
});

it("switches Expert requirements on through Settings without losing the target", async () => {
  const api = setup(); const { user } = await openRule();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.selectOptions(screen.getByLabelText("Authoring mode"), "expert");
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByLabelText("within")).toHaveValue(42);
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(screen.getByLabelText("why this change (required)")).toHaveFocus());
  expect(api.writes).toEqual([]);
  await user.type(screen.getByLabelText("why this change (required)"), "An agreed business target");
  await user.type(screen.getByLabelText("who owns it (required)"), "Process owner");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.writes).toHaveLength(1));
  expect(api.writes[0]!.calibration).toEqual({ c_draft: { rationale: "An agreed business target", owner: "Process owner" } });
});

it("does not carry failed edits, optional notes, or save errors into a different immutable version", async () => {
  const api = setup(true); const user = userEvent.setup();
  const next = structuredClone(api.source); next.id = "nv_other"; next.version = 8;
  (next.norm as NormDocument).constraints![0]!.params.delta = 12;
  db.norms.push(next);
  const history = createMemoryHistory({ initialEntries: [PATH] });
  render(<App queryClient={makeTestQueryClient()} history={history} />);
  await screen.findByTestId("rule-editor", {}, LOAD);
  await user.clear(screen.getByLabelText("within")); await user.type(screen.getByLabelText("within"), "42");
  await user.click(screen.getByText("Add reason or owner (optional)"));
  await user.type(screen.getByLabelText("why this change (optional)"), "Unsaved business note");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  expect(await screen.findByTestId("norm-save-error")).toBeVisible();
  await act(async () => { history.push(PATH.replace("nv_7", "nv_other")); });
  await waitFor(() => expect(screen.getByLabelText("within")).toHaveValue(12));
  expect(screen.getByLabelText("why this change (optional)")).toHaveValue("");
  expect(screen.queryByTestId("norm-save-error")).not.toBeInTheDocument();
  expect(api.writes).toHaveLength(1); expect(api.writes[0]!.parentId).toBe("nv_7");
  expect(api.source).toEqual(api.original);
});
