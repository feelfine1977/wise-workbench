import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const NODE = "expectation:p2p_bpic19:c_l3_invoice_to_clear_days";

describe("the knowledge hub (R3-05, RK-3, RK-4)", () => {
  it("lists every node of the pack by kind and opens one as a page in the panel's template", async () => {
    const user = userEvent.setup();
    renderApp("/p/p2p2018/knowledge");
    await screen.findByTestId("hub-count", {}, T);
    // stages, expectation areas, expectations, failure modes and indicators each get their own block
    for (const kind of ["stage", "layer", "expectation", "failure_mode", "kpi"]) {
      expect(await screen.findByTestId(`hub-group-${kind}`, {}, T)).toBeInTheDocument();
    }
    // the plain name is the link, never the id
    const link = await screen.findByRole("link", { name: /^Paid within terms$/ }, T);
    expect(link.textContent).not.toMatch(/c_l3_/);
    await user.click(link);
    const page = await screen.findByTestId("hub-page", {}, T);
    // the template's blocks, in the panel's order
    expect(within(page).getByTestId("hub-expectation")).toBeInTheDocument();
    expect(within(page).getByTestId("hub-meaning")).toHaveTextContent(/waited longer than the target/);
    expect(within(page).getByTestId("hub-why")).toBeInTheDocument();
    expect(within(page).getByTestId("hub-detected")).toBeInTheDocument();
    expect(within(page).getByTestId("usual-reasons")).toHaveTextContent(/outside the log — ask/);
    expect(within(page).getByTestId("usual-actions")).toHaveTextContent(/accounts payable/);
    expect(within(page).getByTestId("hub-check-first")).toBeInTheDocument();
    expect(within(page).getByTestId("hub-related")).toHaveTextContent(/Invoice unpaid or paid late/);
  });

  it("searches over the plain and the method names", async () => {
    const user = userEvent.setup();
    renderApp("/p/p2p2018/knowledge");
    const count = await screen.findByTestId("hub-count", {}, T);
    // the node is live, so the count before the search is kept as a string
    const before = String(count.textContent);
    const all = Number(before.replace(/[^\d]/g, ""));
    expect(all).toBeGreaterThan(100);
    await user.type(screen.getByLabelText("Search the hub"), "paid");
    await waitFor(() => expect(screen.getByTestId("hub-count")).toHaveTextContent(/of .* pages match/), T);
    const matching = Number((screen.getByTestId("hub-count").textContent ?? "").replace(/[^\d]/g, "").slice(0, 2));
    expect(matching).toBeLessThan(all);
  });

  it("adds your organisation's note to the pack's text instead of replacing it", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/knowledge/${encodeURIComponent(NODE)}`);
    const page = await screen.findByTestId("hub-page", {}, T);
    const before = within(page).getByTestId("hub-meaning").textContent;
    await user.click(within(page).getByRole("button", { name: /Add your organisation's note/ }));
    await user.type(screen.getByLabelText(/In our company this usually means/), "Our terms are 60 days for the top five vendors.");
    await user.type(screen.getByLabelText(/Who is writing this/), "AP manager");
    await user.click(screen.getByRole("button", { name: /Save the note/ }));
    const overlay = await screen.findByTestId("hub-overlay", {}, T);
    await waitFor(() => expect(overlay).toHaveTextContent(/Our terms are 60 days/), T);
    expect(overlay).toHaveTextContent(/AP manager/);
    // the pack's own text is still there
    expect(screen.getByTestId("hub-meaning").textContent).toBe(before);
  });

  it("says so plainly when the pack has no page for a word, instead of a status code", async () => {
    renderApp("/p/p2p2018/knowledge/expectation:p2p_bpic19:nothing_like_this");
    expect(await screen.findByText(/There is no page for this word/, {}, T)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\b404\b/);
  });
});

describe("the What does this mean? chip (RK-4)", () => {
  it("opens the expectation's hub page over the reason screen without leaving it", async () => {
    const user = userEvent.setup();
    const key = encodeURIComponent('["companyID_0000", "Packaging"]');
    const slicing = encodeURIComponent("case Company+case Spend area text");
    renderApp(`/p/p2p2018/runs/run_41/slices/${key}?slicing=${slicing}&view=Automation&tab=why`);
    const drivers = await screen.findByTestId("top-drivers", {}, T);
    const chips = within(drivers).getAllByTestId("what-does-this-mean");
    expect(chips.length).toBeGreaterThanOrEqual(3);
    await user.click(chips[0] as HTMLElement);
    const panel = await screen.findByTestId("hub-panel", {}, T);
    await waitFor(() => expect(within(panel).getByTestId("hub-page")).toHaveTextContent(/Paid within terms/), T);
    // the screen behind it is still the reason screen
    expect(screen.getByTestId("why-sentence")).toBeInTheDocument();
  });
});
