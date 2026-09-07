import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { useWorkbench } from "@/app/context";
import { flowRoute } from "@/app/router";
import type { FlowSearch, RenderMode } from "@/app/search";
import { filterPreviewQuery, flowFocusedQuery, type Filter, type RunC2 } from "@/lib/api/cycle2";
import { FreezeButton } from "@/components/guide/Freeze";
import { LensDialog } from "@/components/LensDialog";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { bpmnUrl } from "@/lib/api/cycle3";
import { filterHash, parseFilter, serializeFilter } from "@/lib/filter";
import { fmtInt } from "@/lib/format";
import { flowQuery } from "@/lib/queries";
import { useNavStore } from "@/lib/stores/nav";
import { useSceneStore } from "@/lib/stores/scenes";
import { useFilterFeedback } from "@/components/flow/useFilterFeedback";
import { StepHeader } from "./StepHeader";

const FlowMap = lazy(() => import("@/components/flow/FlowMap"));

interface ConstraintMeta {
  description?: { id?: string; type?: string; label?: string; layer?: string; description?: string; activities?: string[]; a?: string[]; b?: string[] };
}

const LENS_TYPES = new Set(["lag", "metric", "singularity", "balance"]);

/**
 * The Flow step (R3-O11, §3): the map is the screen. It sits between Signals and Why, keeps the whole state
 * in the address (context, chips, detail level, rendering, selection, full window), and every action on an
 * activity or a path works end to end: filter to, exclude, the paths in and out from the full relation, the
 * distribution, the worst cases through here, pin. `Flow | Board` is the second arrangement of the same step.
 */
