import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery as useFlowTypesQuery } from "@tanstack/react-query";
import { flowTypeOf, flowTypesQuery, scopeOf, useCreateScopedRun, type RunCreateC2, type SlicingSpecC2 } from "@/lib/api/cycle2";
import { useWorkbench } from "@/app/context";
import { useTrackJob } from "@/app/shell/JobTray";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { NextStep } from "@/components/guide/NextStep";
import { EmptyState, ErrorBlock, QueryState } from "@/components/states";
import { SliceDesigner } from "./SliceDesigner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { runsQuery } from "@/lib/queries";

export const runStatusVariant = { queued: "info", running: "accent", done: "success", failed: "danger", cancelled: "warning" } as const;
export const runStatusGlyph = { queued: "○", running: "◐", done: "●", failed: "✕", cancelled: "⊘" } as const;

const ALL_FLOWS = "__all__";

function NewRunDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ctx = useWorkbench();
  const navigate = useNavigate();
  const create = useCreateScopedRun(ctx.projectId);
  const track = useTrackJob(ctx.projectId);
  const normOptions = ctx.norms;
  const normJson = (id: string) => ctx.norms.find((n) => n.id === id)?.norm as { views?: { name: string }[] } | undefined;
  const parent = ctx.run;
  const [form, setForm] = useState<RunCreateC2>({
    caseTableId: ctx.caseTable?.id ?? ctx.caseTableIds[0] ?? "",
    normVersionId: ctx.norm?.id ?? normOptions.find((n) => n.status === "approved")?.id ?? "",
    views: parent?.views ?? [],
    slicings: (parent?.slicings as SlicingSpecC2[] | undefined) ?? [{ id: "case Vendor", attributes: ["case Vendor"] }],
    gamma: parent?.gamma ?? 20,
    minCases: parent?.minCases ?? 1,
    note: "",
    scope: flowTypeOf(parent) ? { flow_type: flowTypeOf(parent), attribute: scopeOf(parent)?.attribute ?? "flow_type" } : undefined,
  });
  const views = normJson(form.normVersionId)?.views?.map((v) => v.name) ?? parent?.views ?? [];
  const flowTypes = useFlowTypesQuery({ ...flowTypesQuery(ctx.projectId, form.caseTableId), enabled: !!form.caseTableId });
  const attributes = ctx.caseTable?.attributes?.length ? ctx.caseTable.attributes : ["case Vendor", "case Company", "case Spend area text", "case Item Type", "flow_type", "exposure"];

  const submit = () => {
    create.mutate(
      { ...form, views: form.views?.length ? form.views : views, slicings: (form.slicings ?? []).filter((s) => s.attributes.length > 0) },
      {
        onSuccess: (run) => {
          if (run.jobId) track({ id: run.jobId, kind: "score_run", status: "queued", progress: 0, attempts: 0, cancelRequested: false, createdAt: run.createdAt, updatedAt: run.createdAt }, `Score ${run.id} (${form.note || "no note"})`, { kind: "run", id: run.id });
          onOpenChange(false);
          void navigate({ to: "/p/$projectId/runs/$runId", params: { projectId: ctx.projectId, runId: run.id }, search: { tab: "monitor" } });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New run</DialogTitle>
          <DialogDescription>Scores the case table against a norm version. γ and min cases are human decisions: the note records why.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="case table" htmlFor="run-ct">
            <Select value={form.caseTableId} onValueChange={(v) => setForm({ ...form, caseTableId: v })}>
              <SelectTrigger id="run-ct" className="font-mono text-xs">
                <SelectValue placeholder="case table" />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([...(ctx.caseTable ? [ctx.caseTable.id] : []), ...ctx.caseTableIds])].map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="norm version" htmlFor="run-norm">
            <Select value={form.normVersionId} onValueChange={(v) => setForm({ ...form, normVersionId: v, views: [] })}>
              <SelectTrigger id="run-norm">
                <SelectValue placeholder="norm version" />
              </SelectTrigger>
              <SelectContent>
                {normOptions.map((n) => (
                  <SelectItem key={n.id} value={n.id}>
                    v{n.version} · {n.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="scope" htmlFor="run-scope" hint="Everything together, or one flow type on its own (R2-O10); applicability rules stay untouched.">
            <Select value={form.scope?.flow_type ?? ALL_FLOWS} onValueChange={(v) => setForm({ ...form, scope: v === ALL_FLOWS ? undefined : { flow_type: v, attribute: flowTypes.data?.attribute ?? "flow_type" } })}>
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="γ (small groups count less)" htmlFor="run-gamma" hint="A group with n = γ keeps half of its shortfall.">
              <Input id="run-gamma" type="number" min={0} step={1} value={form.gamma ?? 20} onChange={(e) => setForm({ ...form, gamma: Number(e.target.value) })} />
            </Field>
            <Field label="min cases" htmlFor="run-min">
              <Input id="run-min" type="number" min={1} step={1} value={form.minCases ?? 1} onChange={(e) => setForm({ ...form, minCases: Number(e.target.value) })} />
            </Field>
          </div>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-medium text-text-muted">perspectives</legend>
            <ul className="mt-1 flex flex-wrap gap-3">
              {views.map((v) => {
                const checked = form.views?.length ? form.views.includes(v) : true;
                return (
                  <li key={v} className="flex items-center gap-2">
                    <Checkbox
                      id={`view-${v}`}
                      checked={checked}
                      onCheckedChange={(c) => {
                        const current = form.views?.length ? form.views : views;
                        setForm({ ...form, views: c ? [...new Set([...current, v])] : current.filter((x) => x !== v) });
                      }}
                    />
                    <label htmlFor={`view-${v}`} className="text-sm">
                      {v}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <Field label="groupings" htmlFor="run-slicings" className="sm:col-span-2" hint="Combine up to three attributes per grouping; numeric attributes are banded. The id is the attributes joined by +.">
            <SliceDesigner attributes={attributes} value={(form.slicings ?? []) as SlicingSpecC2[]} onChange={(slicings) => setForm({ ...form, slicings })} />
          </Field>
          <Field label="note" htmlFor="run-note" className="sm:col-span-2" hint="Period label and the reason for γ; shown in the ribbon as the period.">
            <Input id="run-note" value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="2018-H2, γ = 20 as in the baseline" />
          </Field>
          {create.isError && (
            <div className="sm:col-span-2">
              <ErrorBlock error={create.error} />
            </div>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!form.caseTableId || !form.normVersionId || create.isPending}>
              Start run
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
  const [open, setOpen] = useState(false);
  const doneRun = ctx.runs.find((r) => r.status === "done");

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
        <Button onClick={() => setOpen(true)} disabled={!ctx.norms.length}>
          New run
        </Button>
      </header>
      {doneRun ? (
        <NextStep label="Open the ranked list" because="the latest run is scored; the signals list is where the analysis starts" to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: doneRun.id }} search={{ slicing: doneRun.slicings?.[0]?.id ?? undefined, view: doneRun.views?.[0] }} />
      ) : (
        <NextStep label="Start a run" because="scoring the case table against the norm produces the ranked list" onClick={() => setOpen(true)} />
      )}
      {open && <NewRunDialog open={open} onOpenChange={setOpen} />}
      <QueryState query={runs}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState title={t("empty.noRuns")} reason={t("empty.noRunsReason")} action={{ label: "Create a run", onClick: () => setOpen(true) }} />
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
                      <Td className="text-xs">{flowTypeOf(r) ? `${flowTypeOf(r)} only` : "all flow types"}</Td>
                      <Td className="font-mono text-xs">{ctx.norms.find((n) => n.id === r.normVersionId) ? `v${ctx.norms.find((n) => n.id === r.normVersionId)?.version}` : r.normVersionId}</Td>
                      <Td className="font-mono text-xs">{r.caseTableId}</Td>
                      <Td numeric>{fmtNum(r.gamma, 0)}</Td>
                      <Td numeric>{fmtNum(r.minCases, 0)}</Td>
                      <Td className="text-xs">{r.views?.join(", ")}</Td>
                      <Td className="text-xs">{r.slicings?.map((s) => (s.attributes ?? []).map((a) => a.replace(/^case /, "")).join(" × ")).join("; ")}</Td>
                      <Td className="text-xs">{fmtDateTime(r.manifest?.finishedAt)}</Td>
                      <Td>
                        {r.status === "done" && (
                          <Button asChild size="sm" variant="outline">
                            <Link to="/p/$projectId/runs/$runId/backlog" params={{ projectId: ctx.projectId, runId: r.id }} search={{ slicing: r.slicings?.[0]?.id ?? undefined, view: r.views?.[0] }}>
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
