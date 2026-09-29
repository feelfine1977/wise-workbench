import { EndpointCoverageBar } from "./EndpointCoverageBar";
import type { ComponentType } from "react";
import type { DriverEvidence } from "@/lib/api/driverEvidence";
import type { SolutionCardBlock } from "@/lib/api/solutionCards";
import { fmtInt, fmtNum } from "@/lib/format";
import { DriverDayChart } from "./DriverDayChart";

type Duration = NonNullable<DriverEvidence["duration"]>;
type BlockProps = { data: DriverEvidence; block: SolutionCardBlock };
const partitionLabels: Record<keyof Duration["partitions"], string> = {
  orderedCases: "One of each endpoint, end after start",
  tiedCases: "One of each endpoint, same timestamp",
  reversedCases: "One of each endpoint, end before start",
  repeatedEndpointCases: "Both endpoints present, repeated start or end",
  missingTimestampCases: "One of each endpoint, missing timestamp",
  missingStartOnlyCases: "End present, start absent",
  missingEndOnlyCases: "Start present, end absent",
  neitherEndpointCases: "Neither endpoint present",
};
const days = (value: number | null) => value === null || !Number.isFinite(value) ? "Unavailable" : value > 0 && value < 0.1 ? "<0.1 days" : `${fmtNum(value, 1)} days`;
const endpointLabel = (data: DriverEvidence, side: "start" | "end") => data.endpoints?.[side].labels.join(" or ") || `${side} endpoint`;
const Unavailable = ({ block }: { block: SolutionCardBlock }) => <p className="text-sm text-text-muted">Unavailable. {block.missingData}</p>;

function ActivityCoverage({ data, block }: BlockProps) {
  if (data.endpoints) return <table className="w-full text-left text-sm tnum">
    <caption className="pb-2 text-left text-xs text-text-muted">Each required endpoint is counted separately across {fmtInt(data.scope.selectedCases)} selected cases. The same case can contain both endpoints; these counts are not additive.</caption>
    <thead><tr><th scope="col" className="py-1">Activity</th><th scope="col" className="py-1 text-right">Cases</th><th scope="col" className="py-1 text-right">Records</th><th scope="col" className="py-1 text-right">Undated</th></tr></thead>
    <tbody>{(["start", "end"] as const).map(side => {
      const endpoint = data.endpoints![side];
      return <tr key={side} className="border-t border-border">
        <th scope="row" className="py-2 pr-2 font-normal"><span className="block text-xs text-text-muted">{side === "start" ? "Start" : "End"}</span>{endpointLabel(data, side)}</th>
        <td className="py-2 text-right">{fmtInt(endpoint.caseCount)}</td><td className="py-2 text-right">{fmtInt(endpoint.eventCount)}</td><td className="py-2 text-right">{fmtInt(endpoint.missingTimestampEvents)}</td>
      </tr>;
    })}</tbody>
  </table>;
  const coverage = data.activityCoverage;
  if (!coverage) return <Unavailable block={block} />;
  return <>
    <p className="text-sm text-text-muted">{coverage.labels.join(" or ")}</p>
    <p className="mt-1 text-sm"><strong>{fmtInt(coverage.casesWithActivity)} of {fmtInt(coverage.selectedCases)} cases</strong> contain the activity · {fmtInt(coverage.eventCount)} event records.</p>
    <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm tnum">
      <div><dt className="text-xs text-text-muted">Without the activity</dt><dd>{fmtInt(coverage.casesWithoutActivity)} cases</dd></div>
      <div><dt className="text-xs text-text-muted">Exactly once</dt><dd>{fmtInt(coverage.singleOccurrenceCases)} cases</dd></div>
      <div><dt className="text-xs text-text-muted">Repeated</dt><dd>{fmtInt(coverage.repeatedOccurrenceCases)} cases</dd></div>
      <div><dt className="text-xs text-text-muted">Undated records</dt><dd>{fmtInt(coverage.missingTimestampEvents)}</dd></div>
    </dl>
    <p className="mt-1 text-xs text-text-muted">Raw activity coverage, without applying before/after conditions, thresholds or norm scoring. An absent record is not evidence that the activity occurred zero times outside this log.</p>
  </>;
}

