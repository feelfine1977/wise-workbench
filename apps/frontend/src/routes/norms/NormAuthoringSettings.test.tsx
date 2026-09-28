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
  expect(JSON.parse(localStorage.getItem(NORM_AUTHORING_PREFERENCES_KEY)!)).toEqual({ mode: "guided", skipReasonOwner: false, advancedControls: false });
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


it("keeps advanced controls opt-in in Guided and always available in Expert", async () => {
  const user = userEvent.setup();
  function AdvancedConsumer() {
    const { showAdvancedControls } = useNormAuthoringPreferences();
    return showAdvancedControls ? <p>Advanced controls enabled</p> : <p>Simple controls</p>;
  }
  const view = render(<><NormAuthoringSettings /><AdvancedConsumer /></>);
  expect(screen.getByText("Simple controls")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  const advanced = screen.getByRole("checkbox", { name: "Show advanced rule and list controls" });
  expect(advanced).not.toBeChecked();
  await user.click(advanced);
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByText("Advanced controls enabled")).toBeVisible();
  view.unmount(); render(<><NormAuthoringSettings /><AdvancedConsumer /></>);
  expect(screen.getByText("Advanced controls enabled")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("checkbox", { name: "Show advanced rule and list controls" }));
  await user.selectOptions(screen.getByLabelText("Authoring mode"), "expert");
  expect(screen.getByRole("checkbox", { name: "Show advanced rule and list controls" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Show advanced rule and list controls" })).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Authoring mode"), "guided");
  expect(screen.getByRole("checkbox", { name: "Show advanced rule and list controls" })).not.toBeChecked();
});
