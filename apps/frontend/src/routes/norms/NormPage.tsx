import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useWorkbench } from "@/app/context";
import { normRoute } from "@/app/router";
import { LayerChip } from "@/components/badges";
import { DistributionLens } from "@/components/DistributionLens";
import { JsonView } from "@/components/JsonView";
import { ErrorBlock, LoadingBlock, QueryState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Card, CardTitle } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { distributionQuery, normQuery, normsQuery, useCreateNormVersion } from "@/lib/queries";
import { cn } from "@/lib/utils";
import type { NormTab } from "@/app/search";

interface Constraint {
  id: string;
  layer: string;
  type: string;
  params: Record<string, unknown>;
  weight?: number;
  description?: string;
  applicability?: Record<string, unknown>;
}
interface NormJson {
  name?: string;
  scoring_mode?: string;
  layers?: { id: string; name: string }[];
  views?: { name: string; layer_weights?: Record<string, number> }[];
  constraints?: Constraint[];
}

function thresholdOf(c: Constraint): { threshold: number; width: number; keys: [string, string] } | undefined {
  const p = c.params;
  if (c.type === "lag") return { threshold: Number(p.delta), width: Number(p.width), keys: ["delta", "width"] };
  if (c.type === "metric") return { threshold: Number(p.threshold), width: Number(p.width), keys: ["threshold", "width"] };
  if (c.type === "singularity") return { threshold: Number(p.k), width: Number(p.K), keys: ["k", "K"] };
  if (c.type === "balance") return { threshold: Number(p.tau), width: Number(p.width), keys: ["tau", "width"] };
  return undefined;
}

function sentence(c: Constraint): string {
  const p = c.params;
  const list = (v: unknown) => (Array.isArray(v) ? v.join(" / ") : String(v ?? ""));
  switch (c.type) {
    case "presence":
      return `${list(p.activity)} should occur at least ${String(p.m ?? 1)}×`;
    case "exclusion":
      return `${list(p.activity)} should not occur`;
    case "precedence":
      return `${list(p.a)} should precede ${list(p.b)}`;
    case "lag":
      return `${list(p.b)} within ${String(p.delta)} ${String(p.unit ?? "D")} of ${list(p.a)} (tolerance ${String(p.width)})`;
    case "singularity":
      return `${list(p.activity)} at most ${String(p.k)}× (tolerance up to ${String(p.K)})`;
    case "metric":
      return `${String(p.attribute)} ${p.direction === "low" ? "at least" : "at most"} ${String(p.threshold)} (width ${String(p.width)})`;
    case "balance":
      return `${String(p.attr_x)} vs ${String(p.attr_y)} within ${String(p.tau)}`;
    default:
      return c.description ?? c.type;
  }
}

