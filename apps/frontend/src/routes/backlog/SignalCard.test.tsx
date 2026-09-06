import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogRow } from "@wise/api-schema";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUiStore } from "@/lib/stores/ui";
import { verifiedBacklog } from "@/mocks/fixtures/verified";
import { SignalCard, distanceSentence } from "./SignalCard";

/** Packaging in run run_0mtoq44vd14f208ur (company × spend area, Automation, γ = 20): the paper's Table XI row as the API serves it. */
const packaging = verifiedBacklog("case Company+case Spend area text", "Automation")!.rows[0] as BacklogRow;

function renderCard(props: Partial<ComponentProps<typeof SignalCard>> = {}) {
  const onWhy = vi.fn();
  render(
    <TooltipProvider>
      <SignalCard row={packaging} maxPI={1000} view="Automation" onWhy={onWhy} {...props} />
    </TooltipProvider>,
  );
  return { onWhy };
}

describe("signal card", () => {
  beforeEach(() => useUiStore.getState().setVocabulary("plain"));

  it("one sentence with three numbers — items, the share below expectation, the most-missed expectation with its share — then the comparison and the strip", async () => {
    const user = userEvent.setup();
    const { onWhy } = renderCard({ label: "Packaging" });
    const card = screen.getByRole("article", { name: "1. Packaging" });
    expect(within(card).getByRole("heading", { level: 3 })).toHaveTextContent("Packaging");
    const sentence = within(card).getByTestId("card-sentence");
    expect(sentence).toHaveTextContent(/^109,199 purchase order items · 0\.9 % below expectation · waiting too long between steps in 97\s?% of them\.$/);
    expect(sentence.textContent?.match(/\d[\d,.]*/g)?.length).toBe(3);
    // the real-unit comparison as a muted line
    expect(within(card).getByTestId("card-reason")).toHaveTextContent(/^Paid within terms: 83 days here against 55 elsewhere \(\+25 days\)\.$/);
    // the kind carries its glyph; the method's name stays hidden in plain mode
    const kind = within(card).getByText("widespread").closest("[data-kind]") as HTMLElement;
    expect(kind).toHaveAttribute("data-kind", "widespread");
    expect(kind.textContent).toContain("●");
    expect(within(kind).queryByText("reservoir")).not.toBeInTheDocument();
    // the strip: priority as a whole number, the confidence word, at most one caveat chip
    expect(within(card).getByTestId("card-strip")).toHaveTextContent(/^priority 946 · confidence high$/);
    expect(within(card).getByRole("list", { name: "Data caveats for this group" }).querySelectorAll("li")).toHaveLength(1);
    expect(card).not.toHaveTextContent(/of 30/);
    // no method term, no constraint id, no points sentence on the card
    expect(card).not.toHaveTextContent(/c_l3_invoice_to_clear_days|stable PI|hotspot|points below/);
    expect(within(card).getByRole("meter", { name: /^priority 945\.7 of 1,000\.0/ })).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "More about Packaging" }));
    const more = within(card).getByTestId("card-more");
    expect(more).toHaveTextContent(/0\.9 points below the overall score of 84\.4 \(1 %\)/);
    expect(more).toHaveTextContent(/945\.7/);
    expect(more).toHaveTextContent(/rank 1 of 30/);
    expect(more).toHaveTextContent(/P\(stays in top-10\) = 1\.00/);
    expect(more).toHaveTextContent(/83\.6\s?% of the rules met/);
    expect(more).toHaveTextContent(/On time/);
    // the reading sentence agrees with the card's confidence word
    expect(more).toHaveTextContent(/confidence in rank: high/);
    expect(more).not.toHaveTextContent(/not computed/);
    await user.click(within(card).getByRole("button", { name: "Why? Packaging" }));
    expect(onWhy).toHaveBeenCalledWith(packaging.key);
  });

  it("the method's terms first when the vocabulary is switched, ids visible", async () => {
    const user = userEvent.setup();
    useUiStore.getState().setVocabulary("method");
    renderCard();
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent(/109,199 n_cases/);
    expect(card).toHaveTextContent(/gap 0\.0087/);
    expect(card).toHaveTextContent(/Handovers and ageing/);
    const kind = within(card).getByText("reservoir").closest("[data-kind]") as HTMLElement;
    expect(kind).toHaveAttribute("data-hotspot", "reservoir");
    expect(within(kind).getByText("widespread")).toBeInTheDocument();
    expect(card).toHaveTextContent(/stability stable/);
    expect(within(card).getByRole("meter", { name: /^PI 945\.7/ })).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: /^More about/ }));
    expect(within(card).getByTestId("card-more")).toHaveTextContent(/c_l3_invoice_to_clear_days/);
  });

  it("a group at or above expectation says so and has no kind yet", () => {
    renderCard({ row: { ...packaging, gap: 0, stable_gap: 0, PI: 0, stable_PI: 0, hotspot_type: null, kind: null, kind_reading: null, dominant_layer: null, dominant_layer_name: null, top_constraint_description: null, comparison: null, points_below: null, rank: 30 } });
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent(/at or above the overall score/);
    expect(within(card).getByLabelText("no kind of problem yet")).toBeInTheDocument();
    expect(within(card).getByRole("meter")).toHaveAttribute("aria-valuenow", "0");
  });

  it("falls back to the number rule when the backend has no points sentence", () => {
    expect(distanceSentence({ gap: 0.128, global_mean: 0.842, mean_score: 0.714 }, true)).toMatch(/^12\.8 points below the overall score of 84\.2 \(15\s?%\)$/);
    expect(distanceSentence({ gap: 0.128, global_mean: 0.842, mean_score: 0.714, points_below: "served" }, true)).toBe("served");
    expect(distanceSentence({ gap: 0.128, global_mean: 0.842, mean_score: 0.714 }, false)).toMatch(/^gap 0\.1280/);
  });

  it("prints the backend's comparison as served, also when it says there is no material difference", () => {
    renderCard({ row: { ...packaging, comparison: "Mostly automatic: a manual share of 83 % here against 80 % elsewhere (+3.3 points).", comparison_kind: "metric", top_constraint_plain: "Mostly automatic" } });
    expect(screen.getByTestId("card-reason")).toHaveTextContent(/^Mostly automatic: a manual share of 83 % here against 80 % elsewhere \(\+3\.3 points\)\.$/);
    cleanup();
    renderCard({ row: { ...packaging, comparison: "No material difference on the top expectation (Few manual touches).", comparison_kind: "none", top_constraint_plain: "Few manual touches" } });
    expect(screen.getByTestId("card-reason")).toHaveTextContent(/^No material difference on the top expectation \(Few manual touches\)\.$/);
    cleanup();
    renderCard({ row: { ...packaging, comparison: null, comparison_kind: null } });
    expect(screen.queryByTestId("card-reason")).not.toBeInTheDocument();
  });

  it("the case noun replaces \"cases\" and the drill button appears behind more", async () => {
    const user = userEvent.setup();
    const onDrill = vi.fn();
    renderCard({ row: { ...packaging, case_noun: null }, caseNoun: "sales order items", onDrill });
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent(/109,199 sales order items/);
    await user.click(within(card).getByRole("button", { name: /^More about/ }));
    await user.click(within(card).getByRole("button", { name: "Drill into this group" }));
    expect(onDrill).toHaveBeenCalledWith(packaging.key);
  });
});
