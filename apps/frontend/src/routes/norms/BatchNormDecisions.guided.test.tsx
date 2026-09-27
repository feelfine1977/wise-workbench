import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import type { NormVersionCreate } from "@wise/api-schema";
import { makeTestQueryClient } from "@/test/utils";
import { server } from "@/mocks/node";
import { BatchNormDecisions, thresholdDraftRequest } from "./BatchNormDecisions";
import { NormAuthoringSettings } from "./NormAuthoringSettings";
import { batchNumericRule, type BatchPreviewRow } from "./normBatchPolicy";
import type { NormDocument } from "./normAuthoring";

const document: NormDocument = {
  name: "Draft targets", layers: [{ id: "time", name: "Timing" }], views: [{ name: "Overview", layer_weights: { time: 1 } }],
  constraints: [10, 20].map((delta, index) => ({ id: `c${index}`, description: `Target ${index}`, type: "lag", layer: "time", params: { a: ["Receive"], b: ["Pay"], delta, width: 2, unit: "D" } })),
  metadata: { calibration_pending: ["c0", "c1"], keep: "unchanged" },
};
function row(index = 0): BatchPreviewRow {
  const c = document.constraints![index]!;
  const rule = batchNumericRule(c)!;
  return { id: c.id, name: c.description!, rationale: "", owner: "", rule, before: { target: rule.target, width: rule.width }, after: { target: 15, width: 3 }, evidence: { loadedAt: "2026-09-01", data: { normVersionId: "v1", caseTableId: "ct", constraintId: c.id, type: c.type, unit: rule.unit, direction: rule.direction, threshold: rule.target, width: rule.width, stats: { n: 7, nCases: 10 }, casesInScope: 10, bins: [], ecdf: [] } } };
}
function setup(fail = false) {
  const bodies: NormVersionCreate[] = []; const onSaved = vi.fn();
  server.use(
    http.get("*/projects/guided-batch/norms/:id/calibration", ({ params }) => HttpResponse.json({ normVersionId: params.id, status: "draft", missingRationale: ["c0", "c1"], canLeaveDraft: false, thresholds: [] })),
    http.get("*/projects/guided-batch/norms/v1/signals/:id", ({ params }) => HttpResponse.json(row(params.id === "c0" ? 0 : 1).evidence!.data)),
    http.post("*/projects/guided-batch/norms", async ({ request }) => {
      const body = await request.json() as NormVersionCreate; bodies.push(body);
      if (fail) { fail = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
      return HttpResponse.json({ id: "v2", parentId: "v1", norm: body.norm, status: "draft" }, { status: 201 });
    }),
  );
  const ui = render(<QueryClientProvider client={makeTestQueryClient()}><NormAuthoringSettings /><BatchNormDecisions document={document} projectId="guided-batch" versionId="v1" caseTableId="ct" onSaved={onSaved} onConstraint={() => {}} /></QueryClientProvider>);
  return { bodies, onSaved, ui };
}
async function previewThreshold(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText(/2 pending decisions/);
  await user.click(screen.getByRole("button", { name: "Batch threshold settings" }));
  await user.selectOptions(screen.getByLabelText("Compatible threshold group"), screen.getByRole("option", { name: /lag · D/ }));
  await user.click(screen.getByRole("checkbox", { name: /^Target 0/ }));
  await user.click(screen.getByRole("button", { name: "Load selected evidence" }));
  await screen.findByText(/7 measured \/ 10 in scope/);
  await waitFor(() => expect(screen.getByLabelText("New target")).toBeEnabled());
  await user.type(screen.getByLabelText("New target"), "15");
  await user.type(screen.getByLabelText("New tolerance width"), "3");
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
}

it("previews and retries only chosen threshold changes with no calibration decision, preserving pending metadata", async () => {
  const before = structuredClone(document); const api = setup(true); const user = userEvent.setup();
  await previewThreshold(user);
  const preview = screen.getByRole("region", { name: "Batch change preview" });
  expect(preview).toHaveTextContent("Reason: Not recorded"); expect(preview).toHaveTextContent("Owner: Not recorded");
  expect(within(preview).getByRole("checkbox", { name: "Apply Target 0" })).not.toBeChecked();
  expect(api.bodies).toEqual([]);
  await user.click(within(preview).getByRole("checkbox", { name: "Apply Target 0" }));
  const save = screen.getByRole("button", { name: "Save 1 selected threshold changes as new draft" });
  await user.click(save);
  expect(await screen.findByRole("alert")).toHaveTextContent("Your selections and entries are kept");
  expect(screen.getByLabelText("New target")).toHaveValue(15);
  expect(within(preview).getByRole("checkbox", { name: "Apply Target 0" })).toBeChecked();
  await user.click(save);
  await waitFor(() => expect(api.onSaved).toHaveBeenCalledWith("v2"));
  expect(api.bodies[1]).toEqual(api.bodies[0]);
  const body = api.bodies[0]!;
  expect(body).not.toHaveProperty("calibration"); expect(body).not.toHaveProperty("author"); expect(body).not.toHaveProperty("status");
  expect((body.norm as NormDocument).constraints![0]!.params.delta).toBe(15);
  expect((body.norm as NormDocument).constraints![1]).toEqual(document.constraints![1]);
  expect(body.norm.metadata).toEqual(document.metadata); expect(body.norm.views).toEqual(document.views);
  expect(body.parentId).toBe("v1"); expect(document).toEqual(before);
});

it("keeps confirmation-only decisions gated by explicit reason and owner even when skip is enabled", async () => {
  const api = setup(); const user = userEvent.setup(); await screen.findByText(/2 pending decisions/);
  await user.click(screen.getByRole("button", { name: "Select visible pending" }));
  await user.click(screen.getByRole("button", { name: "Preview selected decisions" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter the shared reason and owner");
  expect(screen.queryByRole("region", { name: "Batch change preview" })).not.toBeInTheDocument();
  expect(api.bodies).toEqual([]);
});

it("invalidates a threshold preview when Settings changes the decision policy, retaining the entered target", async () => {
  const api = setup(); const user = userEvent.setup(); await previewThreshold(user);
  await user.click(screen.getByRole("checkbox", { name: "Apply Target 0" }));
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.selectOptions(screen.getByLabelText("Authoring mode"), "expert");
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("region", { name: "Batch change preview" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("New target")).toHaveValue(15);
  await user.click(screen.getByRole("button", { name: "Preview selected threshold settings" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter the shared reason and owner");
  expect(api.bodies).toEqual([]);
});

it("retains real optional notes without calibration and rejects stale, empty, incompatible or invalid threshold evidence", () => {
  const proposal = row();
  const body = thresholdDraftRequest(document, "v1", [{ ...proposal, rationale: "Explore this target", owner: "" }], "ct");
  expect(body.note).toContain("Explore this target"); expect(body.note).not.toContain("owner:"); expect(body).not.toHaveProperty("calibration");
  expect(() => thresholdDraftRequest(document, "v2", [proposal], "ct")).toThrow(/different version/);
  expect(() => thresholdDraftRequest(document, "v1", [proposal], "other")).toThrow(/different version/);
  expect(() => thresholdDraftRequest(document, "v1", [{ ...proposal, evidence: undefined }], "ct")).toThrow(/Load evidence/);
  expect(() => thresholdDraftRequest(document, "v1", [{ ...proposal, after: { target: NaN, width: 3 } }], "ct")).toThrow(/finite/);
  expect(() => thresholdDraftRequest(document, "v1", [{ ...proposal, evidence: { ...proposal.evidence!, data: { ...proposal.evidence!.data, stats: { n: 0, nCases: 10 } } } }], "ct")).toThrow(/No finite measurements/);
  expect(() => thresholdDraftRequest(document, "v1", [{ ...proposal, rule: { ...proposal.rule!, key: "other" } }], "ct")).toThrow(/no longer matches/);
});
