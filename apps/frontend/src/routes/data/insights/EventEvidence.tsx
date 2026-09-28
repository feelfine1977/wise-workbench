import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Table, Td, Th } from "@/components/ui";
import { ErrorBlock, LoadingBlock } from "@/components/states";
import { edaQuery, type EDAEndpointCoverage } from "@/lib/api/eda";
import { fmtDays, fmtInt, fmtShare } from "@/lib/format";
import { explorerParams, type ExplorerScope } from "./selectionHelpers";

const duration = (days: number | null) => days === null ? "Unavailable" : fmtDays(days);
const statuses = {
  paired: "Unique dated pair", startOnly: "Start only · end unobserved", endOnly: "End only · start unobserved",
  neither: "Neither endpoint recorded", undatedEndpoint: "Endpoint timestamp missing", reversed: "End precedes start", ambiguous: "Repeated endpoint · ambiguous",
};
function Coverage({ coverage }: { coverage: EDAEndpointCoverage }) {
  const rows = [
    [statuses.paired, coverage.pairedCases], [statuses.startOnly, coverage.startOnlyCases],
    [statuses.endOnly, coverage.endOnlyCases], [statuses.neither, coverage.neitherCases],
    [statuses.undatedEndpoint, coverage.undatedEndpointCases], [statuses.reversed, coverage.reversedCases],
    [statuses.ambiguous, coverage.ambiguousCases],
  ] as const;
  return <div className="space-y-4" aria-label="Endpoint duration coverage">
    <p className="text-sm"><strong>{fmtInt(coverage.pairedCases)} of {fmtInt(coverage.eligibleCases)} selected cases have a defined pair</strong> {coverage.eligibleCases > 0 ? `(${fmtShare(coverage.pairedCases / coverage.eligibleCases)})` : ""}.</p>
    <p className="text-sm">Median: <strong>{duration(coverage.medianDays)}</strong> · 90th percentile: <strong>{duration(coverage.p90Days)}</strong>. Only the {fmtInt(coverage.pairedCases)} paired cases contribute.</p>
    <Table><thead><tr><Th>Mutually exclusive coverage group</Th><Th numeric>Selected cases</Th></tr></thead><tbody>{rows.map(([label, n]) => <tr key={label}><Td>{label}</Td><Td numeric>{fmtInt(n)}</Td></tr>)}</tbody></Table>
    <p className="eda-note">{coverage.rule}</p>
    <p className="eda-note">An unobserved endpoint may reflect censoring, incomplete recording or a different route. The log does not establish which. Unpaired cases are retained above and have no assigned duration.</p>
  </div>;
}

