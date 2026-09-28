import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  brush, brushX, dragEnable, format, interpolateBlues, pointer, scaleBand,
  rgb, scaleLinear, scaleSequentialLog, select,
  type D3BrushEvent, type ScaleBand,
} from "d3";

export type CountMark = { key: string; label: string; total: number; selected: number };
type RangeMark = CountMark & { min: number | null; max: number | null; missing: boolean };
type DensityCell = { spanKey: string; eventKey: string; total: number; selected: number };
export interface LinkedBarsProps {
  rows: CountMark[];
  title: string;
  activeKeys: string[];
  onToggle: (key: string) => void;
  onRange?: (keys: string[]) => void;
  color?: string;
  horizontal?: boolean;
  compact?: boolean;
}
export interface LinkedDensityProps {
  spans: RangeMark[];
  events: RangeMark[];
  cells: DensityCell[];
  onSelect: (spanKeys: string[], eventKeys: string[]) => void;
  compact?: boolean;
}

type Interval = readonly [number, number];
type Rectangle = readonly [Interval, Interval];
const exact = format(",d");
const compactCount = format("~s");
const totals = (row: Pick<CountMark, "selected" | "total">) => `${exact(row.selected)} selected cases; ${exact(row.total)} total cases`;
const truncate = (label: string, characters: number) => {
  const letters = Array.from(label);
  return letters.length > characters ? `${letters.slice(0, Math.max(1, characters - 1)).join("")}…` : label;
};
function contrastText(fill: string) {
  const value = rgb(fill);
  const [r = 0, g = 0, b = 0] = [value.r, value.g, value.b].map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000" : "#fff";
}
const focusClass = "outline-none focus-visible:[&_.focus-ring]:stroke-accent focus-visible:[&_.focus-ring]:stroke-[3]";
const fieldClass = "min-w-0 rounded border border-border bg-surface px-2 py-1 text-sm text-text";
const buttonClass = "rounded border border-border px-3 py-1.5 text-sm text-accent-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

/** Positive overlap selects complete ordinal bands; padding and zero-width gestures select nothing. */
// eslint-disable-next-line react-refresh/only-export-components -- Pure mapping is also the gesture test boundary.
export function keysInBandRange(keys: readonly string[], band: ScaleBand<string>, range: Interval | null): string[] {
  if (!range || !range.every(Number.isFinite) || range[0] === range[1]) return [];
  const lower = Math.min(...range);
  const upper = Math.max(...range);
  return keys.filter((key) => {
    const start = band(key);
    return start !== undefined && start < upper && start + band.bandwidth() > lower;
  });
}

function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const next = node.getBoundingClientRect().width;
      if (Number.isFinite(next) && next > 0) setWidth(Math.max(280, Math.round(next)));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** D3 owns only this group's descendants. Clearing the transient brush never commits again. */
function useOrdinalBrush(mode: "x" | "xy", extent: Rectangle, enabled: boolean, onCommit: (value: Interval | Rectangle) => void) {
  const ref = useRef<SVGGElement>(null);
  const callback = useRef(onCommit);
  callback.current = onCommit;
  const [[x0, y0], [x1, y1]] = extent;
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled || x1 <= x0 || y1 <= y0) return;
    const group = select(node);
    const behavior = (mode === "x" ? brushX<unknown>() : brush<unknown>())
      .extent([[x0, y0], [x1, y1]])
      .keyModifiers(false)
      .handleSize(10);
    let activeMouseView: Window | null = null;
    behavior.on("start.wise", (event: D3BrushEvent<unknown>) => {
      const source = event.sourceEvent as MouseEvent | undefined;
      if (source?.type === "mousedown") activeMouseView = source.view;
    }).on("end.wise", (event: D3BrushEvent<unknown>) => {
      activeMouseView = null;
      if (!event.sourceEvent || !event.selection) return;
      const value = event.selection as Interval | Rectangle;
      group.call(behavior.move, null);
      callback.current(value);
    });
    group.call(behavior);
    group.selectAll(".overlay").attr("fill", "transparent");
    group.selectAll(".selection").attr("fill", "var(--color-accent, #2563eb)").attr("fill-opacity", 0.2);
    return () => {
      behavior.on(".wise", null);
      group.on(".brush", null);
      group.selectAll("*").remove();
      // D3 attaches mouse gestures to the owning window until mouseup.
      if (activeMouseView) {
        select(activeMouseView).on(".brush", null);
        dragEnable(activeMouseView);
      }
    };
  }, [mode, enabled, x0, y0, x1, y1]);
  return ref;
}

