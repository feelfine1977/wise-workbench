/**
 * R3-12 — an error state that ends.
 *
 * A pasted address whose filter carries a clause this run does not know is refused by the server in eleven
 * milliseconds. Cycle 3 found the three screens that read a filter from the address — the Flow step, the
 * board and the reason screen — still on *Loading…* with *all flows · – cases* beside it, indefinitely. Each
 * of them must now end on one sentence in the reader's words with one way out, and never print a status code
 * as its message.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const RUN = "/p/p2p2018/runs/run_41";
const CSA = encodeURIComponent("case Company+case Spend area text");
const PACKAGING = encodeURIComponent('["companyID_0000", "Packaging"]');
/** A filter of a kind no run understands — what a pasted address from another release looks like. */
const UNKNOWN = encodeURIComponent(JSON.stringify({ and: [{ kind: "resource_pool", pool: "night shift" }] }));

/** The one sentence, and nothing a reader cannot act on. */
async function expectsOneSentenceWithAWayOut(where: string) {
  const alert = await screen.findByRole("alert", {}, T);
  const sentence = within(alert).getByTestId("error-sentence");
  expect(sentence, `${where} says nothing about the filter`).toHaveTextContent(/This link carries a filter this run does not understand/);
  // never a status code as the message a reader reads
  expect(alert.textContent ?? "").not.toMatch(/\b(4\d\d|5\d\d)\b/);
  // and one way out, not a wall of retries
  expect(within(alert).getAllByRole("button").length).toBeGreaterThan(0);
  return alert;
}

describe("a link whose filter this run does not understand (R3-12)", () => {
  it("the Flow step ends on the sentence and opens the run without the filter", async () => {
    const user = userEvent.setup();
    renderApp(`${RUN}/flow?slicing=${CSA}&view=Automation&filter=${UNKNOWN}`);
    const alert = await expectsOneSentenceWithAWayOut("the Flow step");
    // the way out works: the same run, without the filter, draws its map
    await user.click(within(alert).getByRole("button", { name: /Open the run without the filter/ }));
    // the way out works: the same run without the filter answers, and the screen is no longer an error
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), T);
    expect(await screen.findByText(/purchase order items/, {}, T)).toBeInTheDocument();
  });

  it("the reason screen ends on the sentence and opens the group without the filter", async () => {
    const user = userEvent.setup();
    renderApp(`${RUN}/slices/${PACKAGING}?slicing=${CSA}&view=Automation&tab=why&filter=${UNKNOWN}`);
    const alert = await expectsOneSentenceWithAWayOut("the reason screen");
    await user.click(within(alert).getByRole("button", { name: /Open this group without the filter/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), T);
    expect(await screen.findByTestId("why-strip", {}, T)).toBeInTheDocument();
  });

  it("the board says it once, with no numbers under a sentence that says it has none (P1-11)", async () => {
    renderApp(`${RUN}/board?slicing=${CSA}&view=Automation&filter=${UNKNOWN}`);
    const alerts = await screen.findAllByRole("alert", {}, T);
    // one board, one state: it was three identical alerts under four tiles that went on counting for ever
    expect(alerts).toHaveLength(1);
    const first = alerts[0] as HTMLElement;
    expect(within(first).getByTestId("error-sentence")).toHaveTextContent(/This link carries a filter this run does not understand/);
    expect(within(first).getByRole("button", { name: /Open the board without the filter/ })).toBeInTheDocument();
    // and no number is printed for a selection that could not be counted
    expect(screen.queryByTestId("kpi-tiles")).not.toBeInTheDocument();
    expect(screen.queryByTestId("count-line")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/are being counted/);
  });

  it("keeps the server's own words one click away, for the person who wants them", async () => {
    const user = userEvent.setup();
    renderApp(`${RUN}/flow?slicing=${CSA}&view=Automation&filter=${UNKNOWN}`);
    const alert = await screen.findByRole("alert", {}, T);
    await user.click(within(alert).getByText("what the server said"));
    expect(within(alert).getByText(/unknown clause kind/i)).toBeInTheDocument();
  });
});
