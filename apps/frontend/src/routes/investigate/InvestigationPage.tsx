import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useWorkbench } from "@/app/context";
import { investigationRoute } from "@/app/router";
import { investigationQuery, type InvestigationQuestion, type InvestigationMetric } from "@/lib/api/investigation";
import { traceQuery } from "@/lib/queries";
import { useRunConstraintNames } from "@/lib/useRunConstraintNames";
import { fmtInt, fmtNum, fmtShare } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { BackControl } from "@/components/guide/BackControl";
import { FreezeButton } from "@/components/guide/Freeze";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { ProcessVariants } from "@/components/flow/ProcessVariants";
import { TraceTimeline } from "@/routes/slice/TraceTimeline";
import { cn } from "@/lib/utils";
import { QuestionControls } from "./QuestionControls";
import { familyLabels } from "./questionCopy";

export default function InvestigationPage() {
  const ctx = useWorkbench();
  const { runId } = investigationRoute.useParams();
  const search = investigationRoute.useSearch();
  const navigate = useNavigate();
  const {filter, family, activity, source, target, relation} = search;
  const params = {filter,family,activity,source,target,relation};
  const query = useQuery(investigationQuery(ctx.projectId, runId, params));
  const current = query.data?.questions.find(q => q.id === search.question) ?? query.data?.questions[0];
  const view = search.view ?? ctx.view;
  const slicing = search.slicing ?? ctx.slicing;
  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <BackControl />
        <h1 className="text-2xl font-semibold">Investigate a process question</h1>
        <p className="reading text-text-muted">Start with recorded behavior, inspect a path or item, then decide what to check or change.</p>
        {query.data && <p className="text-sm text-text-muted" data-testid="question-population">{fmtInt(query.data.selectedCases)} of {fmtInt(query.data.totalCases)} {query.data.caseNoun} in this selection. These measurements describe this run; the Process norm and scores stay unchanged.</p>}
        {search.filter !== undefined && <Button variant="outline" size="sm" onClick={() => void navigate({to: ".", search: {...search, filter: undefined}})}>Use all items in this run</Button>}
      </header>
      {query.data && <QuestionControls key={JSON.stringify(params)} params={params} activities={query.data.choices.activities} onApply={next=>void navigate({to:".",search:{...next,view:search.view,slicing:search.slicing,question:undefined}})} />}
      {query.isPending && <LoadingBlock rows={6} />}
      {query.isError && <ErrorBlock error={query.error} retry={() => void query.refetch()} action={{label:"Choose a different question",onClick:()=>void navigate({to:".",search:{view:search.view,slicing:search.slicing,filter:search.filter}})}} />}
      {query.data?.questions.length === 0 && <EmptyState title="No question profiles are available for this run." reason="Explore the flow or select constraints appropriate to the available activities." />}
      {current && query.data && (
        <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="surface min-w-0 space-y-2 p-3 lg:hidden">
            <label htmlFor="question-profile" className="block text-sm font-medium">Choose a recorded pattern ({query.data.questions.length})</label>
            <select id="question-profile" className="h-10 w-full min-w-0 rounded-md border border-border bg-surface px-2 text-sm" value={current.id} onChange={event => void navigate({to: ".", search: {...search, question: event.target.value}})}>
              {query.data.questions.map(q => <option key={q.id} value={q.id}>{familyLabels[q.family]}: {q.title}{q.status === "unavailable" ? " · not measured" : ""}</option>)}
            </select>
          </div>
          <p className="sr-only" role="status">Showing evidence: {current.title}</p>
          <nav aria-label="Process questions" className="surface hidden flex-col gap-1 p-2 lg:sticky lg:top-4 lg:flex lg:max-h-[65vh] lg:overflow-y-auto">
            <p className="px-3 py-2 text-xs text-text-muted">{query.data.questions.length} {query.data.questions.length === 1 ? "profile" : "profiles"} shown. Use an activity above to inspect a specific pattern.</p>
            {query.data.questions.map(q => <button key={q.id} type="button" aria-current={q.id === current.id ? "page" : undefined} onClick={() => void navigate({to: ".", search: {...search, question:q.id}})} className={cn("rounded-md p-3 text-left text-sm", q.id === current.id ? "bg-accent-subtle font-semibold text-accent-text" : "text-text hover:bg-surface-sunken")}>
              <span className="mb-1 block text-xs font-normal text-text-muted">{familyLabels[q.family]}</span>{q.title}{q.status === "unavailable" && <span className="mt-1 block text-xs font-normal text-text-muted">Not measured in this selection</span>}
            </button>)}
          </nav>
          <QuestionEvidence key={JSON.stringify([current.id,search.filter])} question={current} projectId={ctx.projectId} runId={runId} view={view} slicing={slicing} minCases={ctx.run?.minCases ?? undefined} caseNoun={query.data.caseNoun} />
        </div>
      )}
    </div>
  );
}

