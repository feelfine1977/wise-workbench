import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoSeriousA11yViolations, renderApp } from "@/test/utils";
import { currentStep } from "./Stepper";
import { http, HttpResponse } from "msw";
import { db } from "@/mocks/db";
import { server } from "@/mocks/node";
import { bindProjectDataset } from "@/lib/api/projectBinding";
import { useNavStore } from "@/lib/stores/nav";
import { parseSearch } from "../search";

const T = { timeout: 8000 };

describe("the analysis path (R2-O6)", () => {
  it("maps every screen onto its step", () => {
    expect(currentStep("/p/x/data")).toBe("data");
    expect(currentStep("/p/x/data/ds_1")).toBe("data");
    expect(currentStep("/p/x/norms/nv_7")).toBe("norm");
    expect(currentStep("/p/x/runs")).toBe("run");
    expect(currentStep("/p/x/runs/run_41")).toBe("run");
    expect(currentStep("/p/x/runs/run_41/backlog")).toBe("signals");
    expect(currentStep("/p/x/runs/run_41/investigate")).toBe("signals");
    expect(currentStep("/p/x/runs/run_41/slices/k")).toBe("why");
    expect(currentStep("/p/x")).toBe("goal");
  });

  it("maps sub-screens onto the step they were opened from", () => {
    expect(currentStep("/p/x/norms/nv_7", "/p/x/runs/run_41/slices/k", { tab: "constraints", constraint: "payment" })).toBe("why");
    expect(currentStep("/p/x/norms/nv_7", "/p/x/runs/run_41/backlog")).toBe("norm");
    expect(currentStep("/p/x/notebook", "/p/x/runs/run_41/slices/k")).toBe("why");
    expect(currentStep("/p/x/notebook")).toBeUndefined();
  });

  it("uses the norm page for guided and structural work even with a remembered group or constraint", () => {
    const norm = "/p/x/norms/nv_7";
    const why = "/p/x/runs/run_41/slices/k";
    for (const origin of [why, `${why}/act`]) {
      for (const tab of ["guide", "structure", "map", "review", "history", "json"]) {
        expect(currentStep(norm, origin, { tab, constraint: "payment" })).toBe("norm");
      }
      expect(currentStep(norm, origin, { tab: "constraints" })).toBe("norm");
      expect(currentStep(norm, origin)).toBe("norm");
    }
    expect(currentStep(norm, `${why}/act`, { tab: "constraints", constraint: "payment" })).toBe("norm");
    expect(currentStep(norm, why, { constraint: "payment" })).toBe("why");
  });

  it("preserves an explicit invalid filter when navigating to process questions and flow", async () => {
    renderApp("/p/p2p2018/runs/run_41/backlog?filter=7");
    const stepper = await screen.findByRole("navigation", { name: "Analysis path" }, T);
    for (const name of [/Process questions/, /^Flow/]) {
      await waitFor(() => {
        const href = within(stepper).getByRole("link", { name }).getAttribute("href")!;
        expect((parseSearch(new URL(href, "http://localhost").search) as Record<string, unknown>).filter).toBe("7");
      });
    }
  });

  it("shows a compact path and an honest full journey, with working links and planned stages", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Finance`);
    await screen.findByRole("list", { name: "Signals" }, T);
    const stepper = screen.getByRole("navigation", { name: "Analysis path" });
    const steps = within(stepper).getAllByRole("listitem").filter((li) => li.hasAttribute("data-step"));
    expect(steps.map((s) => s.querySelector("[data-step-label]")?.textContent)).toEqual(["Project", "Understand data", "Process norm", "Run WISE", "Analyse", "Improve"]);
    expect(steps[3]).toHaveAttribute("data-step-state", "available");
    expect(steps[5]).toHaveAttribute("data-step-state", "available");
    expect(steps[4]).toHaveAttribute("aria-current", "step");
    expect(stepper).not.toHaveTextContent(/you are here/i);
    expect(within(steps[5] as HTMLElement).getByRole("link")).toBeInTheDocument();
    // no user-visible string names a release
    expect(stepper.textContent).not.toMatch(/cycle \d/);
    expect(within(steps[4] as HTMLElement).getByRole("link")).toHaveAttribute("href", expect.stringContaining("/runs/run_41/investigate"));
    expect(within(steps[2] as HTMLElement).getByRole("link")).toHaveAttribute("href", expect.stringContaining("tab=guide"));
    await user.click(within(stepper).getByRole("button", { name: "All stages of your journey" }));
    const journey = await screen.findByRole("list", { name: "All stages" });
    const readiness = journey.querySelector('[data-stage="data"]') as HTMLElement;
    expect(readiness).toHaveTextContent(/\d+ blocking issues? · \d+ warnings?\. Review data checks before interpreting results\./);
    expect(readiness).not.toHaveTextContent(/578 events|180,913|93\.1%|outside the observation window|exact duplicates/);
    expect(within(journey).getAllByRole("listitem").map((item) => item.getAttribute("data-stage"))).toEqual(["goal", "data", "context", "norm", "weights", "run", "explore", "why", "act", "pilot", "follow_up"]);
    expect(journey).not.toHaveTextContent(/\bS\d+\b|increment|twelve stages|\bv\d+\b|gated/i);
    expect(within(journey).getByRole("link", { name: "Case and flow context" })).toHaveAttribute("href", expect.stringContaining("tab=flows"));
    expect(within(journey).getByRole("link", { name: "Layers and views" })).toHaveAttribute("href", expect.stringContaining("tab=structure"));
    for (const id of ["pilot", "follow_up"]) {
      const planned = journey.querySelector(`[data-stage="${id}"]`) as HTMLElement;
      expect(planned).toHaveTextContent("Planned");
      expect(within(planned).queryByRole("link")).not.toBeInTheDocument();
      expect(within(planned).queryByRole("button")).not.toBeInTheDocument();
    }
    await expectNoSeriousA11yViolations(journey);
    await user.keyboard("{Escape}");
    await user.click(within(steps[1] as HTMLElement).getByRole("link"));
    await screen.findByRole("heading", { level: 1, name: /BPI_Challenge_2019/ }, T);
    expect(within(screen.getByRole("navigation", { name: "Analysis path" })).getAllByRole("listitem").filter((li) => li.hasAttribute("data-step"))[1]).toHaveAttribute("aria-current", "step");
  });

  it("the norm lens opened from a reason screen stays under Why with a second line; the back control cuts the stack so the list is one press away", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation&minCases=1&kind=widespread`);
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    await user.click(within(within(list).getAllByRole("article")[0] as HTMLElement).getByRole("button", { name: /^Why\?/ }));
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    await user.click(screen.getByRole("tab", { name: "Compared" }));
    await user.click(await screen.findByRole("link", { name: /norm's calibration lens/ }, T));
    await screen.findByTestId("norm-builder", {}, T);
    const stepper = screen.getByRole("navigation", { name: "Analysis path" });
    const why = within(stepper).getAllByRole("listitem").find((li) => li.getAttribute("data-step") === "analyse") as HTMLElement;
    expect(why).toHaveAttribute("aria-current", "step");
    await waitFor(() => expect(within(why).getByTestId("step-subline")).toHaveTextContent(/Packaging · lens of/));
    expect(screen.getByTestId("back-control")).toHaveTextContent(/^Back to Why\?/);
    await user.click(screen.getByTestId("back-control"));
    await screen.findByRole("heading", { level: 1, name: /Packaging/ }, T);
    expect(screen.getByRole("tab", { name: "Compared" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("back-control")).toHaveTextContent("Back to Where is it worst? (page 1, widespread only)");
    await user.click(screen.getByTestId("back-control"));
    await screen.findByRole("list", { name: "Signals" }, T);
    expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent(/widespread/);
  });

  it("Act → Process norm selects Define without discarding the saved assessment or exact group return", async () => {
    await bindProjectDataset("p2p2018", "ds_1");
    const run = { ...db.runs.find(r => r.id === "run_41")!, scope: { selection_id: "recorded-cohort" } };
    server.use(
      http.get("*/api/v1/projects/p2p2018/runs", () => HttpResponse.json([run])),
      http.get("*/api/v1/projects/p2p2018/runs/run_41", () => HttpResponse.json(run)),
      http.get("*/api/v1/projects/p2p2018/case-tables/:caseTableId/selections", () => HttpResponse.json([
        { id: "recorded-cohort", caseTableId: run.caseTableId, datasetId: "ds_1", name: "Recorded cohort", cases: 12, selection: null, createdAt: "2026-09-27" },
      ])),
    );
    const groupPath = `/p/p2p2018/runs/run_41/slices/${encodeURIComponent('["companyID_0000", "Packaging"]')}`;
    const query = `slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation&minCases=1`;
    const origin = `${groupPath}/act?${query}`;
    useNavStore.getState().setLastSlice(`${groupPath}?${query}&tab=why`, "Packaging");
    const user = userEvent.setup();
    renderApp(origin);
    await screen.findByTestId("act-reading", {}, T);
    const stepper = screen.getByRole("navigation", { name: "Analysis path" });
    expect(stepper.querySelector('[data-step="act"]')).toHaveAttribute("aria-current", "step");
    const normLink = within(stepper).getByRole("link", { name: "Process norm" });
    await waitFor(() => {
      const url = new URL(normLink.getAttribute("href")!, "http://localhost");
      expect(url.pathname).toBe(`/p/p2p2018/norms/${run.normVersionId}`);
      expect(Object.fromEntries(url.searchParams)).toEqual({ caseTable: run.caseTableId, selection: "recorded-cohort", tab: "guide" });
    }, T);
    await user.click(normLink);
    await screen.findByRole("region", { name: "Norm authoring guide" }, T);
    expect(stepper.querySelector('[data-step="norm"]')).toHaveAttribute("aria-current", "step");
    expect(stepper.querySelector('[data-step="analyse"]')).not.toHaveAttribute("aria-current");
    expect(within(stepper).queryByRole("group", { name: "Substeps" })).not.toBeInTheDocument();
    await waitFor(() => expect(within(stepper).queryByTestId("step-subline")).not.toBeInTheDocument());
    expect(useNavStore.getState().lastSlice).toEqual({ href: `${groupPath}?${query}&tab=why`, label: "Packaging" });
    expect(screen.getByTestId("back-control")).toHaveTextContent("Back to Improve");
    await user.click(screen.getByTestId("back-control"));
    await screen.findByTestId("act-reading", {}, T);
    expect(stepper.querySelector('[data-step="act"]')).toHaveAttribute("aria-current", "step");
    const restored = new URL(useNavStore.getState().visited.at(-1)!.href, "http://localhost");
    expect(decodeURIComponent(restored.pathname)).toBe(decodeURIComponent(`${groupPath}/act`));
    expect(Object.fromEntries(restored.searchParams)).toEqual(Object.fromEntries(new URLSearchParams(query)));
    expect(screen.getByTestId("ribbon-saved-selection")).toHaveTextContent("recorded-cohort");
  });

  it("a sub-screen's back control returns to the exact place the reader came from", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Logistics&minCases=30`);
    await screen.findByRole("list", { name: "Signals" }, T);
    await user.click(within(screen.getByRole("navigation", { name: "Analysis path" })).getByRole("link", { name: /Process norm/ }));
    await screen.findByRole("region", { name: "Norm authoring guide" }, T);
    const back = screen.getByTestId("back-control");
    expect(back).toHaveTextContent("Back to Where is it worst? (page 1)");
    await user.click(back);
    await screen.findByRole("list", { name: "Signals" }, T);
    await waitFor(() => expect(screen.getByTestId("ranking-rule")).toHaveTextContent(/Logistics/));
    expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent(/at least 30 purchase order items/);
  });
});

it("offers dataset selection and new-run entry without replacing the current assessment", async () => {
  renderApp("/p/p2p2018");
  const navigation = await screen.findByRole("navigation", { name: "Analysis path" });
  expect(within(navigation).getByRole("link", { name: "Select a dataset" })).toHaveAttribute("href", "/p/p2p2018/data");
  expect(within(navigation).getByRole("link", { name: "Runs / new run" })).toHaveAttribute("href", "/p/p2p2018/runs");
});
