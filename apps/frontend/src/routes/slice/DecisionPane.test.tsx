import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { BacklogRow } from "@wise/api-schema";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFindingStore } from "@/lib/stores/findings";
import { DecisionPane } from "./DecisionPane";

const row: BacklogRow = { key: '["vendorID_0128"]', keys: { "case Vendor": "vendorID_0128" }, n_cases: 5254, mean_score: 0.662, gap: 0.18, stable_gap: 0.178, PI: 945.7, stable_PI: 936.8, rank: 1, hotspot_type: "reservoir", kind: "widespread", dominant_layer: "L3_timeliness_ageing", stability: "stable" };

describe("decision pane", () => {
  it("asks for a note only on human decisions", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <DecisionPane projectId="p" runId="run_41" slicing="case Vendor" row={row} />
      </TooltipProvider>,
    );
    const save = screen.getByRole("button", { name: "Save finding" });
    expect(save).toBeDisabled();

    // owner alone is not a decision: no note asked
    await user.type(screen.getByLabelText("owner"), "purchasing lead");
    expect(save).toBeEnabled();
    expect(screen.queryByLabelText(/note \*/)).not.toBeInTheDocument();

    // a disposition is a decision: note required
    await user.click(screen.getByRole("radio", { name: "investigate" }));
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("note *"), "goods-to-invoice lags; owner present");
    expect(save).toBeEnabled();

    // overriding the computed type is a decision too
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
