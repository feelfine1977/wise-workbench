import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import type { SolutionCardBlock } from "@/lib/api/solutionCards";
import { driverEvidenceFixture as evidence, solutionCardFixture as card } from "./driverEvidence.fixture";
import { SolutionCardEvidence } from "./SolutionCardEvidence";

it("lets different templates change block order and selection without constraint-specific component logic", () => {
  const { rerender } = render(<SolutionCardEvidence data={evidence} />);
  expect(screen.getAllByTestId("solution-card-block").map(b => b.getAttribute("data-block-kind"))).toEqual(card.blocks.map(b => b.kind));
  expect(screen.getByText("12.3 days")).toHaveAttribute("title", "12.345 days");
  expect(screen.getByText("44.6 days")).toHaveAttribute("title", "44.567 days");
  rerender(<SolutionCardEvidence data={{ ...evidence, constraintId: "entirely-different", solutionCard: { ...card, title: "A different investigation", blocks: [card.blocks[3]!, card.blocks[0]!] } }} />);
  expect(screen.getAllByTestId("solution-card-block").map(b => b.getAttribute("data-block-kind"))).toEqual(["due_date_lead", "activity_coverage"]);
  expect(screen.queryByText("Median elapsed time")).not.toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("A different investigation")).toBeInTheDocument();
});

it("keeps missing payloads and unknown recipes unavailable instead of false zeros", () => {
  const unknown = { ...card.blocks[0]!, id: "unknown", kind: "future_recipe" } as unknown as SolutionCardBlock;
  render(<SolutionCardEvidence data={{ ...evidence, activityCoverage: null, endpoints: null, endDayOfMonth: null, duration: null, solutionCard: { ...card, blocks: [...card.blocks, unknown] } }} />);
  expect(screen.getByText(/this evidence block is not supported/)).toBeInTheDocument();
  expect(screen.getByText("Unavailable. No usable timestamp pairs.")).toBeInTheDocument();
  expect(screen.getByText("Unavailable. Dated end records are unavailable.")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/0 cases|0\.0 days|0\.0%/);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("explains due-date lead time without presenting an elapsed-time target as a due date", async () => {
  render(<SolutionCardEvidence data={{ ...evidence, solutionCard: { ...card, blocks: [card.blocks[3]!] } }} />);
  await userEvent.click(screen.getByText(/What does “release long before/));
  expect(screen.getByText(/Release-to-due lead time =/)).toHaveTextContent("invoice payment due date − release date");
  expect(screen.getByText(/Release-to-due lead time =/)).toHaveTextContent("Positive means release was before payment was due; waiting may be planned.");
  expect(screen.getByText(/Release-to-due lead time =/)).toHaveTextContent("not a contractual due date");
  expect(screen.getByText(/Due-date timing unavailable/)).toBeInTheDocument();
});

it("works for non-lag activity coverage and keeps known zero separate from missing coverage", () => {
  const zero = { ...evidence.activityCoverage!, eventCount: 0, caseCount: 0, casesWithActivity: 0, casesWithoutActivity: 100, singleOccurrenceCases: 0, repeatedOccurrenceCases: 0, missingTimestampEvents: 0 };
  render(<SolutionCardEvidence data={{ ...evidence, constraintType: "presence", activityCoverage: zero, duration: null, endDayOfMonth: null, endpoints: null, solutionCard: { ...card, blocks: [card.blocks[0]!] } }} />);
  expect(screen.getByText("0 of 100 cases")).toBeInTheDocument();
  expect(screen.getByText("100 cases")).toBeInTheDocument();
  expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument();
});

it("exposes exact missing/repeated/reversed partitions and the pair denominator", async () => {
  render(<SolutionCardEvidence data={{ ...evidence, solutionCard: { ...card, blocks: [card.blocks[1]!] } }} />);
  expect(screen.getByText("61 cases")).toBeInTheDocument();
  await userEvent.click(screen.getByText(/Endpoint coverage and exclusions/));
  const row = screen.getByRole("rowheader", { name: "Both endpoints present, repeated start or end" }).closest("tr")!;
  expect(within(row).getByRole("cell")).toHaveTextContent("3");
  const reversed = screen.getByRole("rowheader", { name: "One of each endpoint, end before start" }).closest("tr")!;
  expect(within(reversed).getByRole("cell")).toHaveTextContent("2");
});

it("shows both required endpoint coverages and avoids payment-specific claims for other processes", () => {
  render(<SolutionCardEvidence data={{ ...evidence, solutionCard: { ...card, process: "o2c", blocks: [card.blocks[0]!, card.blocks[1]!] },
    endpoints: { start: { ...evidence.endpoints.start, labels: ["Create order"] }, end: { ...evidence.endpoints.end, labels: ["Goods issue"] } } }} />);
  const start = screen.getByRole("rowheader", { name: /Start Create order/ }).closest("tr")!;
  const end = screen.getByRole("rowheader", { name: /End Goods issue/ }).closest("tr")!;
  expect(within(start).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["75", "90", "3"]);
  expect(within(end).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["80", "100", "1"]);
  expect(document.body).toHaveTextContent("these counts are not additive");
  expect(document.body).not.toHaveTextContent(/overdue payment|bank payments/);
});


it("keeps tied timestamps and excluded reversed pairs visible beside a zero median", () => {
  render(<SolutionCardEvidence data={{ ...evidence, duration: { ...evidence.duration!, median: 0, p90: 0, pairedCases: 4, partitions: { ...evidence.duration!.partitions, orderedCases: 0, tiedCases: 4, reversedCases: 2 } }, solutionCard: { ...card, blocks: [card.blocks[1]!] } }} />);
  expect(screen.getByText(/4 of 100 selected cases enter this summary/)).toBeVisible();
  expect(screen.getByText(/a recorded zero interval does not establish instant work/)).toBeVisible();
  expect(screen.getByText(/2 unique pairs run backwards and are excluded/)).toBeVisible();
});
