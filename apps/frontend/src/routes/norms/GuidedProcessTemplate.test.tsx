import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { expectNoSeriousA11yViolations, makeTestQueryClient } from "@/test/utils";
import { GuidedProcessTemplate, type GuidedProcessTemplateProps } from "./GuidedProcessTemplate";

function catalogue(projectId = "p", caseTableId = "ct", labelPack: string | null = null, templateId: string | null = null) {
  const activity = labelPack ? "Create Order" : "p2p.order";
  const value = {
    projectId, caseTableId, datasetId: "current-data", process: "p2p", cases: 4, labelPack, templateId,
    labelPacks: [{ id: "bpic2019", observedLabels: 1, totalLabels: 8 }],
    templates: [{
      id: "baseline", name: "Actual P2P baseline", description: "A process-pack norm.",
      documentHash: "hash-current-preview", source: "process_pack", activityLabels: "canonical_ids", available: true, reason: null,
      pendingConstraintIds: ["payment"], warnings: ["Payment labels need review."],
      norm: { name: "P2P baseline", layers: [{ id: "timing" }], views: [{ name: "Operations", layer_weights: { timing: 1 } }],
        constraints: [
          { id: "record", layer: "timing", type: "presence", params: { activity: [activity], m: 1 } },
          { id: "payment", layer: "timing", type: "lag", params: { a: [activity], b: ["Unobserved payment"], delta: 30, width: 7 } },
        ],
        metadata: { calibration_pending: ["payment"], template_import: { templateId: "baseline", caseTableId, datasetId: "current-data", labelPack } },
      },
      constraints: [
        { id: "record", layer: "timing", type: "presence", description: "Record the order", casesInScope: 4, observedCases: 4, missingActivities: [], issues: [], priority: "normal" },
        { id: "payment", layer: "timing", type: "lag", description: "Payment timing", casesInScope: 0, observedCases: 0, missingActivities: ["Unobserved payment"], issues: [], priority: "low" },
      ],
    }, {
      id: "unavailable", name: "Unavailable reference", description: "Configured norm.", source: "configured_norm", activityLabels: "log_labels",
      documentHash: null, available: false, reason: "The configured norm document is unavailable.", norm: null, warnings: [], pendingConstraintIds: [], constraints: [],
    }],
  };
  if (templateId !== "baseline") return { ...value, templates: value.templates.map(item => ({ ...item, norm: null, documentHash: null, constraints: [] })) };
  return value;
}

const requests: string[] = [];
const track = ({ request }: { request: Request }) => requests.push(request.method + " " + new URL(request.url).pathname);
beforeEach(() => {
  requests.length = 0;
  server.events.on("request:start", track);
  server.use(http.get("*/projects/:projectId/norms/templates", ({ params, request }) => {
    const query = new URL(request.url).searchParams;
    return HttpResponse.json(catalogue(String(params.projectId), query.get("caseTableId")!, query.get("labelPack"), query.get("templateId")));
  }));
});
afterEach(() => server.events.removeListener("request:start", track));

function mount(overrides: Partial<GuidedProcessTemplateProps> = {}) {
  const client = makeTestQueryClient();
  const props = { projectId: "p", caseTableId: "ct", datasetName: "Current.csv", onCreated: vi.fn(), ...overrides };
  const tree = (next: GuidedProcessTemplateProps) => <QueryClientProvider client={client}><GuidedProcessTemplate {...next} /></QueryClientProvider>;
  const result = render(tree(props));
  return { ...result, props, update: (next: Partial<GuidedProcessTemplateProps>) => result.rerender(tree({ ...props, ...next })) };
}
async function open() {
  await userEvent.click(screen.getByText("Prepare a process template"));
  return screen.findByRole("combobox", { name: "Process template" });
}
async function preview() {
  await userEvent.click(screen.getByRole("button", { name: "Preview selected template" }));
  return screen.findByRole("button", { name: "Create independent draft" });
}
const writes = () => requests.filter(request => !request.startsWith("GET "));

