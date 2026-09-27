import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { scaleBand } from "d3";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keysInBandRange, LinkedBars, LinkedDensity, type CountMark } from "./LinkedCharts";

const rows: CountMark[] = [
  { key: "early", label: "0–<1 day", total: 1200, selected: 300 },
  { key: "late", label: "≥365 days", total: 8, selected: 2 },
  { key: "missing", label: "Unknown span", total: 4, selected: 0 },
];
const spans = rows.map((row, i) => ({ ...row, min: i === 0 ? 0 : i === 1 ? 365 : null, max: i === 0 ? 1 : null, missing: i === 2 }));
const events = [
  { key: "single", label: "1 event", total: 10, selected: 3, min: 1, max: 2, missing: false },
  { key: "many", label: "≥2 events", total: 1202, selected: 299, min: 2, max: null, missing: false },
];
const cells = [
  { spanKey: "early", eventKey: "single", total: 10, selected: 3 },
  { spanKey: "early", eventKey: "many", total: 1190, selected: 297 },
  { spanKey: "late", eventKey: "single", total: 0, selected: 0 },
  { spanKey: "late", eventKey: "many", total: 8, selected: 2 },
  { spanKey: "missing", eventKey: "single", total: 0, selected: 0 },
  { spanKey: "missing", eventKey: "many", total: 4, selected: 0 },
];

