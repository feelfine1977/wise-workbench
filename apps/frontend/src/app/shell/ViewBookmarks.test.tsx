import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { renderApp } from "@/test/utils";
import { useViewPreference } from "@/lib/stores/viewPreference";

it("switches a scored view in place and preserves the selected filter", async () => {
  const user = userEvent.setup();
  renderApp("/p/p2p2018/runs/run_41/backlog?view=Finance&minCases=30");
  const views = await screen.findByRole("group", { name: "Choose a business view" });
  await user.click(within(views).getByRole("button", { name: "Automation" }));
  await waitFor(() => expect(screen.getByTestId("ranking-rule")).toHaveTextContent("Automation"));
  expect(within(views).getByRole("button", { name: "Automation" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent("at least 30");
});
it("hides view controls and palette commands on project setup even with an existing scored run", async () => {
  const user = userEvent.setup();
  renderApp("/p/p2p2018");
  await screen.findByRole("region", { name: "Project actions" });
  expect(screen.queryByRole("region", { name: "Business views" })).not.toBeInTheDocument();
  await user.keyboard("{Meta>}k{/Meta}");
  const palette = await screen.findByRole("dialog");
  expect(within(palette).queryByRole("option", { name: /^Switch (view|perspective) to/ })).not.toBeInTheDocument();
});


it("keeps a shared analysis preference while showing its controls only on norm structure", async () => {
  const user = userEvent.setup();
  renderApp("/p/p2p2018/runs/run_41/backlog?view=Automation");
  await waitFor(() => expect(useViewPreference.getState().byProject.p2p2018).toBe("Automation"));
  await user.click(screen.getByRole("link", { name: "Process norm" }));
  const constraints = await screen.findByRole("tab", { name: "Constraints" });
  expect(screen.queryByRole("region", { name: "Business views" })).not.toBeInTheDocument();
  expect(useViewPreference.getState().byProject.p2p2018).toBe("Automation");
  await user.keyboard("{Meta>}k{/Meta}");
  let palette = await screen.findByRole("dialog");
  expect(within(palette).queryByRole("option", { name: /^Switch (view|perspective) to/ })).not.toBeInTheDocument();
  await user.keyboard("{Escape}");

  await user.click(screen.getByRole("tab", { name: "Layers & views" }));
  const views = await screen.findByRole("group", { name: "Choose a business view" });
  expect(within(views).getByRole("button", { name: "Automation" })).toHaveAttribute("aria-pressed", "true");
  await user.keyboard("{Meta>}k{/Meta}");
  palette = await screen.findByRole("dialog");
  await user.click(within(palette).getByRole("option", { name: /^Switch (view|perspective) to Logistics/ }));
  await waitFor(() => expect(within(views).getByRole("button", { name: "Logistics" })).toHaveAttribute("aria-pressed", "true"));
  await user.click(constraints);
  await waitFor(() => expect(screen.queryByRole("region", { name: "Business views" })).not.toBeInTheDocument());
  expect(useViewPreference.getState().byProject.p2p2018).toBe("Logistics");
});

it("keeps Understand data free of view controls after leaving scored analysis", async () => {
  const user = userEvent.setup();
  renderApp("/p/p2p2018/runs/run_41/backlog?view=Automation");
  await screen.findByRole("group", { name: "Choose a business view" });
  await user.click(screen.getByRole("link", { name: "Understand data" }));
  await screen.findByRole("heading", { level: 1, name: /BPI_Challenge_2019/ });
  expect(screen.queryByRole("region", { name: "Business views" })).not.toBeInTheDocument();
  expect(useViewPreference.getState().byProject.p2p2018).toBe("Automation");
});

it("keeps the selected view when opening the ranked list from run results", async () => {
  renderApp("/p/p2p2018/runs/run_41?view=Automation");
  const link = await screen.findByRole("link", { name: "Open the ranked list" });
  expect(link).toHaveAttribute("href", expect.stringContaining("view=Automation"));
});
