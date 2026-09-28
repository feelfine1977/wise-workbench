import { useEffect, useMemo, useRef, useState } from "react";
import {
  brush,
  scaleSqrt,
  scaleSymlog,
  select,
  format,
  type D3BrushEvent,
} from "d3";
import { fmtDays, fmtInt } from "@/lib/format";
interface Point {
  key: string;
  label: string;
  selected: number;
  total: number;
  events: number;
  knownSpanCases: number;
  unknownSpanCases: number;
  unknownEventCases: number;
  p90SpanDays: number | null;
  medianSpanDays: number | null;
}
export function ConcentrationPlot({
  rows,
  onSelect,
}: {
  rows: Point[];
  onSelect: (keys: string[]) => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const group = useRef<SVGGElement>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  const points = rows.filter((r) => r.selected > 0 && r.p90SpanDays !== null);
  const x = useMemo(
    () =>
      scaleSymlog()
        .domain([0, Math.max(1, ...rows.map((r) => r.selected))])
        .nice()
        .range([75, 770]),
    [rows],
  );
  const y = useMemo(
    () =>
      scaleSymlog()
        .domain([0, Math.max(1, ...rows.map((r) => r.p90SpanDays ?? 0))])
        .nice()
        .range([300, 25]),
    [rows],
  );
  const radius = scaleSqrt()
    .domain([0, Math.max(1, ...rows.map((r) => r.events))])
    .range([0, 22]);
  useEffect(() => {
    if (!selecting || !group.current) return;
    const g = select(group.current);
    const b = brush<unknown>()
      .extent([
        [75, 25],
        [770, 300],
      ])
      .on("end", (e: D3BrushEvent<unknown>) => {
        if (!e.sourceEvent || !e.selection) return;
        const [[x0, y0], [x1, y1]] = e.selection as [
          [number, number],
          [number, number],
        ];
        const keys = rows
          .filter(
            (r) =>
              r.selected > 0 &&
              r.p90SpanDays !== null &&
              x(r.selected) >= x0 &&
              x(r.selected) <= x1 &&
              y(r.p90SpanDays) >= y0 &&
              y(r.p90SpanDays) <= y1,
          )
          .map((r) => r.key);
        g.call(b.move, null);
        if (keys.length) callback.current(keys);
      });
    g.call(b);
    return () => {
      g.on(".brush", null);
      g.selectAll("*").remove();
    };
  }, [rows, x, y, selecting]);
  const logTicks = (maximum: number) =>
    [
      0,
      ...Array.from(
        {
          length: Math.max(1, Math.floor(Math.log10(Math.max(1, maximum))) + 1),
        },
        (_, i) => 10 ** i,
      ),
    ].filter((n) => n <= maximum);
  const describe = (r: Point) =>
    `${r.label}: ${fmtInt(r.selected)} selected cases, p90 recorded span ${fmtDays(r.p90SpanDays!)}, ${fmtInt(r.knownSpanCases)} known spans, ${fmtInt(r.unknownSpanCases)} unknown spans; ${fmtInt(r.events)} known events, ${fmtInt(r.unknownEventCases)} unknown event counts`;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          Each dot is a context group. Position: case count × span p90. Dot
          area: recorded events.
        </p>
        <button
          className="rounded border border-border px-3 py-1.5 text-xs"
          aria-pressed={selecting}
          onClick={() => setSelecting(!selecting)}
        >
          {selecting ? "Select groups: drag a box" : "Select groups with a box"}
        </button>
      </div>
      <svg
        className="mt-3 w-full"
        viewBox="0 0 820 350"
        aria-label="Context groups by volume and recorded span"
      >
        <text x="75" y="13" fontSize="11" fill="currentColor">
          ↑ Recorded span p90 (days)
        </text>
        {logTicks(y.domain()[1]!).map((n) => (
          <g key={n}>
            <line
              x1="75"
              x2="770"
              y1={y(n)}
              y2={y(n)}
              stroke="currentColor"
              opacity=".1"
            />
            <text
              x="66"
              y={y(n)}
              textAnchor="end"
              dy=".35em"
              fontSize="10"
              fill="currentColor"
            >
              {format("~s")(n)}
            </text>
          </g>
        ))}
        {logTicks(x.domain()[1]!).map((n) => (
          <g key={n}>
            <line
              x1={x(n)}
              x2={x(n)}
              y1="25"
              y2="300"
              stroke="currentColor"
              opacity=".1"
            />
            <text
              x={x(n)}
              y="319"
              textAnchor="middle"
              fontSize="10"
              fill="currentColor"
            >
              {format("~s")(n)}
            </text>
          </g>
        ))}
        {points.map((r, i) => (
          <g
            key={r.key}
            role="button"
            tabIndex={0}
            aria-label={describe(r)}
            onClick={() => onSelect([r.key])}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect([r.key]);
              }
            }}
            className="cursor-pointer"
          >
            <title>{describe(r)}</title>
            <circle
              cx={x(r.selected)}
              cy={y(r.p90SpanDays!)}
              r={Math.max(7, radius(r.events))}
              fill="transparent"
            />
            <circle
              cx={x(r.selected)}
              cy={y(r.p90SpanDays!)}
              r={radius(r.events)}
              fill={i % 2 ? "#0c8599" : "#4263eb"}
              fillOpacity=".65"
              stroke="var(--color-surface)"
              strokeWidth="1.5"
            />
            <text
              x={x(r.selected)}
              y={y(r.p90SpanDays!) - radius(r.events) - 4}
              fontSize="9"
              textAnchor="middle"
              fill="currentColor"
              pointerEvents="none"
            >
              {points.length < 9 ? r.label.slice(0, 22) : ""}
            </text>
          </g>
        ))}
        {selecting && <g ref={group} />}
        <text
          x="770"
          y="342"
          textAnchor="end"
          fontSize="11"
          fill="currentColor"
        >
          Selected cases →
        </text>
      </svg>
      <p className="eda-note">
        Both axes use a symmetric log scale to retain long tails and zero.{" "}
        {rows.filter((r) => r.selected > 0 && r.p90SpanDays === null).length}{" "}
        groups have no known span and are omitted from dots. Select a dot or
        table row to inspect it.
      </p>
    </div>
  );
}
