import { useId } from "react";
import { scaleLinear } from "d3";
import type { DriverEvidence } from "@/lib/api/driverEvidence";
import { fmtInt } from "@/lib/format";

/** These eight mutually exclusive partitions are supplied by the evidence evaluator. */
export function EndpointCoverageBar({ duration, cases }: { duration: NonNullable<DriverEvidence["duration"]>; cases: number }) {
  const id = useId();
  const p = duration.partitions;
  const parts = [
    { name: "Ordered pairs", count: p.orderedCases, fill: "var(--color-accent)" },
    { name: "Tied timestamps", count: p.tiedCases, fill: "var(--color-text-muted)" },
    { name: "Reversed pairs", count: p.reversedCases, fill: "var(--scale-penalty-5)" },
    { name: "Repeated endpoints", count: p.repeatedEndpointCases, fill: "var(--color-border-strong)" },
    { name: "Missing timestamps", count: p.missingTimestampCases, fill: `url(#${id}-missing)` },
    { name: "Missing start", count: p.missingStartOnlyCases, fill: `url(#${id}-missing)` },
    { name: "Missing end", count: p.missingEndOnlyCases, fill: `url(#${id}-missing)` },
    { name: "Neither endpoint", count: p.neitherEndpointCases, fill: `url(#${id}-missing)` },
  ];
  if (!Number.isFinite(cases) || cases <= 0 || parts.some(part => !Number.isInteger(part.count) || part.count < 0) || parts.reduce((sum, part) => sum + part.count, 0) !== cases) {
    return <p className="my-2 text-xs text-text-muted">A complete coverage partition is unavailable; inspect the reported counts below.</p>;
  }
  const x = scaleLinear().domain([0, cases]).range([0, 800]);
  let offset = 0;
  return <figure className="my-3" aria-label="Endpoint coverage across selected cases">
    <svg viewBox="0 0 800 24" className="block w-full" role="img" aria-label={parts.map(part => `${part.name}: ${fmtInt(part.count)} cases`).join("; ")}>
      <defs><pattern id={`${id}-missing`} patternUnits="userSpaceOnUse" width="7" height="7"><rect width="7" height="7" fill="var(--color-surface-sunken)" /><path d="M-1 1L1-1M0 7L7 0M6 8L8 6" stroke="var(--color-border-strong)" strokeWidth=".8" /></pattern></defs>
      {parts.map(part => { const start = offset; offset += part.count; return <rect key={part.name} x={x(start)} y={2} width={x(part.count)} height={20} fill={part.fill}><title>{part.name}: {fmtInt(part.count)} cases</title></rect>; })}
    </svg>
    <figcaption className="mt-2 text-xs text-text-muted">{fmtInt(p.orderedCases + p.tiedCases)} measured pairs of {fmtInt(cases)} selected cases · hatched sections lack an endpoint or timestamp. Exact partitions below.</figcaption>
  </figure>;
}
