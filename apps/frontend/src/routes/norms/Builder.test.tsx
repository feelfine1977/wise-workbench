import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";
import { applicabilitySentence, ruleSentence, thresholdOf, type Constraint } from "./Builder";

const T = { timeout: 8000 };
const PATH = "/p/p2p2018/norms/nv_7?tab=constraints";

const lag: Constraint = { id: "c_x", layer: "L3", type: "lag", params: { a: ["Record Goods Receipt"], b: ["Clear Invoice"], delta: 30, width: 90, unit: "D" } };

describe("the norm in the reader's words", () => {
  it("says the rule and who it applies to in sentences, never as parameters", () => {
    expect(ruleSentence(lag)).toBe("Clear Invoice follows Record Goods Receipt within 30 days, with 90 days of tolerance");
    expect(applicabilitySentence(lag, "purchase order items")).toBe("Applies to every one of these purchase order items.");
    expect(applicabilitySentence({ ...lag, applicability: { flow_types: ["standard"] } }, "items")).toBe("Applies to standard flows.");
    expect(applicabilitySentence(lag, "items", { excluded: true, note: "this extract has no invoice events" })).toBe(
      "Not applicable to this log — this extract has no invoice events.",
    );
    expect(thresholdOf(lag)).toEqual({ threshold: 30, width: 90, keys: ["delta", "width"] });
    expect(thresholdOf({ ...lag, type: "presence" })).toBeUndefined();
  });
});

describe("the norm builder (R3-02, R3-O6)", () => {
  it("leads with the plain name and the rule, keeps the id in the tooltip and flags the thresholds to calibrate", async () => {
    renderApp(PATH);
    const builder = await screen.findByTestId("norm-builder", {}, T);
    expect(within(builder).getByTestId("norm-sentence")).toBeInTheDocument();
    // no id and no release name is a primary label on this screen (R3-13)
    const catalogue = screen.getByRole("region", { name: /On time|Handovers|timeliness/i }) ?? builder;
    expect(catalogue).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/S3–S4|increment \d|cycle \d/i);
    expect(text).not.toMatch(/fingerprint/i);
    // an expectation whose threshold says more about the threshold than about the groups carries its chip
    await waitFor(() => expect(screen.getAllByTestId("calibration-chip").length).toBeGreaterThan(0), T);
  });

  it("edits a rule with pickers bound to this log's own activities and their counts", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await screen.findByTestId("norm-builder", {}, T);
    await user.click(screen.getByRole("button", { name: "the rule" }));
    const editor = await screen.findByTestId("rule-editor", {}, T);
    // the pickers list the log's activities with how many items carry them
    const picker = within(editor).getByRole("group", { name: "First this" });
    await user.type(within(picker).getByLabelText(/search the activities of this log/i), "goods receipt");
    // the choices are a listbox, so an activity already chosen and its "remove" chip never collide
    const option = await within(picker).findByRole("option", { name: /Record Goods Receipt/ }, T);
    expect(option).toHaveTextContent(/purchase order items/);
    // and the rule reads back as a sentence
    expect(within(editor).getByTestId("rule-sentence")).toBeInTheDocument();
  });

  it("marks an expectation not applicable to this log with a note, and asks for a reason and an owner before saving", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await screen.findByTestId("norm-builder", {}, T);
    await user.click(screen.getByRole("button", { name: "who it applies to" }));
    const editor = await screen.findByTestId("applicability-editor", {}, T);
    await user.click(within(editor).getByLabelText(/Not applicable to this log/));
    await user.type(screen.getByLabelText(/why \(required\)/), "no invoice events in this extract");
    await waitFor(() => expect(screen.getByTestId("applicability-sentence")).toHaveTextContent(/Not applicable to this log — no invoice events/), T);

    // a change does not leave the pane without a reason and an owner
    const save = screen.getByRole("button", { name: /Save as the next version/ });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(screen.getByLabelText(/why this change \(required\)/)).toHaveFocus();
    expect(screen.getByLabelText(/why this change \(required\)/)).toHaveAttribute("aria-invalid", "true");
    await user.type(screen.getByLabelText(/why this change \(required\)/), "the rule cannot be evaluated here");
    expect(screen.getByLabelText(/why this change \(required\)/)).not.toHaveAttribute("aria-invalid");
    await user.click(save);
    expect(screen.getByLabelText(/who owns it \(required\)/)).toHaveFocus();
    await user.type(screen.getByLabelText(/who owns it \(required\)/), "SD expert");
    expect(save).toBeEnabled();
  });

  it("offers an expectation of your own, in the areas the norm already has", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await screen.findByTestId("norm-builder", {}, T);
    await user.click(screen.getByTestId("add-expectation"));
    const form = await screen.findByTestId("new-expectation", {}, T);
    await user.type(within(form).getByLabelText(/what it is called/), "Shipped within the target time");
    await user.click(within(form).getByRole("button", { name: "Add it" }));
    await waitFor(() => expect(screen.getByTestId("norm-sentence")).toBeInTheDocument(), T);
    expect(screen.getByTestId("norm-builder")).toHaveTextContent(/Shipped within the target time/);
  });
});

describe("signing a norm version (R3-02, P1-9)", () => {
  it("moves a version out of draft under the name of the person who signs it", async () => {
    const user = userEvent.setup();
    renderApp("/p/p2p2018/norms");
    // the version list carries the control the endpoint has always had and no screen called
    const sign = await screen.findAllByRole("button", { name: /Mark reviewed/ }, T);
    await user.click(sign[0] as HTMLElement);
    const dialog = await screen.findByTestId("sign-norm", {}, T);
    const save = within(dialog).getByRole("button", { name: /Mark reviewed/ });
    // Attempting to sign explains the missing name and keeps the dialog open.
    expect(save).toBeEnabled();
    await user.click(save);
    expect(within(dialog).getByLabelText(/Who signs it/)).toHaveFocus();
    expect(within(dialog).getByLabelText(/Who signs it/)).toHaveAttribute("aria-invalid", "true");
    await user.type(within(dialog).getByLabelText(/Who signs it/), "U. Jessen, process owner");
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(screen.queryByTestId("sign-norm")).not.toBeInTheDocument(), T);
    // and the row says so
    expect((await screen.findAllByText(/reviewed/, {}, T)).length).toBeGreaterThan(0);
  });
});

it("describes lag tolerance as an offset and never as the saturation endpoint", () => {
  const c = { ...lag, params: { ...lag.params, delta: 12, width: 20 } };
  expect(ruleSentence(c)).toBe("Clear Invoice follows Record Goods Receipt within 12 days, with 20 days of tolerance");
  expect(ruleSentence(c)).not.toContain("tolerated to 20");
});