export function EventEvidence({ scope, traceCaseId, onCloseTrace }: {
  scope: ExplorerScope; traceCaseId?: string; onCloseTrace: () => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activitySearch, setActivitySearch] = useState("");
  const [activityPage, setActivityPage] = useState(1);
  const [tracePage, setTracePage] = useState(1);
  const [endpoints, setEndpoints] = useState<{ endpointStart: string; endpointEnd: string }>();
  const [error, setError] = useState("");
  useEffect(() => { setTracePage(1); }, [traceCaseId]);
  const query = useQuery({ ...edaQuery(scope.projectId, scope.caseTableId, {
    ...explorerParams(scope), eventInsight: true, activitySearch, activityPage, ...endpoints, traceCaseId, tracePage,
  }), enabled: open || Boolean(traceCaseId) });
  const data = query.isError ? undefined : query.data?.eventEvidence;
  const traceRef = useRef<HTMLElement>(null);
  const scrolledTrace = useRef<string | undefined>(undefined);
  const loadedTraceId = data?.trace?.caseId;
  useEffect(() => {
    if (loadedTraceId && loadedTraceId !== scrolledTrace.current) {
      scrolledTrace.current = loadedTraceId;
      traceRef.current?.scrollIntoView({ block: "start" });
    }
  }, [loadedTraceId]);
  return <section className="eda-cell" aria-label="Activities and event evidence">
    <h3>What was actually recorded?</h3>
    <p className="eda-caption">Count activity records, compare their case coverage, and inspect a case trace. All evidence belongs to the same selected whole cases.</p>
    <Button variant="outline" aria-expanded={open || Boolean(traceCaseId)} onClick={() => setOpen(!open)}>Explore activities and endpoint durations</Button>
    {(open || traceCaseId) && <div className="mt-5 space-y-6">
      {query.isPending && <LoadingBlock />}
      {query.isError && <><ErrorBlock error={query.error} retry={() => void query.refetch()} /><div className="flex gap-2">{endpoints && <Button variant="outline" onClick={() => setEndpoints(undefined)}>Clear endpoint query</Button>}{traceCaseId && <Button variant="outline" onClick={onCloseTrace}>Close unavailable trace</Button>}</div></>}
      {data && <>
        <p className="eda-note">{fmtInt(data.eligibleCases)} selected cases · {fmtInt(data.recordedEvents)} prepared event rows · {fmtInt(data.casesWithoutEvents)} cases without event records · {fmtInt(data.missingActivityEvents)} unnamed events · {fmtInt(data.undatedEvents)} undated events.</p>
        {data.trace && <section ref={traceRef} className="space-y-3" aria-label={`Event trace for ${data.trace.caseId}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Case trace: {data.trace.caseId}</h4><Button variant="ghost" size="sm" onClick={() => { onCloseTrace(); setTracePage(1); }}>Close trace</Button></div>
          <p className="eda-note">{fmtInt(data.trace.total)} recorded events · {fmtInt(data.trace.undatedEvents)} undated. Chronological order, then mapped order and stored row for ties. Equal timestamps do not establish business sequence; undated events appear last.</p>
          {data.trace.endpointStatus && <p className="text-sm">Endpoint status: {statuses[data.trace.endpointStatus as keyof typeof statuses] ?? data.trace.endpointStatus} · {duration(data.trace.endpointDays)}</p>}
          <Table><thead><tr><Th numeric>Position</Th><Th>Activity</Th><Th>Recorded timestamp</Th><Th>Lifecycle</Th><Th>Resource</Th></tr></thead><tbody>{data.trace.events.map((e) => <tr key={e.position}><Td numeric>{e.position}</Td><Td>{e.activity ?? "Unknown activity"}</Td><Td>{e.timestamp ?? "Unknown chronology"}{e.timestampTied && <small className="block text-text-muted">Timestamp tie</small>}</Td><Td>{e.lifecycle ?? "Not recorded"}</Td><Td>{e.resource ?? "Not recorded"}</Td></tr>)}</tbody></Table>
          <div className="flex items-center gap-3"><Button variant="outline" size="sm" disabled={tracePage === 1} onClick={() => setTracePage(tracePage - 1)}>Previous events</Button><span className="text-xs">Event page {tracePage}</span><Button variant="outline" size="sm" disabled={tracePage * data.trace.pageSize >= data.trace.total} onClick={() => setTracePage(tracePage + 1)}>Next events</Button></div>
        </section>}
        <section aria-label="Activity presence and repetition" className="space-y-3">
          <h4 className="font-semibold">Which activities occur, and how often do they repeat?</h4>
          <p className="eda-note">Presence = cases with ≥1 record. Repetition = cases with ≥2 records. Both percentages divide by all {fmtInt(data.eligibleCases)} selected cases, including zero occurrences. Repeated records do not establish rework.</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setActivitySearch(search); setActivityPage(1); }}>
            <label className="text-sm">Find an activity<Input value={search} maxLength={256} onChange={(e) => setSearch(e.target.value)} /></label><Button type="submit" size="sm">Search activities</Button>
          </form>
          <Table><thead><tr><Th>Activity</Th><Th numeric>Event occurrences</Th><Th numeric>Distinct cases · presence</Th><Th numeric>Repeated cases · repetition</Th><Th numeric>Cases with zero</Th></tr></thead>
            <tbody>{data.activities.map((r) => <tr key={r.activity === null ? "missing" : `value:${r.activity}`}><Td>{r.activity ?? "Unknown / missing activity"}</Td><Td numeric>{fmtInt(r.occurrences)}</Td><Td numeric>{fmtInt(r.cases)} · {r.presenceRate === null ? "Unavailable" : fmtShare(r.presenceRate)}</Td><Td numeric>{fmtInt(r.repeatedCases)} · {r.repetitionRate === null ? "Unavailable" : fmtShare(r.repetitionRate)}</Td><Td numeric>{fmtInt(r.zeroCases)}</Td></tr>)}</tbody>
          </Table>
          {!data.activities.length && <p>No activity records match this search.</p>}
          <p className="eda-note">Activities overlap: adding distinct-case counts across activities double counts cases. Search changes this list only.</p>
          <div className="flex items-center gap-3"><Button variant="ghost" size="sm" disabled={activityPage === 1} onClick={() => setActivityPage(activityPage - 1)}>Previous activities</Button><span className="text-xs">Page {activityPage} · {fmtInt(data.totalActivities)} matching activities</span><Button variant="ghost" size="sm" disabled={activityPage * data.activityPageSize >= data.totalActivities} onClick={() => setActivityPage(activityPage + 1)}>Next activities</Button></div>
        </section>
        <section className="space-y-3" aria-label="Define endpoint duration">
          <h4 className="font-semibold">How much time lies between two unambiguous endpoints?</h4>
          <p className="eda-note">Choose distinct activity names. A duration requires exactly one occurrence of each, dated in order. Repeated endpoints stay visible as ambiguous; no arbitrary first/last pairing is chosen.</p>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => {
            e.preventDefault(); const form = new FormData(e.currentTarget);
            const endpointStart = String(form.get("start") ?? ""), endpointEnd = String(form.get("end") ?? "");
            if (!endpointStart || !endpointEnd || endpointStart === endpointEnd) { setError("Choose two distinct, exact activity names."); return; }
            setError(""); setEndpoints({ endpointStart, endpointEnd });
          }}>
            <datalist id={listId}>{data.activities.filter((r) => r.activity !== null).map((r) => <option key={r.activity!} value={r.activity!} />)}</datalist>
            <label className="text-sm">Start activity<Input name="start" list={listId} maxLength={4096} defaultValue={endpoints?.endpointStart} required /></label>
            <label className="text-sm">End activity<Input name="end" list={listId} maxLength={4096} defaultValue={endpoints?.endpointEnd} required /></label>
            <Button size="sm" type="submit">Calculate endpoint coverage</Button>
            {endpoints && <Button size="sm" variant="ghost" onClick={() => setEndpoints(undefined)}>Clear endpoints</Button>}
          </form>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {data.endpoints && <Coverage coverage={data.endpoints} />}
        </section>
        <details className="eda-methods"><summary>Event evidence definitions</summary><ul>{data.notes.map((n) => <li key={n}>{n}</li>)}</ul></details>
      </>}
    </div>}
  </section>;
}
