import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, it, vi } from "vitest";
import type { NormVersionCreate } from "@wise/api-schema";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, makeTestQueryClient } from "@/test/utils";
import { StructureEditor, type AuthoringStep } from "./StructureEditor";
import type { NormDocument } from "./normAuthoring";
import { structureIssues } from "./normAuthoring";
import { NORM_AUTHORING_PREFERENCES_KEY } from "./useNormAuthoringPreferences";
import { withGeneralBenchmark } from "./viewMembership";
import { viewColor } from "@/lib/viewColors";

const document: NormDocument = {
  name: "Payments", scoring_mode: "layer_balanced", metadata: { calibration_pending: ["timing"], untouched: "keep" },
  layers: [{ id: "time", name: "Timing", description: "Payment targets" }, { id: "quality", name: "Quality" }],
  constraints: [
    { id: "timing", layer: "time", type: "lag", description: "Pay on time", params: { delta: 30, width: 60 }, weight: 2 },
    { id: "receipt", layer: "quality", type: "presence", description: "Receipt recorded", params: { activity: ["Receive"] }, weight: 1 },
  ],
  views: [{ name: "Finance", layer_weights: { time: 2, quality: 1 } }, { name: "Automation", constraint_weights: { timing: 0, receipt: 3 } }],
};
function setup(options: { step?: AuthoringStep; failure?: boolean; selectedView?: string; guided?: boolean; document?: NormDocument } = {}) {
  localStorage.setItem(NORM_AUTHORING_PREFERENCES_KEY, JSON.stringify({ mode: options.guided ? "guided" : "expert", skipReasonOwner: true }));
  const saved = vi.fn(); const chosen = vi.fn(); const opened = vi.fn(); const bodies: NormVersionCreate[] = [];
  let failure = options.failure;
  const sourceDocument = options.document ?? document;
  server.use(http.post("*/projects/p/norms", async ({ request }) => {
    const body = await request.json() as NormVersionCreate; bodies.push(body);
    if (failure) { failure = false; return HttpResponse.json({ title: "Unavailable" }, { status: 503 }); }
    return HttpResponse.json({ id: "nv_new", norm: body.norm, parentId: body.parentId, status: "draft" }, { status: 201 });
  }));
  function Harness() {
    const [step, setStep] = useState<AuthoringStep>(options.step ?? "layers");
    const [view, setView] = useState(options.selectedView ?? "Finance");
    return <StructureEditor projectId="p" versionId="nv_original" document={sourceDocument} step={step} selectedView={view} onView={value => { chosen(value); setView(value); }} onStep={setStep} onConstraint={opened} onSaved={saved} />;
  }
  render(<QueryClientProvider client={makeTestQueryClient()}><Harness /></QueryClientProvider>);
  if (options.step === "views") fireEvent.click(screen.getByRole("button", { name: "Edit one view" }));
  return { bodies, saved, chosen, opened };
}

it("saves assignments and within-layer weights as a new draft while retaining review obligations", async () => {
  const before = structuredClone(document); const api = setup({ failure: true }); const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Weight within layer: Pay on time")); await user.type(screen.getByLabelText("Weight within layer: Pay on time"), "4");
  await user.click(screen.getByText("Edit constraint assignments"));
  await user.selectOptions(screen.getByLabelText("Layer for Pay on time"), "quality");
  await user.click(screen.getByRole("button", { name: "Save structure as new draft" }));
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  expect(screen.getByLabelText("why this change (required)")).toHaveFocus();
  await user.type(screen.getByLabelText("why this change (required)"), "Quality owns payment discipline");
  await user.type(screen.getByLabelText("who owns it (required)"), "Process owner");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your edits are kept");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.saved).toHaveBeenCalledWith("nv_new"));
  expect(api.bodies[0]).toMatchObject({ parentId: "nv_original", norm: { metadata: expect.objectContaining(before.metadata!), views: expect.arrayContaining(before.views!), constraints: [{ ...before.constraints![0], layer: "quality", weight: 4 }, before.constraints![1]] } });
  expect(api.bodies[0]!.calibration).toBeUndefined(); expect(api.bodies[1]).toEqual(api.bodies[0]);
  expect(document).toEqual(before);
});