/** S3–S4 — a norm version: constraints with the calibration lens, JSON view, version notes. */
export default function NormPage() {
  const ctx = useWorkbench();
  const { normVersionId } = normRoute.useParams();
  const search = normRoute.useSearch();
  const navigate = useNavigate();
  const norm = useQuery(normQuery(ctx.projectId, normVersionId));
  const norms = useQuery(normsQuery(ctx.projectId));
  const create = useCreateNormVersion(ctx.projectId);
  const json = norm.data?.norm as NormJson | undefined;
  const constraints = useMemo(() => json?.constraints ?? [], [json]);
  const selected = constraints.find((c) => c.id === search.constraint) ?? constraints.find((c) => thresholdOf(c));
  const runId = ctx.runs.find((r) => r.status === "done")?.id;
  const dist = useQuery({ ...distributionQuery(ctx.projectId, runId ?? "", selected?.id ?? ""), enabled: !!runId && !!selected });
  const [pending, setPending] = useState<{ threshold: number; width: number }>();
  const [note, setNote] = useState("");

  const setTab = (tab: NormTab) => void navigate({ to: ".", search: (s) => ({ ...s, tab }) });
  const selectConstraint = (id: string) => void navigate({ to: ".", search: (s) => ({ ...s, constraint: id }) });

  const commit = () => {
    if (!selected || !pending || !json || !note.trim()) return;
    const t = thresholdOf(selected);
    if (!t) return;
    const next: NormJson = {
      ...json,
      constraints: constraints.map((c) => (c.id === selected.id ? { ...c, params: { ...c.params, [t.keys[0]]: pending.threshold, [t.keys[1]]: pending.width } } : c)),
    };
    create.mutate(
      { norm: next as Record<string, unknown>, note: note.trim(), parentId: normVersionId },
      {
        onSuccess: (created) => {
          setPending(undefined);
          setNote("");
          void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: created.id }, search: { tab: "history", constraint: selected.id } });
        },
      },
    );
  };

  const byLayer = useMemo(() => {
    const groups = new Map<string, Constraint[]>();
    for (const c of constraints) {
      const list = groups.get(c.layer) ?? [];
      list.push(c);
      groups.set(c.layer, list);
    }
    return groups;
  }, [constraints]);

  return (
    <div className="flex flex-col gap-4">
      <QueryState query={norm} rows={6}>
        {(nv) => (
          <>
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-text-subtle">S3–S4 · Norm</p>
                <h1 className="text-2xl font-semibold">
                  {json?.name ?? nv.id} · v{nv.version}
                </h1>
                <p className="text-sm text-text-muted">
                  <Badge variant={nv.status === "approved" ? "success" : nv.status === "reviewed" ? "info" : "warning"} className="mr-2">
                    {nv.status}
                  </Badge>
                  <span className="font-mono text-xs">{nv.fingerprint}</span> · {json?.scoring_mode} · {json?.layers?.length ?? 0} layers · {constraints.length} constraints · {json?.views?.length ?? 0} views
                </p>
              </div>
              <Link className="text-sm text-accent-text underline" to="/p/$projectId/norms" params={{ projectId: ctx.projectId }}>
                all versions
              </Link>
            </header>

            <Tabs value={search.tab} onValueChange={(v) => setTab(v as NormTab)}>
              <TabsList aria-label="Norm sections">
                <TabsTrigger value="constraints">Constraints</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
                <TabsTrigger value="history">Version notes</TabsTrigger>
              </TabsList>

              <TabsContent value="constraints">
                <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
                  <Card className="max-h-[70vh] overflow-y-auto">
                    <CardTitle>Catalogue</CardTitle>
                    {[...byLayer.entries()].map(([layer, list]) => (
                      <section key={layer} className="mb-3" aria-label={layer}>
                        <h4 className="mb-1 text-xs font-medium">
                          <LayerChip id={layer} name={json?.layers?.find((l) => l.id === layer)?.name} />
                        </h4>
                        <ul className="flex flex-col gap-0.5">
                          {list.map((c) => {
                            const t = thresholdOf(c);
                            return (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  onClick={() => selectConstraint(c.id)}
                                  aria-pressed={selected?.id === c.id}
                                  className={cn("flex w-full flex-col items-start rounded-sm px-2 py-1 text-left text-sm hover:bg-surface-sunken", selected?.id === c.id && "bg-selection")}
                                >
                                  <span className="flex w-full items-center gap-2">
                                    <span className="font-mono text-xs">{c.id}</span>
                                    <Badge variant="outline">{c.type}</Badge>
                                    <span className="ml-auto text-xs text-text-subtle">w {fmtNum(c.weight, 1)}</span>
                                  </span>
                                  <span className="text-xs text-text-muted">{sentence(c)}</span>
                                  {t && <span className="tnum text-xs text-text-subtle">ϑ = {fmtNum(t.threshold, 2)} · W = {fmtNum(t.width, 2)}</span>}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                  </Card>
                  <Card>
                    <CardTitle>Calibration lens</CardTitle>
                    {!selected && <p className="text-sm text-text-muted">Select a constraint with a threshold.</p>}
                    {selected && !runId && <p className="text-sm text-text-muted">The lens needs a finished run to read the empirical distribution. Create a run first.</p>}
                    {selected && runId && dist.isPending && <LoadingBlock rows={5} />}
                    {selected && dist.isError && <ErrorBlock error={dist.error} />}
                    {selected && dist.data && thresholdOf(selected) && (
                      <DistributionLens
                        key={selected.id}
                        distribution={dist.data}
                        constraintId={selected.id}
                        title={`${selected.id} · ${sentence(selected)}`}
                        direction={(selected.params.direction as "high" | "low" | undefined) ?? "high"}
                        onCommit={(next) => setPending(next)}
                      />
                    )}
                    {selected && dist.data && !thresholdOf(selected) && <p className="text-sm text-text-muted">{selected.type} constraints have no threshold to calibrate; the distribution shows the raw count.</p>}
                    {selected?.description && <p className="mt-3 text-xs text-text-muted">{selected.description}</p>}
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="json">
                <JsonView value={nv.norm} ariaLabel={`Norm JSON v${nv.version}`} />
              </TabsContent>

              <TabsContent value="history">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardTitle>This version</CardTitle>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                      <dt className="text-text-muted">note</dt>
                      <dd>{nv.note}</dd>
                      <dt className="text-text-muted">author</dt>
                      <dd>{nv.author}</dd>
                      <dt className="text-text-muted">created</dt>
                      <dd>{fmtDateTime(nv.createdAt)}</dd>
                      <dt className="text-text-muted">parent</dt>
                      <dd>
                        {nv.parentId ? (
                          <Link className="font-mono text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: nv.parentId }} search={{ tab: "history" }}>
                            {nv.parentId}
                          </Link>
                        ) : (
                          "–"
                        )}
                      </dd>
                      <dt className="text-text-muted">validation</dt>
                      <dd>
                        {nv.validation && nv.validation.length > 0 ? (
                          <ul className="list-disc pl-4">
                            {nv.validation.map((v) => (
                              <li key={v}>{v}</li>
                            ))}
                          </ul>
                        ) : (
                          "clean"
                        )}
                      </dd>
                    </dl>
                  </Card>
                  <Card>
                    <CardTitle>Lineage</CardTitle>
                    <ol className="flex flex-col gap-2 text-sm">
                      {[...(norms.data ?? [])]
                        .sort((a, b) => b.version - a.version)
                        .map((n) => (
                          <li key={n.id} className={cn("rounded-sm border border-border p-2", n.id === nv.id && "bg-selection")}>
                            <Link className="font-medium text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: n.id }} search={{ tab: "history" }}>
                              v{n.version}
                            </Link>{" "}
                            <Badge variant="outline">{n.status}</Badge>
                            <p className="text-xs text-text-muted">{n.note}</p>
                          </li>
                        ))}
                    </ol>
                  </Card>
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </QueryState>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Commit threshold as a new version</DialogTitle>
            <DialogDescription>
              {selected?.id}: ϑ = {fmtNum(pending?.threshold, 2)}, W = {fmtNum(pending?.width, 2)}. A threshold is a human decision, so a one-line reason is required.
            </DialogDescription>
          </DialogHeader>
          <Field label="note *" htmlFor="commit-note">
            <Textarea id="commit-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this threshold; who agreed" autoFocus />
          </Field>
          {create.isError && <ErrorBlock error={create.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(undefined)}>
              Cancel
            </Button>
            <Button onClick={commit} disabled={!note.trim() || create.isPending}>
              Create version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
