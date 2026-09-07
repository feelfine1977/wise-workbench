import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { buildBacklog } from "@/mocks/fixtures/backlog";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };
const SLICING_ID = "case Company+case Spend area text";
const SLICING = encodeURIComponent(SLICING_ID);
const KEY = encodeURIComponent('["companyID_0000", "Packaging"]');
const PATH = `/p/p2p2018/runs/run_41/slices/${KEY}/act?slicing=${SLICING}&view=Automation`;

describe("What can we do? — the seventh step (R3-01)", () => {
  it("lists the drivers with their headroom, their reasons split in and outside the log, and their actions with an owner role", async () => {
    renderApp(PATH);
    const cards = await screen.findAllByTestId("driver-card", {}, T);
    expect(cards.length).toBeGreaterThanOrEqual(3);

    const first = cards[0] as HTMLElement;
    // the expectation in plain words, never its id
    expect(first).toHaveTextContent(/Paid within terms/);
    expect(first.textContent).not.toMatch(/c_l3_invoice_to_clear_days/);
    // the share of the shortfall and the headroom in score points
    expect(within(first).getByTestId("driver-reading")).toHaveTextContent(/93\s?% of the shortfall/);
    expect(within(first).getByTestId("headroom")).toHaveTextContent(/4\.3\d? points of possible gain/);
    // the reasons say what the log can show and whom to ask when it cannot
    const reasons = within(first).getByTestId("driver-reasons");
    expect(reasons).toHaveTextContent(/in the log — check/);
    expect(reasons).toHaveTextContent(/outside the log — ask/);
    // the actions carry a countermeasure type and a role
    expect(within(first).getAllByTestId("action-owner")[0]).toHaveTextContent(/measurement · finance controlling/);
    // what to check first
    expect(first).toHaveTextContent(/What to check first/);
    // every driver carries a chip that opens its hub page
    expect(within(first).getAllByTestId("what-does-this-mean").length).toBeGreaterThan(0);
  });

  it("refuses a hypothesis while a check on this group has no reading, and records it once the check is waived", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await screen.findAllByTestId("driver-card", {}, T);

    // Packaging's censoring share is 14 %: below the warning, so no check of this group blocks
    await screen.findByTestId("hypothesis-form", {}, T);
    await waitFor(() => expect(screen.queryByTestId("hypothesis-blocked")).not.toBeInTheDocument(), T);

    // the run-wide readiness reading is stated once, at the run, and never asks for a waiver here
    const readiness = await screen.findByTestId("gate-readiness", {}, T);
    expect(readiness).toHaveTextContent(/one reading for the whole run/);
    expect(within(readiness).queryByRole("button", { name: /Decide/ })).not.toBeInTheDocument();

    // marking a reason to test fills the statement and names its expectation
    await user.click(within(screen.getAllByTestId("driver-card")[0] as HTMLElement).getAllByRole("button", { name: "Mark to test" })[0] as HTMLElement);
    await waitFor(() => expect((within(screen.getByTestId("hypothesis-form")).getByLabelText(/your own words/) as HTMLTextAreaElement).value).toMatch(/Contractual terms/), T);

    // the form is rebuilt around the marked reason, so it is looked up again here
    const form = screen.getByTestId("hypothesis-form");
    await user.type(within(form).getByLabelText(/Who is recording it/), "SD expert");
    await user.click(within(form).getByRole("button", { name: /Record the hypothesis/ }));
    // the record survives on the server and lists under Open findings
    expect(await within(await screen.findByTestId("open-findings", {}, T)).findByText(/Contractual terms/, {}, T)).toBeInTheDocument();
  });

  it("saves a proposed action with its owner role under Open findings, in a form that opens where it was asked for", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    const cards = await screen.findAllByTestId("driver-card", {}, T);
    await user.click(within(cards[0] as HTMLElement).getAllByRole("button", { name: "Propose this action" })[0] as HTMLElement);
    const form = await screen.findByTestId("action-form", {}, T);
    // P1-7: the form is inside the driver whose action was pressed, not at the foot of the page 1,952 px below
    expect((cards[0] as HTMLElement).contains(form)).toBe(true);
    expect(document.activeElement).toBe(within(form).getByLabelText(/What should be done/));
    expect((within(form).getByLabelText(/What should be done/) as HTMLTextAreaElement).value).toMatch(/Payment terms per vendor/);
    await user.type(within(form).getByLabelText(/Who is proposing it/), "process owner");
    await user.click(within(form).getByRole("button", { name: /Save the proposal/ }));
    const findings = await screen.findByTestId("open-findings", {}, T);
    expect(await within(findings).findByText(/Payment terms per vendor/, {}, T)).toBeInTheDocument();
    expect(findings).toHaveTextContent(/finance controlling/);
  });

  it("puts what was proposed on the dashboard, from the server rather than from this browser (P1-6)", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    const cards = await screen.findAllByTestId("driver-card", {}, T);
    await user.click(within(cards[0] as HTMLElement).getAllByRole("button", { name: "Propose this action" })[0] as HTMLElement);
    const form = await screen.findByTestId("action-form", {}, T);
    await user.type(within(form).getByLabelText(/Who is proposing it/), "process owner");
    await user.click(within(form).getByRole("button", { name: /Save the proposal/ }));
    await waitFor(() => expect(screen.getByTestId("open-findings")).toHaveTextContent(/Payment terms per vendor/), T);

    // the dashboard reads the same records: it read a browser-local list and said "No finding yet" while the
    // server held the action
    cleanup();
    renderApp("/p/p2p2018");
    const records = await screen.findByTestId("open-records", {}, T);
    expect(records).toHaveTextContent(/Payment terms per vendor/);
    expect(records).toHaveTextContent(/finance controlling/);
    expect(records).toHaveTextContent(/process owner/);
    expect(document.body.textContent ?? "").not.toMatch(/No finding yet/);
  });

  it("names a group that is ranked below the first page in words, not as its key", async () => {
    // the screen reads the names from the first page of the ranked list; a group below it used to fall back to
    // the key itself, so the heading read ["companyID_0003","Real Estate"]
    const { rows } = buildBacklog(SLICING_ID, "Automation", 20, 1);
    const ranked = [...rows].sort((a, b) => b.stable_PI - a.stable_PI);
    expect(ranked.length, "the mocked run has more than sixteen groups").toBeGreaterThan(15);
    const below = ranked[15]!;
    const values = Object.values(below.keys ?? {});
    renderApp(`/p/p2p2018/runs/run_41/slices/${encodeURIComponent(below.key)}/act?slicing=${SLICING}&view=Automation`);

    const heading = await screen.findByRole("heading", { level: 1 }, T);
    expect(heading).toHaveTextContent(values[values.length - 1] as string);
    expect(heading.textContent ?? "").not.toMatch(/[[\]"]/);
  });

  it("prints no status code, no raw id and no release name", async () => {
    renderApp(PATH);
    await screen.findAllByTestId("driver-card", {}, T);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\b(404|422|500)\b/);
    expect(text).not.toMatch(/cycle \d|increment \d/i);
    expect(text).not.toMatch(/\bc_l\d_/);
    // a numeric group key never keeps a float tail (R3-08)
    expect(text).not.toMatch(/\b\d{3,}\.0\b/);
  });
});
