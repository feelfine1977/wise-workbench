import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery as useFlowTypesQuery } from "@tanstack/react-query";
import { flowTypeOf, flowTypesQuery, scopeOf, useCreateScopedRun, type RunCreate as RunCreateC2 } from "@/lib/api/runs";
import type { SlicingSpec as SlicingSpecC2 } from "@/lib/api/exploration";
import { runsRoute } from "@/app/router";
import { analysisSelectionsQuery } from "@/lib/api/analysisSelections";
import { useWorkbench } from "@/app/context";
import { useTrackJob } from "@/app/shell/JobTray";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { EmptyState, ErrorBlock, QueryState } from "@/components/states";
import { SliceDesigner } from "./SliceDesigner";
import { GroupingSuggestions } from "./GroupingSuggestions";
import { groupingSuggestionsQuery, uniqueSlicingId } from "@/lib/api/groupingSuggestions";
import { withGeneralBenchmark, generalBenchmarkName } from "@/routes/norms/viewMembership";
import type { NormDocument } from "@/routes/norms/normAuthoring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { caseTableQuery, caseTablesQuery } from "@/lib/queries";
import { viewColor } from "@/lib/viewColors";
import { runsQuery } from "@/lib/api/runs";

export const runStatusVariant = { queued: "info", running: "accent", done: "success", failed: "danger", cancelled: "warning" } as const;
export const runStatusGlyph = { queued: "○", running: "◐", done: "●", failed: "✕", cancelled: "⊘" } as const;

const ALL_FLOWS = "__all__";

function NewRunDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ctx = useWorkbench();
  const navigate = useNavigate();
  const create = useCreateScopedRun(ctx.projectId);
  const track = useTrackJob(ctx.projectId);
  const normOptions = ctx.norms;
  const normJson = (id: string) => {
    const document = ctx.norms.find((n) => n.id === id)?.norm;
    return document ? withGeneralBenchmark(document as NormDocument) : undefined;
  };
  const parent = ctx.run;
  const setup = runsRoute.useSearch();
  const [form, setForm] = useState<RunCreateC2>({
    caseTableId: setup.caseTable ?? ctx.caseTable?.id ?? ctx.caseTableIds[0] ?? "",
    normVersionId: ctx.norm?.id ?? normOptions.find((n) => n.status === "approved")?.id ?? normOptions[0]?.id ?? "",
    views: parent?.views ?? undefined,
    slicings: (parent?.slicings as SlicingSpecC2[] | undefined) ?? [],
    gamma: parent?.gamma ?? 20,
    minCases: parent?.minCases ?? 1,
    note: "",
    scope: (setup.selection || setup.flowType) ? { ...(setup.selection ? { selection_id: setup.selection } : {}), ...(setup.flowType ? { flow_type: setup.flowType } : {}) } : scopeOf(parent),
  });
  const [focusLayer, setFocusLayer] = useState("");
  const [focusConstraint, setFocusConstraint] = useState("");
  const views = normJson(form.normVersionId)?.views?.map((v) => v.name) ?? parent?.views ?? [];
  const tables = useQuery(caseTablesQuery(ctx.projectId));
  const selectedTable = useQuery({ ...caseTableQuery(ctx.projectId, form.caseTableId), enabled: !!form.caseTableId });
  useEffect(() => {
    const first = tables.data?.find((table) => table.status === "ready" && table.datasetId === ctx.datasetBinding?.datasetId);
    if (first) setForm((previous) => previous.caseTableId ? previous : { ...previous, caseTableId: first.id });
  }, [tables.data, ctx.datasetBinding?.datasetId]);
  const effectiveDocument = normJson(form.normVersionId);
  const benchmarkName = effectiveDocument ? generalBenchmarkName(effectiveDocument) : undefined;
  const selectedViews = [...new Set([...(form.views ?? views), ...(benchmarkName ? [benchmarkName] : [])])];
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const flowTypes = useFlowTypesQuery({ ...flowTypesQuery(ctx.projectId, form.caseTableId, undefined, 0.05, form.scope?.selection_id ?? undefined), enabled: !!form.caseTableId });
  const selections = useQuery({ ...analysisSelectionsQuery(ctx.projectId, form.caseTableId), enabled: !!form.caseTableId });
  const chosenSelection = selections.data?.find((s) => s.id === form.scope?.selection_id);
  const tableMatchesProject = ctx.datasetBindingState === "bound" && selectedTable.data?.datasetId === ctx.datasetBinding?.datasetId;
  const suggestionsEnabled = tableMatchesProject && !!form.normVersionId && selectedViews.length > 0 && (!form.scope?.selection_id || !!chosenSelection);
  const suggestions = useQuery({ ...groupingSuggestionsQuery(ctx.projectId, form.caseTableId, {
    normVersionId: form.normVersionId, views: selectedViews, scope: form.scope ?? undefined,
    focusLayer: focusLayer || undefined, focusConstraint: focusConstraint || undefined, minCases: form.minCases ?? 1,
  }), enabled: suggestionsEnabled });
  // Hide evidence synchronously for every new key, including a return to a cached key.
  const suggestionData = suggestionsEnabled && !suggestions.isFetching && !suggestions.isError ? suggestions.data : undefined;
  const attributes = [...new Set([...(selectedTable.data?.attributes ?? []), ...(suggestionData?.attributes.map((a) => a.name) ?? [])])];
  const attributeTypes = Object.fromEntries((suggestionData?.attributes ?? []).map((a) => [a.name, a.type]));
  const normDocument = normJson(form.normVersionId);

  const submit = () => {
    if (!tableMatchesProject || (form.scope?.selection_id && !chosenSelection)) return;
    create.mutate(
      { ...form, views: selectedViews, slicings: (form.slicings ?? []).filter((s) => s.attributes.length > 0) },
      {
        onSuccess: (run) => {
          if (run.jobId) track({ id: run.jobId, kind: "score_run", status: run.status, progress: run.status === "done" ? 1 : 0, attempts: 0, cancelRequested: false, createdAt: run.createdAt, updatedAt: run.createdAt }, `Score ${run.id} (${form.note || "no note"})`, { kind: "run", id: run.id });
          void navigate({ to: "/p/$projectId/runs/$runId", params: { projectId: ctx.projectId, runId: run.id }, search: { tab: "monitor" }, state: { reusedAssessmentId: run.status === "done" ? run.id : undefined } });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New run</DialogTitle>
          <DialogDescription>Assess the project’s fixed dataset with a Process norm, a saved filter and selected views. Existing runs remain unchanged.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Prepared dataset" htmlFor="run-ct">
            <Select value={form.caseTableId} onValueChange={(v) => setForm({ ...form, caseTableId: v, slicings: [], scope: undefined })}>
              <SelectTrigger id="run-ct" className="text-sm">
                <SelectValue placeholder="case table" />
              </SelectTrigger>
              <SelectContent>
                {(tables.data ?? []).filter((table) => table.status === "ready" && table.datasetId === ctx.datasetBinding?.datasetId).map((table, index) => (
                  <SelectItem key={table.id} value={table.id}>
                    {ctx.datasets.find((d) => d.id === table.datasetId)?.name ?? "Dataset"} · preparation {index + 1} · {table.cases.toLocaleString()} cases
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="norm version" htmlFor="run-norm">
            <Select value={form.normVersionId} onValueChange={(v) => { setForm({ ...form, normVersionId: v, views: undefined }); setFocusLayer(""); setFocusConstraint(""); }}>
              <SelectTrigger id="run-norm">
                <SelectValue placeholder="norm version" />
              </SelectTrigger>
              <SelectContent>
                {normOptions.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    {String(n.norm.name ?? "Process norm")} · v{n.version} · {n.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Analysis filter" htmlFor="run-selection" className="sm:col-span-2" hint="Every chart, finding and case in this run uses the saved cases. Selecting a flow type narrows them further.">
            <select id="run-selection" className="h-control w-full rounded border border-border bg-surface px-2" value={form.scope?.selection_id ?? ""} onChange={(e) => setForm({ ...form, scope: e.target.value ? { selection_id: e.target.value } : undefined })}>
              <option value="">All prepared cases</option>
              {form.scope?.selection_id && !chosenSelection && <option value={form.scope.selection_id}>Loading requested filter…</option>}
              {selections.data?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.cases.toLocaleString()} cases</option>)}
            </select>
            {selections.isError && <ErrorBlock error={selections.error} retry={() => void selections.refetch()} />}
          </Field>
          <Field label="Flow type" htmlFor="run-scope" hint="Within the analysis filter above; applicability rules stay untouched.">
            <Select value={form.scope?.flow_type ?? ALL_FLOWS} onValueChange={(v) => setForm({ ...form, scope: v === ALL_FLOWS && !form.scope?.selection_id ? undefined : { ...(form.scope?.selection_id ? { selection_id: form.scope.selection_id } : {}), ...(v === ALL_FLOWS ? {} : { flow_type: v, attribute: flowTypes.data?.attribute ?? "flow_type" }) } })}>
            <SelectTrigger id="run-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FLOWS}>all flow types together</SelectItem>
                {(flowTypes.data?.types ?? []).map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    {t.name} only ({t.cases.toLocaleString("en")} cases)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Button variant="outline" size="sm" aria-expanded={advancedOpen} aria-controls="run-advanced" onClick={() => setAdvancedOpen(!advancedOpen)}>Advanced settings</Button>
            {advancedOpen && <div id="run-advanced" className="mt-2 grid grid-cols-2 gap-3">
            <Field label="γ (small groups count less)" htmlFor="run-gamma" hint="A group with n = γ keeps half of its shortfall.">
              <Input id="run-gamma" type="number" min={0} step={1} value={form.gamma ?? 20} onChange={(e) => setForm({ ...form, gamma: Number(e.target.value) })} />
            </Field>
            <Field label="min cases" htmlFor="run-min">
              <Input id="run-min" type="number" min={1} step={1} value={form.minCases ?? 1} onChange={(e) => setForm({ ...form, minCases: Number(e.target.value) })} />
            </Field>
            </div>}
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-medium text-text-muted">Views to assess</legend>
            {benchmarkName && <p className="my-2 text-sm"><strong>{benchmarkName}</strong> · always included · equal weight per participating layer</p>}
            <ul className="mt-1 flex flex-wrap gap-3">
              {views.filter((v) => v !== benchmarkName).map((v) => {
                const checked = selectedViews.includes(v);
                return (
                  <li key={v} className="flex items-center gap-2">
                    <Checkbox
                      id={`view-${v}`}
                      checked={checked}
                      onCheckedChange={(c) => {
                        const current = selectedViews;
                        setForm({ ...form, views: c ? [...new Set([...current, v])] : current.filter((x) => x !== v) });
                      }}
                    />
                    <label htmlFor={`view-${v}`} className="border-b-2 text-sm" style={{ borderColor: viewColor(v) }}>
                      {v}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <Field label="Suggestion focus layer" htmlFor="grouping-layer" hint="Optional focus for discovery; this does not change what the run scores.">
            <select id="grouping-layer" className="h-control w-full rounded border border-border bg-surface px-2" value={focusLayer} onChange={(e) => { setFocusLayer(e.target.value); setFocusConstraint(""); }}>
              <option value="">All selected-view layers</option>
              {normDocument?.layers?.map((l) => <option key={l.id} value={l.id}>{l.name || l.id}</option>)}
            </select>
          </Field>
          <Field label="Suggestion focus constraint" htmlFor="grouping-constraint">
            <select id="grouping-constraint" className="h-control w-full rounded border border-border bg-surface px-2" value={focusConstraint} onChange={(e) => setFocusConstraint(e.target.value)}>
              <option value="">All selected-view constraints</option>
              {normDocument?.constraints?.filter((c) => !focusLayer || c.layer === focusLayer).map((c) => <option key={c.id} value={c.id}>{c.description || c.id}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            {suggestionsEnabled && suggestions.isFetching && <p role="status" className="text-xs">Evaluating context combinations for this selection…</p>}
            {suggestionsEnabled && suggestions.isError && <div><p className="text-xs">Grouping suggestions unavailable; custom groupings remain available.</p><ErrorBlock error={suggestions.error} retry={() => void suggestions.refetch()} /></div>}
            {suggestionData && <GroupingSuggestions key={suggestionData.evidence.fingerprint} selectionName={chosenSelection?.name} data={suggestionData} chosen={form.slicings ?? []} onAdd={(s) => setForm((previous) => {
              const rows = previous.slicings ?? [];
              return { ...previous, slicings: [...rows, { attributes: s.attributes, bands: s.bands, id: uniqueSlicingId(s, rows) }] };
            })} />}
          </div>
          <Field label="groupings" htmlFor="run-slicings" className="sm:col-span-2" hint="Add as many groupings as needed, with 1–3 context columns each. Numeric columns use bands; each row has a unique id.">
            <SliceDesigner attributes={attributes} attributeTypes={attributeTypes} value={(form.slicings ?? []) as SlicingSpecC2[]} onChange={(slicings) => setForm({ ...form, slicings })} />
          </Field>
          <Field label="note" htmlFor="run-note" className="sm:col-span-2" hint="Period label and the reason for γ; shown in the ribbon as the period.">
            <Input id="run-note" value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="2018-H2, γ = 20 as in the baseline" />
          </Field>
          {tables.isError && <ErrorBlock error={tables.error} />}
          {!tables.isPending && !tables.data?.some((table) => table.status === "ready") && <p className="text-sm sm:col-span-2">Prepare a dataset first: <Link to="/p/$projectId/data" params={{ projectId: ctx.projectId }} className="text-accent-text underline">select data and build its case table</Link>.</p>}
          {!tableMatchesProject && <p role="status" className="text-sm text-warning sm:col-span-2">Choose and fix this project’s dataset in Data before starting a run.</p>}
          {!selectedViews.length && <p className="text-sm text-warning sm:col-span-2">Select at least one view.</p>}
          {create.isError && (
            <div className="sm:col-span-2">
              <ErrorBlock error={create.error} />
            </div>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!tableMatchesProject || (!!form.scope?.selection_id && !chosenSelection) || !form.caseTableId || !form.normVersionId || !selectedViews.length || selectedTable.data?.status !== "ready" || !(form.slicings ?? []).some((s) => s.attributes.length > 0) || create.isPending}>
              {create.isPending ? "Starting run…" : "Start run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Run — runs list and the run form with the slice designer and the flow-type scope. */
export default function RunsPage() {
  const { t } = useTranslation();
  const ctx = useWorkbench();
  const runs = useQuery(runsQuery(ctx.projectId));
  const setup = runsRoute.useSearch();
  const navigate = useNavigate();
  const open = setup.new === true;
  const setOpen = (next: boolean) => void navigate({ to: ".", search: previous => ({ ...previous, new: next ? true : undefined }), replace: !next });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-wide text-text-subtle">Run · scoring</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Runs
            <HowToReadToggle id="runs" />
          </h1>
          <p className="reading text-base text-text-muted">A run scores one case table against one norm version with chosen groupings; identical inputs return the existing run.</p>
          <HowToRead id="runs">
            Start a run to get the ranked list. In the form, <strong>groupings</strong> combine up to three attributes (numeric ones in bands) and <strong>scope</strong> restricts the run to one flow type. A run with a scope shows in the ribbon's flow-type switcher.
          </HowToRead>
        </div>
        <Button onClick={() => setOpen(true)} disabled={!ctx.norms.length || ctx.datasetBindingState !== "bound"}>
          New run
        </Button>
      </header>
      {ctx.datasetBindingState === "unbound" && <p className="text-sm">Fix the project dataset first in <Link to="/p/$projectId/data" params={{ projectId: ctx.projectId }} className="text-accent-text underline">Data</Link>.</p>}
      {!ctx.isLoading && !ctx.norms.length && <p className="text-sm text-text-muted">Create a Process norm before starting a run. <Link className="text-accent-text underline" to="/p/$projectId/norms" params={{ projectId: ctx.projectId }}>Create or import a Process norm</Link></p>}
      {open && !ctx.isLoading && ctx.norms.length > 0 && <NewRunDialog open={open} onOpenChange={setOpen} />}
      <QueryState query={runs}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={t("empty.noRuns")} reason={t("empty.noRunsReason")} action={ctx.norms.length ? { label: "Create a run", onClick: () => setOpen(true) } : undefined} />
          ) : (
            <Card>
              <CardTitle>All runs</CardTitle>
              <Table>
                <thead>
                  <tr>
                    <Th>run</Th>
                    <Th>status</Th>
                    <Th>period / note</Th>
                    <Th>scope</Th>
                    <Th>norm</Th>
                    <Th>case table</Th>
                    <Th numeric>γ</Th>
                    <Th numeric>min cases</Th>
                    <Th>views</Th>
                    <Th>slicings</Th>
                    <Th>finished</Th>
                    <Th>
                      <span className="sr-only">{t("app.actions")}</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {[...list].reverse().map((r) => (
                    <tr key={r.id} className={r.id === ctx.run?.id ? "bg-selection/40" : undefined}>
                      <Td>
                        <Link className="font-mono text-accent-text underline" to="/p/$projectId/runs/$runId" params={{ projectId: ctx.projectId, runId: r.id }} search={{ tab: "monitor" }}>
                          {r.id}
                        </Link>
                      </Td>
                      <Td>
                        <Badge variant={runStatusVariant[r.status]}>
                          <span aria-hidden>{runStatusGlyph[r.status]}</span>
                          {r.status}
                        </Badge>
                      </Td>
                      <Td>{r.note}</Td>
                      <Td className="text-xs">{scopeOf(r)?.selection_id ? "Saved filter · " : ""}{flowTypeOf(r) ? `${flowTypeOf(r)} only` : "all flow types"}</Td>
                      <Td className="text-sm">{ctx.norms.find((n) => n.id === r.normVersionId) ? `v${ctx.norms.find((n) => n.id === r.normVersionId)?.version}` : r.normVersionId}</Td>
                      <Td className="text-sm">{r.caseTableId}</Td>
                      <Td numeric>{fmtNum(r.gamma, 0)}</Td>
                      <Td numeric>{fmtNum(r.minCases, 0)}</Td>
                      <Td className="text-xs">{r.views?.join(", ")}</Td>
                      <Td className="text-xs">{r.slicings?.map((s) => (s.attributes ?? []).map((a) => a.replace(/^case /, "")).join(" × ")).join("; ")}</Td>
                      <Td className="text-xs">{fmtDateTime(r.manifest?.finishedAt)}</Td>
                      <Td>
                        {r.status === "done" && (
                          <Button asChild size="sm" variant="outline">
                            <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: r.id }} search={{ slicing: r.slicings?.[0]?.id ?? undefined, view: r.views?.[0], minCases: r.minCases ?? undefined }}>
                              Backlog
                            </Link>
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )
        }
      </QueryState>
    </div>
  );
}
