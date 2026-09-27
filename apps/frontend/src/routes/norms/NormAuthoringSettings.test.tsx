import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { NormAuthoringSettings } from "./NormAuthoringSettings";
import { NORM_AUTHORING_PREFERENCES_KEY, useNormAuthoringPreferences } from "./useNormAuthoringPreferences";

function Consumer() {
  const { mode, allowDraftWithoutDecision } = useNormAuthoringPreferences();
  return <output data-testid="consumer">{mode}:{String(allowDraftWithoutDecision)}</output>;
}

it("starts with compact Guided settings, synchronizes editors, and restores the browser preference on remount", async () => {
  const user = userEvent.setup();
  const view = render(<><NormAuthoringSettings /><Consumer /></>);
  expect(screen.getByLabelText("Current norm settings")).toHaveTextContent("Guided · Reason / owner optional for drafts");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const dialog = screen.getByRole("dialog", { name: "Norm settings" });
  const skip = within(dialog).getByRole("checkbox", { name: "Skip reason and owner for draft saves" });
  expect(skip).toBeChecked();
  await user.click(skip);
  expect(screen.getByTestId("consumer")).toHaveTextContent("guided:false");
  expect(JSON.parse(localStorage.getItem(NORM_AUTHORING_PREFERENCES_KEY)!)).toEqual({ mode: "guided", skipReasonOwner: false });
  await expectNoSeriousA11yViolations(dialog);
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
  view.unmount();
  render(<><NormAuthoringSettings /><Consumer /></>);
  expect(screen.getByTestId("consumer")).toHaveTextContent("guided:false");
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("checkbox", { name: "Skip reason and owner for draft saves" })).not.toBeChecked();
});

it("keeps the Guided skip preference while Expert always requires decisions, including after reload", async () => {
  const user = userEvent.setup(); const view = render(<><NormAuthoringSettings /><Consumer /></>);
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.selectOptions(screen.getByLabelText("Authoring mode"), "expert");
  expect(screen.getByRole("checkbox", { name: "Skip reason and owner for draft saves" })).toBeDisabled();
  expect(screen.getByTestId("consumer")).toHaveTextContent("expert:false");
  view.unmount(); render(<><NormAuthoringSettings /><Consumer /></>);
  expect(screen.getByTestId("consumer")).toHaveTextContent("expert:false");
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.selectOptions(screen.getByLabelText("Authoring mode"), "guided");
  expect(screen.getByTestId("consumer")).toHaveTextContent("guided:true");
});

it.each(["broken json", '{"mode":"unknown","skipReasonOwner":"false"}', "null"])("handles invalid stored preferences (%s) and external storage changes", value => {
  localStorage.setItem(NORM_AUTHORING_PREFERENCES_KEY, value);
  render(<Consumer />);
  expect(screen.getByTestId("consumer")).toHaveTextContent("guided:true");
  act(() => {
    localStorage.setItem(NORM_AUTHORING_PREFERENCES_KEY, JSON.stringify({ mode: "expert", skipReasonOwner: true }));
    window.dispatchEvent(new StorageEvent("storage", { key: NORM_AUTHORING_PREFERENCES_KEY }));
  });
  expect(screen.getByTestId("consumer")).toHaveTextContent("expert:false");
});
