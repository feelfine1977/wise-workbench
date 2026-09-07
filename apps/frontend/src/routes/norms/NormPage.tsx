import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useVocabulary } from "@/components/Term";
import { returnTarget, useNavStore } from "@/lib/stores/nav";
import { useWorkbench } from "@/app/context";
import { normRoute } from "@/app/router";
import { LayerChip } from "@/components/badges";
import { DistributionLens } from "@/components/DistributionLens";
import { BackControl } from "@/components/guide/BackControl";
import { FreezeButton } from "@/components/guide/Freeze";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { JsonView } from "@/components/JsonView";
import { ErrorBlock, LoadingBlock, QueryState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardTitle } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime, fmtInt, fmtNum } from "@/lib/format";
import { distributionQuery, normQuery, normsQuery, useCreateNormVersion } from "@/lib/queries";
import { flowTypesQuery } from "@/lib/api/cycle2";
import { runManifestQuery } from "@/lib/api/cycle3";
import { inventoryQuery } from "@/lib/api/cycle4";
import { CalibrationChip } from "@/components/badges";
import { WhatDoesThisMean } from "@/components/knowledge/WhatDoesThisMean";
import { ApplicabilityEditor, CommitFieldsForm, NewConstraintButton, RuleEditor, StatusChip, applicabilitySentence, ruleSentence, thresholdOf, type CommitFields, type Constraint } from "./Builder";
import { NEXT_STATUS, SignVersion } from "./SignVersion";
import { cn } from "@/lib/utils";
import type { NormTab } from "@/app/search";

interface NormJson {
  name?: string;
  scoring_mode?: string;
  layers?: { id: string; name: string }[];
  views?: { name: string; layer_weights?: Record<string, number> }[];
  constraints?: Constraint[];
}