it("starts compact and collapsed, fetching only when expanded, without any project switching", async () => {
  const { container } = mount();
  expect(container.querySelector("details")).not.toHaveAttribute("open");
  expect(requests).toEqual([]);
  const chooser = await open();
  expect(chooser).toHaveValue("");
  expect(requests).toEqual(["GET /api/v1/projects/p/norms/templates"]);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
  await expectNoSeriousA11yViolations(container);
});

it("previews all rules with separate scope/missing-label caveats and keeps preview details closed", async () => {
  const { container } = mount();
  await userEvent.selectOptions(await open(), "baseline");
  await preview();
  const summary = screen.getByText("Preview 2 rules and source caveats");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  await userEvent.click(summary);
  expect(screen.getByText(/0\/4 cases in scope.*Review later/)).toBeVisible();
  expect(screen.getByText("Unobserved labels: Unobserved payment")).toBeVisible();
  expect(screen.getByText(/does not mark them outside business scope/)).toBeVisible();
  expect(screen.getByText(/1 numeric decisions will need review/)).toBeVisible();
  expect(writes()).toEqual([]);
  await expectNoSeriousA11yViolations(container);
});

it("creates only an explicit independent draft from the previewed norm with numeric thresholds pending", async () => {
  const bodies: Record<string, unknown>[] = [];
  server.use(http.post("*/projects/p/norms", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>;
    bodies.push(body);
    return HttpResponse.json({ id: "nv-independent", status: "draft", norm: body.norm }, { status: 201 });
  }));
  const { props } = mount();
  await userEvent.selectOptions(await open(), "baseline");
  await preview();
  expect(bodies).toEqual([]);
  await userEvent.clear(screen.getByLabelText("Draft norm name"));
  await userEvent.type(screen.getByLabelText("Draft norm name"), "Our process expectations");
  await userEvent.click(screen.getByRole("button", { name: "Create independent draft" }));
  await waitFor(() => expect(props.onCreated).toHaveBeenCalledWith("nv-independent"));
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ norm: { name: "Our process expectations",
    constraints: catalogue("p", "ct", null, "baseline").templates[0]!.norm!.constraints,
    metadata: { calibration_pending: ["payment"], template_import: { caseTableId: "ct", datasetId: "current-data" } },
  } });
  for (const field of ["parentId", "status", "calibration", "notApplicable"]) expect(bodies[0]).not.toHaveProperty(field);
  expect(writes()).toEqual(["POST /api/v1/projects/p/norms"]);
  expect(requests.some(path => /dataset-binding|datasets\/presets|\/runs/.test(path))).toBe(false);
});

