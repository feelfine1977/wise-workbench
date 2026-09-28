import { useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import type { WorkbenchContext } from "@/app/context";
import { groupingOptionsQuery, type GroupingOptions } from "@/lib/api/groupings";
import { slicingPreviewQuery, type BandSpec } from "@/lib/api/exploration";
import { cutPoints, groupingToken, type GroupingDefinition } from "@/lib/grouping";
import { useGroupingStore } from "@/lib/stores/groupings";
import { groupingLabel } from "@/lib/sentences";
import { fmtInt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErrorBlock } from "@/components/states";

const EMPTY: { token: string; label: string }[] = [];
interface Props { ctx: WorkbenchContext; compact?: boolean }

/** Saved and suggested partitions of the run; a selection reuses the original case scores. */
export function GroupingControl({ ctx, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const searchParams = useSearch({ strict: false }) as { minCases?: number };
  const q = useQuery({ ...groupingOptionsQuery(ctx.projectId, ctx.runId ?? ""), enabled: ctx.run?.status === "done", retry: false });
  const scope = `${ctx.projectId}:${ctx.run?.caseTableId ?? ""}`;
  const saved = useGroupingStore((s) => s.saved[scope] ?? EMPTY);
  const save = useGroupingStore((s) => s.save);
  const choices = useMemo(() => {
    const options = [
      ...(ctx.run?.slicings ?? []).map((s) => ({ token: s.id ?? "", label: groupingLabel(s.id ?? undefined, s.attributes) })),
      ...saved,
      ...(q.data?.suggestions ?? []).map((s) => ({ token: s.id, label: s.label })),
    ];
    if (ctx.slicing && !options.some((s) => s.token === ctx.slicing)) options.push({ token: ctx.slicing, label: groupingLabel(ctx.slicing) });
    return options.filter((s, i) => s.token && options.findIndex((other) => other.token === s.token) === i);
  }, [ctx.run, ctx.slicing, saved, q.data]);
  return <div className={`flex items-center gap-1 text-sm ${compact ? "flex-nowrap" : "flex-wrap"}`}>
    <span className="text-xs text-text-muted">grouping</span>
    <Select value={ctx.slicing ?? ""} onValueChange={ctx.setSlicing} disabled={!choices.length}>
      <SelectTrigger compact aria-label={compact ? "Switch grouping" : "Choose analysis grouping"} className="w-auto max-w-[18rem] [&>span:first-child]:truncate"><SelectValue placeholder="Choose grouping" /></SelectTrigger>
      <SelectContent>{choices.map((s) => <SelectItem key={s.token} value={s.token}>{s.label}</SelectItem>)}</SelectContent>
    </Select>
    <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={ctx.run?.status !== "done"} aria-label={compact ? "More grouping choices" : "Create or explore groupings"}>{compact ? <Plus className="size-4" /> : "Create / explore groups"}</Button>
    {open && <Dialog open onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
      <DialogHeader><DialogTitle>How would you like to group the process?</DialogTitle><DialogDescription>Choose a different angle on the same scored cases. Combine attributes or define value bands, then inspect the group sizes before applying.</DialogDescription></DialogHeader>
      {q.isPending ? <p role="status">Reading the available fields…</p> : q.isError ? <ErrorBlock error={q.error} /> : <GroupingEditor key={`${ctx.runId}:${scope}`} data={q.data} projectId={ctx.projectId} runId={ctx.runId!} minCases={searchParams.minCases ?? ctx.run?.minCases ?? 20} onUse={(definition, label) => {
        const token = groupingToken(definition);
        save(scope, { token, label });
        ctx.setSlicing(token);
        setOpen(false);
      }} />}
    </DialogContent></Dialog>}
  </div>;
}

interface EditorProps { data: GroupingOptions; projectId: string; runId: string; minCases: number; onUse: (definition: GroupingDefinition, label: string) => void }
interface NumericSetting { method: "quantile" | "cuts" | "exact"; q: number; text: string }

export function GroupingEditor({ data, projectId, runId, minCases, onUse }: EditorProps) {
  const [attributes, setAttributes] = useState<string[]>([]);
  const [settings, setSettings] = useState<Record<string, NumericSetting>>({});
  const [label, setLabel] = useState("");
  const [previewSpec, setPreviewSpec] = useState<GroupingDefinition>();
  const [search, setSearch] = useState("");
  const numeric = attributes.filter((a) => data.attributes.find((f) => f.name === a)?.type === "numeric");
  const bands: BandSpec[] = numeric.filter((a) => settings[a]?.method !== "exact").map((a) => {
    const value = settings[a] ?? { method: "quantile", q: 4, text: "" };
    return value.method === "cuts" ? { attribute: a, method: "cuts", cuts: cutPoints(value.text) ?? [] } : { attribute: a, method: "quantile", q: value.q };
  });
  const invalidCuts = bands.some((b) => b.method === "cuts" && !b.cuts?.length);
  const definition: GroupingDefinition = { attributes, bands };
  const valid = attributes.length > 0 && !invalidCuts;
  const query = useQuery({ ...slicingPreviewQuery(projectId, runId, previewSpec?.attributes ?? [], previewSpec?.bands, minCases), enabled: !!previewSpec, retry: false });
  const current = !!previewSpec && groupingToken(previewSpec) === groupingToken(definition);
  const change = () => setPreviewSpec(undefined);
  const choose = (spec: GroupingDefinition, name: string) => {
    setAttributes(spec.attributes); setLabel(name); setPreviewSpec(undefined);
    setSettings(Object.fromEntries(spec.attributes.map((a) => {
      const band = spec.bands?.find((b) => b.attribute === a);
      return [a, { method: band?.method ?? "exact", q: band?.q ?? 4, text: band?.cuts?.join(", ") ?? "" }];
    })));
  };
  const setNumeric = (a: string, patch: Partial<NumericSetting>) => { change(); setSettings((s) => ({ ...s, [a]: { method: "quantile", q: 4, text: "", ...s[a], ...patch } })); };
  return <div className="flex flex-col gap-5">
    <section aria-labelledby="suggested-groupings"><h3 id="suggested-groupings" className="font-semibold">Suggested from this dataset</h3>
      <p className="mb-2 text-sm text-text-muted">Available fields suggest useful starting points. These are ways to investigate, not claims about causes.</p>
      <Input value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find suggested grouping" placeholder="Find company, value, month, flow…" />
      <div className="mt-2 grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">{data.suggestions.filter((s) => `${s.label} ${s.description}`.toLowerCase().includes(search.toLowerCase())).map((s) => <button type="button" key={s.id} className="rounded-md border border-border p-3 text-left hover:bg-selection focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => choose(s, s.label)}>
        <strong className="block text-sm">{s.label}</strong><span className="mt-1 block text-xs text-text-muted">{s.description}</span>
      </button>)}</div>
    </section>
    <section aria-labelledby="custom-grouping" className="flex flex-col gap-3 border-t border-border pt-4"><h3 id="custom-grouping" className="font-semibold">Build your grouping</h3>
      <div className="flex flex-col gap-2">{attributes.map((a, i) => <div key={i} className="flex items-center gap-2">
        <span className="text-xs text-text-muted">{i ? "with" : "Group by"}</span>
        <select className="min-w-0 flex-1 rounded-md border border-border bg-surface p-2 text-sm" aria-label={`Group attribute ${i + 1}`} value={a} onChange={(e) => { change(); setLabel(""); setAttributes((values) => values.map((v, j) => i === j ? e.target.value : v)); }}>
          {data.attributes.filter((f) => f.name === a || !attributes.includes(f.name)).map((f) => <option key={f.name} value={f.name}>{groupingLabel(undefined, [f.name])} · {f.type === "numeric" ? "value bands" : `${fmtInt(f.distinct)} values`}</option>)}
        </select><Button variant="ghost" size="iconSm" aria-label={`Remove group attribute ${i + 1}`} onClick={() => { change(); setLabel(""); setAttributes((values) => values.filter((_, j) => j !== i)); }}><X /></Button>
      </div>)}</div>
      <Button variant="outline" size="sm" className="self-start" disabled={attributes.length >= 3 || !data.attributes.some((a) => !attributes.includes(a.name))} onClick={() => { change(); setLabel(""); const next = data.attributes.find((a) => !attributes.includes(a.name)); if (next) setAttributes([...attributes, next.name]); }}><Plus />{attributes.length ? "Add another attribute" : "Choose an attribute"}</Button>
      {attributes.map((a) => { const f = data.attributes.find((v) => v.name === a); return <p key={a} className="text-xs text-text-muted">{f?.description || a} · {fmtInt(f?.distinct ?? 0)} values · {fmtInt(f?.missing ?? 0)} missing{(f?.distinct ?? 0) > 200 ? " · Many small groups may fall below the ranking minimum." : ""}</p>; })}
      {numeric.map((a) => { const v = settings[a] ?? { method: "quantile", q: 4, text: "" }; return <fieldset key={a} className="rounded-md border border-border p-3"><legend className="px-1 text-sm">Bands for {groupingLabel(undefined, [a])}</legend><div className="flex flex-wrap items-center gap-2">
        <select className="rounded-md border border-border bg-surface p-2 text-sm" aria-label={`Band method for ${a}`} value={v.method} onChange={(e) => setNumeric(a, { method: e.target.value as NumericSetting["method"] })}><option value="quantile">Equal-count bands</option><option value="cuts">My cut points</option><option value="exact">Each distinct value</option></select>
        {v.method === "quantile" ? <Input className="w-20" aria-label={`Number of bands for ${a}`} type="number" min={2} max={20} value={v.q} onChange={(e) => setNumeric(a, { q: Math.max(2, Math.min(20, Number(e.target.value) || 4)) })} /> : v.method === "cuts" ? <Input className="w-60" aria-label={`Cut points for ${a}`} aria-invalid={!cutPoints(v.text)} value={v.text} placeholder="1000, 10000, 100000" onChange={(e) => setNumeric(a, { text: e.target.value })} /> : null}
      </div>{v.method === "cuts" && !cutPoints(v.text) && <p role="alert" className="mt-1 text-sm text-danger">Enter distinct ascending numbers separated by commas.</p>}<p className="mt-2 text-xs text-text-muted">A value equal to a cut point goes into the next band. Missing values remain a separate group.</p></fieldset>; })}
      <label className="text-sm">Name (optional)<Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} placeholder="For example: Company and order value" /></label>
    </section>
    <section className="rounded-md border border-border bg-surface-sunken p-3" aria-label="Grouping preview">
      <Button variant="outline" disabled={!valid || query.isFetching} onClick={() => setPreviewSpec(definition)}>{query.isFetching ? "Counting groups…" : "Preview group sizes"}</Button>
      <p className="mt-2 text-xs text-text-muted">Preview covers {fmtInt(data.cases)} cases in this run’s flow scope, before any additional screen filters. The same WISE scores and norm are reused.</p>
      {current && query.isError && <ErrorBlock error={query.error} />}
      {current && query.data && <div role="status" className="mt-3 text-sm"><strong>{fmtInt(query.data.groups)} groups</strong> · {fmtInt(query.data.belowMinCases)} below {fmtInt(query.data.minCases)} cases stay unranked.
        <p className="mt-1 text-text-muted">Largest groups:</p><ul>{(query.data.largest ?? []).slice(0, 5).map((g) => <li key={String(g.key)}>{displayKey(String(g.key))}: {fmtInt(Number(g.n_cases))} cases</li>)}</ul>
      </div>}
    </section>
    <DialogFooter><Button disabled={!valid || !current || !query.isSuccess || query.isFetching} onClick={() => onUse(definition, label.trim() || groupingLabel(groupingToken(definition)))}>Use this grouping</Button></DialogFooter>
    <p className="text-xs text-text-muted">Your grouping is remembered on this browser for this case table. The analysis link also contains its definition, so it can be reopened or shared.</p>
  </div>;
}
function displayKey(key: string): string { try { const value: unknown = JSON.parse(key); return Array.isArray(value) ? value.map(String).join(" × ") : key; } catch { return key; } }