it("edits the selected view without converting direct constraint weights, and colors are identity only", async () => {
  const api = setup({ step: "views", selectedView: "Automation" }); const user = userEvent.setup();
  expect(screen.getByLabelText("View name")).toHaveValue("Automation");
  expect(screen.getByText(/weights constraints directly/)).toBeVisible();
  const bookmark = screen.getByRole("button", { name: "Automation Direct constraint weights" });
  expect(bookmark).toHaveStyle({ borderBottom: `3px solid ${viewColor("Automation")}` });
  await user.click(screen.getByText("Choose constraints in Timing"));
  await user.clear(screen.getByLabelText("View weight: Pay on time")); await user.type(screen.getByLabelText("View weight: Pay on time"), "5");
  await user.click(screen.getByRole("button", { name: "Finance 2 weighted layers" }));
  expect(api.chosen).toHaveBeenCalledWith("Finance");
  expect(screen.getByLabelText("View weight: Timing")).toHaveValue(2);
  await user.clear(screen.getByLabelText("View weight: Quality")); await user.type(screen.getByLabelText("View weight: Quality"), "0");
  expect(screen.getByText("Not weighted", { selector: "span" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Save structure as new draft" }));
  await user.type(screen.getByLabelText("why this change (required)"), "Agreed priorities");
  await user.type(screen.getByLabelText("who owns it (required)"), "View owner");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.saved).toHaveBeenCalled());
  expect(api.bodies[0]!.norm.views).toEqual(withGeneralBenchmark({ ...document, views: [{ name: "Finance", layer_weights: { time: 2, quality: 0 } }, { name: "Automation", constraint_weights: { timing: 5, receipt: 3 } }] }).views);
});

it("does not turn blank or negative weights into zero and matrix cells navigate to the actual weight", async () => {
  setup({ step: "views" }); const user = userEvent.setup();
  await user.clear(screen.getByLabelText("View weight: Timing"));
  expect(screen.getByLabelText("View weight: Timing")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Save structure as new draft" })).toBeDisabled();
  await user.type(screen.getByLabelText("View weight: Timing"), "-2");
  expect(screen.getByRole("alert")).toHaveTextContent("zero or a positive number");
  await user.clear(screen.getByLabelText("View weight: Timing")); await user.type(screen.getByLabelText("View weight: Timing"), "2");
  expect(screen.getByText(/These are not performance scores/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit Finance: Quality" }));
  await waitFor(() => expect(screen.getByLabelText("View weight: Quality")).toHaveFocus());
  await expectNoSeriousA11yViolations(screen.getByRole("region", { name: "Layer and view editor" }));
});

it("requires an intentional positive weight in new views and unique view names", () => {
  expect(structureIssues({ ...document, views: [{ name: "Empty", layer_weights: { time: 0, quality: 0 } }] })).toContain("Each view needs a positive weight on at least one assigned constraint.");
  expect(structureIssues({ ...document, views: [{ name: "Finance", layer_weights: { time: 1 } }, { name: "Finance", layer_weights: { quality: 1 } }] })).toContain("Use a different name for each view.");
  expect(structureIssues({ ...document, constraints: [{ ...document.constraints![0]!, layer: "missing" }] })).toContain("Assign every constraint to a layer.");
});


it("changes membership only for the chosen view and keeps the automatic benchmark read-only", async () => {
  const api = setup({ step: "views" }); const user = userEvent.setup();
  await user.click(screen.getByText("Choose constraints in Timing"));
  await user.click(screen.getByLabelText("Include Pay on time in Finance"));
  expect(screen.getByLabelText("View weight: Timing")).toHaveValue(0);
  await user.click(screen.getByRole("button", { name: "Automation Direct constraint weights" }));
  expect(screen.getByLabelText("Include layer Quality in Automation")).toBeChecked();
  await user.click(screen.getByRole("button", { name: "General Equal-layer benchmark" }));
  expect(screen.getByLabelText("Include layer Timing in General")).not.toBeChecked();
  expect(screen.getByLabelText("Include layer Timing in General")).toBeDisabled();
  expect(screen.queryByLabelText("View name")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save structure as new draft" }));
  await user.type(screen.getByLabelText("why this change (required)"), "Only Finance excludes timing");
  await user.type(screen.getByLabelText("who owns it (required)"), "Finance owner");
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.saved).toHaveBeenCalled());
  expect((api.bodies[0]!.norm.views as typeof document.views)![1]).toEqual(document.views![1]);
  expect(api.bodies[0]!.norm.constraints).toEqual(document.constraints);
});


it("saves per-view choices as a guided draft without inventing reason or owner", async () => {
  const api = setup({ step: "views", guided: true }); const user = userEvent.setup();
  await user.click(screen.getByLabelText("Include layer Timing in Finance"));
  await user.click(screen.getByRole("button", { name: "Save structure as new draft" }));
  expect(screen.queryByLabelText("who owns it (required)")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.saved).toHaveBeenCalled());
  expect(api.bodies[0]!.calibration).toBeUndefined();
  expect(api.bodies[0]!.note).toBe("Layers and views updated in guided draft");
});


it("selects the new editable view after General moves to the end and saves its weights", async () => {
  const source = withGeneralBenchmark(document);
  const before = structuredClone(source);
  const api = setup({ step: "views", selectedView: "General", guided: true, document: source });
  const user = userEvent.setup();
  expect(screen.queryByLabelText("View name")).not.toBeInTheDocument();
  await user.click(screen.getByText("Add view", { selector: "summary" }));
  await user.type(screen.getByLabelText("New view name"), "Operations");
  await user.click(screen.getByRole("button", { name: "Add view" }));
  expect(screen.getByLabelText("View name")).toHaveValue("Operations");
  expect(screen.getByRole("button", { name: "Operations 0 weighted layers" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "General Equal-layer benchmark" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "Save structure as new draft" })).toBeDisabled();
  const weight = screen.getByLabelText("View weight: Timing");
  expect(weight).toBeEnabled();
  await user.clear(weight);
  await user.type(weight, "4");
  expect(screen.getByLabelText("View name")).toHaveValue("Operations");
  expect(screen.getByRole("button", { name: "Save structure as new draft" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Save structure as new draft" }));
  await user.click(screen.getByRole("button", { name: "Save as the next version" }));
  await waitFor(() => expect(api.saved).toHaveBeenCalledWith("nv_new"));
  expect(api.bodies[0]!.norm.views).toEqual(withGeneralBenchmark({ ...document, views: [...document.views!, { name: "Operations", layer_weights: { time: 4, quality: 0 } }] }).views);
  expect(source).toEqual(before);
});

it("rejects duplicate names before benchmark normalization, including a renamed managed General", async () => {
  const source = withGeneralBenchmark({ ...document, views: [...document.views!, { name: "General", layer_weights: { time: 1 } }] });
  expect(source.metadata?.general_benchmark).toMatchObject({ name: "General benchmark" });
  setup({ step: "views", document: source });
  const user = userEvent.setup();
  await user.click(screen.getByText("Add view", { selector: "summary" }));
  const name = screen.getByLabelText("New view name");
  for (const duplicate of ["General", " General benchmark ", "Finance"]) {
    await user.clear(name);
    await user.type(name, duplicate);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("A view with this name already exists");
    expect(screen.getByRole("button", { name: "Add view" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("View name")).toHaveValue("Finance");
    expect(screen.getByRole("button", { name: "Save structure as new draft" })).toBeDisabled();
  }
  await user.clear(name);
  await user.type(name, "General benchmark 2");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add view" }));
  expect(screen.getByLabelText("View name")).toHaveValue("General benchmark 2");
  expect(screen.getByRole("button", { name: "General benchmark Equal-layer benchmark" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("View weight: Timing")).toBeEnabled();
});