function activateOnKey(event: KeyboardEvent<SVGGElement>, activate: () => void) {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat) activate();
  }
}

function BoundsInputs({ rows, name, label }: { rows: CountMark[]; name: string; label: string }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const first = rows.some((r) => r.key === start) ? start : (rows[0]?.key ?? "");
  const last = rows.some((r) => r.key === end) ? end : (rows.at(-1)?.key ?? "");
  return <fieldset className="flex min-w-0 flex-wrap gap-2">
    <legend className="mb-1 text-xs font-medium">{label}</legend>
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">From category
      <select className={fieldClass} name={`${name}-from`} value={first} onChange={(e) => setStart(e.target.value)} disabled={!rows.length}>
        {rows.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
      </select>
    </label>
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">Through category
      <select className={fieldClass} name={`${name}-through`} value={last} onChange={(e) => setEnd(e.target.value)} disabled={!rows.length}>
        {rows.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
      </select>
    </label>
  </fieldset>;
}

function RangeControls({ compact, children }: { compact: boolean; children: ReactNode }) {
  if (!compact) return <>{children}</>;
  return <details className="mt-2 text-sm">
    <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Select a range with controls</summary>
    {children}
  </details>;
}

function formRange(rows: CountMark[], values: FormData, name: string) {
  const a = rows.findIndex((row) => row.key === values.get(`${name}-from`));
  const b = rows.findIndex((row) => row.key === values.get(`${name}-through`));
  return a < 0 || b < 0 ? [] : rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.key);
}

export function LinkedBars({ rows, title, activeKeys, onToggle, onRange, color = "var(--color-accent, #2563eb)", horizontal = false, compact = false }: LinkedBarsProps) {
  const id = useId();
  const { ref, width } = useChartWidth();
  const keys = rows.map((row) => row.key);
  const left = horizontal ? Math.min(200, Math.max(108, width * 0.29)) : 58;
  const right = width - 20;
  const top = 20;
  const bottom = horizontal ? top + Math.max(72, rows.length * 32) : 220;
  const band = scaleBand<string>().domain(keys).range(horizontal ? [top, bottom] : [left, right]).padding(0.2);
  const maximum = Math.max(1, ...rows.map((row) => Math.max(row.total, row.selected)));
  const count = scaleLinear().domain([0, maximum]).nice(4).range(horizontal ? [left, right] : [bottom, top]);
  const ticks = count.ticks(4).filter(Number.isInteger);
  const railY = bottom + (horizontal ? 64 : 104);
  const railBand = scaleBand<string>().domain(keys).range([left, right]).padding(0.08);
  const brushRef = useOrdinalBrush("x", [[left, railY], [right, railY + 28]], !!onRange && !!rows.length, (value) => {
    const chosen = keysInBandRange(keys, railBand, value as Interval);
    if (chosen.length) onRange?.(chosen);
  });
  const height = onRange ? railY + 54 : bottom + (horizontal ? 50 : 88);
  const active = new Set(activeKeys);
  const labelStride = horizontal ? 1 : Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor((right - left) / 72))));
  return <section aria-labelledby={`${id}-heading`} className="min-w-0 text-text">
    <h3 id={`${id}-heading`} className={compact ? "sr-only" : "text-base font-semibold"}>{title}</h3>
    <p id={`${id}-help`} className="mt-1 text-xs text-text-muted">{compact ? <>
      Gray: all cases · Color: selected · Ordinal categories.
      <span className="sr-only"> Enter or Space toggles a bar. Category positions are not elapsed time or numeric distance.</span>
    </> : "Gray: all cases. Color: selected cases. Enter or Space toggles a bar. Category positions are ordinal, not elapsed time or numeric distance."}</p>
    <div ref={ref} className="min-w-0 w-full">{!rows.length ? <p className="py-4 text-sm">No categories to display.</p> : <>
      <svg role="group" aria-label={`${title} chart`} aria-describedby={`${id}-help`} viewBox={`0 0 ${width} ${height}`} className="block w-full" style={{ height: "auto" }}>
        <g aria-hidden="true" fontSize={11} fill="currentColor">
          {ticks.map((tick) => <g key={tick}>
            <line x1={horizontal ? count(tick) : left} x2={horizontal ? count(tick) : right} y1={horizontal ? top : count(tick)} y2={horizontal ? bottom : count(tick)} stroke="currentColor" opacity={tick === 0 ? 0.5 : 0.14} />
            <text x={horizontal ? count(tick) : left - 8} y={horizontal ? bottom + 18 : count(tick) + 4} textAnchor={horizontal ? "middle" : "end"}><title>{`${exact(tick)} cases`}</title>{compactCount(tick)}</text>
          </g>)}
          <text x={horizontal ? right : left} y={horizontal ? bottom + 38 : 12} textAnchor={horizontal ? "end" : "start"}>Cases</text>
        </g>
        {rows.map((row, index) => {
          const position = band(row.key)!;
          const breadth = band.bandwidth();
          const geometry = (value: number) => horizontal
            ? { x: left, y: position, width: Math.max(0, count(value) - left), height: breadth }
            : { x: position, y: count(value), width: breadth, height: Math.max(0, bottom - count(value)) };
          const hit = horizontal ? { x: 2, y: position - 2, width: right - 2, height: breadth + 4 }
            : { x: position - 2, y: top, width: breadth + 4, height: bottom - top + 4 };
          return <g key={row.key} role="button" tabIndex={0} aria-pressed={active.has(row.key)} aria-label={`${row.label}: ${totals(row)}`} className={focusClass} data-bar-key={row.key}
            onClick={() => onToggle(row.key)} onKeyDown={(event) => activateOnKey(event, () => onToggle(row.key))}>
            <title>{`${row.label}: ${totals(row)}`}</title>
            <rect {...geometry(row.total)} fill="#94a3b8" opacity={0.45} />
            <rect {...geometry(row.selected)} fill={color} />
            <rect {...hit} fill="transparent" stroke={active.has(row.key) ? color : "transparent"} strokeWidth={2} className="focus-ring" />
            {index % labelStride === 0 && <text aria-hidden="true" x={horizontal ? left - 8 : position + breadth / 2} y={horizontal ? position + breadth / 2 + 4 : bottom + 18}
              textAnchor="end" transform={horizontal ? undefined : `rotate(-30, ${position + breadth / 2}, ${bottom + 18})`} fontSize={12} fill="currentColor">
              <title>{row.label}</title>{truncate(row.label, horizontal ? Math.floor((left - 16) / 7) : Math.min(16, Math.floor((position + breadth / 2 - 8) / 7)))}
            </text>}
          </g>;
        })}
        {onRange && <>
          <text x={left} y={railY - 10} fill="currentColor" fontSize={11}>Drag an ordinal range</text>
          <g aria-hidden="true">{rows.map((row) => <rect key={row.key} x={railBand(row.key)} y={railY} width={railBand.bandwidth()} height={28} fill={active.has(row.key) ? color : "#94a3b8"} opacity={active.has(row.key) ? 0.7 : 0.25} />)}</g>
          <g ref={brushRef} data-brush="bars" aria-hidden="true" />
          <text x={left} y={railY + 44} fill="currentColor" fontSize={10}>First → last · ordinal</text>
        </>}
      </svg>
    </>}</div>
    {onRange && <RangeControls compact={compact}><form aria-label={`${title} range selection`} className="my-2 flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      const chosen = formRange(rows, new FormData(event.currentTarget), "bars");
      if (chosen.length) onRange(chosen);
    }}><BoundsInputs rows={rows} name="bars" label="Category range (inclusive)" /><button type="submit" className={buttonClass} disabled={!rows.length}>Select category range</button></form></RangeControls>}
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{title} as a table</summary>
      <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">{title}: exact counts and category selection</caption>
        <thead><tr><th scope="col" className="p-2">Category</th><th scope="col" className="p-2 text-right">Selected cases</th><th scope="col" className="p-2 text-right">All cases</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key} className="border-t border-border"><th scope="row" className="p-2 font-normal"><button type="button" aria-pressed={active.has(row.key)} onClick={() => onToggle(row.key)} className="break-words text-left text-accent-text underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{row.label}</button></th><td className="p-2 text-right tabular-nums">{exact(row.selected)}</td><td className="p-2 text-right tabular-nums">{exact(row.total)}</td></tr>)}</tbody>
      </table></div>
    </details>
  </section>;
}