/**
 * A norm version, and the builder that calibrates it in the browser (R3-02, R3-O6, R2-11).
 *
 * The catalogue leads with each expectation's plain name and its rule in one sentence — the id lives in the
 * tooltip — and flags the ones whose threshold says more about the threshold than about the groups. The
 * right-hand pane is the expectation itself: the distribution lens for its threshold, the rule editor with
 * pickers bound to this log's own activities and values, and the applicability editor, including
 * *not applicable to this log* with a note. Nothing leaves the pane without a rationale and an owner, and
 * every change is saved as the next version with its note.
 */
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
  const runId = ctx.runs.find((r) => r.status === "done")?.id;
  const selected = constraints.find((c) => c.id === search.constraint) ?? constraints.find((c) => thresholdOf(c));
  const dist = useQuery({ ...distributionQuery(ctx.projectId, runId ?? "", selected?.id ?? ""), enabled: !!runId && !!selected });
  const [pending, setPending] = useState<{ threshold: number; width: number }>();
  const [fields, setFields] = useState<CommitFields>({ rationale: "", owner: "" });
  const [signing, setSigning] = useState(false);
  // the rule and the applicability of the selected expectation while they are being edited
  const [edited, setEdited] = useState<Constraint>();
  const [pane, setPane] = useState<"lens" | "rule" | "applies">("lens");
  const inventory = useQuery({ ...inventoryQuery(ctx.projectId, ctx.caseTable?.id ?? ""), enabled: !!ctx.caseTable });
  const flowTypes = useQuery({ ...flowTypesQuery(ctx.projectId, ctx.caseTable?.id ?? ""), enabled: !!ctx.caseTable });
  const manifest = useQuery({ ...runManifestQuery(ctx.projectId, runId ?? ""), enabled: !!runId });
  const uncalibrated = useMemo(() => new Map((manifest.data?.uncalibrated ?? []).map((u) => [u.id, u])), [manifest.data]);
  const caseNoun = ctx.caseTable?.readiness?.caseNoun ?? "cases";
  const plainOf = (c: Constraint) => c.plain_name ?? uncalibrated.get(c.id)?.plain_name ?? c.description?.replace(/\.$/, "") ?? c.id;
  /** Expectations the run flags as saying more about their threshold than about the groups (R2-09). */
  const flagged = constraints.filter((c) => uncalibrated.has(c.id)).length;
  const { vocabulary } = useVocabulary();
  // opened from a reason screen, the lens is a sub-screen of Why: the stepper keeps Why current with this line under it
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visited = useNavStore((s) => s.visited);
  const lastSlice = useNavStore((s) => s.lastSlice);
  const setSubline = useNavStore((s) => s.setSubline);
  const fromWhy = /\/slices\//.test(returnTarget(visited, pathname)?.pathname ?? "");
  const lensName = selected ? plainOf(selected) : undefined;
  useEffect(() => {
    if (fromWhy && lastSlice) setSubline(`${lastSlice.label} · lens of “${lensName ?? selected?.id ?? "an expectation"}”`);
    else setSubline(undefined);
    return () => setSubline(undefined);
  }, [fromWhy, lastSlice, lensName, selected?.id, setSubline]);

  const setTab = (tab: NormTab) => void navigate({ to: ".", search: (s) => ({ ...s, tab }) });
  const selectConstraint = (id: string) => void navigate({ to: ".", search: (s) => ({ ...s, constraint: id }) });

  /** Every change of the norm is the next version, with the reason and the owner in its note (R3-02). */
  const saveVersion = (patch: (c: Constraint) => Constraint, what: string, extra?: Constraint) => {
    if (!json || !fields.rationale.trim() || !fields.owner.trim()) return;
    const id = (edited ?? selected)?.id;
    const next: NormJson = {
      ...json,
      constraints: [...constraints.map((c) => (c.id === id ? patch(c) : c)), ...(extra ? [extra] : [])],
    };
    create.mutate(
      { norm: next as Record<string, unknown>, note: `${what} — ${fields.rationale.trim()} (owner: ${fields.owner.trim()})`, parentId: normVersionId },
      {
        onSuccess: (created) => {
          setPending(undefined);
          setEdited(undefined);
          setFields({ rationale: "", owner: "" });
          void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: created.id }, search: { tab: "constraints", constraint: id } });
        },
      },
    );
  };

  const commit = () => {
    if (!selected || !pending) return;
    const t = thresholdOf(selected);
    if (!t) return;
    saveVersion((c) => ({ ...c, params: { ...c.params, [t.keys[0]]: pending.threshold, [t.keys[1]]: pending.width } }), `${plainOf(selected)}: threshold set to ${pending.threshold}, tolerated to ${pending.width}`);
  };

  /** A rule or an applicability edited in the pane, saved as the next version. */
  const commitEdited = (what: string) => {
    if (!edited) return;
    saveVersion(() => edited, `${plainOf(edited)}: ${what}`);
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
    <div className="flex flex-col gap-5">
      <QueryState query={norm} rows={6}>
        {(nv) => (
          <>
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-text-subtle">
                  <BackControl className="normal-case tracking-normal" />
                  <span>Norm · expectations and perspectives</span>
                </div>
                <h1 className="flex items-center gap-2 text-2xl font-semibold" title={nv.id}>
                  {json?.name ?? "The expectations of this process"} · version {nv.version}
                  <HowToReadToggle id="norm" />
                </h1>
                <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                  <StatusChip status={nv.status} />
                  {/* P1-9: the version is signed where it is read, beside the badge that says it is not */}
                  {NEXT_STATUS[nv.status as "draft" | "reviewed"] && (
                    <Button variant="outline" size="sm" onClick={() => setSigning(true)}>
                      {NEXT_STATUS[nv.status as "draft" | "reviewed"].label}
                    </Button>
                  )}
                  {nv.author ? <span className="text-xs text-text-subtle">signed by {nv.author}</span> : null}
                  <span>
                    {json?.layers?.length ?? 0} expectation areas · {constraints.length} expectations · {json?.views?.length ?? 0} perspectives
                    {flagged > 0 ? <span className="ml-2 text-warning">· {fmtInt(flagged)} still to calibrate on this log</span> : null}
                  </span>
                </p>
                {signing && <SignVersion projectId={ctx.projectId} version={nv} onDone={() => setSigning(false)} />}
              </div>
              <div className="flex flex-wrap items-center gap-3" data-no-capture>
                <FreezeButton projectId={ctx.projectId} screen="norm" context={{ run_id: runId }} data={{ constraint: selected?.id, threshold: selected ? thresholdOf(selected) : undefined }} defaultTitle={`Norm v${nv.version}${selected ? ` · ${selected.id}` : ""}`} />
                <Link className="text-sm text-accent-text underline" to="/p/$projectId/norms" params={{ projectId: ctx.projectId }}>
                  all versions
                </Link>
              </div>
            </header>
            <HowToRead id="norm">
              The list on the left is every expectation of this process, by area, with the rule in one sentence. Pick one and the pane on the right shows how the {caseNoun} are spread around its threshold, lets you change the rule
              with the activities and values this log actually has, and lets you say which {caseNoun} it is meant for — including <strong>not applicable to this log</strong>, for a rule that cannot fail or cannot pass here.
              Every change is the next version and asks for a reason and an owner, because a threshold is a decision somebody answers for.
            </HowToRead>
            <Tabs value={search.tab} onValueChange={(v) => setTab(v as NormTab)}>
              <TabsList aria-label="Norm sections">
                <TabsTrigger value="constraints">Constraints</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
                <TabsTrigger value="history">Version notes</TabsTrigger>
              </TabsList>

              <TabsContent value="constraints">
                <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_1fr]">
                  <Card className="max-h-[70vh] overflow-y-auto">
                    <CardTitle>The expectations of this process</CardTitle>
                    {[...byLayer.entries()].map(([layer, list]) => (
                      <section key={layer} className="mb-3" aria-label={json?.layers?.find((l) => l.id === layer)?.name ?? layer}>
                        <h4 className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                          <LayerChip id={layer} name={json?.layers?.find((l) => l.id === layer)?.name} />
                          <WhatDoesThisMean kind="layer" entryId={layer} label={json?.layers?.find((l) => l.id === layer)?.name ?? layer} />
                        </h4>
                        <ul className="flex flex-col gap-0.5">
                          {list.map((c) => {
                            const t = thresholdOf(c);
                            const flag = uncalibrated.get(c.id);
                            const na = !!(c.applicability as { not_applicable?: boolean } | undefined)?.not_applicable;
                            return (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  onClick={() => selectConstraint(c.id)}
                                  aria-pressed={selected?.id === c.id}
                                  title={c.id}
                                  className={cn("flex w-full flex-col items-start rounded-sm px-2 py-1 text-left text-sm hover:bg-surface-sunken", selected?.id === c.id && "bg-selection")}
                                >
                                  <span className="flex w-full items-baseline gap-2">
                                    {/* the plain name is the label; the id lives in the tooltip (R3-13) */}
                                    <span className="min-w-0 flex-1 font-medium">{plainOf(c)}</span>
                                    {na && <Badge variant="outline" className="shrink-0 text-[10px]">not applicable here</Badge>}
                                  </span>
                                  <span className="text-xs text-text-muted">{ruleSentence(c)}</span>
                                  {flag && <CalibrationChip className="mt-0.5" text={flag.text} />}
                                  {t && !flag && <span className="tnum text-xs text-text-subtle">{fmtNum(t.threshold, 2)}, tolerated to {fmtNum(t.width, 2)}</span>}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                    <div className="mt-2 border-t border-border pt-3">
                      <NewConstraintButton
                        layers={json?.layers ?? []}
                        onCreate={(c) => {
                          setEdited(c);
                          setPane("rule");
                          void navigate({ to: ".", search: (sp) => ({ ...sp, constraint: c.id }) });
                        }}
                      />
                    </div>
                  </Card>
                  <Card data-testid="norm-builder">
                    {!selected && !edited && <p className="text-sm text-text-muted">Pick an expectation on the left to read it, calibrate it, or say which {caseNoun} it is meant for.</p>}
                    {(selected || edited) && (
                      <>
                        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                          <CardTitle className="mb-0 flex items-center gap-1.5" title={(edited ?? selected)?.id}>
                            {plainOf((edited ?? selected) as Constraint)}
                            <WhatDoesThisMean kind="constraint" entryId={(edited ?? selected)?.id} label={plainOf((edited ?? selected) as Constraint)} />
                          </CardTitle>
                          <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="What to work on">
                            {([["lens", "the numbers"], ["rule", "the rule"], ["applies", "who it applies to"]] as const).map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                aria-pressed={pane === id}
                                onClick={() => {
                                  setPane(id);
                                  if (id !== "lens" && !edited && selected) setEdited(selected);
                                }}
                                className={cn("px-2 py-1 text-xs", pane === id ? "bg-accent-subtle font-medium text-accent-text" : "text-text-muted hover:bg-surface-sunken")}
                              >
                                {label}
                              </button>
                            ))}
                          </span>
                        </div>
                        <p className="reading mb-3 text-sm text-text-muted" data-testid="norm-sentence">
                          {ruleSentence((edited ?? selected) as Constraint)}. {applicabilitySentence((edited ?? selected) as Constraint, caseNoun)}
                        </p>
                        {selected && uncalibrated.get(selected.id) && <CalibrationChip className="mb-3" text={uncalibrated.get(selected.id)?.text} />}

                        {pane === "lens" && (
                          <>
                            {!runId && <p className="text-sm text-text-muted">The spread of the {caseNoun} around this threshold needs a finished run. Score one first.</p>}
                            {selected && runId && dist.isPending && <LoadingBlock rows={5} />}
                            {selected && dist.isError && <ErrorBlock error={dist.error} />}
                            {selected && dist.data && thresholdOf(selected) && (
                              <DistributionLens
                                key={selected.id}
                                distribution={dist.data}
                                constraintId={selected.id}
                                title={plainOf(selected)}
                                direction={(selected.params.direction as "high" | "low" | undefined) ?? "high"}
                                onCommit={(next) => setPending(next)}
                                mode={vocabulary}
                                sliders="always"
                                noun={caseNoun}
                                groupName={`all ${caseNoun}`}
                              />
                            )}
                            {selected && dist.data && !thresholdOf(selected) && (
                              <p className="text-sm text-text-muted">This expectation has no threshold to move: it asks whether something happened, not how much. Change its rule or its applicability instead.</p>
                            )}
                          </>
                        )}

                        {pane === "rule" && edited && ctx.caseTable && (
                          <>
                            <RuleEditor projectId={ctx.projectId} caseTableId={ctx.caseTable.id} constraint={edited} caseNoun={caseNoun} onChange={setEdited} />
                            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                              <CommitFieldsForm value={fields} onChange={setFields} />
                              {create.isError && <ErrorBlock error={create.error} />}
                              <div className="flex gap-2">
                                <Button size="sm" disabled={!fields.rationale.trim() || !fields.owner.trim() || create.isPending} onClick={() => commitEdited("the rule was changed")}>
                                  Save as the next version
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => { setEdited(undefined); setPane("lens"); }}>
                                  Discard
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                        {pane === "rule" && !ctx.caseTable && <p className="text-sm text-text-muted">A rule is written against a log's own activities; this project has no case table yet.</p>}

                        {pane === "applies" && edited && (
                          <>
                            <ApplicabilityEditor
                              constraint={edited}
                              flowTypes={(flowTypes.data?.types ?? []).map((f) => ({ name: f.name, cases: f.cases }))}
                              attributes={inventory.data?.attributes ?? []}
                              caseNoun={caseNoun}
                              onChange={setEdited}
                            />
                            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                              <CommitFieldsForm value={fields} onChange={setFields} />
                              {create.isError && <ErrorBlock error={create.error} />}
                              <div className="flex gap-2">
                                <Button size="sm" disabled={!fields.rationale.trim() || !fields.owner.trim() || create.isPending} onClick={() => commitEdited("who it applies to was changed")}>
                                  Save as the next version
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => { setEdited(undefined); setPane("lens"); }}>
                                  Discard
                                </Button>
                              </div>
                            </div>
                          </>
                        )}
                      </>
                    )}
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
            <DialogTitle>Set this threshold</DialogTitle>
            <DialogDescription>
              {selected ? plainOf(selected) : ""}: {fmtNum(pending?.threshold, 2)}, tolerated to {fmtNum(pending?.width, 2)}. A threshold is a decision somebody answers for, so it needs a reason and an owner.
            </DialogDescription>
          </DialogHeader>
          <CommitFieldsForm value={fields} onChange={setFields} />
          {create.isError && <ErrorBlock error={create.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(undefined)}>
              Cancel
            </Button>
            <Button onClick={commit} disabled={!fields.rationale.trim() || !fields.owner.trim() || create.isPending}>
              Save as the next version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