function EndpointDuration({ data, block }: BlockProps) {
  const duration = data.duration;
  if (!duration) return <Unavailable block={block} />;
  return <>
    <p className="mb-2 text-sm text-text-muted">{endpointLabel(data, "start")} → {endpointLabel(data, "end")}</p>
    {duration.status === "available" ? <>
      <dl className="grid gap-3 tnum sm:grid-cols-3 [&>div]:rounded-lg [&>div]:border [&>div]:border-border [&>div]:bg-surface-sunken [&>div]:p-3">
        <div><dt className="text-xs text-text-muted">Median elapsed time</dt><dd className="text-xl font-semibold" title={duration.median === null ? undefined : `${duration.median} days`}>{days(duration.median)}</dd></div>
        <div><dt className="text-xs text-text-muted">90th percentile</dt><dd className="text-xl font-semibold" title={duration.p90 === null ? undefined : `${duration.p90} days`}>{days(duration.p90)}</dd></div>
        <div><dt className="text-xs text-text-muted">Unique ordered or tied pairs</dt><dd className="text-xl font-semibold">{fmtInt(duration.pairedCases)} cases</dd></div>
      </dl>
      <p className="mt-2 text-sm">{fmtInt(duration.pairedCases)} of {fmtInt(data.scope.selectedCases)} selected cases enter this summary. {duration.partitions.tiedCases > 0 && <>{fmtInt(duration.partitions.tiedCases)} have identical endpoint timestamps; a recorded zero interval does not establish instant work. </>}{duration.partitions.reversedCases > 0 && <>{fmtInt(duration.partitions.reversedCases)} unique pairs run backwards and are excluded.</>}</p>
      <p className="mt-1 text-xs text-text-muted">The median is the middle elapsed time; the 90th percentile describes the upper part of this distribution. Only cases with exactly one dated start and end, end at or after start, enter these summaries. This descriptive pairing differs from norm scoring; elapsed time alone does not establish business lateness.</p>
    </> : <p className="text-sm text-text-muted">Elapsed-time summary unavailable: {duration.reason ?? block.missingData}</p>}
    <EndpointCoverageBar duration={duration} cases={data.scope.selectedCases} />
    <details className="mt-2">
      <summary className="cursor-pointer text-sm text-accent-text">Endpoint coverage and exclusions · {fmtInt(data.scope.selectedCases)} cases</summary>
      <table className="mt-2 w-full text-left text-xs tnum">
        <caption className="pb-2 text-left text-text-muted">Mutually exclusive case partitions; repeated endpoints and missing timestamps are not assigned a duration.</caption>
        <thead><tr><th scope="col" className="py-1">Endpoint evidence</th><th scope="col" className="py-1 text-right">Cases</th></tr></thead>
        <tbody>{Object.entries(partitionLabels).map(([key, label]) => <tr key={key} className="border-t border-border"><th scope="row" className="py-1 font-normal">{label}</th><td className="py-1 text-right">{fmtInt(duration.partitions[key as keyof Duration["partitions"]])}</td></tr>)}</tbody>
      </table>
      <p className="mt-2 text-xs text-text-muted">Including repeats: {fmtInt(duration.ordering.firstEndBeforeFirstStartCases)} of {fmtInt(duration.ordering.casesWithKnownEndpointTimes)} cases with dated endpoints have their first end before their first start; {fmtInt(duration.ordering.allDatedEndsBeforeFirstStartCases)} have all dated ends before the first start. These overlapping checks are separate from the partitions.</p>
    </details>
  </>;
}

function EndDayOfMonth({ data, block }: BlockProps) {
  const calendar = data.endDayOfMonth;
  if (!calendar) return <Unavailable block={block} />;
  return <>
    <DriverDayChart buckets={calendar.buckets.map(b => ({ day: b.day, events: b.eventCount, cases: b.caseCount }))} eventTotal={calendar.datedEventCount} caseTotal={calendar.datedCaseCount} activityLabel={endpointLabel(data, "end")} />
    <p className="mt-2 text-xs text-text-muted">All end-event records: {fmtInt(calendar.eventCount)} across {fmtInt(calendar.caseCount)} distinct cases; {fmtInt(calendar.missingTimestampEvents)} records lack timestamps and are excluded from calendar bars. Recorded rows are not counts of unique business transactions.</p>
    <p className="mt-1 text-xs text-text-muted">{calendar.firstTimestamp && calendar.lastTimestamp ? <>Observed interval: {calendar.firstTimestamp} to {calendar.lastTimestamp} · {fmtInt(calendar.representedMonths)} represented months · timezone {calendar.timezone ?? "not established"}. Day 31 has fewer calendar opportunities; counts are not exposure-adjusted.</> : "No observed date interval is available because no dated end-event records were found."}</p>
  </>;
}

function DueDateLead({ data, block }: BlockProps) {
  return <>
    <p className="text-sm text-text"><strong>Due-date timing unavailable.</strong> {data.dueDate?.reason ?? block.missingData}</p>
    <details className="mt-1"><summary className="cursor-pointer text-xs text-accent-text">What does “release long before the due date” mean?</summary><p className="mt-1 reading text-xs text-text-muted">Release-to-due lead time = invoice payment due date − release date. Positive means release was before payment was due; waiting may be planned. How early is too early depends on agreed terms. This log has no mapped payment due date, so that lead time cannot be calculated. The norm’s elapsed-time target is not a contractual due date.</p></details>
  </>;
}

/** Registry keys are payload recipes; the catalog selects questions and their order. */
const renderers: Record<SolutionCardBlock["kind"], ComponentType<BlockProps>> = {
  activity_coverage: ActivityCoverage,
  endpoint_duration: EndpointDuration,
  end_day_of_month: EndDayOfMonth,
  due_date_lead: DueDateLead,
};

export function SolutionCardEvidence({ data }: { data: DriverEvidence }) {
  const card = data.solutionCard;
  if (!card) return <p className="mt-3 text-sm text-text-muted">No solution-card template is available for this expectation.</p>;
  return <div className="mt-3" data-testid="solution-card-measured">
    <h5 className="text-base font-semibold">{card.title}</h5>
    <p className="mt-1 text-sm text-text-muted">{card.intent}</p>
    <div className="wise-evidence-blocks mt-3">{card.blocks.map(block => {
      const Renderer = Object.hasOwn(renderers, block.kind) ? renderers[block.kind] : undefined;
      return <section key={block.id} className="min-w-0 overflow-x-auto rounded-lg border border-border bg-surface p-4" data-testid="solution-card-block" data-block-kind={block.kind}>
        <h6 className="text-sm font-semibold">{block.title}</h6>
        <p className="mb-2 mt-1 text-sm text-text-muted">{block.question}</p>
        {Renderer ? <Renderer data={data} block={block} /> : <p className="text-sm text-text-muted">Unavailable: this evidence block is not supported by this frontend. {block.missingData}</p>}
        <p className="mt-2 text-xs text-text-muted">{block.interpretation}</p>
      </section>;
    })}</div>
  </div>;
}
