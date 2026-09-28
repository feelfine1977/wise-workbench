import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import type { NormVersion, NormVersionCreate, components } from "@wise/api-schema";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, makeTestQueryClient } from "@/test/utils";
import { SignVersion } from "./SignVersion";

type Calibration = components["schemas"]["NormCalibration"];
function setup(options: { count?: number; failRead?: boolean; failSave?: boolean; refuseSign?: boolean; longDescriptions?: boolean } = {}) {
  const constraints = Array.from({ length: options.count ?? 13 }, (_, i) => ({ id: `c_${i}`, description: `Payment target ${i + 1}${options.longDescriptions ? ". " + "This synthetic description explains payment timing and its applicable business scope. ".repeat(15) : ""}`, layer: "time", type: "lag", params: { a: ["Receive"], b: ["Pay"], delta: 30, width: 60 } }));
  const version: NormVersion = { id: "nv_preflight", name: "Payments", normId: "n", version: 1, status: "draft", fingerprint: "test", createdAt: "2026-09-01T00:00:00Z", note: "Agreed targets", norm: { name: "Payments", layers: [{ id: "time", name: "Timing" }], views: [{ name: "Finance", layer_weights: { time: 1 } }], constraints, metadata: { preserve: "original", calibration_pending: constraints.map(c => c.id) } } };
  const source = structuredClone(version);
  const versions = new Map([[version.id, version]]);
  const bodies: NormVersionCreate[] = [];
  const signatures: unknown[] = [];
  let failRead = options.failRead;
  let failSave = options.failSave;
  let refused = false;
  const cal = new Map<string, Calibration>([[version.id, { normVersionId: version.id, status: "draft", thresholds: constraints.map((c, i) => ({ constraint_id: c.id, rationale: i === 1 ? "Already agreed reason" : null, owner: i === 0 ? "Treasury" : null })), missingRationale: options.refuseSign ? [] : constraints.map(c => c.id), canLeaveDraft: !!options.refuseSign }]]);
  server.use(
    http.get("*/projects/p/norms/:id/calibration", ({ params }) => { if (failRead) { failRead = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); } return HttpResponse.json(cal.get(String(params.id))); }),
    http.get("*/projects/p/norms/:id", ({ params }) => HttpResponse.json(versions.get(String(params.id)))),
    http.post("*/projects/p/norms", async ({ request }) => {
      const body = await request.json() as NormVersionCreate; bodies.push(body);
      if (failSave) { failSave = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
      const previous = versions.get(body.parentId!)!;
      const saved = { ...previous, id: `nv_decisions_${bodies.length}`, version: previous.version + 1, norm: structuredClone(body.norm), parentId: body.parentId, note: body.note };
      versions.set(saved.id, saved);
      const parentCal = cal.get(previous.id)!;
      const remaining = parentCal.missingRationale!.filter(id => !body.calibration?.[id]);
      cal.set(saved.id, { ...parentCal, normVersionId: saved.id, missingRationale: remaining, canLeaveDraft: !remaining.length, thresholds: parentCal.thresholds!.map(row => ({ ...row, ...body.calibration?.[row.constraint_id!] })) });
      return HttpResponse.json(saved, { status: 201 });
    }),
    http.patch("*/projects/p/norms/:id", async ({ request, params }) => {
      const body = await request.json() as { status: string; author: string }; signatures.push({ id: params.id, body });
      if (options.refuseSign && !refused) { refused = true; cal.set(version.id, { ...cal.get(version.id)!, missingRationale: ["c_0"], canLeaveDraft: false }); return HttpResponse.json({ code: "norm.rationale_required", errors: [{ field: "c_0", message: "Required" }] }, { status: 422 }); }
      return HttpResponse.json({ ...versions.get(String(params.id)), ...body });
    }),
  );
  const done = vi.fn();
  render(<QueryClientProvider client={makeTestQueryClient()}><SignVersion projectId="p" version={version} onDone={done} /></QueryClientProvider>);
  return { bodies, signatures, done, version, source };
}

it("preflights all 13 constraints, focuses the exact missing field, and stages only explicit decisions", async () => {
  const api = setup(); const user = userEvent.setup();
  const list = await screen.findByRole("list", { name: "Required decisions" });
  expect(within(list).getAllByRole("button")).toHaveLength(13);
  expect(screen.queryByLabelText("Who signs it")).not.toBeInTheDocument();
  expect(api.signatures).toHaveLength(0);
  await user.click(within(list).getByRole("button", { name: "Payment target 2 Needs owner" }));
  await waitFor(() => expect(screen.getByLabelText("Constraint owner (required)")).toHaveFocus());
  expect(screen.getByLabelText("Reason for this constraint (required)")).toHaveValue("Already agreed reason");
  await user.click(screen.getByRole("button", { name: "Record decision" }));
  expect(screen.getByLabelText("Constraint owner (required)")).toHaveAttribute("aria-invalid", "true");
  await user.type(screen.getByLabelText("Constraint owner (required)"), "  AP owner  ");
  await user.click(screen.getByRole("button", { name: "Record decision" }));
  await user.click(screen.getByRole("button", { name: "Save 1 decision as new draft" }));
  expect(await screen.findByText("12 constraints need a decision · 0 ready to save")).toBeVisible();
  expect(api.bodies[0]).toMatchObject({ parentId: "nv_preflight", norm: api.source.norm, calibration: { c_1: { rationale: "Already agreed reason", owner: "AP owner" } } });
  expect(Object.keys(api.bodies[0]!.calibration!)).toEqual(["c_1"]);
  expect(api.bodies[0]!.author).toBeUndefined();
  expect(api.signatures).toHaveLength(0);
  expect(api.version).toEqual(api.source);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.done).toHaveBeenCalledWith("nv_decisions_1");
});