export function LinkedDensity({ spans, events, cells, onSelect, compact = false }: LinkedDensityProps) {
  const id = useId();
  const { ref, width } = useChartWidth();
  const svgRef = useRef<SVGSVGElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const left = Math.min(170, Math.max(106, width * 0.25));
  const right = width - 18;
  const top = 30;
  const bottom = top + Math.max(150, events.length * 30);
  const spanKeys = spans.map((row) => row.key);
  const eventKeys = events.map((row) => row.key);
  const x = scaleBand<string>().domain(spanKeys).range([left, right]).paddingInner(0.06);
  const y = scaleBand<string>().domain(eventKeys).range([top, bottom]).paddingInner(0.06);
  const byKey = new Map(cells.map((cell) => [JSON.stringify([cell.spanKey, cell.eventKey]), cell]));
  const maximum = Math.max(0, ...cells.filter((cell) => spanKeys.includes(cell.spanKey) && eventKeys.includes(cell.eventKey)).map((cell) => cell.selected));
  const color = scaleSequentialLog(interpolateBlues).domain([1, Math.max(2, maximum)]);
  const brushRef = useOrdinalBrush("xy", [[left, top], [right, bottom]], !!spans.length && !!events.length, (value) => {
    const [[x0, y0], [x1, y1]] = value as Rectangle;
    const chosenSpans = keysInBandRange(spanKeys, x, [x0, x1]);
    const chosenEvents = keysInBandRange(eventKeys, y, [y0, y1]);
    if (chosenSpans.length && chosenEvents.length) onSelect(chosenSpans, chosenEvents);
  });
  const marks = events.flatMap((event, row) => spans.map((span, column) => ({
    span, event, row, column, key: JSON.stringify([span.key, event.key]), cell: byKey.get(JSON.stringify([span.key, event.key])),
  })));
  const focusKey = marks.some((mark) => mark.key === focused) ? focused : marks[0]?.key;
  const labelStride = Math.max(1, Math.ceil(spans.length / Math.max(1, Math.floor((right - left) / 48))));
  return <section aria-labelledby={`${id}-heading`} className="min-w-0 text-text">
    <h3 id={`${id}-heading`} className={compact ? "sr-only" : "text-base font-semibold"}>Recorded span and event count</h3>
    <p id={`${id}-help`} className="mt-1 text-xs text-text-muted">{compact ? <>
      Cases by categorical ranges. Click a cell or drag a block.
      <span className="sr-only"> Both axes are categorical ranges, not continuous scales. Arrow keys move between cells; Enter or Space selects a cell. Use the range controls to select a block with the keyboard.</span>
    </> : "Each cell counts cases. Both axes are categorical ranges, not continuous scales. Drag a block, click a cell, or use the range controls. Arrow keys move between cells; Enter or Space selects a cell."}</p>
    <div ref={ref} className="min-w-0 w-full">{!spans.length || !events.length ? <p className="py-4 text-sm">No range categories to display.</p> : <>
      <svg ref={svgRef} role="group" aria-label="Recorded span and event count matrix" aria-describedby={`${id}-help`} viewBox={`0 0 ${width} ${bottom + 104}`} className="block w-full" style={{ height: "auto" }}>
        <g aria-hidden="true" fill="currentColor" fontSize={11}>
          <text x={left - 8} y={16} textAnchor="end">Events per case</text>
          {events.map((event) => <text key={event.key} x={left - 8} y={y(event.key)! + y.bandwidth() / 2 + 4} textAnchor="end"><title>{event.label}</title>{truncate(event.label, Math.floor((left - 16) / 7))}</text>)}
          {spans.filter((_, i) => i % labelStride === 0).map((span) => <text key={span.key} x={x(span.key)! + x.bandwidth() / 2} y={bottom + 17} textAnchor="end" transform={`rotate(-30, ${x(span.key)! + x.bandwidth() / 2}, ${bottom + 17})`}><title>{span.label}</title>{truncate(span.label, 14)}</text>)}
          <text x={left} y={bottom + 90}>Recorded span · ordinal ranges</text>
        </g>
        {marks.map(({ span, event, row, column, key, cell }) => {
          const count = cell?.selected;
          const name = `${span.label}; ${event.label}: ${cell ? totals(cell) : "counts unavailable"}`;
          return <g key={key} role="button" tabIndex={key === focusKey ? 0 : -1} aria-label={name} data-density-cell={key} className={focusClass}
            onFocus={() => setFocused(key)} onClick={() => onSelect([span.key], [event.key])} onKeyDown={(e) => {
              activateOnKey(e, () => onSelect([span.key], [event.key]));
              const nextColumn = e.key === "ArrowLeft" ? Math.max(0, column - 1) : e.key === "ArrowRight" ? Math.min(spans.length - 1, column + 1) : e.key === "Home" ? 0 : e.key === "End" ? spans.length - 1 : column;
              const nextRow = e.key === "ArrowUp" ? Math.max(0, row - 1) : e.key === "ArrowDown" ? Math.min(events.length - 1, row + 1) : row;
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                svgRef.current?.querySelectorAll<SVGGElement>("[data-density-cell]")[nextRow * spans.length + nextColumn]?.focus();
              }
            }}>
            <title>{name}</title>
            <rect x={x(span.key)} y={y(event.key)} width={x.bandwidth()} height={y.bandwidth()} fill={count === undefined ? "none" : count === 0 ? "#94a3b8" : color(count)} opacity={count === 0 ? 0.2 : 1} stroke="currentColor" strokeOpacity={0.15} />
            {x.bandwidth() >= 34 && y.bandwidth() >= 18 && <text aria-hidden="true" x={x(span.key)! + x.bandwidth() / 2} y={y(event.key)! + y.bandwidth() / 2 + 4} textAnchor="middle" fontSize={11} fill={count ? contrastText(color(count)) : "currentColor"}>{count === undefined ? "?" : compactCount(count)}</text>}
            <rect x={x(span.key)! + 1.5} y={y(event.key)! + 1.5} width={Math.max(0, x.bandwidth() - 3)} height={Math.max(0, y.bandwidth() - 3)} fill="transparent" stroke="transparent" className="focus-ring" />
          </g>;
        })}
        <g ref={brushRef} data-brush="density" aria-hidden="true" onMouseMove={(event) => {
          const svg = svgRef.current;
          if (!svg) return;
          const [px, py] = pointer(event.nativeEvent, svg);
          const hit = marks.find(({ span, event: bucket }) => px >= x(span.key)! && px < x(span.key)! + x.bandwidth() && py >= y(bucket.key)! && py < y(bucket.key)! + y.bandwidth());
          const label = hit ? `${hit.span.label}; ${hit.event.label}: ${hit.cell ? totals(hit.cell) : "counts unavailable"}` : "Drag to select a block of categories";
          select(event.currentTarget).select(".overlay").selectAll("title").data([label]).join("title").text((value) => value);
        }} onClick={(event) => {
          // The transparent D3 overlay receives pointer clicks; marks retain keyboard ownership.
          const svg = svgRef.current;
          if (!svg || event.defaultPrevented) return;
          const [px, py] = pointer(event.nativeEvent, svg);
          const span = spanKeys.find((key) => px >= x(key)! && px < x(key)! + x.bandwidth());
          const eventKey = eventKeys.find((key) => py >= y(key)! && py < y(key)! + y.bandwidth());
          if (span !== undefined && eventKey !== undefined) onSelect([span], [eventKey]);
        }} />
      </svg>
    </>}</div>
    <div className="flex flex-wrap gap-3 text-xs" aria-label="Selected case count color legend">
      {[0, ...(maximum ? [...new Set([1, maximum])] : [])].map((value) => <span key={value} className="inline-flex items-center gap-1"><span aria-hidden="true" className="inline-block h-3 w-5 rounded-sm" style={{ background: value ? color(value) : "#94a3b8", opacity: value ? 1 : 0.2 }} />{exact(value)}</span>)}
    </div>
    <p className="my-2 text-xs text-text-muted">{compact ? <>
      Selected cases (log color). Gray = 0; ? = unavailable.
      <span className="sr-only"> Exact counts are in cell titles and the table.</span>
    </> : <>Log color scale: selected cases, {maximum ? `1–${exact(maximum)}` : "no selected cases"}. Gray = zero. ? = counts unavailable. Exact counts are in cell titles and the table.</>}</p>
    <RangeControls compact={compact}><form aria-label="Matrix block selection" className="my-3 flex flex-wrap items-end gap-3" onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const chosenSpans = formRange(spans, values, "span");
      const chosenEvents = formRange(events, values, "events");
      if (chosenSpans.length && chosenEvents.length) onSelect(chosenSpans, chosenEvents);
    }}><BoundsInputs rows={spans} name="span" label="Recorded span range" /><BoundsInputs rows={events} name="events" label="Events per case range" /><button type="submit" className={buttonClass} disabled={!spans.length || !events.length}>Select block</button></form></RangeControls>
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Recorded span and event count as a table</summary>
      <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Case counts by recorded span and events per case; select one pair</caption>
        <thead><tr><th scope="col" className="p-2">Recorded span / events per case</th><th scope="col" className="p-2 text-right">Selected cases</th><th scope="col" className="p-2 text-right">All cases</th></tr></thead>
        <tbody>{marks.map(({ key, span, event, cell }) => <tr key={key} className="border-t border-border"><th scope="row" className="p-2 font-normal"><button type="button" onClick={() => onSelect([span.key], [event.key])} className="break-words text-left text-accent-text underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">{span.label} / {event.label}</button></th><td className="p-2 text-right tabular-nums">{cell ? exact(cell.selected) : "Unavailable"}</td><td className="p-2 text-right tabular-nums">{cell ? exact(cell.total) : "Unavailable"}</td></tr>)}</tbody>
      </table></div>
    </details>
  </section>;
}
