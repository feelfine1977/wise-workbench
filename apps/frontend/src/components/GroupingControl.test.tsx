import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { makeTestQueryClient } from "@/test/utils";
import { GroupingEditor } from "./GroupingControl";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { cutPoints, groupingAttributes, groupingToken } from "@/lib/grouping";
import { groupingLabel } from "@/lib/sentences";
import type { GroupingOptions } from "@/lib/api/groupings";
const DATA: GroupingOptions = { cases: 100, attributes: [
  { name: "company", type: "categorical", distinct: 2, missing: 0 },
  { name: "exposure", type: "numeric", distinct: 90, missing: 2 },
], suggestions: [{ id: "company", label: "Company only", description: "Find organisation differences", attributes: ["company"], bands: [] }] };
function setup() {
  const onUse = vi.fn();
  const requests: URL[] = [];
  server.use(http.get("*/projects/p/runs/r/slicings/preview", ({ request }) => {
    requests.push(new URL(request.url));
    return HttpResponse.json({ groups: 3, cases: 100, belowMinCases: 1, minCases: 20, largest: [{ key: '["A"]', n_cases: 55 }] });
  }));
  render(<QueryClientProvider client={makeTestQueryClient()}><Dialog open><DialogContent><DialogTitle>Group cases</DialogTitle><GroupingEditor data={DATA} projectId="p" runId="r" minCases={20} onUse={onUse} /></DialogContent></Dialog></QueryClientProvider>);
  return { onUse, requests, user: userEvent.setup() };
}
describe("grouping builder", () => {
  it("previews a suggested grouping before applying and declares scope", async () => {
    const { user, onUse, requests } = setup();
    expect(screen.getByRole("button", { name: "Use this grouping" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Company only/ }));
    await user.click(screen.getByRole("button", { name: "Preview group sizes" }));
    expect(await screen.findByRole("status")).toHaveTextContent("3 groups · 1 below 20");
    expect(screen.getByText(/before any additional screen filters/)).toBeInTheDocument();
    expect(requests[0]?.searchParams.get("slicing")).toBe("company");
    await user.click(screen.getByRole("button", { name: "Use this grouping" }));
    expect(onUse).toHaveBeenCalledWith({ attributes: ["company"], bands: [] }, "Company only");
  });
  it("combines attributes, validates cuts, invalidates an earlier preview after edits", async () => {
    const { user, onUse, requests } = setup();
    await user.click(screen.getByRole("button", { name: /Company only/ }));
    await user.click(screen.getByRole("button", { name: "Add another attribute" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Band method for exposure" }), "cuts");
    const cuts = screen.getByRole("textbox", { name: "Cut points for exposure" });
    await user.type(cuts, "1000, 500");
    expect(cuts).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Preview group sizes" })).toBeDisabled();
    await user.clear(cuts); await user.type(cuts, "1000, 10000");
    await user.click(screen.getByRole("button", { name: "Preview group sizes" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use this grouping" })).toBeEnabled());
    expect(JSON.parse(requests[0]!.searchParams.get("bands")!)).toEqual([{ attribute: "exposure", method: "cuts", cuts: [1000, 10000] }]);
    await user.type(cuts, "0");
    expect(screen.getByRole("button", { name: "Use this grouping" })).toBeDisabled();
    expect(onUse).not.toHaveBeenCalled();
  });
  it("can group numeric identifiers by exact value without inventing bands", async () => {
    const { user, requests } = setup();
    await user.click(screen.getByRole("button", { name: /Company only/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Group attribute 1" }), "exposure");
    await user.selectOptions(screen.getByRole("combobox", { name: "Band method for exposure" }), "exact");
    await user.click(screen.getByRole("button", { name: "Preview group sizes" }));
    await screen.findByRole("status");
    expect(requests[0]?.searchParams.get("slicing")).toBe("exposure");
    expect(requests[0]?.searchParams.has("bands")).toBe(false);
  });
  it("does not allow an unsuccessful preview to be applied", async () => {
    const { user, onUse } = setup();
    server.use(http.get("*/projects/p/runs/r/slicings/preview", () => HttpResponse.json({ detail: "Unknown attribute" }, { status: 422 })));
    await user.click(screen.getByRole("button", { name: /Company only/ }));
    await user.click(screen.getByRole("button", { name: "Preview group sizes" }));
    await screen.findByText("Unknown attribute");
    expect(screen.getByRole("button", { name: "Use this grouping" })).toBeDisabled();
    expect(onUse).not.toHaveBeenCalled();
  });
});
describe("shareable grouping definitions", () => {
  it("keeps band boundaries with the slicing across navigation and readable labels", () => {
    const token = groupingToken({ attributes: ["case Company", "exposure"], bands: [{ attribute: "exposure", method: "cuts", cuts: [1000, 10000] }] });
    expect(groupingAttributes(token)).toEqual(["case Company", "exposure"]);
    expect(groupingLabel(token)).toBe("Company × exposure (custom bands)");
  });
  it.each(["", "10,", "10,10", "20,10", "Infinity", "no"])('rejects invalid custom boundaries %s', (value) => expect(cutPoints(value)).toBeUndefined());
  it("accepts signed finite ascending boundaries", () => expect(cutPoints("-10, 0, 100.5")).toEqual([-10, 0, 100.5]));
});
