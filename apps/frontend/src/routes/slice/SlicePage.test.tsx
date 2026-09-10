import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { useUiStore } from "@/lib/stores/ui";
import { useFindingStore } from "@/lib/stores/findings";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const PACKAGING = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent('["companyID_0000", "Packaging"]')}?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation`;

describe("Why? — the essential reason chain on Packaging (RG-3)", () => {
  beforeEach(() => {
    useUiStore.getState().setVocabulary("plain");
    useFindingStore.setState(useFindingStore.getInitialState(), true);
  });

  it("Data trust checks the raw filter and withholds hypotheses even when selected checks pass", async () => {
    const filter = '{"and":[{"kind":"open","value":true},{"kind":"open","value":true}]}';
    const requests: (string | null)[] = [];
    server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/gates", ({ request }) => {
      requests.push(new URL(request.url).searchParams.get("filter"));
      return HttpResponse.json({
        caseNoun: "purchase order items",
        filter: { and: [{ kind: "open", value: true }] },
        selection: { state: "measured", cases: 1, wholeGroupCases: 2, fingerprint: "selected-items" },
        gates: [{ id: "selected-trust", kind: "domain", scope: "group", status: "passed", text: "Selected checks passed." }],
      });
    }));
    renderApp(`${PACKAGING}&tab=trust&filter=${encodeURIComponent(filter)}`);
    const counts = await screen.findByTestId("gate-selection-counts", {}, T);
    expect(counts).toHaveTextContent("Selected purchase order items: 1 of 2 in the whole group. Checks use this exact selection.");
    expect(screen.getByTestId("trust-scope-note")).toHaveTextContent("Caveats and diagnostic numbers describe the whole group");
    expect(requests).toEqual([filter]);
    expect(screen.getByTestId("gate-selected-trust")).toHaveAttribute("data-gate-status", "passed");
    expect(screen.getByTestId("hypothesis-selection-notice")).toHaveTextContent("Hypotheses use whole-group checks");
    expect(screen.queryByTestId("hypothesis-form")).not.toBeInTheDocument();
  });

  it("Data trust retains malformed raw filter input for refusal instead of checking the whole group", async () => {
    const requests: (string | null)[] = [];
    server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/gates", ({ request }) => {
      requests.push(new URL(request.url).searchParams.get("filter"));
      return HttpResponse.json({ detail: "The filter must be an object." }, { status: 422 });
    }));
    renderApp(`${PACKAGING}&tab=trust&filter=7`);
    expect(await screen.findByTestId("gates-unavailable", {}, T)).toHaveTextContent("The filter must be an object.");
    expect(requests).toEqual(["7"]);
    expect(screen.queryByTestId("gate-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hypothesis-form")).not.toBeInTheDocument();
  });

  it.each(["", '&filter=%7B%22and%22%3A%5B%7B%22kind%22%3A%22open%22%2C%22value%22%3Atrue%7D%5D%7D'])("Data trust withholds decisions and hypotheses for drilled context %s", async (filterParam) => {
    const parent = JSON.stringify({ slicing: "case Company+case Spend area text", key: '["companyID_0000", "Packaging"]' });
    const requests: string[] = [];
    server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/gates", ({ request }) => { requests.push(request.url); return HttpResponse.json({ gates: [] }); }));
    renderApp(`${PACKAGING}&tab=trust&within=${encodeURIComponent(parent)}${filterParam}`);
    expect(await screen.findByTestId("gates-unavailable", {}, T)).toHaveTextContent("Checks and decisions are unavailable for this drilled selection.");
    expect(requests).toEqual([]);
    expect(screen.queryByTestId("gate-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hypothesis-form")).not.toBeInTheDocument();
  });

  it.each(["typical causes", "decision", "stepper", "backlog stepper"])("preserves filter and parent group through the %s route into Act", async (entry) => {
    const filter = JSON.stringify({ and: [{ kind: "open", value: true }] });
    const parent = JSON.stringify({ slicing: "case Company+case Spend area text", key: '["companyID_0000", "Packaging"]' });
    let submitted: Record<string, unknown> | undefined;
    server.use(http.post("*/api/v1/projects/p2p2018/actions", async ({ request }) => {
      submitted = await request.json() as Record<string, unknown>;
      return HttpResponse.json({ status: 422, code: "review.immutable_context", detail: "Proposals for drilled selections are not supported yet." }, { status: 422 });
    }));
    if (entry === "backlog stepper") {
      server.use(http.get("*/api/v1/projects/p2p2018/runs/run_41/what-can-we-do", () => HttpResponse.json({ drivers: [{
        constraint_id: "selection-review",
        plain_name: "Review the selection",
        usual_actions: [{ text: "Review the selected cases", countermeasure: "review", owner_role: "process_owner" }],
      }] })));
    }
    const user = userEvent.setup();
    const start = entry === "backlog stepper" ? `/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Automation` : PACKAGING;
    renderApp(`${start}&filter=${encodeURIComponent(filter)}&within=${encodeURIComponent(parent)}`);
    if (entry === "backlog stepper") {
      const signals = await screen.findByRole("list", { name: "Signals" }, T);
      await user.click(within(signals).getAllByRole("button", { name: /^Why\? / })[0]!);
    }
    await screen.findByTestId("why-strip", {}, T);
    if (entry === "typical causes") {
      await user.click(within(await screen.findByTestId("typical-causes", {}, T)).getByRole("button", { name: /What can we do/ }));
    } else if (entry === "decision") {
      await user.click(screen.getByRole("radio", { name: "Investigate" }));
      await user.type(screen.getByLabelText("note *"), "Review this selection");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await user.click(await screen.findByRole("button", { name: "Open What can we do?" }, T));
    } else {
      await user.click(within(screen.getByRole("navigation", { name: "Analysis path" })).getByRole("button", { name: /What can we do/ }));
    }
    const driver = (await screen.findAllByTestId("driver-card", {}, T))[0]!;
    await user.click(within(driver).getAllByRole("button", { name: "Propose this action" })[0]!);
    const form = await screen.findByRole("form", { name: "Propose an action" }, T);
    await user.type(within(form).getByLabelText("Who is proposing it"), "Reviewer");
    await user.click(within(form).getByRole("button", { name: "Save the proposal" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("Proposals for drilled selections are not supported yet.");
    expect(submitted).toMatchObject({ filter, within: parent, status: "proposed" });
    expect(form).toBeInTheDocument();
  });

  it("one sentence with the concentration clause, Why first with the expectations, the lens and the map, caveats, no ids", async () => {
    const user = userEvent.setup();
    renderApp(PACKAGING);
    // the company every group shares is dropped from the name; the kind and the confidence sit once at the right
    await screen.findByRole("heading", { level: 1, name: /^Packaging\b/ }, T);
    const sentence = screen.getByTestId("why-sentence");
    expect(sentence).toHaveTextContent(/^109,199 purchase order items · 0\.9 % below expectation · invoices cleared late in 97\s?% of them; the shortfall is 93\s?% this one expectation\.$/);
    // the card and the Why screen print one bracket, and it is the difference of the two numbers (R3-04)
    expect(screen.getByTestId("why-reason")).toHaveTextContent(/^Paid within terms: 83 days here against 55 elsewhere \(\+28 days\)\.$/);
    expect(screen.getAllByText(/confidence high/).length).toBe(1);
    // the compact strip: priority, rank, average met with everyone, one caveat
    const strip = screen.getByTestId("why-strip");
    expect(strip).toHaveTextContent(/priority946/);
    // one run, one population: the rank counts the groups the ranked list ranks, not a second population
    // the row was scored under (R3-09)
    expect(strip).toHaveTextContent(/rank1 of 23/);
    expect(strip).toHaveTextContent(/average met84\s?% \(everyone 84\s?%\)/);
    expect(within(strip).getByRole("list", { name: "Data caveats for this group" })).toHaveTextContent(/14\s?%.*still open/);
    // six one-word tabs, Why first and selected
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Why", "Compared", "Flow", "Cases", "Data trust", "Gain"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // the six metric boxes are behind "more" in plain mode
    expect(screen.queryByTestId("method-strip")).not.toBeInTheDocument();
    const drivers = await screen.findByTestId("top-drivers", {}, T);
    const items = within(drivers).getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]).toHaveTextContent(/Paid within terms/);
    expect(items[0]).toHaveTextContent(/missed in 97\s?% of these purchase order items · explains 93\s?% of the shortfall/);
    expect(drivers).not.toHaveTextContent(/c_l3_invoice_to_clear_days/);
    // the comparison lens of the top expectation with its two sentences, and the map, embedded in the Why tab
    const lens = await screen.findByTestId("why-lens", {}, T);
    await waitFor(() => expect(within(lens).getByTestId("lens-sentences")).toHaveTextContent(/Paid within terms: 83 days here; everywhere else 55\./), T);
    expect(within(lens).getByTestId("lens-sentences")).toHaveTextContent(/97\s?% of Packaging's purchase order items miss it.*everyone else: 83\s?%/);
    expect(await screen.findByTestId("why-map", {}, T)).toBeInTheDocument();
    expect(await screen.findByTestId("flow-map", {}, T)).toBeInTheDocument();
    expect(screen.getByTestId("why-caveats")).toHaveTextContent(/14\s?% of purchase order items still open/);
    // R3-01: the first candidate causes of the leading expectation, from the same hub pages as What can we do?,
    // split into what the log can show and what has to be asked, with the way to the seventh step
    const causes = await screen.findByTestId("typical-causes", {}, T);
    await waitFor(() => expect(causes).toHaveTextContent(/Contractual terms of 60 or 90 days/), T);
    expect(causes).toHaveTextContent(/in the log — check/);
    expect(causes).toHaveTextContent(/Candidates to check, not findings/);
    expect(within(causes).getByRole("button", { name: /What can we do\?/ })).toBeEnabled();
    expect(causes.textContent).not.toMatch(/cycle \d/);
    // the full picture stays behind "Show all"
    expect(screen.queryByTestId("drivers-table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Show all \d+ expectations/ }));
    expect(await screen.findByTestId("drivers-table", {}, T)).toBeInTheDocument();
    // the sub-groups sit on the Cases tab
    await user.click(screen.getByRole("tab", { name: "Cases" }));
    expect(await screen.findByTestId("subgroups", {}, T)).toHaveTextContent(/vendorID_0136/);
    // possible gain in sentences
    await user.click(screen.getByRole("tab", { name: "Gain" }));
    expect(await screen.findByTestId("headroom-list", {}, T)).toHaveTextContent(/If Paid within terms were always met, this group would gain 4\.3 points \(100\s?% of its shortfall\)/);
    // no next step before a decision is saved
    expect(screen.queryByTestId("next-step")).not.toBeInTheDocument();
  });

  it("the method's terms return when the vocabulary is switched: metric boxes, ids and the method strip; the old tab value maps onto Why", async () => {
    useUiStore.getState().setVocabulary("method");
    renderApp(`${PACKAGING}&tab=drivers`);
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    expect(screen.getByRole("tab", { name: "Why" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("method-strip")).toBeInTheDocument();
    const drivers = await screen.findByTestId("top-drivers", {}, T);
    await waitFor(() => expect(drivers).toHaveTextContent(/c_l3_invoice_to_clear_days/));
  });

  it("a filter in the address shows as a chip with cases in on every tab and is written as the object's JSON", async () => {
    const user = userEvent.setup();
    renderApp(`${PACKAGING}&tab=gain&filter=${encodeURIComponent(JSON.stringify({ and: [{ kind: "activity", op: "contains", activity: "Remove Payment Block" }] }))}`);
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    const bar = screen.getByTestId("filter-bar");
    expect(bar).toHaveTextContent(/purchase order items in:/);
    expect(within(bar).getByRole("list", { name: "Active filters" })).toHaveTextContent("with Remove Payment Block");
    await waitFor(() => expect(within(bar).getByTestId("filter-preview")).toHaveTextContent(/[\d,]+ of [\d,]+/), T);
    expect(screen.getByRole("tab", { name: "Gain" })).toHaveAttribute("aria-selected", "true");
    await user.click(within(bar).getByRole("button", { name: /Remove filter: with Remove Payment Block/ }));
    await waitFor(() => expect(within(screen.getByTestId("filter-bar")).queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument());
  });

  it("after a saved decision the next step appears under the pane", async () => {
    const user = userEvent.setup();
    renderApp(`${PACKAGING}&tab=trust`);
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    await user.click(screen.getByRole("radio", { name: "Investigate" }));
    await user.type(screen.getByLabelText("note *"), "payment terms to be checked");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByTestId("next-step")).toHaveTextContent(/Freeze this screen for the notebook/);
    expect(screen.getByTestId("next-step")).toHaveTextContent(/What can we do\?/);
  });
});
