import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { verifiedSlice, VERIFIED_PACKAGING_KEY } from "@/mocks/fixtures/verified";
import { tableRecords } from "@/lib/utils";
import { expectNoSeriousA11yViolations } from "@/test/utils";
import { GainExplanation, GainScenario } from "./GainExplanation";

describe("Gain semantics", () => {
  it("shows BPIC19's actual mean increasing below 100 while its priority reduction reaches 100%", async () => {
    const detail = verifiedSlice(VERIFIED_PACKAGING_KEY, "Automation")!;
    const gains = tableRecords<{ plain: string; gain_points: number; gain_percent: number }>(detail.headroom);
    const gain = gains[0]!;
    const { container } = render(<GainScenario name={gain.plain} meanScore={detail.row.mean_score} points={gain.gain_points} priorityPercent={gain.gain_percent} meter />);

    expect(screen.getByTestId("gain-scenario")).toHaveTextContent(/Mean WISE score \(0–100\): 83\.6 now.*87\.9 in this scenario/);
    const meter = screen.getByRole("meter", { name: "Priority reduction for Paid within terms" });
    expect(meter).toHaveAttribute("aria-valuenow", "100");
    expect(meter).toHaveAttribute("aria-valuetext", "100% of current priority");
    // This fixture captures the analytics identity: score gains add, capped priority shares do not.
    expect(gains.reduce((sum, row) => sum + row.gain_points, 0)).toBeCloseTo(100 * (1 - detail.row.mean_score), 4);
    expect(gains.reduce((sum, row) => sum + row.gain_percent, 0)).toBeGreaterThan(100);
    await expectNoSeriousA11yViolations(container);
  });

  it.each([null, undefined, Number.NaN])("does not turn an unavailable priority share (%s) into a zero meter", (priorityPercent) => {
    render(<GainScenario name="Paid within terms" meanScore={0.835697} points={4.339486} priorityPercent={priorityPercent} meter />);
    expect(screen.getByTestId("gain-scenario")).toHaveTextContent("Priority reduction: unavailable.");
    expect(screen.getByTestId("gain-scenario")).toHaveTextContent("87.9 in this scenario");
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("keeps measured zero distinct from unavailable and draws no positive bar", () => {
    render(<GainScenario name="Already met" meanScore={1} points={0} priorityPercent={0} meter />);
    expect(screen.getByTestId("gain-scenario")).toHaveTextContent(/100\.0 now.*100\.0 in this scenario/);
    expect(screen.getByTestId("gain-scenario")).toHaveTextContent("Priority reduction: 0% of current priority.");
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(meter.firstElementChild).toHaveStyle({ width: "0%" });
  });

  it("does not round a partial priority reduction up to 100%", () => {
    render(<GainScenario name="Nearly enough" points={4} priorityPercent={99.9} meter />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuetext", "99.90% of current priority");
  });

  it.each([null, undefined, Number.NaN])("omits the current-to-scenario example when this group's mean is unavailable (%s)", (meanScore) => {
    render(<GainScenario name="Paid within terms" meanScore={meanScore} points={4.339486} priorityPercent={100} />);
    expect(screen.queryByText(/Mean WISE score/)).not.toBeInTheDocument();
    expect(screen.getByTestId("gain-scenario")).toHaveTextContent("Priority reduction: 100% of current priority.");
  });

  it("uses a measured zero mean rather than treating it as absent", () => {
    render(<GainScenario name="Constraint" meanScore={0} points={4.3} />);
    expect(screen.getByTestId("gain-scenario")).toHaveTextContent(/0\.0 now.*4\.3 in this scenario/);
  });

  it("makes the calculation disclosure focusable and expandable and names the whole-group scope", async () => {
    const user = userEvent.setup();
    const { container } = render(<GainExplanation view="Automation" wholeGroup />);
    const summary = screen.getByText("How gain is calculated");
    const disclosure = summary.closest("details")!;
    expect(disclosure).not.toHaveAttribute("open");
    expect(container).toHaveTextContent("score points, not priority units, money or days saved");
    expect(container).toHaveTextContent("ceiling under the norm, not a forecast of an action’s effect");
    expect(container).toHaveTextContent("Gains describe the whole group");
    await user.tab();
    expect(summary).toHaveFocus();
    // jsdom does not implement the native summary keyboard default action; check expansion by click.
    await user.click(summary);
    expect(disclosure).toHaveAttribute("open");
    expect(disclosure).toHaveTextContent("Automation view’s layer and constraint weights, effective weights, applicability and missing evaluations stay fixed");
    expect(disclosure).toHaveTextContent("Score-point gains for distinct constraints add up");
    expect(disclosure).toHaveTextContent("100 minus the current mean score");
    expect(disclosure).toHaveTextContent("comparison mean, which stays fixed");
    expect(disclosure).toHaveTextContent("A percentage is undefined when current priority is zero");
    await expectNoSeriousA11yViolations(container);
  });
});