it("applies curated labels only after explicit selection and submits that preview", async () => {
  const bodies: Record<string, unknown>[] = [];
  server.use(http.post("*/projects/p/norms", async ({ request }) => {
    bodies.push(await request.json() as Record<string, unknown>);
    return HttpResponse.json({ id: "mapped-draft", status: "draft" }, { status: 201 });
  }));
  mount();
  await userEvent.selectOptions(await open(), "baseline");
  await preview();
  expect(screen.getByLabelText("Activity labels")).toHaveValue("");
  const before = requests.length;
  await userEvent.selectOptions(screen.getByLabelText("Activity labels"), "bpic2019");
  expect(requests).toHaveLength(before);
  expect(screen.queryByRole("button", { name: "Create independent draft" })).not.toBeInTheDocument();
  await preview();
  await waitFor(() => expect(screen.getByLabelText("Activity labels")).toHaveValue("bpic2019"));
  await userEvent.click(await screen.findByRole("button", { name: "Create independent draft" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ norm: { constraints: [{ params: { activity: ["Create Order"] } }, { params: { a: ["Create Order"] } }],
    metadata: { template_import: { labelPack: "bpic2019" } } } });
  expect(writes()).toEqual(["POST /api/v1/projects/p/norms"]);
});

it("does not allow submission while a different binding preview is loading", async () => {
  let release!: () => void;
  server.use(http.get("*/projects/p/norms/templates", async ({ request }) => {
    const pack = new URL(request.url).searchParams.get("labelPack");
    if (pack) await new Promise<void>(resolve => { release = resolve; });
    return HttpResponse.json(catalogue("p", "ct", pack, new URL(request.url).searchParams.get("templateId")));
  }));
  mount();
  await userEvent.selectOptions(await open(), "baseline");
  await preview();
  await userEvent.selectOptions(screen.getByLabelText("Activity labels"), "bpic2019");
  await userEvent.click(screen.getByRole("button", { name: "Preview selected template" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Checking this template");
  expect(screen.queryByRole("button", { name: "Create independent draft" })).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
  release();
  expect(await screen.findByRole("button", { name: "Create independent draft" })).toBeEnabled();
});

it("keeps the template and edited name after creation fails", async () => {
  server.use(http.post("*/projects/p/norms", () => HttpResponse.json({ title: "Unavailable" }, { status: 503 })));
  mount();
  await userEvent.selectOptions(await open(), "baseline");
  await preview();
  await userEvent.clear(screen.getByLabelText("Draft norm name"));
  await userEvent.type(screen.getByLabelText("Draft norm name"), "Keep my name");
  await userEvent.click(screen.getByRole("button", { name: "Create independent draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your preview and name are kept.");
  expect(screen.getByLabelText("Draft norm name")).toHaveValue("Keep my name");
  expect(screen.getByLabelText("Process template")).toHaveValue("baseline");
});

it("does not offer creation for an unavailable source", async () => {
  mount();
  await userEvent.selectOptions(await open(), "unavailable");
  expect(screen.getByRole("status")).toHaveTextContent("The configured norm document is unavailable.");
  expect(screen.queryByRole("button", { name: "Create independent draft" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
});

it("does not guess a template for a process without configured sources", async () => {
  server.use(http.get("*/projects/p/norms/templates", () => HttpResponse.json({ ...catalogue(), process: "custom", templates: [] })));
  mount();
  await userEvent.click(screen.getByText("Prepare a process template"));
  expect(await screen.findByText("No norm templates are configured for custom.")).toBeVisible();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
});

it("requires a selected table before making a preview request", async () => {
  mount({ caseTableId: undefined });
  await userEvent.click(screen.getByText("Prepare a process template"));
  expect(screen.getByText(/Select a prepared case table/)).toBeVisible();
  expect(requests).toEqual([]);
});

it("blocks a mismatched preview context and permits a verified retry", async () => {
  let correct = false;
  server.use(http.get("*/projects/p/norms/templates", () => HttpResponse.json(catalogue("p", correct ? "ct" : "foreign"))));
  mount();
  await userEvent.click(screen.getByText("Prepare a process template"));
  expect(await screen.findByRole("alert")).toHaveTextContent("The template catalogue could not be verified.");
  expect(screen.queryByRole("button", { name: "Create independent draft" })).not.toBeInTheDocument();
  correct = true;
  await userEvent.click(screen.getByRole("button", { name: "Retry templates" }));
  expect(await screen.findByRole("combobox", { name: "Process template" })).toHaveValue("");
  expect(writes()).toEqual([]);
});

it.each([404, 409])("reports backend refusal %s without redirecting into a preset load", async status => {
  server.use(http.get("*/projects/p/norms/templates", () => HttpResponse.json({ title: "Cannot preview" }, { status })));
  mount();
  await userEvent.click(screen.getByText("Prepare a process template"));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create independent draft" })).not.toBeInTheDocument();
  expect(writes()).toEqual([]);
});

it("clears selection, name and open details when project or preparation changes", async () => {
  const { update, container } = mount();
  await userEvent.selectOptions(await open(), "baseline");
  await preview();
  await userEvent.type(screen.getByLabelText("Draft norm name"), " unsaved");
  update({ projectId: "other", caseTableId: "new-table" });
  expect(container.querySelector("details")).not.toHaveAttribute("open");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  const chooser = await open();
  expect(chooser).toHaveValue("");
  expect(within(chooser).getAllByRole("option")).toHaveLength(3);
  expect(requests).toContain("GET /api/v1/projects/other/norms/templates");
  expect(writes()).toEqual([]);
});
