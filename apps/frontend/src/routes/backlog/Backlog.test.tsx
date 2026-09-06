import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/stores/ui";
import { label } from "@/lib/vocabulary";
import { verifiedBacklog } from "@/mocks/fixtures/verified";
import { renderApp } from "@/test/utils";

const BACKLOG = `/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Finance`;
const T = { timeout: 8000 };
const vendors = verifiedBacklog("case Vendor", "Finance")!.rows;
const first = vendors[0]!;
const firstLabel = JSON.parse(first.key)[0] as string;

describe("where is it worst: the signals list on the verified run", () => {
  beforeEach(() => useUiStore.getState().setVocabulary("plain"));

  it("opens on ranked sentence cards: one sentence, the priority bar, one Why? per card, filters behind Refine", async () => {
    renderApp(BACKLOG);
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const cards = within(list).getAllByRole("article");
    expect(cards).toHaveLength(10);
    const card = cards[0] as HTMLElement;
    expect(card).toHaveAccessibleName(`1. ${firstLabel}`);
    expect(within(card).getByTestId("card-sentence")).toHaveTextContent(new RegExp(`${first.n_cases.toLocaleString("en")} purchase order items`));
    expect(within(card).getByTestId("card-sentence")).toHaveTextContent(first.points_below as string);
    expect(within(card).getByTestId("card-sentence")).toHaveTextContent(/confidence not computed/);
    expect(within(card).getByRole("button", { name: `Why? ${firstLabel}` })).toBeInTheDocument();
    expect(within(list).getAllByRole("button", { name: /^Why\? / })).toHaveLength(10);
    // the reading sentence names what is ranked, in the run's words
    expect(screen.getByTestId("ranking-rule")).toHaveTextContent(/1,975 groups of purchase order items by Vendor/);
    expect(screen.getByTestId("ranking-rule")).toHaveTextContent(/γ = 20/);
    // the filters sit in the Refine drawer, not on the screen
    expect(screen.queryByText("Only groups with at least … cases")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Refine/ })).toBeInTheDocument();
    // one next step with its reason
    expect(screen.getByTestId("next-step")).toHaveTextContent(`Why? ${firstLabel}`);
    expect(screen.getByTestId("next-step")).toHaveTextContent(/because it carries/);
    // the how-to-read paragraph is open the first time and closes
    expect(screen.getByTestId("how-to-read")).toBeInTheDocument();
    // the illustrative badge is absent on a verified slicing
    expect(screen.queryByText("illustrative")).not.toBeInTheDocument();
  });

  it("the first click on Why? opens the reason screen (R2-O4), also on a card that was not active", async () => {
    const user = userEvent.setup();
    renderApp(BACKLOG);
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const cards = within(list).getAllByRole("article");
    const third = cards[2] as HTMLElement;
    const heading = within(third).getByRole("heading", { level: 3 }).textContent as string;
    expect(third).toHaveAttribute("data-active", "false");
    await user.click(within(third).getByRole("button", { name: `Why? ${heading}` }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(heading), T);
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
    // the Flow tab is the first and the selected one
    expect(screen.getByRole("tab", { name: "Where in the flow" })).toHaveAttribute("aria-selected", "true");
    // the back control returns to the signals list with its search params
    const back = screen.getByTestId("back-control");
    expect(back).toHaveTextContent("Back to Where is it worst?");
    await user.click(back);
    await screen.findByRole("list", { name: "Signals" }, T);
    expect(screen.getByTestId("ranking-rule")).toHaveTextContent(/Finance/);
  });

  it("keyboard: ↓ moves the active card, p pins it, ↵ opens Why?", async () => {
    const user = userEvent.setup();
    renderApp(BACKLOG);
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const cards = () => within(list).getAllByRole("article");
    (cards()[0] as HTMLElement).focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(cards()[1]).toHaveAttribute("data-active", "true"));
    expect(cards()[1]).toHaveAttribute("aria-current", "true");
    const label = within(cards()[1] as HTMLElement).getByRole("heading", { level: 3 }).textContent as string;
    await user.keyboard("p");
    expect(await screen.findByLabelText(`Pinned ${label}`)).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(label), T);
    expect(screen.getByRole("heading", { name: "Decision" })).toBeInTheDocument();
  });

  it("keeps filters in the URL as chips, accepts the method's hotspotType alias and sends the kind to the API", async () => {
    const user = userEvent.setup();
    renderApp(`${BACKLOG}&hotspotType=severity`);
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const acute = vendors.filter((r) => r.kind === "acute");
    await waitFor(() => expect(within(list).getAllByRole("article")).toHaveLength(acute.length));
    const only = within(list).getAllByRole("article")[0] as HTMLElement;
    expect(only).toHaveTextContent(JSON.parse(acute[0]!.key)[0] as string);
    expect(within(only).getByText("acute")).toBeInTheDocument();
    const chips = screen.getByRole("list", { name: "Active filters" });
    expect(chips).toHaveTextContent(/acute: few cases, far off/);
    await user.click(within(chips).getByRole("button", { name: /^Remove filter: acute/ }));
    await waitFor(() => expect(within(list).getAllByRole("article")).toHaveLength(10));
  });

  it("the Refine drawer holds the filter questions and the active ones show as chips", async () => {
    const user = userEvent.setup();
    renderApp(BACKLOG);
    await screen.findByRole("list", { name: "Signals" }, T);
    await user.click(screen.getByRole("button", { name: /^Refine/ }));
    const drawer = await screen.findByRole("dialog", { name: "Refine the list" });
    expect(within(drawer).getByText("Only groups with at least … cases")).toBeInTheDocument();
    expect(within(drawer).getByText("Only acute / systematic / widespread")).toBeInTheDocument();
    expect(within(drawer).getByText("Only high-confidence ranks")).toBeInTheDocument();
    await user.click(within(drawer).getByRole("checkbox", { name: /Only high-confidence ranks/ }));
    await user.keyboard("{Escape}");
    const chips = await screen.findByRole("list", { name: "Active filters" });
    expect(chips).toHaveTextContent(/high-confidence ranks only/);
  });

  it("drills into a group: a finer grouping restricted to the group's cases, with a chip to leave it", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Company+case Spend area text")}&view=Automation&minCases=1`);
    const list = await screen.findByRole("list", { name: "Signals" }, T);
    const packaging = within(list).getAllByRole("article")[0] as HTMLElement;
    await user.click(within(packaging).getByRole("button", { name: /^More about/ }));
    await user.click(within(packaging).getByRole("button", { name: "Drill into this group" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Active filters" })).toHaveTextContent(/inside companyID_0000 × Packaging/), T);
    await waitFor(() => expect(screen.getByTestId("ranking-rule")).toHaveTextContent(/by Vendor inside companyID_0000 × Packaging/), T);
    const drilled = within(screen.getByRole("list", { name: "Signals" })).getAllByRole("article");
    expect(drilled[0]).toHaveTextContent("vendorID_0136");
    expect(drilled[0]).toHaveTextContent(/14,369 purchase order items/);
  });

  it("the Table tab keeps the library's columns: plain headers first, the method's names when the vocabulary is switched", async () => {
    renderApp(`${BACKLOG}&tab=table`);
    const grid = await screen.findByRole("grid", { name: "Backlog" }, T);
    expect(within(grid).getByRole("columnheader", { name: /^cases/ })).toBeInTheDocument();
    expect(within(grid).getByRole("columnheader", { name: /^priority, small groups discounted/ })).toBeInTheDocument();
    expect(within(grid).getAllByRole("row").length).toBeGreaterThan(5);
    expect(within(grid).getByText(firstLabel)).toBeInTheDocument();
    expect(within(grid).getAllByText(/reservoir|severity|mechanism/).length).toBeGreaterThan(0);
    act(() => useUiStore.getState().setVocabulary("method"));
    for (const col of ["n_cases", "mean_score", "gap", "stable_gap", "PI", "stable_PI"]) {
      const header = label(col, "method").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(await within(grid).findByRole("columnheader", { name: new RegExp(`^${header}(?!\\w)`) })).toBeInTheDocument();
    }
  });

  it("the table's slice link opens the reason screen on the first click of a non-active row (R2-O4)", async () => {
    const user = userEvent.setup();
    renderApp(`${BACKLOG}&tab=table`);
    const grid = await screen.findByRole("grid", { name: "Backlog" }, T);
    const rows = within(grid).getAllByRole("row");
    const row = rows[3] as HTMLElement;
    expect(row).toHaveAttribute("data-active", "false");
    const link = within(row).getByRole("link");
    const name = link.textContent as string;
    await user.click(link);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(name), T);
  });

  it("marks illustrative slicings and hides the badge on verified ones", async () => {
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Item Type")}&view=Finance`);
    await screen.findByRole("list", { name: "Signals" }, T);
    expect(await screen.findByText("illustrative")).toBeInTheDocument();
  });
});
