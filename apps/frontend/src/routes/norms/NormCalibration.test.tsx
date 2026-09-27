import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { beforeEach, expect, it } from "vitest";
import type { NormVersionCreate, components } from "@wise/api-schema";
import { db } from "@/mocks/db";
import { server } from "@/mocks/node";
import { renderApp } from "@/test/utils";
import { thresholdOf, type Constraint } from "./Builder";

// Exact constraint shape read from the reported norm; distribution values below are synthetic.
const release: Constraint = {
  id: "c_l2_df2_release_after_goods", layer: "L2_flow_discipline", type: "precedence",
  params: { a: ["Record Goods Receipt", "Record Service Entry Sheet"], b: ["Remove Payment Block"], k: 0, K: 1, missing_a: "skip", missing_b: "skip" },
  weight: 1.5, applicability: { flow_type: ["DF2"] },
  description: "In DF2, payment-block release should happen after the first goods/service event.",
};
const PATH = `/p/p2p2018/norms/nv_7?caseTable=ct_1&tab=constraints&constraint=${release.id}`;
const LOAD = { timeout: 8000 };
const numeric: Constraint = { id: "c_numeric", type: "lag", layer: release.layer, params: { a: ["Record Goods Receipt"], b: ["Clear Invoice"], delta: 0, width: 1, unit: "D" }, description: "Invoice timing" };
const NUMERIC_PATH = PATH.replace(release.id, numeric.id);
const coverageText = "Block released after the goods (invoice-first flow) is measured on 53,400 of the 221,010 purchase order items it applies to (24 %); on the rest it records whether the events are logged, not the value it names.";
const distribution: components["schemas"]["NormSignalDistribution"] = {
  normVersionId: "nv_7", caseTableId: "ct_1", constraintId: numeric.id,
  type: "lag", unit: "D", direction: "high", threshold: 0, width: 1, binary: true,
  bins: [{ x0: 0, x1: 0.5, n: 3 }, { x0: 0.5, x1: 1, n: 1 }],
  ecdf: [[0, 0.75], [1, 1]], stats: { n: 4, nCases: 4, shareBeyondThreshold: 0.25, shareBeyondSaturation: 0.25 },
};