afterEach(async () => {
  // D3 suppresses the synthetic click immediately following a drag until the next task.
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

function overlay(container: HTMLElement, kind: string) {
  const node = container.querySelector<SVGRectElement>(`[data-brush="${kind}"] .overlay`);
  if (!node) throw new Error(`Missing real D3 ${kind} brush overlay`);
  return node;
}
function bounds(node: SVGRectElement) {
  const x = Number(node.getAttribute("x"));
  const y = Number(node.getAttribute("y"));
  return { x, y, width: Number(node.getAttribute("width")), height: Number(node.getAttribute("height")) };
}
// Vitest's global Window proxy is rejected by jsdom's UIEvent constructor.
// Set the event's view after construction; D3 still receives real DOM events.
function mouseEvent(kind: "mouseDown" | "mouseMove" | "mouseUp", node: Element | Window, init: MouseEventInit) {
  const event = createEvent[kind](node, init);
  Object.defineProperty(event, "view", { value: document.defaultView });
  fireEvent(node, event);
}
const mouseDown = (node: Element | Window, init: MouseEventInit) => mouseEvent("mouseDown", node, init);
const mouseMove = (node: Element | Window, init: MouseEventInit) => mouseEvent("mouseMove", node, init);
const mouseUp = (node: Element | Window, init: MouseEventInit) => mouseEvent("mouseUp", node, init);
function drag(node: SVGRectElement, from: [number, number], to: [number, number]) {
  mouseDown(node, { clientX: from[0], clientY: from[1], buttons: 1 });
  mouseMove(document.defaultView!, { clientX: to[0], clientY: to[1], buttons: 1 });
  mouseUp(document.defaultView!, { clientX: to[0], clientY: to[1] });
}

describe("ordinal selection mapping", () => {
  const keys = ["small", "large", "missing"];
  const band = scaleBand<string>().domain(keys).range([0, 300]);
  it("selects positive overlap in displayed order, including reversed drags and open/missing category keys", () => {
    expect(keysInBandRange(keys, band, [100, 200])).toEqual(["large"]);
    expect(keysInBandRange(keys, band, [290, 110])).toEqual(["large", "missing"]);
    expect(keysInBandRange(keys, band, [-40, 20])).toEqual(["small"]);
    expect(keysInBandRange(keys, band, [300, 400])).toEqual([]);
  });
  it("does not interpret null, point selections, NaN or band padding as categories", () => {
    expect(keysInBandRange(keys, band, null)).toEqual([]);
    expect(keysInBandRange(keys, band, [100, 100])).toEqual([]);
    expect(keysInBandRange(keys, band, [0, Number.NaN])).toEqual([]);
    const padded = scaleBand<string>().domain(keys).range([0, 300]).paddingInner(0.5);
    expect(keysInBandRange(keys, padded, [padded("small")! + padded.bandwidth() + 1, padded("large")! - 1])).toEqual([]);
  });
});

it("toggles bars using Space, Enter and the native table; preserves focus and exact counts after updates", async () => {
  const user = userEvent.setup();
  const onToggle = vi.fn();
  const view = render(<LinkedBars rows={rows} title="Span" activeKeys={["early", "late"]} onToggle={onToggle} horizontal />);
  expect(screen.getByRole("heading", { name: "Span" })).not.toHaveClass("sr-only");
  expect(screen.queryByText("Select a range with controls")).not.toBeInTheDocument();
  const chart = screen.getByRole("group", { name: "Span chart" });
  const first = within(chart).getByRole("button", { name: "0–<1 day: 300 selected cases; 1,200 total cases" });
  first.focus();
  await user.keyboard(" {Enter}");
  expect(onToggle.mock.calls).toEqual([["early"], ["early"]]);
  expect(first).toHaveAttribute("aria-pressed", "true");
  fireEvent.keyDown(first, { key: " ", repeat: true });
  expect(onToggle).toHaveBeenCalledTimes(2);
  view.rerender(<LinkedBars rows={rows.map((row) => ({ ...row, selected: 0 }))} title="Span" activeKeys={[]} onToggle={onToggle} horizontal />);
  expect(view.container.querySelector('[data-bar-key="early"]')).toBe(first);
  expect(first).toHaveFocus();
  expect(first).toHaveAttribute("aria-label", "0–<1 day: 0 selected cases; 1,200 total cases");
  expect(first).toHaveAttribute("aria-pressed", "false");
  await user.click(screen.getByText("Span as a table"));
  await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Unknown span" }));
  expect(onToggle).toHaveBeenLastCalledWith("missing");
});

it("uses a real brushX, commits once on end, and clears without feeding back", () => {
  const onRange = vi.fn();
  const view = render(<StrictMode><LinkedBars rows={rows} title="Span" activeKeys={[]} onToggle={vi.fn()} onRange={onRange} /></StrictMode>);
  const node = overlay(view.container, "bars");
  const b = bounds(node);
  expect(view.container.querySelectorAll('[data-brush="bars"] .overlay')).toHaveLength(1);
  mouseDown(node, { clientX: b.x + 1, clientY: b.y + 10, buttons: 1 });
  mouseMove(document.defaultView!, { clientX: b.x + b.width - 1, clientY: b.y + 10, buttons: 1 });
  expect(onRange).not.toHaveBeenCalled();
  mouseUp(document.defaultView!, { clientX: b.x + b.width - 1, clientY: b.y + 10 });
  expect(onRange.mock.calls).toEqual([[rows.map((row) => row.key)]]);
  expect(view.container.querySelector('[data-brush="bars"] .selection')).toHaveStyle({ display: "none" });
  mouseDown(node, { clientX: b.x + 10, clientY: b.y + 10, buttons: 1 });
  mouseUp(document.defaultView!, { clientX: b.x + 10, clientY: b.y + 10 });
  expect(onRange).toHaveBeenCalledTimes(1);
});

it("keeps ordinal brush and native range semantics equivalent for horizontal bars and new callbacks", async () => {
  const user = userEvent.setup();
  const oldRange = vi.fn();
  const onRange = vi.fn();
  const view = render(<LinkedBars rows={rows} title="Span" activeKeys={[]} onToggle={vi.fn()} onRange={oldRange} horizontal />);
  const node = overlay(view.container, "bars");
  view.rerender(<LinkedBars rows={rows} title="Span" activeKeys={[]} onToggle={vi.fn()} onRange={onRange} horizontal />);
  const b = bounds(node);
  drag(node, [b.x + b.width * 0.4, b.y + 10], [b.x + b.width - 1, b.y + 10]);
  expect(oldRange).not.toHaveBeenCalled();
  expect(onRange).toHaveBeenLastCalledWith(["late", "missing"]);
  const form = screen.getByRole("form", { name: "Span range selection" });
  await user.selectOptions(within(form).getByLabelText("From category"), "late");
  await user.click(within(form).getByRole("button", { name: "Select category range" }));
  expect(onRange.mock.calls).toEqual([[["late", "missing"]], [["late", "missing"]]]);
});

it("removes active D3 window listeners if a chart unmounts mid-gesture", () => {
  const onRange = vi.fn();
  const view = render(<LinkedBars rows={rows} title="Span" activeKeys={[]} onToggle={vi.fn()} onRange={onRange} />);
  const node = overlay(view.container, "bars");
  const b = bounds(node);
  mouseDown(node, { clientX: b.x + 5, clientY: b.y + 5, buttons: 1 });
  view.unmount();
  mouseMove(document.defaultView!, { clientX: b.x + b.width, clientY: b.y + 5, buttons: 1 });
  mouseUp(document.defaultView!, { clientX: b.x + b.width, clientY: b.y + 5 });
  expect(onRange).not.toHaveBeenCalled();
});

it("renders a rectangular brush over categorical matrix bands and selects a block once", () => {
  const onSelect = vi.fn();
  const view = render(<StrictMode><LinkedDensity spans={spans} events={events} cells={cells} onSelect={onSelect} /></StrictMode>);
  const node = overlay(view.container, "density");
  const b = bounds(node);
  drag(node, [b.x + b.width * 0.4, b.y + b.height * 0.1], [b.x + b.width - 1, b.y + b.height - 1]);
  expect(onSelect.mock.calls).toEqual([[["late", "missing"], ["single", "many"]]]);
  expect(view.container.querySelector('[data-brush="density"] .selection')).toHaveStyle({ display: "none" });
});

it("supports matrix overlay clicks, roving keyboard focus, exact titles and table pair selection", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const view = render(<LinkedDensity spans={spans} events={events} cells={cells} onSelect={onSelect} />);
  const node = overlay(view.container, "density");
  const b = bounds(node);
  fireEvent.click(node, { clientX: b.x + 10, clientY: b.y + 10 });
  expect(onSelect).toHaveBeenLastCalledWith(["early"], ["single"]);
  const matrix = screen.getByRole("group", { name: "Recorded span and event count matrix" });
  const buttons = within(matrix).getAllByRole("button");
  expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  buttons[0]!.focus();
  await user.keyboard("{ArrowRight}{ArrowDown} ");
  expect(onSelect).toHaveBeenLastCalledWith(["late"], ["many"]);
  expect(buttons[4]).toHaveFocus();
  expect(buttons[4]?.querySelector("title")).toHaveTextContent("≥365 days; ≥2 events: 2 selected cases; 8 total cases");
  await user.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalledTimes(3);
  await user.click(screen.getByText("Recorded span and event count as a table"));
  await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Unknown span / ≥2 events" }));
  expect(onSelect).toHaveBeenLastCalledWith(["missing"], ["many"]);
});

it("offers native keyboard block controls and does not fabricate zero for an omitted cell", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<LinkedDensity spans={spans} events={events} cells={cells.slice(1)} onSelect={onSelect} />);
  const matrix = screen.getByRole("group", { name: "Recorded span and event count matrix" });
  expect(within(matrix).getByRole("button", { name: "0–<1 day; 1 event: counts unavailable" })).toBeInTheDocument();
  const form = screen.getByRole("form", { name: "Matrix block selection" });
  const ranges = within(form).getAllByLabelText("From category");
  await user.selectOptions(ranges[0]!, "late");
  await user.selectOptions(ranges[1]!, "many");
  await user.click(within(form).getByRole("button", { name: "Select block" }));
  expect(onSelect.mock.calls).toEqual([[["late", "missing"], ["many"]]]);
});

