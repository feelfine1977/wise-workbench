import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { driverEvidenceQuery, type DriverEvidenceParams } from "@/lib/api/driverEvidence";
import { notServed } from "@/lib/api/compatibility";
import { fmtInt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { SolutionCardEvidence } from "./SolutionCardEvidence";
import { Link } from "@tanstack/react-router";

export function DriverEvidencePanel({ projectId, runId, params, within, groupName }: {
  projectId: string;
  runId: string;
  params: DriverEvidenceParams;
  within?: string;
  groupName: string;
}) {
  const headingId = useId();
  const options = driverEvidenceQuery(projectId, runId, params);
  const scopeKey = JSON.stringify(options.queryKey);
  const [requestedScope, setRequestedScope] = useState<string | null>(null);
  const requested = requestedScope === scopeKey;
  const unavailable = within !== undefined || !params.slicing;
  const query = useQuery({ ...options, enabled: requested && !unavailable });
  const busy = requested && !unavailable && query.isFetching;
  return <section aria-labelledby={headingId} aria-busy={busy} className="py-1" data-testid="driver-evidence">
    <h4 id={headingId} className="text-sm font-semibold">Measured event evidence</h4>
    <p className="mt-1 break-words text-xs text-text-muted">Group {groupName} · {params.view ?? "run’s default view"} · {params.filter === undefined ? "no additional filter" : "exact filter from this address"}. View does not change these event measurements.</p>
    {unavailable ? <p className="mt-2 text-sm text-text-muted">{within !== undefined ? "Event evidence is unavailable for this drilled selection. No whole-group evidence was substituted." : "Choose a grouping to measure event evidence."}</p> : !requested ? <div className="mt-3">
      <Button variant="outline" size="sm" onClick={() => setRequestedScope(scopeKey)}>Measure evidence for this selection</Button>
      <p className="mt-1 text-xs text-text-muted">Load the solution card’s counts and timing when you need them. Measurements use the saved run and this selection.</p>
    </div> : busy || query.isPending ? <p role="status" className="mt-3 text-sm text-text-muted">Measuring events for this exact run, group and filter… The suggestions remain available while this loads.</p> : query.isError ? <div className="mt-3" role="status">
      <p className="text-sm text-text-muted">{notServed(query.error) ? "This backend does not provide event evidence for this expectation." : query.error instanceof ApiError ? query.error.problem?.detail ?? "Event evidence could not be measured for this selection." : "Event evidence could not be loaded for this selection."}</p>
      <Button variant="outline" size="sm" className="mt-2" onClick={() => void query.refetch()}>Retry event evidence</Button>
    </div> : query.data ? <>
      <p className="mt-2 text-sm text-text" data-testid="driver-evidence-counts"><strong>{fmtInt(query.data.scope.selectedCases)} {query.data.scope.caseNoun}</strong> in this evidence population · {fmtInt(query.data.scope.groupCases)} in the saved run’s whole group · {fmtInt(query.data.scope.runCases)} in the saved run.</p>
      <p className="mt-1 text-xs text-text-muted">All selected cases are included; the rule’s applicability condition is not applied. These event measurements do not estimate the whole-group score scenario above, an action’s benefit or its cause.</p>
      {query.data.status === "unavailable" && <p className="mt-2 text-sm text-text-muted">{query.data.reason ?? "Event evidence is unavailable for this expectation."}</p>}
      <SolutionCardEvidence data={query.data} />
      {query.data.solutionCard?.hubNode && <Link to="/p/$projectId/knowledge/$nodeId" params={{ projectId, nodeId: query.data.solutionCard.hubNode }} className="text-sm text-accent-text underline">Open this solution-card template in Knowledge Hub →</Link>}
      {query.data.caveats.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-xs text-text-muted">Measurement limits</summary><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-text-muted">{query.data.caveats.map(c => <li key={c}>{c}</li>)}</ul></details>}

      <details className="mt-2"><summary className="cursor-pointer text-xs text-text-muted">Exact evidence scope</summary><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all text-xs">
        <dt>Run</dt><dd>{query.data.source.runId}</dd><dt>Grouping</dt><dd>{query.data.scope.slicing}</dd><dt>Group key</dt><dd>{JSON.stringify(query.data.scope.key)}</dd><dt>Filter</dt><dd>{query.data.scope.filter === null ? "None" : JSON.stringify(query.data.scope.filter)}</dd><dt>Norm version</dt><dd>{query.data.source.normVersionId}</dd><dt>Prepared table</dt><dd>{query.data.source.caseTableId}</dd><dt>Run cohort</dt><dd>{query.data.source.selectionId ?? "All cases in the saved run scope"}</dd>
      </dl></details>
    </> : null}
  </section>;
}