function calibrationApi(binary = false) {
  const version = db.norms.find(n => n.id === "nv_7")!;
  version.norm = { ...version.norm, constraints: [structuredClone(release), structuredClone(numeric)] };
  const original = structuredClone(version.norm);
  const writes: NormVersionCreate[] = [];
  let signatures = 0;
  const signals: string[] = [];
  server.use(
    http.get("*/projects/p2p2018/runs/:id/manifest", ({ params }) => HttpResponse.json({ runId: params.id, uncalibrated: [{ id: release.id, reason: "partly_measured", measured: 53400, applies_to: 221010, text: coverageText }, { id: numeric.id, reason: "declared", text: "Invoice timing carries an uncalibrated threshold." }] })),
    http.get("*/projects/p2p2018/norms/:id/signals/:constraint", ({ params }) => { signals.push(String(params.constraint)); return HttpResponse.json({ ...distribution, binary, normVersionId: params.id, constraintId: params.constraint }); }),
    http.post("*/projects/p2p2018/norms", async ({ request }) => {
      const body = await request.json() as NormVersionCreate; writes.push(body);
      const created = { ...version, id: "nv_calibrated", version: version.version + 1, status: "draft" as const, parentId: version.id, norm: body.norm };
      db.norms.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch("*/projects/p2p2018/norms/:id", () => { signatures++; return HttpResponse.json({}, { status: 500 }); }),
  );
  return { original, writes, signals, get signatures() { return signatures; } };
}

it.each(["selected", "catalogue"])("opens the %s coverage badge with the exact warning and no invented numeric editor", async location => {
  const api = calibrationApi(); const user = userEvent.setup(); renderApp(location === "selected" ? PATH : NUMERIC_PATH);
  const builder = await screen.findByTestId("norm-builder", {}, LOAD);
  const scope = location === "selected" ? within(builder) : screen;
  await user.click(await scope.findByRole("button", { name: /Review measurement coverage/ }, LOAD));
  expect(within(builder).getByRole("heading", { name: "Measurement coverage" })).toBeVisible();
  expect(within(builder).getByTestId("calibration-notice")).toHaveTextContent(coverageText);
  expect(builder).toHaveTextContent("Changing a threshold does not supply missing events.");
  expect(builder).toHaveTextContent("no editable numeric threshold in this calibration view");
  expect(within(builder).queryByText("a threshold to calibrate")).not.toBeInTheDocument();
  expect(within(builder).queryByLabelText(/Target \(/)).not.toBeInTheDocument();
  expect(within(builder).queryByRole("button", { name: /Commit as version/ })).not.toBeInTheDocument();
  expect(thresholdOf(release)).toBeUndefined();
  expect(api.signals).not.toContain(release.id);
  await user.click(within(builder).getByRole("button", { name: "Review applicability" }));
  expect(await screen.findByTestId("applicability-editor", {}, LOAD)).toBeVisible();
  expect(api.writes).toHaveLength(0); expect(api.signatures).toBe(0);
  expect(db.norms.find(n => n.id === "nv_7")!.norm).toEqual(api.original);
});

it.each([false, true])("opens the selected badge (binary=%s) and requires a reason and owner before saving", async binary => {
  const api = calibrationApi(binary); const user = userEvent.setup(); renderApp(NUMERIC_PATH);
  const builder = await screen.findByTestId("norm-builder", {}, LOAD);
  await user.click(await within(builder).findByRole("button", { name: /Calibrate threshold/ }, LOAD));
  expect(screen.getByRole("button", { name: "the numbers" })).toHaveAttribute("aria-pressed", "true");
  const target = await within(builder).findByLabelText("Target (days)", {}, LOAD);
  expect(target).toHaveValue(0);
  expect(screen.getByLabelText("Tolerance width (days)")).toHaveValue(1);
  expect(api.writes).toHaveLength(0);
  await user.clear(target); await user.type(target, "1");
  const width = screen.getByLabelText("Tolerance width (days)"); await user.clear(width); await user.type(width, "2");
  await user.click(screen.getByRole("button", { name: "Commit as version…" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("tolerance width 2");
  await user.click(within(dialog).getByRole("button", { name: "Save as the next version" }));
  expect(api.writes).toHaveLength(0);
  expect(within(dialog).getByLabelText("why this threshold (required)")).toHaveAttribute("aria-invalid", "true");
  await user.type(within(dialog).getByLabelText("why this threshold (required)"), "Agreed release tolerance");
  await user.click(within(dialog).getByRole("button", { name: "Save as the next version" }));
  expect(api.writes).toHaveLength(0);
  await user.type(within(dialog).getByLabelText("who owns it (required)"), "Process owner");
  await user.click(within(dialog).getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.writes).toHaveLength(1), LOAD);
  const constraints = api.original.constraints as Constraint[];
  expect(api.writes[0]).toMatchObject({ parentId: "nv_7", calibration: { [numeric.id]: { rationale: "Agreed release tolerance", owner: "Process owner" } }, norm: { ...api.original, constraints: constraints.map(c => c.id === numeric.id ? { ...c, params: { ...c.params, delta: 1, width: 2 } } : c) } });
  expect(db.norms.find(n => n.id === "nv_7")!.norm).toEqual(api.original);
  expect(api.signatures).toBe(0);
});

it("opens a flagged catalogue badge on its own constraint and shows a retryable distribution failure", async () => {
  const api = calibrationApi(); const user = userEvent.setup();
  let unavailable = true;
  server.use(http.get("*/projects/p2p2018/norms/nv_7/signals/:id", () => unavailable
    ? HttpResponse.json({ status: 503, title: "Distribution unavailable" }, { status: 503 })
    : HttpResponse.json(distribution)));
  renderApp(PATH);
  await user.click(await screen.findByRole("button", { name: /Calibrate threshold/ }, LOAD));
  const builder = screen.getByTestId("norm-builder");
  expect(builder).toHaveTextContent(numeric.description!);
  await within(builder).findByRole("alert", {}, LOAD);
  expect(within(builder).queryByLabelText("Target (days)")).not.toBeInTheDocument();
  unavailable = false;
  await user.click(within(builder).getByRole("button", { name: /Try again/ }));
  expect(await within(builder).findByLabelText("Target (days)", {}, LOAD)).toHaveValue(0);
  expect(api.writes).toHaveLength(0);
});


it("shows that calibration is loading immediately after a keyboard activation", async () => {
  const api = calibrationApi(); const user = userEvent.setup();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  server.use(http.get("*/projects/p2p2018/norms/nv_7/signals/:id", async () => { await gate; return HttpResponse.json(distribution); }));
  renderApp(NUMERIC_PATH);
  try {
    const builder = await screen.findByTestId("norm-builder", {}, LOAD);
    const action = await within(builder).findByRole("button", { name: /Calibrate threshold/ }, LOAD);
    action.focus(); await user.keyboard("{Enter}");
    expect(within(builder).getByText("Loading calibration distribution…")).toBeVisible();
    expect(screen.getByRole("region", { name: "Calibration and measurement" })).toHaveFocus();
    expect(api.writes).toHaveLength(0);
  } finally { finish(); }
  expect(await screen.findByLabelText("Target (days)", {}, LOAD)).toHaveValue(0);
});

// These existing decision/signature regressions use the explicit Expert requirements.
beforeEach(() => localStorage.setItem("wise-norm-authoring-preferences", JSON.stringify({ mode: "expert", skipReasonOwner: true })));
