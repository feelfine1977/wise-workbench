import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { expect, it, vi } from "vitest";
import { server } from "@/mocks/node";
import { evaluateMockEda } from "@/mocks/eda";
import { edaCases } from "@/mocks/fixtures/eda";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import {
  analysisKey,
  draftFromSelection,
  draftSelection,
  useAnalysisSelection,
} from "@/lib/stores/analysisSelection";
import { DataExploration } from "./DataExploration";
import type { ExplorationPage } from "@/app/search";
const scope = { projectId: "p2p2018", datasetId: "ds_1", caseTableId: "ct_1" };
const key = analysisKey(scope.projectId, scope.datasetId, scope.caseTableId);
function setup(mode?: ExplorationPage) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <DataExploration {...scope} pageMode={mode} />
    </QueryClientProvider>,
  );
  return { ...result, client };
}
const count = (n: number) => screen.findByText(`${n} of 6 cases selected`);
const chart = (name: string) =>
  within(screen.getByRole("group", { name: `${name} chart` }));
it("opens a descriptive data atlas and supports direct navigation without a norm", async () => {
  const { container } = setup();
  await count(6);
  expect(
    screen.getByRole("navigation", { name: "Exploration pages" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Data atlas/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("button", { name: "Edit filters" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expectNoSeriousA11yViolations(container);
});
it("combines multiple context fields, keeps them across pages, and supports undo and reset", async () => {
  setup();
  await count(6);
  await userEvent.click(
    screen.getByRole("button", { name: /Context & concentration/ }),
  );
  await userEvent.click(
    chart("flow_type").getByRole("button", { name: /^DF1:/ }),
  );
  await count(2);
  await userEvent.click(
    chart("flow_type").getByRole("button", { name: /^DF2:/ }),
  );
  await count(4);
  await userEvent.click(
    chart("vendor").getByRole("button", { name: /^Vendor A:/ }),
  );
  await count(2);
  expect(
    draftSelection(useAnalysisSelection.getState().entries[key]!.draft).facets,
  ).toHaveLength(2);
  await userEvent.click(
    within(
      screen.getByRole("navigation", { name: "Exploration pages" }),
    ).getByRole("button", { name: /Case evidence/ }),
  );
  const table = within(
    screen.getByRole("region", { name: "Selected case details" }),
  );
  expect(table.getByText("demo-001")).toBeInTheDocument();
  expect(table.queryByText("demo-002")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  await count(4);
  await userEvent.click(
    screen.getByRole("button", { name: "Reset selection" }),
  );
  await count(6);
});
it("retains a facet when changing the displayed grouping field", async () => {
  setup("context");
  await count(6);
  await userEvent.click(
    chart("flow_type").getByRole("button", { name: /^DF1:/ }),
  );
  await count(2);
  await userEvent.selectOptions(
    screen.getByLabelText("Explore a context field"),
    "vendor",
  );
  await count(2);
  expect(
    draftSelection(useAnalysisSelection.getState().entries[key]!.draft)
      .facets?.[0]?.field,
  ).toBe("flow_type");
  expect(
    screen.getByRole("button", { name: /Remove flow_type: DF1/ }),
  ).toBeInTheDocument();
});
it("intersects exact date, span and event ranges and rejects reversed or fractional event bounds", async () => {
  setup("time");
  await count(6);
  await userEvent.click(screen.getByRole("button", { name: "Edit filters" }));
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2018-01-01" },
  });
  fireEvent.change(screen.getByLabelText("Through"), {
    target: { value: "2018-01-31" },
  });
  fireEvent.change(screen.getByLabelText("Recorded span ≥ days"), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText("Recorded span < days"), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByLabelText("Events at least"), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByLabelText("Events less than"), {
    target: { value: "4" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Apply ranges" }));
  await count(1);
  expect(
    draftSelection(useAnalysisSelection.getState().entries[key]!.draft),
  ).toMatchObject({
    timeRanges: [
      { from: "2018-01-01T00:00:00Z", before: "2018-02-01T00:00:00.000Z" },
    ],
    spanRanges: [{ min: 0, max: 3 }],
    eventRanges: [{ min: 3, max: 4 }],
  });
  fireEvent.change(screen.getByLabelText("Recorded span < days"), {
    target: { value: "0" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Apply ranges" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("minimum below");
});
it("distinguishes unknown spans from zero and restores an empty intersection", async () => {
  setup("time");
  await count(6);
  await userEvent.click(
    chart("Recorded span").getByRole("button", { name: /^Unknown span:/ }),
  );
  await count(1);
  await userEvent.click(
    chart("Cases over time").getByRole("button", { name: /^2018-01:/ }),
  );
  await count(0);
  expect(screen.getByText("No cases match this selection")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: /Remove First recorded:/ }),
  );
  await count(1);
  expect(
    draftSelection(useAnalysisSelection.getState().entries[key]!.draft),
  ).toEqual({ spanMissing: true });
});
it("keeps omitted historic months visible and offers a keyboard range selection", async () => {
  setup("time");
  await count(6);
  expect(screen.getByText(/empty months omitted/)).toBeInTheDocument();
  const old = chart("Cases over time").getByRole("button", {
    name: /^1948-01:/,
  });
  old.focus();
  await userEvent.keyboard("{Enter}");
  await count(1);
  expect(
    screen.getByRole("button", { name: /Remove First recorded: 1948-01/ }),
  ).toBeInTheDocument();
});
it("selects an exact context pair through a Sankey connection and changes encoding", async () => {
  setup("context");
  await count(6);
  const graph = screen.getByLabelText("Context membership Sankey");
  await userEvent.click(
    within(graph).getByRole("button", { name: /^DF1 × Vendor A:/ }),
  );
  await count(2);
  await userEvent.click(screen.getByRole("button", { name: "Treemap" }));
  expect(
    screen.getByLabelText("Context membership treemap"),
  ).toBeInTheDocument();
  expect(
    draftSelection(useAnalysisSelection.getState().entries[key]!.draft).facets,
  ).toEqual([
    { field: "flow_type", keys: ["v1"] },
    { field: "vendor", keys: ["v1"] },
  ]);
});
it("does not display previous counts during an error and retains a recovery path", async () => {
  setup("context");
  await count(6);
  server.use(
    http.get("*/api/v1/projects/:projectId/case-tables/:caseTableId/eda", () =>
      HttpResponse.json({ detail: "Unavailable" }, { status: 503 }),
    ),
  );
  await userEvent.click(
    chart("flow_type").getByRole("button", { name: /^DF1:/ }),
  );
  await screen.findByRole("button", { name: "Try again" });
  expect(screen.queryByText("6 of 6 cases selected")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Remove flow_type:/ }),
  ).toBeInTheDocument();
  server.resetHandlers();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await count(2);
});
it("round-trips multi-field saved recipes and keeps a saved ID when only display axes change", () => {
  const selection = {
    facets: [{ field: "vendor", keys: ["v1", "missing"] }],
    timeRanges: [{ from: "2018-01-01T00:00:00Z" }],
    eventRanges: [{ min: 3, max: 10 }],
    spanMissing: true,
  };
  const draft = draftFromSelection(selection, "flow_type");
  expect(draftSelection(draft)).toEqual(selection);
  useAnalysisSelection.getState().activate(key, "sel", draft);
  useAnalysisSelection
    .getState()
    .update(key, { ...draft, attribute: "vendor" });
  expect(useAnalysisSelection.getState().entries[key]?.savedId).toBe("sel");
});
it("hides advanced controls initially and carries richer filters into the save form", async () => {
  setup("time");
  await count(6);
  expect(screen.queryByLabelText("Filter name")).not.toBeInTheDocument();
  await userEvent.click(
    chart("Events per case").getByRole("button", { name: /^3/ }),
  );
  await count(2);
  await userEvent.click(
    screen.getByRole("button", { name: "Save / use selection" }),
  );
  expect(await screen.findByLabelText("Filter name")).toBeInTheDocument();
  expect(
    draftSelection(useAnalysisSelection.getState().entries[key]!.draft)
      .eventRanges,
  ).toEqual([{ min: 3, max: 5 }]);
});
it("keeps query footprint while a new cohort is pending", async () => {
  const bounds = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 1400,
      width: 1000,
      height: 1400,
      toJSON: () => ({}),
    });
  try {
    setup("context");
    await count(6);
    let finish!: (v: Response) => void;
    server.use(
      http.get(
        "*/api/v1/projects/:projectId/case-tables/:caseTableId/eda",
        () =>
          new Promise<Response>((r) => {
            finish = r;
          }),
      ),
    );
    await userEvent.click(
      chart("flow_type").getByRole("button", { name: /^DF1:/ }),
    );
    expect(
      screen.getByRole("region", { name: "Exploration results" }),
    ).toHaveStyle({ minHeight: "1400px" });
    expect(screen.queryByText("6 of 6 cases selected")).not.toBeInTheDocument();
    const population = screen.getByRole("region", {name:"Selected population summary"});
    expect(population).toHaveAttribute("aria-busy", "true");
    expect(within(population).getByText("Updating selected-population summary…")).toBeVisible();
    expect(population.querySelector(".eda-metrics")).not.toBeVisible();
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () =>
      finish(HttpResponse.json({ detail: "Unavailable" }, { status: 503 })),
    );
    await screen.findByRole("button", { name: "Try again" });
  } finally {
    bounds.mockRestore();
  }
});
it("provides a scoped mapping path when no preparation exists", () => {
  render(<DataExploration projectId="p /" datasetId="ds /" />);
  expect(
    screen.getByRole("link", { name: "Review column mapping" }),
  ).toHaveAttribute("href", "/p/p%20%2F/data/ds%20%2F?tab=mapping");
});

it("editing only event bounds preserves a multi-period selection and unknown spans", async () => {
  setup("time");
  await count(6);
  await userEvent.click(
    chart("Cases over time").getByRole("button", { name: /^2018-01:/ }),
  );
  await userEvent.click(
    chart("Cases over time").getByRole("button", { name: /^1948-01:/ }),
  );
  await userEvent.click(
    chart("Recorded span").getByRole("button", { name: /^Unknown span:/ }),
  );
  await count(0);
  const before = draftSelection(
    useAnalysisSelection.getState().entries[key]!.draft,
  );
  await userEvent.click(screen.getByRole("button", { name: "Edit filters" }));
  fireEvent.change(screen.getByLabelText("Events at least"), {
    target: { value: "2" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Apply ranges" }));
  expect(
    draftSelection(useAnalysisSelection.getState().entries[key]!.draft),
  ).toEqual({ ...before, eventRanges: [{ min: 2 }] });
});
it("reopens saved ranges with highlighted bars and toggles them off by bounds", async () => {
  const selection = {
    timeRanges: [
      { from: "2018-01-01T00:00:00Z", before: "2018-02-01T00:00:00Z" },
    ],
    spanRanges: [{ min: 1, max: 3 }],
    eventRanges: [{ min: 3, max: 5 }],
  };
  useAnalysisSelection
    .getState()
    .activate(key, "saved", draftFromSelection(selection));
  setup("time");
  await count(1);
  expect(
    chart("Cases over time").getByRole("button", { name: /^2018-01:/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const span = chart("Recorded span").getByRole("button", { name: /^1[^0-9]/ });
  expect(span).toHaveAttribute("aria-pressed", "true");
  expect(
    chart("Events per case").getByRole("button", { name: /^3/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(span);
  expect(
    draftSelection(useAnalysisSelection.getState().entries[key]!.draft)
      .spanRanges,
  ).toBeUndefined();
  expect(
    draftSelection(useAnalysisSelection.getState().entries[key]!.draft)
      .timeRanges,
  ).toEqual(selection.timeRanges);
});

it("keeps a legacy saved cohort active when migrating its displayed grouping", async () => {
  useAnalysisSelection
    .getState()
    .activate(
      key,
      "legacy",
      draftFromSelection({ categoryKeys: ["v1"] }, "flow_type"),
    );
  setup("context");
  await count(2);
  await userEvent.selectOptions(
    screen.getByLabelText("Explore a context field"),
    "vendor",
  );
  await count(2);
  expect(useAnalysisSelection.getState().entries[key]?.savedId).toBe("legacy");
});
it("restores a bar's keyboard focus after each uncached linked update", async () => {
  server.use(
    http.get(
      "*/api/v1/projects/:projectId/case-tables/:caseTableId/eda",
      async ({ request }) => {
        await delay(40);
        return HttpResponse.json(
          evaluateMockEda(new URL(request.url).searchParams, "ds_1", "ct_1"),
        );
      },
    ),
  );
  setup("context");
  await count(6);
  chart("flow_type").getByRole("button", { name: /^DF1:/ }).focus();
  await userEvent.keyboard("{Enter}");
  await count(2);
  expect(
    chart("flow_type").getByRole("button", { name: /^DF1:/ }),
  ).toHaveFocus();
  chart("flow_type").getByRole("button", { name: /^DF2:/ }).focus();
  await userEvent.keyboard("{Enter}");
  await count(4);
  expect(
    chart("flow_type").getByRole("button", { name: /^DF2:/ }),
  ).toHaveFocus();
});
it.each([2, 6])(
  "discloses event-count missingness for %i selected cases",
  async (missing) => {
    const previous = edaCases.map((r) => r.events);
    try {
      edaCases.forEach((r, i) => {
        if (i < missing) r.events = null;
      });
      const { container } = setup("context");
      await count(6);
      expect(
        screen.getByText(
          `Known-count sum · ${missing} cases have unknown event counts`,
        ),
      ).toBeInTheDocument();
      const metric = container.querySelectorAll(".eda-metrics strong")[1];
      expect(metric).toHaveTextContent(missing === 6 ? "Unknown" : "9");
      expect(
        screen.getByRole("columnheader", { name: "Span coverage" }),
      ).toBeInTheDocument();
    } finally {
      edaCases.forEach((r, i) => {
        r.events = previous[i]!;
      });
    }
  },
);

it("keeps exact searched values in explicit joint paths across linked refreshes", async () => {
  setup("context");
  await count(6);
  await userEvent.click(chart("flow_type").getByRole("button", { name: /^DF1:/ }));
  await count(2);
  await userEvent.click(screen.getByRole("button", { name: "Find any vendor value" }));
  await userEvent.click(await screen.findByRole("button", { name: /^Vendor A 2 \/ 2$/ }));
  await count(2);
  await userEvent.click(screen.getByRole("button", { name: "Keep field filters as one OR path" }));
  await count(2);
  expect(draftSelection(useAnalysisSelection.getState().entries[key]!.draft).jointAny?.[0]?.facets).toEqual([
    { field: "flow_type", keys: [], values: ["DF1"] }, { field: "vendor", keys: [], values: ["Vendor A"] },
  ]);
  expect(screen.getByRole("button", { name: "Find any vendor value" })).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(chart("flow_type").getByRole("button", { name: /^DF2:/ }));
  await count(0);
  await userEvent.click(await screen.findByRole("button", { name: /^Vendor B 0 \/ 2$/ }));
  await userEvent.click(screen.getByRole("button", { name: "Keep field filters as one OR path" }));
  await count(4);
  expect(draftSelection(useAnalysisSelection.getState().entries[key]!.draft).jointAny).toHaveLength(2);
});


it("puts scoped population evidence before filter controls with introductory guidance closed", async () => {
  const {container} = setup();
  await count(6);
  const population = screen.getByRole("region", {name:"Selected population summary"});
  const toolbar = container.querySelector('[aria-label="Shared analysis selection"]')!;
  expect(population.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(population).toHaveTextContent("SELECTED CASES");
  expect(population).toHaveTextContent("of prepared cases");
  expect(population).toHaveTextContent("Within selected cases");
  expect(population).not.toHaveTextContent(/delay|late|savings|business impact/i);
  expect(population).toHaveAttribute("aria-busy", "false");
  const help = screen.getByText("How to explore").closest("details")!;
  expect(help).not.toHaveAttribute("open");
  await userEvent.click(screen.getByText("How to explore"));
  expect(help).toHaveAttribute("open");
  expect(within(help).getByText(/different fields intersect/)).toBeVisible();
  expect(within(screen.getByRole("navigation", {name:"Exploration pages"})).getAllByRole("button")).toHaveLength(4);
});

it("keeps a multi-value selection across compact page buttons operated by keyboard", async () => {
  setup();
  await count(6);
  const nav = within(screen.getByRole("navigation", {name:"Exploration pages"}));
  nav.getByRole("button", {name:"Context & concentration"}).focus();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(chart("flow_type").getByRole("button", {name:/^DF1:/}));
  await userEvent.click(chart("flow_type").getByRole("button", {name:/^DF2:/}));
  await count(4);
  const selection = draftSelection(useAnalysisSelection.getState().entries[key]!.draft);
  nav.getByRole("button", {name:"Time & variation"}).focus();
  await userEvent.keyboard("{Enter}");
  expect(nav.getByRole("button", {name:"Time & variation"})).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("region", {name:"Selected population summary"})).toHaveTextContent("67%");
  nav.getByRole("button", {name:"Case evidence"}).focus();
  await userEvent.keyboard("{Enter}");
  expect(nav.getByRole("button", {name:"Case evidence"})).toHaveAttribute("aria-current", "page");
  expect(draftSelection(useAnalysisSelection.getState().entries[key]!.draft)).toEqual(selection);
  const evidence = screen.getByRole("region", {name:"Selected case details"});
  expect(within(evidence).getByText("demo-001")).toBeVisible();
  expect(within(evidence).getAllByRole("button", {name:/Inspect event trace for/})).toHaveLength(4);
  expect(within(evidence).queryByText("demo-004")).not.toBeInTheDocument();
  expect(within(evidence).queryByText("demo-005")).not.toBeInTheDocument();
});
