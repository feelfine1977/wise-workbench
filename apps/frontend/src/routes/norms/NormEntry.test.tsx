import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { makeTestQueryClient } from "@/test/utils";
import { validateNormSearch } from "@/app/search";
import { StartNormDialog } from "./StartNormDialog";
import { normChanges } from "./NormVersionComparison";
import type { NormDocument } from "./normAuthoring";

const normSearch = (input: Record<string, unknown>) => validateNormSearch(input as Parameters<typeof validateNormSearch>[0]);

it("opens guidance by default while preserving constraint deep links and map URLs", () => {
  expect(normSearch({}).tab).toBe("guide");
  expect(normSearch({ constraint: "c" }).tab).toBe("constraints");
  expect(normSearch({ tab: "constraints", constraint: "c" }).tab).toBe("constraints");
  expect(normSearch({ tab: "map", caseTable: "ct" })).toMatchObject({ tab: "map", caseTable: "ct" });
});

it("starts a small explicit norm from the selected preparation and preserves fields on failure", async () => {
  const bodies: Record<string, unknown>[] = []; const created = vi.fn(); let fail = true;
  server.use(
    http.get("*/projects/p/norms/inventory", ({ request }) => { expect(new URL(request.url).searchParams.get("caseTableId")).toBe("ct"); return HttpResponse.json({ cases: 40, events: 90, caseTableId: "ct", activities: [{ label: "Ship", events: 30, cases: 30 }], attributes: [] }); }),
    http.post("*/projects/p/norms", async ({ request }) => { const body = await request.json() as Record<string, unknown>; bodies.push(body); if (fail) { fail = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); } return HttpResponse.json({ id: "nv_small", status: "draft", norm: body.norm }, { status: 201 }); }),
  );
  const user = userEvent.setup();
  render(<QueryClientProvider client={makeTestQueryClient()}><StartNormDialog projectId="p" caseTableId="ct" datasetName="Orders.csv" onCreated={created} /></QueryClientProvider>);
  expect(bodies).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Start a small norm" }));
  await screen.findByRole("option", { name: "Ship" });
  expect(screen.getByLabelText("Which activity should be recorded?")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Create starting draft" }));
  expect(screen.getByLabelText("Norm name")).toHaveFocus(); expect(bodies).toHaveLength(0);
  await user.type(screen.getByLabelText("Norm name"), "Shipping expectations");
  await user.type(screen.getByLabelText("What do you want to understand?"), "Do orders reach dispatch?");
  await user.selectOptions(screen.getByLabelText("Which activity should be recorded?"), "Ship");
  await user.type(screen.getByLabelText("Who owns this starting expectation?"), "Process owner");
  await user.click(screen.getByRole("button", { name: "Create starting draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your entries are kept");
  expect(screen.getByLabelText("Norm name")).toHaveValue("Shipping expectations");
  await user.click(screen.getByRole("button", { name: "Create starting draft" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith("nv_small"));
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({ author: "Process owner", norm: { name: "Shipping expectations", constraints: [{ id: "expected_activity", type: "presence", params: { activity: ["Ship"], m: 1 } }], metadata: { authoring: { goal: "Do orders reach dispatch?", caseTableId: "ct" } } } });
  expect(bodies[0]).not.toHaveProperty("status"); expect(bodies[0]).not.toHaveProperty("calibration");
});

it("explains the preparation prerequisite instead of offering invented activities", async () => {
  render(<QueryClientProvider client={makeTestQueryClient()}><StartNormDialog projectId="p" onCreated={vi.fn()} /></QueryClientProvider>);
  await userEvent.click(screen.getByRole("button", { name: "Start a small norm" }));
  expect(within(screen.getByRole("dialog")).getByText(/Prepare the project dataset/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Create starting draft" })).not.toBeInTheDocument();
});

it("distinguishes reassessment definitions from weights, including removed expectations", () => {
  const before: NormDocument = { layers: [{ id: "L", name: "Delivery" }], views: [{ name: "Finance", layer_weights: { L: 1 } }], constraints: [{ id: "c", layer: "L", type: "lag", params: { delta: 2, width: 3 }, description: "Dispatch" }, { id: "r", layer: "L", type: "presence", params: {} }], metadata: { keep: true } };
  const after: NormDocument = { ...before, constraints: [{ ...before.constraints![0]!, params: { width: 3, delta: 2 }, weight: 2 }], views: [{ name: "Finance", layer_weights: { L: 4 } }], metadata: { keep: true, authoring: { goal: "Study delivery" } } };
  const delta = normChanges(before, after);
  expect(delta.rows).toEqual([{ id: "c", name: "Dispatch", kinds: ["Grouping or weight changed"], removed: false }, { id: "r", name: "r", kinds: ["Removed from active norm"], removed: true }]);
  expect(delta).toMatchObject({ structure: true, brief: true, derivation: false });
  expect(before.constraints).toHaveLength(2);
});

// These existing decision/signature regressions use the explicit Expert requirements.
beforeEach(() => localStorage.setItem("wise-norm-authoring-preferences", JSON.stringify({ mode: "expert", skipReasonOwner: true })));

it("starts a Guided draft without an owner or calibration approval fields", async () => {
  localStorage.setItem("wise-norm-authoring-preferences", JSON.stringify({ mode: "guided", skipReasonOwner: true }));
  const bodies: Record<string, unknown>[] = []; const created = vi.fn();
  server.use(
    http.get("*/projects/p/norms/inventory", () => HttpResponse.json({ cases: 40, events: 90, caseTableId: "ct", activities: [{ label: "Ship", events: 30, cases: 30 }], attributes: [] })),
    http.post("*/projects/p/norms", async ({ request }) => { const body = await request.json() as Record<string, unknown>; bodies.push(body); return HttpResponse.json({ id: "nv_small", status: "draft", norm: body.norm }, { status: 201 }); }),
  );
  const user = userEvent.setup();
  render(<QueryClientProvider client={makeTestQueryClient()}><StartNormDialog projectId="p" caseTableId="ct" onCreated={created} /></QueryClientProvider>);
  await user.click(screen.getByRole("button", { name: "Start a small norm" }));
  await screen.findByRole("option", { name: "Ship" });
  await user.type(screen.getByLabelText("Norm name"), "Shipping expectations");
  await user.type(screen.getByLabelText("What do you want to understand?"), "Do orders reach dispatch?");
  await user.selectOptions(screen.getByLabelText("Which activity should be recorded?"), "Ship");
  expect(screen.getByLabelText("Who owns this starting expectation? (optional)")).not.toBeVisible();
  await user.click(screen.getByRole("button", { name: "Create starting draft" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith("nv_small"));
  expect(bodies[0]).not.toHaveProperty("author"); expect(bodies[0]).not.toHaveProperty("calibration"); expect(bodies[0]).not.toHaveProperty("status");
  expect((bodies[0]!.norm as NormDocument).metadata?.authoring).not.toHaveProperty("owner");
  expect(bodies[0]!.note).not.toContain("owner:");
});
