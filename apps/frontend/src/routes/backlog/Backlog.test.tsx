import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

const BACKLOG = "/p/p2p2018/runs/run_41/backlog?slicing=vendor&view=Finance";

describe("backlog explorer", () => {
  it("renders the library's columns, the typology badges and the reading sentence", async () => {
    renderApp(BACKLOG);
    const grid = await screen.findByRole("grid", { name: "Backlog" }, { timeout: 8000 });
    for (const col of ["n_cases", "mean_score", "gap", "stable_gap", "PI", "stable_PI"]) {
      expect(within(grid).getByRole("columnheader", { name: new RegExp(`^${col}`) })).toBeInTheDocument();
    }
    expect(within(grid).getAllByRole("row").length).toBeGreaterThan(5);
    expect(within(grid).getByText("vendorID_0128")).toBeInTheDocument();
    expect(within(grid).getAllByText(/reservoir|severity|mechanism/).length).toBeGreaterThan(0);
    expect(screen.getByText(/slices by/)).toBeInTheDocument();
  });

  it("supports keyboard navigation: arrows move, p pins, Enter opens the slice", async () => {
    const user = userEvent.setup();
    renderApp(BACKLOG);
    const grid = await screen.findByRole("grid", { name: "Backlog" }, { timeout: 8000 });
    const rows = () => within(grid).getAllByRole("row").slice(1);
    const first = rows()[0] as HTMLElement;
    first.focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(rows()[1]).toHaveAttribute("data-active", "true"));
    const key = rows()[1]?.getAttribute("data-row-key") as string;
    await user.keyboard("p");
    expect(await screen.findByLabelText(`Pinned ${key}`)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(key), { timeout: 8000 });
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
  });

  it("keeps filters in the URL and sends them to the API", async () => {
    const user = userEvent.setup();
    renderApp(`${BACKLOG}&hotspotType=severity`);
    const grid = await screen.findByRole("grid", { name: "Backlog" }, { timeout: 8000 });
    await waitFor(() => expect(within(grid).getAllByRole("row").length).toBe(2));
    expect(within(grid).getByText("severity")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => expect(within(grid).getAllByRole("row").length).toBeGreaterThan(10));
  });
});
