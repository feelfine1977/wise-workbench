import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ColumnMapping, DatasetVersion } from "@wise/api-schema";
import { useWorkbench } from "@/app/context";
import { datasetRoute } from "@/app/router";
import { useTrackJob } from "@/app/shell/JobTray";
import { ReadinessBanner } from "@/components/readiness";
import { ErrorBlock, LoadingBlock, QueryState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardTitle, Table, Td, Th } from "@/components/ui/misc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtInt, fmtPct } from "@/lib/format";
import { caseTableQuery, datasetQuery, mappingSuggestionQuery, useCreateMapping, useJob } from "@/lib/queries";

const NONE = "__none__";

/** Follows the build job and re-scopes the screen to the new case table when it finishes. */
function MappingJobFollower({ jobId, onDone }: { jobId: string; onDone: (caseTableId: string) => void }) {
  const job = useJob(jobId);
  const ref = job.data?.status === "done" ? (job.data.resultRef ?? undefined) : undefined;
  useEffect(() => {
    const id = ref?.split(":")[1];
    if (id) onDone(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
  return (
    <p className="text-xs text-text-muted" aria-live="polite">
      Build job {jobId}: {job.data?.status ?? "queued"} · {job.data?.message ?? ""}
    </p>
  );
}

function guess(columns: string[], patterns: RegExp[]): string {
  for (const p of patterns) {
    const hit = columns.find((c) => p.test(c));
    if (hit) return hit;
  }
  return "";
}

function ColumnProfiler({ dataset }: { dataset: DatasetVersion }) {
  const cols = dataset.columns ?? [];
  return (
    <Card>
      <CardTitle>Column profiler · {fmtInt(cols.length)} columns</CardTitle>
      <Table>
        <thead>
          <tr>
            <Th>column</Th>
            <Th>type</Th>
            <Th numeric>nulls</Th>
            <Th numeric>distinct</Th>
            <Th>sample</Th>
          </tr>
        </thead>
        <tbody>
          {cols.map((c) => (
            <tr key={c.name}>
              <Td className="font-mono text-xs">{c.name}</Td>
              <Td>
                <Badge variant="outline">{c.dtype}</Badge>
              </Td>
              <Td numeric>{fmtPct(c.nulls, 1)}</Td>
              <Td numeric>{fmtInt(c.distinct)}</Td>
              <Td className="max-w-md truncate font-mono text-xs text-text-muted" title={(c.sample ?? []).map(String).join(", ")}>
                {(c.sample ?? []).map(String).join(", ")}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function ColumnSelect({ id, value, onChange, columns, allowNone }: { id: string; value: string; onChange: (v: string) => void; columns: string[]; allowNone?: boolean }) {
  return (
    <Select value={value || (allowNone ? NONE : "")} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger id={id} className="font-mono text-xs">
        <SelectValue placeholder="choose a column" />
      </SelectTrigger>
      <SelectContent>
        {allowNone && <SelectItem value={NONE}>none</SelectItem>}
        {columns.map((c) => (
          <SelectItem key={c} value={c}>
            <span className="font-mono text-xs">{c}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** S1–S2 — column profiler, mapping form (incl. header events) and the readiness report of the built case table. */
export default function DatasetPage() {
  const ctx = useWorkbench();
  const { datasetId } = datasetRoute.useParams();
  const search = datasetRoute.useSearch();
  const navigate = useNavigate();
  const track = useTrackJob(ctx.projectId);
  const dataset = useQuery(datasetQuery(ctx.projectId, datasetId));
  const caseTable = useQuery({ ...caseTableQuery(ctx.projectId, search.caseTable ?? ""), enabled: !!search.caseTable });
  const suggestion = useQuery({ ...mappingSuggestionQuery(ctx.projectId, datasetId), enabled: dataset.data?.status === "ready" });
  const create = useCreateMapping(ctx.projectId, datasetId);

  const columns = useMemo(() => (dataset.data?.columns ?? []).map((c) => c.name).filter((n): n is string => !!n), [dataset.data]);
  const [form, setForm] = useState<ColumnMapping>({ caseId: "", activity: "", timestamp: "" });
  const activityCol = form.activity || guess(columns, [/^event concept:name$/i, /^activity$/i, /activity/i, /^(?!case ).*concept:name$/i]);
  const activityValues = useMemo(() => {
    const col = dataset.data?.columns?.find((c) => c.name === activityCol);
    return [...new Set([...(col?.sample ?? []).map(String), ...(form.headerEvents ?? [])])];
  }, [dataset.data, activityCol, form.headerEvents]);

  // The backend guesses the mapping from the column names (exact presets for known logs); the form opens prefilled.
  useEffect(() => {
    if (!columns.length) return;
    const guessed = suggestion.data?.mapping;
    setForm((f) => {
      if (f.caseId || f.activity || f.timestamp) return f;
      if (guessed) return { ...guessed, caseAttributes: guessed.caseAttributes ?? [], headerEvents: guessed.headerEvents ?? [] };
      if (suggestion.isPending) return f;
      return {
        ...f,
        caseId: guess(columns, [/^case concept:name$/i, /case.?id/i, /^case$/i, /^case /i]),
        activity: guess(columns, [/^event concept:name$/i, /^activity$/i, /activity/i, /^(?!case ).*concept:name$/i]),
        timestamp: guess(columns, [/time:timestamp/i, /timestamp/i, /time/i]),
        resource: guess(columns, [/org:resource/i, /resource/i, /user/i]) || undefined,
        caseAttributes: columns.filter((c) => /^case /.test(c) && !/concept:name/.test(c)).slice(0, 6),
      };
    });
  }, [columns, suggestion.data, suggestion.isPending]);

  const toggle = (key: "caseAttributes" | "headerEvents", value: string) =>
    setForm((f) => {
      const list = new Set(f[key] ?? []);
      if (list.has(value)) list.delete(value);
      else list.add(value);
      return { ...f, [key]: [...list] };
    });

  const submit = () => {
    create.mutate(form, {
      onSuccess: (job) => {
        track(job, `Build case table (${dataset.data?.name ?? datasetId})`, { kind: "dataset", id: datasetId });
      },
    });
  };

  const isValid = form.caseId && form.activity && form.timestamp;
  const readyCaseTable = caseTable.data;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-xs uppercase tracking-wide text-text-subtle">S1–S2 · Mapping and case notion</p>
        <h1 className="text-2xl font-semibold">{dataset.data?.name ?? datasetId}</h1>
        <p className="text-sm text-text-muted">
          <span className="font-mono">{datasetId}</span>
          {dataset.data?.contentHash && (
            <>
              {" · "}
              <span className="font-mono">{dataset.data.contentHash}</span>
            </>
          )}
          {dataset.data?.events !== undefined && ` · ${fmtInt(dataset.data.events)} events`}
        </p>
      </header>

      {readyCaseTable && (
        <section aria-label="Readiness report">
          {readyCaseTable.status === "ready" ? (
            <ReadinessBanner readiness={readyCaseTable.readiness ?? undefined} projectId={ctx.projectId} />
          ) : (
            <p className="text-sm text-text-muted">The case table is {readyCaseTable.status}{readyCaseTable.error ? `: ${readyCaseTable.error}` : ""}.</p>
          )}
          <p className="mt-1 text-xs text-text-muted">
            Case table <span className="font-mono">{readyCaseTable.id}</span> · mapping <span className="font-mono">{readyCaseTable.mappingId}</span> · {fmtInt(readyCaseTable.cases)} cases
            {readyCaseTable.events ? ` · ${fmtInt(readyCaseTable.events)} events` : ""}
          </p>
        </section>
      )}
      {caseTable.isError && <ErrorBlock error={caseTable.error} />}

      <QueryState query={dataset} rows={6}>
        {(ds) =>
          ds.status !== "ready" ? (
            <Card>
              <p className="text-sm text-text-muted">The dataset is {ds.status}; the mapping form opens once ingest has finished. Follow the job in the tray.</p>
            </Card>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[1fr_minmax(320px,420px)]">
              <ColumnProfiler dataset={ds} />
              <Card aria-labelledby="mapping-heading" className="self-start">
                <CardTitle id="mapping-heading">Column mapping</CardTitle>
                {suggestion.data && (
                  <p className="mb-2 text-xs text-text-muted" data-testid="mapping-source">
                    Prefilled by the backend from the column names ({suggestion.data.source === "bpic2019" ? "BPI Challenge 2019 export" : suggestion.data.source === "pm4py" ? "XES / pm4py convention" : "patterns"}): {(suggestion.data.notes ?? []).join(" ")}
                  </p>
                )}
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (isValid) submit();
                  }}
                >
                  <Field label="case id *" htmlFor="map-case">
                    <ColumnSelect id="map-case" value={form.caseId} onChange={(v) => setForm({ ...form, caseId: v })} columns={columns} />
                  </Field>
                  <Field label="activity *" htmlFor="map-activity">
                    <ColumnSelect id="map-activity" value={form.activity} onChange={(v) => setForm({ ...form, activity: v })} columns={columns} />
                  </Field>
                  <Field label="timestamp *" htmlFor="map-ts">
                    <ColumnSelect id="map-ts" value={form.timestamp} onChange={(v) => setForm({ ...form, timestamp: v })} columns={columns} />
                  </Field>
                  <Field label="timestamp format" htmlFor="map-fmt" hint="strptime pattern (empty: the library parses mixed formats); day precision is reported by the data caveats">
                    <Input id="map-fmt" className="font-mono text-xs" value={form.timestampFormat ?? ""} onChange={(e) => setForm({ ...form, timestampFormat: e.target.value })} />
                  </Field>
                  <Field label="resource" htmlFor="map-res">
                    <ColumnSelect id="map-res" value={form.resource ?? ""} onChange={(v) => setForm({ ...form, resource: v || undefined })} columns={columns} allowNone />
                  </Field>
                  <Field label="lifecycle" htmlFor="map-lc">
                    <ColumnSelect id="map-lc" value={form.lifecycle ?? ""} onChange={(v) => setForm({ ...form, lifecycle: v || undefined })} columns={columns} allowNone />
                  </Field>
                  <Field label="exposure (volume for PI)" htmlFor="map-exp">
                    <ColumnSelect id="map-exp" value={form.exposure ?? ""} onChange={(v) => setForm({ ...form, exposure: v || undefined })} columns={columns} allowNone />
                  </Field>
                  <fieldset>
                    <legend className="text-xs font-medium text-text-muted">case attributes (slice keys)</legend>
                    <ul className="mt-1 grid max-h-40 grid-cols-1 gap-1 overflow-y-auto">
                      {columns
                        .filter((c) => c !== form.caseId && c !== form.activity && c !== form.timestamp)
                        .map((c) => (
                          <li key={c} className="flex items-center gap-2">
                            <Checkbox id={`attr-${c}`} checked={form.caseAttributes?.includes(c) ?? false} onCheckedChange={() => toggle("caseAttributes", c)} />
                            <label htmlFor={`attr-${c}`} className="font-mono text-xs">
                              {c}
                            </label>
                          </li>
                        ))}
                    </ul>
                  </fieldset>
                  <fieldset>
                    <legend className="text-xs font-medium text-text-muted">header events (replicated onto items; typed away)</legend>
                    <p className="text-xs text-text-subtle">Activities that belong to the purchasing document rather than the item. They count once per document, not per item.</p>
                    <ul className="mt-1 grid grid-cols-1 gap-1">
                      {activityValues.map((a) => (
                        <li key={a} className="flex items-center gap-2">
                          <Checkbox id={`hdr-${a}`} checked={form.headerEvents?.includes(a) ?? false} onCheckedChange={() => toggle("headerEvents", a)} />
                          <label htmlFor={`hdr-${a}`} className="text-xs">
                            {a}
                          </label>
                        </li>
                      ))}
                    </ul>
                    <Input
                      className="mt-2 text-xs"
                      aria-label="Add a header event activity"
                      placeholder="add another activity and press enter"
                      onKeyDown={(e) => {
                        const v = (e.target as HTMLInputElement).value.trim();
                        if (e.key === "Enter" && v) {
                          e.preventDefault();
                          toggle("headerEvents", v);
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                    />
                    {form.headerEvents && form.headerEvents.length > 0 && (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {form.headerEvents.map((h) => (
                          <Badge key={h} variant="accent">
                            {h}
                          </Badge>
                        ))}
                      </p>
                    )}
                  </fieldset>
                  {(form.flowTyping?.length || form.closureActivities?.length || form.exposure) && (
                    <p className="flex flex-wrap gap-1 text-xs text-text-muted">
                      {form.flowTyping?.map((r) => (
                        <Badge key={r.name} variant="outline">
                          flow type {r.name}
                        </Badge>
                      ))}
                      {form.closureActivities?.map((a) => (
                        <Badge key={a} variant="outline">
                          closes with {a}
                        </Badge>
                      ))}
                    </p>
                  )}
                  <Field label="note" htmlFor="map-note" hint="Optional; the case notion is a human decision and travels with the case table.">
                    <Textarea id="map-note" value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Case notion: PO item; header events typed away" />
                  </Field>
                  {create.isError && <ErrorBlock error={create.error} />}
                  <div className="flex items-center gap-2">
                    <Button type="submit" disabled={!isValid || create.isPending}>
                      Validate and build case table
                    </Button>
                    {create.isSuccess && <span className="text-xs text-text-muted">Job started; the readiness report appears here when it finishes.</span>}
                  </div>
                </form>
              </Card>
            </div>
          )
        }
      </QueryState>
      {caseTable.isPending && search.caseTable && <LoadingBlock rows={2} />}
      {create.data && !search.caseTable && <MappingJobFollower jobId={create.data.id} onDone={(id) => void navigate({ to: ".", search: { caseTable: id } })} />}
    </div>
  );
}