export function QuestionEvidence({question:q, projectId, runId, view, slicing, minCases, caseNoun}: {question:InvestigationQuestion;projectId:string;runId:string;view?:string;slicing?:string;minCases?:number;caseNoun:string}) {
  const [sample,setSample] = useState<string>();
  const plainOf = useRunConstraintNames(projectId, runId, sample !== undefined);
  const trace = useQuery({...traceQuery(projectId,runId,sample ?? ""),enabled:sample !== undefined});
  const filter = q.filter ? JSON.stringify(q.filter) : undefined;
  const preferred = q.family === "timing" || q.family === "sequence" ? ["affected_cases","median_hours","measured_pairs"] : q.family === "identity" ? ["events","identity_coverage","distinct_identities"] : q.family === "missingness" ? ["zero_event_cases","missing_timestamp_events","missing_activity_events"] : ["affected_cases","case_share","extra_events"];
  const primary = preferred.map(id=>q.metrics.find(m=>m.id===id)).filter((m):m is InvestigationMetric=>!!m);
  const columns = [...new Map((q.rows ?? []).flatMap(r=>r.metrics).map(m=>[m.id,m])).values()];
  return <article className="surface min-w-0 space-y-5 p-5" aria-label={q.title}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="mb-1 text-xs uppercase tracking-wide text-text-muted">{q.status === "observed" ? "Recorded behavior" : "Not assessable yet"}</p><h2 className="text-xl font-semibold">{q.title}</h2></div>
      <FreezeButton projectId={projectId} screen="investigation-question" context={{run_id:runId,view,slicing,filters:q.filter}} data={q} defaultTitle={q.title} />
    </header>
    <p className="reading text-base font-medium" data-testid="question-summary">{q.summary}</p>
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {primary.map(m => <div key={m.id} className="rounded-md border border-border p-3">
        <dt className="text-sm text-text-muted">{m.label.replace(/cases/gi,caseNoun)}</dt><dd className="my-1 text-xl font-semibold tnum">{metricValue(m,caseNoun)}</dd>
        {m.note && <p className="text-xs text-text-muted">{m.note}</p>}
      </div>)}
    </dl>
    <details className="rounded-md border border-border p-3 text-sm"><summary className="cursor-pointer font-medium">Measurement details and data coverage</summary><p className="reading mt-2">{q.measurement}</p><dl className="mt-3 divide-y divide-border">{q.metrics.map(m=><div key={m.id} className="py-2 sm:grid sm:grid-cols-2 sm:gap-4"><dt>{m.label.replace(/cases/gi,caseNoun)}{m.note && <span className="block text-xs text-text-muted">{m.note}</span>}</dt><dd className="tnum">{metricValue(m,caseNoun)}</dd></div>)}</dl></details>
    {!!q.rows?.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-2 text-left font-medium">Recorded data by activity or attribute</caption><thead><tr><th className="border-b border-border p-2">Activity or attribute</th>{columns.map(m=><th className="border-b border-border p-2" key={m.id}>{m.label.replace(/cases/gi,caseNoun)}</th>)}</tr></thead><tbody>{q.rows.map(r=><tr key={r.label}><th scope="row" className="border-b border-border p-2 font-normal">{r.label}</th>{columns.map(c=><td key={c.id} className="border-b border-border p-2 tnum">{r.metrics.find(m=>m.id===c.id) ? metricValue(r.metrics.find(m=>m.id===c.id)!,caseNoun) : "—"}</td>)}</tr>)}</tbody></table></div>}
    <section className="rounded-md border border-border bg-surface-sunken p-4" aria-label="Interpretation limits"><h3 className="font-semibold">Before calling this a problem</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{q.limitations.map(l=><li key={l}>{l}</li>)}</ul></section>
    {q.status === "observed" && q.filter !== null && <section className="space-y-3"><h3 className="font-semibold">Inspect the affected {caseNoun}</h3><div className="flex flex-wrap gap-2">
      <ProcessVariants projectId={projectId} runId={runId} filter={filter} />
      <Button variant="outline" size="sm" asChild><Link to="/p/$projectId/runs/$runId/flow" params={{projectId,runId}} search={{view,slicing,filter,render:"map"}}>Open their process map</Link></Button>
      {typeof minCases === "number" && Number.isSafeInteger(minCases) && minCases >= 1
        ? <Button variant="outline" size="sm" asChild><Link to="/p/$projectId/runs/$runId/backlog" params={{projectId,runId}} search={{view,slicing,filter,minCases,sort:"-stable_PI"}}>Find the groups to investigate</Link></Button>
        : <Button variant="outline" size="sm" disabled title="The assessment's minimum group size is not available yet.">Find the groups to investigate</Button>}
    </div><div className="flex flex-wrap gap-2">{q.exampleCaseIds.map(id=><Button key={id} variant="ghost" size="sm" onClick={()=>setSample(id)}>Example item {id}</Button>)}</div></section>}
    {q.filter === null && <p role="status" className="text-sm text-text-muted">This relationship cannot yet be carried as an exact selection to the map or ranking. The measured results above remain available.</p>}
    {sample && <section aria-label="Example timeline" className="space-y-2"><h3 className="font-semibold">Example item {sample}</h3><Button variant="ghost" size="sm" onClick={()=>setSample(undefined)}>Close example</Button>{trace.isPending && <LoadingBlock rows={3}/>} {trace.isError && <ErrorBlock error={trace.error} retry={()=>void trace.refetch()}/>} {trace.data && <TraceTimeline trace={trace.data} plainOf={plainOf}/>}</section>}
    <section className="border-t border-border pt-4"><h3 className="font-semibold">A useful next step</h3><p className="reading mt-2">{q.nextCheck}</p><details className="mt-3 text-sm"><summary className="cursor-pointer text-accent-text">Additional evidence to request</summary><ul className="mt-2 list-disc space-y-1 pl-5">{q.contextNeeded.map(c=><li key={c}>{c}</li>)}</ul></details><p className="mt-3 text-xs text-text-muted">To keep an investigation, open a group, choose Why, and record a decision with a reason and owner role. This does not approve a process change.</p></section>
  </article>;
}

function metricValue(m:InvestigationMetric, noun:string) {
  if (m.value === null) return "Unavailable";
  if (m.unit === "share") return fmtShare(m.value);
  return `${fmtNum(m.value,Number.isInteger(m.value) ? 0 : 1)} ${m.unit === "cases" ? noun : m.unit}`;
}