it("resizes without replacing focused marks, including charts initially empty; disconnects observation", () => {
  let measure: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { measure = callback; }
    observe() {}
    disconnect() { disconnect(); }
  });
  const onRange = vi.fn();
  const view = render(<LinkedBars rows={[]} title="Span" activeKeys={[]} onToggle={vi.fn()} onRange={onRange} />);
  view.rerender(<LinkedBars rows={rows} title="Span" activeKeys={[]} onToggle={vi.fn()} onRange={onRange} />);
  const mark = view.container.querySelector<SVGGElement>('[data-bar-key="early"]')!;
  mark.focus();
  const wrapper = view.container.querySelector("svg")!.parentElement!;
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({ width: 360 } as DOMRect);
  expect(measure).toBeDefined();
  act(() => measure?.());
  expect(view.container.querySelector("svg")).toHaveAttribute("viewBox", expect.stringContaining("0 0 360 "));
  expect(view.container.querySelector('[data-bar-key="early"]')).toBe(mark);
  expect(mark).toHaveFocus();
  expect(onRange).not.toHaveBeenCalled();
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});

it("renders deterministic server SVG and accessible empty/all-zero states without invalid geometry", async () => {
  const server = renderToString(<LinkedBars rows={rows} title="SSR chart" activeKeys={[]} onToggle={() => {}} />);
  expect(server).toContain('viewBox="0 0 720 ');
  expect(server).not.toMatch(/NaN|Infinity/);
  const view = render(<><LinkedBars rows={rows.map((r) => ({ ...r, total: 0, selected: 0 }))} title="Zero counts" activeKeys={[]} onToggle={vi.fn()} onRange={vi.fn()} /><LinkedDensity spans={spans} events={events} cells={cells.map((c) => ({ ...c, total: 0, selected: 0 }))} onSelect={vi.fn()} /></>);
  expect(view.container.innerHTML).not.toMatch(/NaN|Infinity/);
  for (const details of view.container.querySelectorAll("details")) details.open = true;
  const result = await axe.run(view.container, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations.map((violation) => `${violation.id}: ${violation.description}`)).toEqual([]);
});


