import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/test/utils";

const T = { timeout: 8000 };

describe("the analysis notebook (R2-O11)", () => {
  it("freezes a screen with a title and a note, lists it, edits the note, reorders and offers the export", async () => {
    const user = userEvent.setup();
    renderApp(`/p/p2p2018/runs/run_41/backlog?slicing=${encodeURIComponent("case Vendor")}&view=Finance`);
    await screen.findByRole("list", { name: "Signals" }, T);
    await user.click(screen.getByRole("button", { name: /^Freeze this screen into the notebook/ }));
    const dialog = await screen.findByRole("dialog", { name: "Freeze this screen" });
    expect(within(dialog).getByLabelText("title")).toHaveValue("Where is it worst? · Vendor · Finance");
    await user.type(within(dialog).getByLabelText("note"), "vendorID_0136 carries the largest shortfall");
    await user.click(within(dialog).getByRole("button", { name: "Freeze" }));
    const status = (await screen.findByText(/^Frozen/, {}, T)).closest("[role=status]") as HTMLElement;
    await user.click(within(status).getByRole("link", { name: "open the notebook" }));
    await screen.findByRole("heading", { level: 1, name: "Analysis notebook" }, T);
    const snapshots = await screen.findByRole("list", { name: "Snapshots" }, T);
    expect(within(snapshots).getAllByRole("listitem")).toHaveLength(1);
    expect(snapshots).toHaveTextContent("Where is it worst? · Vendor · Finance");
    expect(snapshots).toHaveTextContent("vendorID_0136 carries the largest shortfall");
    expect(snapshots).toHaveTextContent(/signals/);
    expect(snapshots).toHaveTextContent(/run_41/);
    await user.click(within(snapshots).getByRole("button", { name: "Edit the note" }));
    const note = within(snapshots).getByLabelText("Snapshot note");
    await user.clear(note);
    await user.type(note, "edited");
    await user.click(within(snapshots).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(snapshots).toHaveTextContent("edited"));
    expect(screen.getByRole("link", { name: /Export as Markdown/ })).toHaveAttribute("href", expect.stringContaining("/notebook/export?format=markdown"));
    // the frozen screen can be reopened where it was
    await user.click(within(snapshots).getByRole("button", { name: "Go to this screen" }));
    await screen.findByRole("list", { name: "Signals" }, T);
  });
});