it("preserves decisions on save failure and signs only the newly saved draft after preflight", async () => {
  const api = setup({ count: 1, failSave: true }); const user = userEvent.setup();
  await screen.findByRole("list", { name: "Required decisions" });
  await user.type(screen.getByLabelText("Reason for this constraint (required)"), "Agreed payment service target");
  await user.click(screen.getByRole("button", { name: "Record decision" }));
  await user.click(screen.getByRole("button", { name: "Save 1 decision as new draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your entries are kept");
  expect(screen.getByLabelText("Reason for this constraint (required)")).toHaveValue("Agreed payment service target");
  await user.click(screen.getByRole("button", { name: "Save 1 decision as new draft" }));
  const signer = await screen.findByLabelText("Who signs it");
  expect(api.bodies[1]).toEqual(api.bodies[0]);
  expect(api.signatures).toHaveLength(0);
  await user.type(signer, "  Reviewer  ");
  await user.click(screen.getByRole("button", { name: "Mark reviewed" }));
  await waitFor(() => expect(api.done).toHaveBeenCalledWith("nv_decisions_2"));
  expect(api.signatures).toEqual([{ id: "nv_decisions_2", body: { status: "reviewed", author: "Reviewer" } }]);
});

it("blocks signing when preflight cannot load and recovers with Retry", async () => {
  const api = setup({ failRead: true }); const user = userEvent.setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be checked");
  expect(screen.getByRole("button", { name: "Mark reviewed" })).toBeDisabled();
  expect(screen.queryByLabelText("Who signs it")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry preflight" }));
  await screen.findByRole("list", { name: "Required decisions" });
  expect(api.signatures).toHaveLength(0);
});

it("turns a late server refusal into actionable preflight without a list of errors", async () => {
  const api = setup({ count: 1, refuseSign: true }); const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Who signs it"), "Reviewer");
  await user.click(screen.getByRole("button", { name: "Mark reviewed" }));
  const list = await screen.findByRole("list", { name: "Required decisions" });
  expect(within(list).getByRole("button", { name: "Payment target 1 Needs reason" })).toBeVisible();
  expect(screen.getByTestId("sign-error")).toHaveTextContent("Complete the listed decisions");
  expect(api.signatures).toHaveLength(1);
  await expectNoSeriousA11yViolations(screen.getByRole("dialog"));
});


it("keeps full long descriptions available without obscuring the selected decision fields", async () => {
  const api = setup({ count: 7, longDescriptions: true }); const user = userEvent.setup();
  const list = await screen.findByRole("list", { name: "Required decisions" });
  const buttons = within(list).getAllByRole("button");
  const constraints = api.version.norm.constraints as { description: string }[];
  expect(buttons).toHaveLength(7);
  for (const [index, button] of buttons.entries()) expect(button).toHaveAttribute("title", constraints[index]!.description);
  expect(screen.getByLabelText("Reason for this constraint (required)")).toBeVisible();
  expect(screen.getByLabelText("Constraint owner (required)")).toBeVisible();
  expect(screen.getByTestId("review-meaning")).not.toBeVisible();
  await user.click(screen.getByText("Full constraint meaning and rule"));
  expect(screen.getByTestId("review-meaning")).toHaveTextContent(constraints[0]!.description);
  expect(screen.getByTestId("review-meaning")).toHaveTextContent("Pay follows Receive within 30 days");
  await user.type(screen.getByLabelText("Reason for this constraint (required)"), "An explicit reason kept while navigating");
  await user.click(buttons[1]!);
  await waitFor(() => expect(screen.getByLabelText("Constraint owner (required)")).toHaveFocus());
  expect(screen.getByTestId("review-meaning")).not.toBeVisible();
  await user.click(screen.getByText("Full constraint meaning and rule"));
  expect(screen.getByTestId("review-meaning")).toHaveTextContent(constraints[1]!.description);
  await user.click(buttons[0]!);
  expect(screen.getByLabelText("Reason for this constraint (required)")).toHaveValue("An explicit reason kept while navigating");
  expect(api.bodies).toHaveLength(0);
  expect(api.signatures).toHaveLength(0);
});
