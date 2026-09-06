import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RunCreate } from "@wise/api-schema";
import { useWorkbench } from "@/app/context";
import { useTrackJob } from "@/app/shell/JobTray";
import { EmptyState, ErrorBlock, QueryState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { runsQuery, useCreateRun } from "@/lib/queries";

export const runStatusVariant = { queued: "info", running: "accent", done: "success", failed: "danger", cancelled: "warning" } as const;
export const runStatusGlyph = { queued: "○", running: "◐", done: "●", failed: "✕", cancelled: "⊘" } as const;

function NewRunDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ctx = useWorkbench();
  const navigate = useNavigate();
  const create = useCreateRun(ctx.projectId);
  const track = useTrackJob(ctx.projectId);
  const normOptions = ctx.norms;
  const normJson = (id: string) => ctx.norms.find((n) => n.id === id)?.norm as { views?: { name: string }[] } | undefined;
  const [form, setForm] = useState<RunCreate>({
    caseTableId: ctx.caseTable?.id ?? ctx.caseTableIds[0] ?? "",
    normVersionId: ctx.norm?.id ?? normOptions.find((n) => n.status === "approved")?.id ?? "",
    views: ctx.run?.views ?? [],
    slicings: ctx.run?.slicings ?? [{ id: "case Vendor", attributes: ["case Vendor"] }],
    gamma: ctx.run?.gamma ?? 50,
    minCases: ctx.run?.minCases ?? 20,
    note: "",
  });
  const views = normJson(form.normVersionId)?.views?.map((v) => v.name) ?? ctx.run?.views ?? [];

  const submit = () => {
    create.mutate(
      { ...form, views: form.views?.length ? form.views : views },
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
      <DialogContent className="max-w-xl">
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
          <Field label="γ (shrinkage, in cases)" htmlFor="run-gamma" hint="A slice with n = γ keeps half of its gap.">
            <Input id="run-gamma" type="number" min={0} step={1} value={form.gamma ?? 50} onChange={(e) => setForm({ ...form, gamma: Number(e.target.value) })} />
          </Field>
          <Field label="min cases" htmlFor="run-min">
            <Input id="run-min" type="number" min={1} step={1} value={form.minCases ?? 20} onChange={(e) => setForm({ ...form, minCases: Number(e.target.value) })} />
          </Field>
          <fieldset className="sm:col-span-2">
            <legend className="text-xs font-medium text-text-muted">views</legend>
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
          <Field label="groupings (one per line: case attribute[, case attribute]; the id is the attributes joined by +)" htmlFor="run-slicings" className="sm:col-span-2" hint={ctx.caseTable?.attributes?.length ? `case table attributes: ${ctx.caseTable.attributes.join(", ")}` : undefined}>
            <Textarea
              id="run-slicings"
              className="font-mono text-xs"
              value={(form.slicings ?? []).map((s) => (s.attributes ?? []).join(", ")).join("\n")}
              onChange={(e) =>
                setForm({
                  ...form,
                  slicings: e.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const attributes = line.split(",").map((a) => a.trim()).filter(Boolean);
                      return { id: attributes.join("+"), attributes };
                    }),
                })
              }
            />
          </Field>
          <Field label="note" htmlFor="run-note" className="sm:col-span-2" hint="Period label and the reason for γ; shown in the ribbon as the period.">
            <Input id="run-note" value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="2018-H2, γ = 50 as in the baseline" />
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

/** S5 — runs list and the run form. */
export default function RunsPage() {
  const { t } = useTranslation();
  const ctx = useWorkbench();
  const runs = useQuery(runsQuery(ctx.projectId));
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-subtle">S5 · Scoring and calibration</p>
          <h1 className="text-2xl font-semibold">Runs</h1>
          <p className="text-sm text-text-muted">A run = case table × norm version × parameters; identical inputs return the existing run.</p>
        </div>
        <Button onClick={() => setOpen(true)} disabled={!ctx.norms.length}>
          New run
        </Button>
      </header>
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