it.each(["bars", "density"] as const)("keeps compact %s named and keyboard-operable with initially collapsed range controls", async (kind) => {
  const user = userEvent.setup();
  const onRange = vi.fn();
  const onSelect = vi.fn();
  const onToggle = vi.fn();
  const view = render(kind === "bars"
    ? <LinkedBars rows={rows} title="Compact span" activeKeys={[]} onToggle={onToggle} onRange={onRange} compact />
    : <LinkedDensity spans={spans} events={events} cells={cells} onSelect={onSelect} compact />);
  const title = kind === "bars" ? "Compact span" : "Recorded span and event count";
  expect(screen.getByRole("heading", { name: title })).toHaveClass("sr-only");
  expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
  const chart = screen.getByRole("group", { name: kind === "bars" ? "Compact span chart" : "Recorded span and event count matrix" });
  expect(chart).toHaveAccessibleDescription(expect.stringContaining("Enter or Space"));
  const first = within(chart).getAllByRole("button")[0]!;
  first.focus();
  await user.keyboard("{Enter}");
  if (kind === "bars") expect(onToggle).toHaveBeenCalledWith("early");
  else expect(onSelect).toHaveBeenCalledWith(["early"], ["single"]);
  onSelect.mockClear();

  const summary = screen.getByText("Select a range with controls");
  const disclosure = summary.closest("details")!;
  expect(disclosure).not.toHaveAttribute("open");
  expect(screen.getByRole("form")).not.toBeVisible();
  const result = await axe.run(view.container, { rules: { "color-contrast": { enabled: false } } });
  expect(result.violations).toEqual([]);
  await user.click(summary);
  expect(disclosure).toHaveAttribute("open");
  const form = screen.getByRole("form", { name: kind === "bars" ? "Compact span range selection" : "Matrix block selection" });
  await user.selectOptions(within(form).getAllByLabelText("From category")[0]!, "late");
  const submit = within(form).getByRole("button", { name: kind === "bars" ? "Select category range" : "Select block" });
  submit.focus();
  await user.keyboard("{Enter}");
  if (kind === "bars") expect(onRange.mock.calls).toEqual([[["late", "missing"]]]);
  else expect(onSelect.mock.calls).toEqual([[["late", "missing"], ["single", "many"]]]);

  await user.click(summary);
  expect(disclosure).not.toHaveAttribute("open");
  expect(screen.getByRole("form")).not.toBeVisible();
  await user.click(screen.getByText(`${title} as a table`));
  expect(screen.getByRole("table")).toBeInTheDocument();
});

it("does not show an empty compact range disclosure when bars have no range action", () => {
  render(<LinkedBars rows={rows} title="Compact categories" activeKeys={[]} onToggle={vi.fn()} compact />);
  expect(screen.queryByText("Select a range with controls")).not.toBeInTheDocument();
  expect(screen.getByText("Compact categories as a table")).toBeInTheDocument();
});
