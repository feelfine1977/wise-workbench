import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { BacklogRow } from "@wise/api-schema";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFindingStore } from "@/lib/stores/findings";
import { DecisionPane } from "./DecisionPane";

const row: BacklogRow = { key: '["vendorID_0128"]', keys: { "case Vendor": "vendorID_0128" }, n_cases: 5254, mean_score: 0.662, gap: 0.18, stable_gap: 0.178, PI: 945.7, stable_PI: 936.8, rank: 1, hotspot_type: "reservoir", kind: "widespread", dominant_layer: "L3_timeliness_ageing", stability: "stable" };

describe("decision pane", () => {
  it("asks one question, What next?, needs a note for every answer, and keeps the kind override behind a disclosure", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <DecisionPane projectId="p" runId="run_41" slicing="case Vendor" row={row} missed="invoices cleared late" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId("decision-reading")).toHaveTextContent(/Reading:.*widespread.*invoices cleared late/);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    // the four answers in plain words; the method's names sit in the tooltips
    expect(screen.getByRole("radiogroup", { name: "What next?" })).toBeInTheDocument();
    for (const name of ["Investigate", "Defer", "Accept the shortfall", "Not a problem"]) expect(screen.getByRole("radio", { name })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Accept the shortfall" })).toHaveAttribute("title", expect.stringContaining("waive"));

    await user.click(screen.getByRole("radio", { name: "Investigate" }));
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("note *"), "goods-to-invoice lags; owner present");
    expect(save).toBeEnabled();
    await user.type(screen.getByLabelText("owner"), "purchasing lead");

    // overriding the computed kind is a decision too: it needs its own note
    await user.click(screen.getByText("Change the kind"));
    await user.click(screen.getByRole("radio", { name: /acute/ }));
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("why override *"), "small volume once header events are typed away");
    expect(save).toBeEnabled();

    await user.click(save);
    const finding = Object.values(useFindingStore.getState().findings)[0];
    expect(finding).toMatchObject({ key: '["vendorID_0128"]', disposition: "investigate", hotspotType: "severity", computedType: "reservoir", owner: "purchasing lead" });
    expect(screen.getByText(/Saved/)).toBeInTheDocument();
  });
});