export default function FlowPage() {
  const ctx = useWorkbench();
  const { runId } = flowRoute.useParams();
  const search = flowRoute.useSearch();
  const navigate = useNavigate();
  const href = useRouterState({ select: (s) => s.location.href });
  const setSubline = useNavStore((s) => s.setSubline);
  const run = ctx.runs.find((r) => r.id === runId) as RunC2 | undefined;
  const slicing = search.slicing ?? run?.slicings?.[0]?.id ?? undefined;
  const view = search.view ?? run?.views?.[0];
  const filter = useMemo(() => parseFilter(search.filter), [search.filter]);
  const pins = useSceneStore((s) => s.pins);
  const pin = useSceneStore((s) => s.pin);
  const unpin = useSceneStore((s) => s.unpin);
  const [lens, setLens] = useState<string>();

  const enabled = !!run && run.status === "done";
  const flow = useQuery({ ...flowQuery(ctx.projectId, runId, { filter: search.filter }), enabled });
  const focused = useQuery({ ...flowFocusedQuery(ctx.projectId, runId, { focus: search.activity ?? "", filter }), enabled: enabled && !!search.activity });
  const preview = useQuery({ ...filterPreviewQuery(ctx.projectId, runId, filter), enabled: enabled && !!filter });

  const graph = flow.data;
  const meta = (graph?.meta ?? {}) as { cases?: number; events?: number; caseNoun?: string; constraints?: ConstraintMeta[]; nodesTotal?: number };
  const noun = meta.caseNoun ?? "cases";
  const casesTotal = preview.data && filter ? preview.data.cases_in + preview.data.cases_out : (meta.cases ?? 0);
  const casesIn = filter ? preview.data?.cases_in : (meta.cases ?? 0);
  const feedback = useFilterFeedback({ filter, casesIn, casesTotal, noun });

  const patch = useCallback((p: Partial<FlowSearch>) => void navigate({ to: ".", search: (s) => ({ ...(s as FlowSearch), ...p }) }), [navigate]);
  const changeFilter = useCallback(
    (next: Filter | undefined) => patch({ filter: serializeFilter(next), fh: filterHash(next) }),
    [patch],
  );

  useEffect(() => {
    setSubline(undefined);
  }, [setSubline]);

  const plainOf = useCallback(
    (id: string) => {
      const found = (meta.constraints ?? []).find((c) => c.description?.id === id)?.description;
      return (found?.description ?? id).replace(/\.$/, "");
    },
    [meta.constraints],
  );
  const constraintsOfActivity = useCallback(
    (activityId: string) =>
      (meta.constraints ?? [])
        .filter((c) => [...(c.description?.activities ?? []), ...(c.description?.a ?? []), ...(c.description?.b ?? [])].includes(activityId))
        .map((c) => c.description)
        .filter((d): d is NonNullable<typeof d> => !!d),
    [meta.constraints],
  );

  const selectedId = useMemo(() => {
    const raw = search.sel?.startsWith("activity:") ? search.sel.slice("activity:".length) : undefined;
    if (!raw || !graph) return null;
    return graph.nodes.find((n) => n.label === raw || n.id === raw)?.id ?? null;
  }, [search.sel, graph]);

  if (!run) {
    return ctx.isLoading ? <LoadingBlock rows={8} /> : <EmptyState title="This run does not exist in this workspace." reason={`No flow can be shown for ${runId}; the ribbon stays on the project's latest run.`} action={{ label: "Go to Runs", to: "/p/$projectId/runs", params: { projectId: ctx.projectId } }} />;
  }
  if (run.status !== "done") {
    return <EmptyState title="Nothing scored yet, so the map has no colours." reason="The flow is drawn when the run has finished; the paths are shown as soon as the case table is built." action={{ label: "Open the run monitor", to: "/p/$projectId/runs/$runId", params: { projectId: ctx.projectId, runId } }} />;
  }

  const scope = run.scope?.flow_type;
  const backFallback = { href: `/p/${ctx.projectId}/runs/${runId}/backlog?slicing=${encodeURIComponent(slicing ?? "")}${view ? `&view=${encodeURIComponent(view)}` : ""}`, label: "Where is it worst?" };
  const shared = { view, slicing, scope: search.scope, detail: search.detail, sel: search.sel, activity: search.activity, filter: search.filter, fh: search.fh, render: search.render, full: search.full };

  return (
    // The step takes the height the shell gives it and never scrolls: the map frame is the band that grows,
    // every other band keeps its own size, so nothing the map draws can change the frame (§3.2).
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden" data-testid="flow-step">
      <StepHeader
        className="shrink-0"
        projectId={ctx.projectId}
        runId={runId}
        title="Where in the flow"
        sentence={
          <>
            {scope ? `${scope} flow only` : "all flows"} · <strong className="tnum">{fmtInt(meta.cases)}</strong> {noun}
            {meta.events ? (
              <>
                , <span className="tnum">{fmtInt(meta.events)}</span> events
              </>
            ) : null}
          </>
        }
        active="flow"
        search={shared}
        backFallback={backFallback}
        actions={
          <FreezeButton
            projectId={ctx.projectId}
            screen="flow"
            context={{ run_id: runId, slicing, view, filters: filter ?? null, scope: run.scope ?? null }}
            data={{ detail: search.detail, render: search.render, selection: search.sel }}
            defaultTitle={`Where in the flow · ${scope ?? "all flows"}`}
          />
        }
      />

      {pins.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs" data-testid="pin-strip">
          <span className="text-text-subtle">pinned scenes:</span>
          {pins.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-2.5 pr-1">
              <button type="button" className="text-accent-text underline" onClick={() => void navigate({ to: p.href })}>
                {p.label}
              </button>
              <button type="button" aria-label={`Unpin ${p.label}`} className="rounded-full px-1 hover:bg-surface-sunken" onClick={() => unpin(p.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {flow.isPending && <LoadingBlock rows={8} />}
      {flow.isError && <ErrorBlock error={flow.error} retry={() => void flow.refetch()} />}
      {graph && graph.nodes.filter((n) => n.kind === "activity").length === 0 && (
        <EmptyState
          title={`No ${noun} match.`}
          reason="Every item is removed by the chips above the map."
          action={{ label: "Remove the last chip", onClick: () => changeFilter(filter && filter.and.length > 1 ? { and: filter.and.slice(0, -1) } : undefined) }}
          alternative={{ label: "Reset all", onClick: () => changeFilter(undefined) }}
        />
      )}
      {graph && graph.nodes.filter((n) => n.kind === "activity").length > 0 && (
        <Suspense fallback={<LoadingBlock rows={8} />}>
          <FlowMap
            className="min-h-0 flex-1"
            graph={graph}
            title={`Process map of ${scope ?? "the whole log"} with the expectations drawn on it`}
            frame="page"
            filter={filter}
            preview={preview.data}
            onFilterChange={changeFilter}
            counts={{ casesIn: casesIn ?? meta.cases ?? 0, casesTotal }}
            noneRemoved={feedback.noneRemoved}
            noun={noun}
            plainOf={plainOf}
            focus={search.activity ?? null}
            onFocusChange={(a) => patch({ activity: a })}
            paths={focused.data?.paths ?? undefined}
            detail={search.detail}
            onDetailChange={(d) => patch({ detail: d })}
            render={search.render as RenderMode}
            onRenderChange={(m) => patch({ render: m })}
            full={search.full}
            onFullChange={(f) => patch({ full: f || undefined })}
            bpmnHref={bpmnUrl(ctx.projectId, runId, { detail: 0.05, filter })}
            selectedId={selectedId}
            onSelectionChange={(sel) => {
              const next = sel?.kind === "node" ? `activity:${sel.label}` : undefined;
              if (next !== search.sel) void navigate({ to: ".", search: (s) => ({ ...(s as FlowSearch), sel: next }), replace: true });
            }}
            announce={feedback.announcement}
            onAction={(action) => {
              const id = action.ids[0];
              if (action.id === "lens") {
                const candidates = constraintsOfActivity(id ?? "");
                setLens(candidates.find((c) => LENS_TYPES.has(c.type ?? ""))?.id ?? candidates[0]?.id);
              }
              if (action.id === "worst-cases") {
                void navigate({ to: "/p/$projectId/runs/$runId/backlog", params: { projectId: ctx.projectId, runId }, search: { slicing, view, tab: "table", sort: "-stable_PI", filter: search.filter } as never });
              }
              if (action.id === "pin") {
                pin({ projectId: ctx.projectId, runId, href, label: `${action.label}${filter?.and.length ? ` · ${filter.and.length} filters` : ""}`, chips: (filter?.and ?? []).map(() => "") });
              }
              if (action.id === "add-constraint" && run.normVersionId) {
                void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: run.normVersionId }, search: { tab: "constraints" } as never });
              }
            }}
          />
        </Suspense>
      )}
      <p className="sr-only" aria-live="polite" data-testid="filter-announcement">
        {feedback.announcement}
      </p>
      <LensDialog projectId={ctx.projectId} runId={runId} constraintId={lens} title={lens ? plainOf(lens) : ""} onClose={() => setLens(undefined)} onOpenNorm={(c) => void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: run.normVersionId }, search: { tab: "constraints", constraint: c } as never })} />
    </div>
  );
}
