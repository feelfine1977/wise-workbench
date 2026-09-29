import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { isAnalysisNormLens, returnTarget, useNavStore } from "@/lib/stores/nav";
import { useWorkbench } from "@/app/context";
import { normRoute } from "@/app/router";
import { RuleEvidenceSummary } from "./RuleEvidenceSummary";
import { NormCalibrationChart } from "./NormCalibrationChart";
import { analysisSelectionsQuery } from "@/lib/api/analysisSelections";
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
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { normQuery, normsQuery, normCalibrationQuery, normSignalQuery, useCreateNormVersion, type NormVersionCreate } from "@/lib/api/norms";
import { normRefusal } from "./normErrors";
import { flowTypesQuery, flowTypeOf, selectionIdOf } from "@/lib/api/runs";
import { runManifestQuery } from "@/lib/api/runs";
import { inventoryQuery } from "@/lib/api/norms";
import { CalibrationAction, CalibrationNotice } from "./CalibrationNotice";
import { WhatDoesThisMean } from "@/components/knowledge/WhatDoesThisMean";
import { ApplicabilityEditor, CommitFieldsForm, NewConstraintButton, RuleEditor, StatusChip, applicabilitySentence, ruleSentence, thresholdOf, normChangeNote, type CommitFields, type Constraint, type ExclusionDraft } from "./Builder";
import { NEXT_STATUS, SignVersion } from "./SignVersion";
import { cn } from "@/lib/utils";
import { StructureEditor } from "./StructureEditor";
import type { NormDocument } from "./normAuthoring";
import { NormVersionComparison } from "./NormVersionComparison";
import { NormGuide } from "./NormGuide";
import { ConstraintLayerMap } from "./ConstraintLayerMap";
import { GuidedProcessTemplate } from "./GuidedProcessTemplate";
import { ConstraintNavigator } from "./ConstraintNavigator";
import { NormDisplayControls } from "./NormDisplayControls";
import { allNormItems, constraintVisible, type NormVisibility } from "./normVisibility";
import { normRelevanceQuery } from "@/lib/api/normRelevance";
import { BatchNormDecisions } from "./BatchNormDecisions";
import { NormAuthoringSettings } from "./NormAuthoringSettings";
import { useNormAuthoringPreferences } from "./useNormAuthoringPreferences";
import type { NormTab } from "@/app/search";

/**
 * A norm version, and the builder that calibrates it in the browser (R3-02, R3-O6, R2-11).
 *
 * The catalogue leads with each expectation's plain name and its rule in one sentence — the id lives in the
 * tooltip — and flags the ones whose threshold says more about the threshold than about the groups. The
 * right-hand pane is the expectation itself: the distribution lens for its threshold, the rule editor with
 * pickers bound to this log's own activities and values, and the applicability editor, including
 * *not applicable to this log* with a note. Guided drafts can skip rationale and owner;
 * every change is saved as the next version, separately from review and approval.
 */
export default function NormPage() {
  const { projectId, normVersionId } = normRoute.useParams();
  // Keep navigation choices while each immutable version owns its unsaved edits.
  const [pane, setPane] = useState<"lens" | "rule" | "applies">("rule");
  const [structureStep, setStructureStep] = useState<"layers" | "views">("layers");
  const [displayByVersion, setDisplayByVersion] = useState<Record<string, NormVisibility>>({});
  return <NormPageSession key={`${projectId}:${normVersionId}`} pane={pane} setPane={setPane} structureStep={structureStep} setStructureStep={setStructureStep} visibility={displayByVersion[normVersionId] ?? allNormItems} setVisibility={visibility => setDisplayByVersion(previous => ({ ...previous, [normVersionId]: visibility }))} />;
}

function NormPageSession({ pane, setPane, structureStep, setStructureStep, visibility, setVisibility }: {
  pane: "lens" | "rule" | "applies"; setPane: (pane: "lens" | "rule" | "applies") => void;
  structureStep: "layers" | "views"; setStructureStep: (step: "layers" | "views") => void;
  visibility: NormVisibility; setVisibility: (visibility: NormVisibility) => void;
}) {
  const { allowDraftWithoutDecision, showAdvancedControls } = useNormAuthoringPreferences();
  const ctx = useWorkbench();
  const { normVersionId } = normRoute.useParams();
  const search = normRoute.useSearch();
  const navigate = useNavigate();
  const norm = useQuery(normQuery(ctx.projectId, normVersionId));
  const norms = useQuery(normsQuery(ctx.projectId));
  const create = useCreateNormVersion(ctx.projectId);
  const calibration = useQuery(normCalibrationQuery(ctx.projectId, normVersionId));
  const json = norm.data?.norm as NormDocument | undefined;
  const constraints = useMemo(() => json?.constraints ?? [], [json]);
  const runId = ctx.runs.find((r) => r.status === "done" && r.normVersionId === normVersionId && r.caseTableId === ctx.caseTable?.id && selectionIdOf(r) === search.selection && !flowTypeOf(r))?.id;
  const selected = constraints.find((c) => c.id === search.constraint) ?? constraints[0];
  const dist = useQuery({ ...normSignalQuery(ctx.projectId, normVersionId, ctx.caseTable?.id ?? "", selected?.id ?? "", search.selection), enabled: !!ctx.caseTable && !!selected && !!thresholdOf(selected) });
  const [pending, setPending] = useState<{ threshold: number; width: number }>();
  const [fields, setFields] = useState<CommitFields>({ rationale: "", owner: "" });
  const [signing, setSigning] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [normName, setNormName] = useState("");
  const [renameFields, setRenameFields] = useState<CommitFields>({ rationale: "", owner: "" });
  const [renameAttempted, setRenameAttempted] = useState(false);
  // the rule and the applicability of the selected expectation while they are being edited
  const [edited, setEdited] = useState<Constraint>();
  const [exclusion, setExclusion] = useState<ExclusionDraft>({ excluded: false, note: "" });
  const localEdits = useRef(new Map<string, { edited?: Constraint; pending?: { threshold: number; width: number }; exclusion: ExclusionDraft; fields: CommitFields; pane: "rule" | "lens" | "applies" }>());
  const calibrationPane = useRef<HTMLElement>(null);
  useEffect(() => {
    if (pane !== "lens") return;
    calibrationPane.current?.focus();
    calibrationPane.current?.scrollIntoView({ block: "nearest" });
  }, [pane, selected?.id]);
  const inventory = useQuery({ ...inventoryQuery(ctx.projectId, ctx.caseTable?.id ?? ""), enabled: !!ctx.caseTable });
  const relevance = useQuery({ ...normRelevanceQuery(ctx.projectId, normVersionId, ctx.caseTable?.id ?? "", search.selection), enabled: !!ctx.caseTable });
  const cohorts = useQuery({ ...analysisSelectionsQuery(ctx.projectId, ctx.caseTable?.id ?? ""), enabled: !!ctx.caseTable });
  const evidenceName = search.selection ? cohorts.data?.find(cohort => cohort.id === search.selection)?.name ?? "Saved selection" : "All prepared cases";
  const flowTypes = useQuery({ ...flowTypesQuery(ctx.projectId, ctx.caseTable?.id ?? ""), enabled: !!ctx.caseTable });
  const manifest = useQuery({ ...runManifestQuery(ctx.projectId, runId ?? ""), enabled: !!runId });
  const uncalibrated = useMemo(() => new Map((manifest.data?.uncalibrated ?? []).map((u) => [u.id, u])), [manifest.data]);
  const caseNoun = ctx.caseTable?.readiness?.caseNoun ?? "cases";
  const plainOf = (c: Constraint) => c.plain_name ?? c.description?.replace(/\.$/, "") ?? uncalibrated.get(c.id)?.plain_name ?? c.id;
  /** Run warnings can concern threshold calibration or measurement coverage. */
  const flagged = constraints.filter((c) => uncalibrated.has(c.id)).length;
  // opened from a reason screen, the lens is a sub-screen of Why: the stepper keeps Why current with this line under it
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visited = useNavStore((s) => s.visited);
  const lastSlice = useNavStore((s) => s.lastSlice);
  const setSubline = useNavStore((s) => s.setSubline);
  const fromWhy = isAnalysisNormLens(pathname, returnTarget(visited, pathname)?.pathname, search);
  const lensName = selected ? plainOf(selected) : undefined;
  useEffect(() => {
    if (fromWhy && lastSlice) setSubline(`${lastSlice.label} · lens of “${lensName ?? selected?.id ?? "an expectation"}”`);
    else setSubline(undefined);
    return () => setSubline(undefined);
  }, [fromWhy, lastSlice, lensName, selected?.id, setSubline]);

  const setTab = (tab: NormTab) => void navigate({ to: ".", search: (s) => ({ ...s, tab }) });
  const selectConstraint = (id: string, nextPane?: "rule" | "lens") => {
    const currentId = edited?.id ?? selected?.id;
    if (currentId && search.constraint) localEdits.current.set(`${normVersionId}:${currentId}`, { edited, pending, exclusion, fields, pane });
    const restored = localEdits.current.get(`${normVersionId}:${id}`);
    setEdited(restored?.edited);
    setPending(restored?.pending);
    setExclusion(restored?.exclusion ?? { excluded: false, note: "" });
    setFields(restored?.fields ?? { rationale: "", owner: "" });
    setAttempted(false);
    setPane(nextPane ?? restored?.pane ?? "rule");
    create.reset();
    void navigate({ to: ".", search: (s) => ({ ...s, tab: "constraints", constraint: id }) });
  };
  const exactRelevance = relevance.data?.normVersionId === normVersionId && relevance.data?.caseTableId === ctx.caseTable?.id && (relevance.data?.scope?.selectionId ?? undefined) === search.selection ? relevance.data : undefined;
  const showOverview = () => {
    const currentId = edited?.id ?? selected?.id;
    if (currentId && search.constraint) localEdits.current.set(`${normVersionId}:${currentId}`, { edited, pending, exclusion, fields, pane });
    setEdited(undefined); setPending(undefined); setFields({ rationale: "", owner: "" }); setExclusion({ excluded: false, note: "" });
    void navigate({ to: ".", search: sp => ({ ...sp, constraint: undefined }) });
  };
  const changeDisplay = (next: NormVisibility) => {
    setVisibility(next);
    if (search.tab === "constraints" && search.constraint && selected && !constraintVisible(selected, next, exactRelevance)) showOverview();
  };
  const hideLayer = (id: string) => changeDisplay({ ...visibility, hiddenLayers: [...new Set([...visibility.hiddenLayers, id])] });
  const hideConstraint = (id: string) => changeDisplay({ ...visibility, hiddenConstraints: [...new Set([...visibility.hiddenConstraints, id])] });
  const displayControls = json && <NormDisplayControls compact document={json} visibility={visibility} relevance={exactRelevance} loading={relevance.isFetching} onRetry={() => { void relevance.refetch(); }} onChange={changeDisplay} />;
  const savedDecision = calibration.data?.thresholds?.find((row) => row.constraint_id === (edited ?? selected)?.id);
  const saveError = create.isError ? (
    <p role="alert" className="reading text-sm text-danger" data-testid="norm-save-error">
      This version could not be saved. Your changes are still here. {normRefusal(create.error, Object.fromEntries([...constraints, ...(edited ? [edited] : [])].map(c => [c.id, plainOf(c)])), "save")}
    </p>
  ) : null;

  /** Save decision metadata through the public request fields; the server owns canonicalization. */
  const saveVersion = (patch: (c: Constraint) => Constraint, what: string, extra?: Constraint, exclude = false) => {
    if (!json || create.isPending) return;
    setAttempted(true);
    const invalid = [
      ...(pane === "rule" && edited && !(edited.plain_name ?? edited.description ?? edited.id).trim() ? ["rule-name"] : []),
      ...(exclude && !exclusion.note.trim() ? ["applicability-note"] : []),
      ...(!allowDraftWithoutDecision && !fields.rationale.trim() ? ["commit-rationale"] : []),
      ...(!allowDraftWithoutDecision && !fields.owner.trim() ? ["commit-owner"] : []),
    ];
    if (invalid.length) { requestAnimationFrame(() => document.getElementById(invalid[0]!)?.focus()); return; }
    const id = extra?.id ?? (edited ?? selected)?.id;
    const next: NormDocument = {
      ...json,
      constraints: [...constraints.map((c) => (c.id === id ? patch(c) : c)), ...(extra ? [extra] : [])],
    };
    const changed = next.constraints?.find((c) => c.id === id);
    const previous = constraints.find(c => c.id === id);
    const nameOnly = previous && changed && (previous.plain_name ?? previous.description ?? previous.id) !== (changed.plain_name ?? changed.description ?? changed.id) && previous.type === changed.type
      && JSON.stringify(previous.params) === JSON.stringify(changed.params)
      && JSON.stringify(previous.applicability) === JSON.stringify(changed.applicability);
    const body: NormVersionCreate = {
      norm: next as Record<string, unknown>,
      note: normChangeNote(what, fields),
      parentId: normVersionId,
      ...(!allowDraftWithoutDecision && changed && thresholdOf(changed) && !exclude && !nameOnly ? { calibration: { [changed.id]: { rationale: fields.rationale.trim(), owner: fields.owner.trim() } } } : {}),
      ...(id && exclude ? { notApplicable: { [id]: { note: exclusion.note.trim(), ...(fields.owner.trim() ? { author: fields.owner.trim() } : {}) } } } : {}),
    };
    create.mutate(
      body,
      {
        onSuccess: (created) => {
          setAttempted(false);
          setPending(undefined);
          setEdited(undefined);
          setExclusion({ excluded: false, note: "" });
          setFields({ rationale: "", owner: "" });
          void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: created.id }, search: { ...search, caseTable: search.caseTable, tab: exclude ? "history" : "constraints", constraint: exclude ? undefined : id } });
        },
      },
    );
  };

  const renameVersion = () => {
    if (!json || create.isPending) return;
    setRenameAttempted(true);
    const invalid = !normName.trim() ? "norm-name" : !allowDraftWithoutDecision && !renameFields.rationale.trim() ? "rename-rationale" : !allowDraftWithoutDecision && !renameFields.owner.trim() ? "rename-owner" : undefined;
    if (invalid) { document.getElementById(invalid)?.focus(); return; }
    create.mutate({ norm: { ...json, name: normName.trim() }, parentId: normVersionId, note: normChangeNote("Norm renamed", renameFields) }, {
      onSuccess: created => {
        setRenaming(false);
        void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: created.id }, search: { ...search } });
      },
    });
  };

  const commit = () => {
    if (!selected || !pending) return;
    const t = thresholdOf(selected);
    if (!t) return;
    saveVersion((c) => ({ ...c, params: { ...c.params, [t.keys[0]]: pending.threshold, [t.keys[1]]: pending.width } }), `${plainOf(selected)}: threshold set to ${pending.threshold}, ${"tolerance width"} ${pending.width}`);
  };

  /** A rule or an applicability edited in the pane, saved as the next version. */
  const commitEdited = (what: string, exclude = false) => {
    if (!edited && !selected) return;
    const editing = (edited ?? selected)!;
    // Classic norm documents support description; plain_name is display-only metadata.
    const value = { ...editing, description: (editing.plain_name ?? editing.description ?? editing.id).trim() };
    delete value.plain_name;
    const extra = constraints.some(c => c.id === value.id) ? undefined : value;
    saveVersion(c => extra ? c : value, `${plainOf(value)}: ${what}`, extra, exclude);
  };

  const finishReview = (createdId?: string) => {
    setSigning(false);
    if (createdId) void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: createdId }, search: { ...search, tab: "review" } });
  };

  return (
    <div className="wise-norm-page flex flex-col gap-4">
      <QueryState query={norm} rows={6}>
        {(nv) => (
          <>
            <header className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-text-subtle">
                  <BackControl className="normal-case tracking-normal" />
                  <span>Process norm</span>
                </div>
                <h1 className="flex items-center gap-2 text-2xl font-semibold" title={nv.id}>
                  {json?.name ?? "Process norm"} · version {nv.version}
                  <HowToReadToggle id="norm" />
                  <Button variant="ghost" size="sm" onClick={() => { setNormName(json?.name ?? ""); setRenameFields({ rationale: "", owner: "" }); setRenameAttempted(false); create.reset(); setRenaming(true); }}>Rename norm</Button>
                </h1>
                <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
                  <StatusChip status={nv.status} />
                  {/* P1-9: the version is signed where it is read, beside the badge that says it is not */}
                  {NEXT_STATUS[nv.status as "draft" | "reviewed"] && (
                    <Button variant="outline" size="sm" onClick={() => setSigning(true)}>
                      {NEXT_STATUS[nv.status as "draft" | "reviewed"].label}
                    </Button>
                  )}
                  {nv.author ? <span className="text-xs text-text-subtle">{nv.status === "draft" ? "author" : "signed by"} {nv.author}</span> : null}
                  <span>
                    {constraints.length} constraints · {json?.layers?.length ?? 0} layers · {json?.views?.length ?? 0} views
                    {flagged > 0 ? <span className="ml-2 text-warning">· {fmtInt(flagged)} constraints with log or calibration warnings</span> : null}
                  </span>
                </p>
                {signing && <SignVersion projectId={ctx.projectId} key={nv.id} version={nv} onDone={finishReview} />}
              </div>
              <div className="flex flex-wrap items-center gap-3" data-no-capture>
                <FreezeButton projectId={ctx.projectId} screen="norm" context={{ run_id: runId }} data={{ constraint: selected?.id, threshold: selected ? thresholdOf(selected) : undefined }} defaultTitle={`Norm v${nv.version}${selected ? ` · ${selected.id}` : ""}`} />
                <Link className="text-sm text-accent-text underline" to="/p/$projectId/norms" params={{ projectId: ctx.projectId }}>
                  all versions
                </Link>
              </div>
            </header>
            <HowToRead id="norm">
              Begin with the purpose and evidence. Define expectations (constraints), group them into layers, then weight them in views. Review records the reason and owner behind required decisions. Every saved change creates a new draft; existing results keep their original Process norm.
            </HowToRead>
            <div className="wise-norm-tools flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              <label className="flex min-w-0 flex-wrap items-center gap-2 text-sm">Evidence population
                <select aria-label="Evidence population" className="max-w-full rounded-lg border border-border bg-surface px-3 py-2" value={search.selection ?? ""} disabled={!ctx.caseTable} onChange={event => void navigate({ to: ".", search: previous => ({ ...previous, selection: event.target.value || undefined }) })}>
                  <option value="">All prepared cases</option>
                  {search.selection && !cohorts.data?.some(cohort => cohort.id === search.selection) && <option value={search.selection}>Saved selection · verifying…</option>}
                  {(cohorts.data ?? []).map(cohort => <option key={cohort.id} value={cohort.id}>{cohort.name} · {fmtInt(cohort.cases)} cases</option>)}
                </select>
              </label>
              <span className="text-xs text-text-muted">{exactRelevance ? `${fmtInt(exactRelevance.cases)} cases · ` : ""}Coverage and calibration use this population. Rules stay shared.</span>
              {cohorts.isError && <p role="status" className="text-xs text-warning">Saved populations could not be loaded. Selected evidence will not fall back to all cases.</p>}
            </div>
            <NormAuthoringSettings disabled={create.isPending}>{json && <NormDisplayControls document={json} visibility={visibility} relevance={exactRelevance} loading={relevance.isFetching} onRetry={() => { void relevance.refetch(); }} onChange={changeDisplay} />}</NormAuthoringSettings>
            </div>
            <Tabs className="wise-norm-tabs" value={search.tab} onValueChange={(v) => setTab(v as NormTab)}>
              <TabsList underline aria-label="Norm sections" className="wise-norm-subnav">
                <TabsTrigger value="guide">Guided overview</TabsTrigger>
                <TabsTrigger value="constraints">Constraints</TabsTrigger>
                <TabsTrigger value="structure">Layers &amp; views</TabsTrigger>
                <TabsTrigger value="map">Norm map</TabsTrigger>
                <TabsTrigger value="review">Review</TabsTrigger>
                <TabsTrigger value="history">Version notes</TabsTrigger>
                {(showAdvancedControls || search.tab === "json") && <TabsTrigger value="json">JSON</TabsTrigger>}
              </TabsList>

              <TabsContent value="guide" forceMount hidden={search.tab !== "guide"}>
                {json && <NormGuide key={normVersionId} projectId={ctx.projectId} versionId={normVersionId} document={json} process={ctx.project?.process ?? undefined} datasetName={ctx.dataset?.name} caseTableId={ctx.caseTable?.id} caseNoun={caseNoun} coverageWarnings={exactRelevance?.constraints.filter(item => item.issues.length > 0 || item.missingActivities.length > 0).length} onTab={setTab} onConstraint={selectConstraint} onSaved={id => void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: id }, search: { ...search, tab: "guide" } })} />}
                {json && <NormVersionComparison key={`compare:${normVersionId}`} projectId={ctx.projectId} parentId={nv.parentId} document={json} onConstraint={selectConstraint} />}
              </TabsContent>
              <TabsContent value="map">
                {displayControls}
                {json && <ConstraintLayerMap document={json} visibility={visibility} relevance={exactRelevance} onHideLayer={hideLayer} onHideConstraint={hideConstraint} onConstraint={selectConstraint} onStructure={(step, view) => { setStructureStep(step); void navigate({ to: ".", search: sp => ({ ...sp, tab: "structure", ...(view ? { view } : {}) }) }); }} />}
              </TabsContent>
              <TabsContent value="constraints">
                {displayControls}
                <div className={search.constraint ? "grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]" : "space-y-4"}>
                  <Card className={search.constraint ? "wise-constraint-nav max-h-[78vh] overflow-y-auto !p-3" : "wise-constraint-nav"}>
                    {json && <ConstraintNavigator key={normVersionId} document={json} template={<GuidedProcessTemplate projectId={ctx.projectId} caseTableId={ctx.caseTable?.id} datasetName={ctx.dataset?.name} onCreated={id => void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: id }, search: { caseTable: ctx.caseTable?.id, selection: search.selection, tab: "constraints" } })} />} visibility={visibility} onHideLayer={hideLayer} onHideConstraint={hideConstraint} relevance={exactRelevance} evidenceState={!ctx.caseTable ? "no-table" : relevance.isError ? "error" : relevance.isPending ? "loading" : "ready"} datasetName={ctx.dataset?.name} selected={edited ?? selected} overview={!search.constraint} missing={calibration.data?.missingRationale ?? []} warnings={uncalibrated} onSelect={selectConstraint} onOverview={showOverview}>
                      <NewConstraintButton
                        layers={json?.layers ?? []}
                        onCreate={(c) => {
                          const currentId = edited?.id ?? selected?.id;
                          if (currentId && search.constraint) localEdits.current.set(`${normVersionId}:${currentId}`, { edited, pending, exclusion, fields, pane });
                          setFields({ rationale: "", owner: "" }); setPending(undefined);
                          setEdited(c);
                          setExclusion({ excluded: false, note: "" });
                          setPane("rule");
                          void navigate({ to: ".", search: (sp) => ({ ...sp, constraint: c.id }) });
                        }}
                      />
                    </ConstraintNavigator>}
                  </Card>
                  <Card hidden={!search.constraint} className="wise-rule-panel min-w-0" data-testid="norm-builder">
                    {(edited && JSON.stringify(edited) !== JSON.stringify(selected) || fields.rationale || fields.owner) && <p role="status" className="mb-3 text-xs text-text-muted">Unsaved edits are kept while switching constraints in this version. Save before leaving this page or changing versions.</p>}
                    {!selected && !edited && <p className="text-sm text-text-muted">Select a constraint or add one to begin.</p>}
                    {(selected || edited) && (
                      <>
                        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                          <CardTitle className="mb-0 flex items-center gap-1.5" title={(edited ?? selected)?.id}>
                            {plainOf((edited ?? selected) as Constraint)}
                            <WhatDoesThisMean kind="constraint" entryId={(edited ?? selected)?.id} label={plainOf((edited ?? selected) as Constraint)} />
                          </CardTitle>
                          <span className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="What to work on">
                            {([["rule", "the rule"], ["applies", "who it applies to"], ["lens", "the numbers"]] as const).map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                aria-pressed={pane === id}
                                onClick={() => {
                                  setPane(id);
                                  setAttempted(false);
                                  if (id !== "lens" && !edited && selected) setEdited(selected);
                                }}
                                className={cn("px-2 py-1 text-xs", pane === id ? "bg-accent-subtle font-medium text-accent-text" : "text-text-muted hover:bg-surface-sunken")}
                              >
                                {label}
                              </button>
                            ))}
                          </span>
                        </div>
                        <p className="mb-2 text-xs text-text-muted">
                          Layer: {json?.layers?.find(l => l.id === (edited ?? selected)?.layer)?.name ?? (edited ?? selected)?.layer}
                          <Link className="ml-3 text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId }} search={{ ...search, tab: "structure" }}>Layers &amp; views</Link>
                        </p>
                        <p className="wise-rule-sentence reading mb-3 text-sm" data-testid="norm-sentence">
                          <span className="mb-1 block text-xs uppercase tracking-wide text-text-muted">Rule from current settings</span>{ruleSentence((edited ?? selected) as Constraint)}. <span className="mt-1 block text-xs text-text-muted">{applicabilitySentence((edited ?? selected) as Constraint, caseNoun, pane === "applies" ? exclusion : undefined)}</span>
                        </p>
                        {selected && <RuleEvidenceSummary projectId={ctx.projectId} versionId={normVersionId} caseTableId={ctx.caseTable?.id} selectionId={search.selection} constraint={selected} readyForCounts={!thresholdOf(selected) || !!dist.data} relevance={exactRelevance?.constraints.find(row => row.id === selected.id)} />}
                        {calibration.isError && <p role="alert" className="mb-3 text-sm text-danger">Saved decisions could not be read. Your edits are still here; reload to try again.</p>}
                        {savedDecision && (savedDecision.rationale || savedDecision.owner) && (
                          <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 text-sm" data-testid="saved-calibration">
                            <dt className="text-text-muted">Saved reason</dt><dd>{savedDecision.rationale || "Not recorded"}</dd>
                            <dt className="text-text-muted">Owner</dt><dd>{savedDecision.owner || "Not recorded"}</dd>
                            <dt className="text-text-muted">Decision recorded</dt><dd>{savedDecision.decidedAt ? <time dateTime={savedDecision.decidedAt}>{fmtDateTime(savedDecision.decidedAt)}</time> : "Not recorded"}</dd>
                          </dl>
                        )}
                        {selected && uncalibrated.get(selected.id) && <CalibrationAction className="mb-3" warning={uncalibrated.get(selected.id)!} numeric={!!thresholdOf(selected)} name={plainOf(selected)} onClick={() => { setPane("lens"); setAttempted(false); }} />}

                        {pane === "lens" && (
                          <section ref={calibrationPane} tabIndex={-1} aria-label="Calibration and measurement">
                            <p className="mb-2 text-xs text-text-muted">Evidence: {evidenceName} · saved norm version {nv.version}. Previewing a target does not change an assessment or approve the norm.</p>
                            {edited && JSON.stringify(edited) !== JSON.stringify(selected) && <p role="status" className="mb-3 rounded border border-warning/50 bg-warning-subtle p-2 text-sm">This threshold preview uses the saved activity and applicability definitions. Save other rule edits as a new version to calibrate those definitions.</p>}
                            {edited && edited.id !== selected?.id && <p className="mb-3 text-sm">This new constraint has no saved measurement yet.</p>}
                            {!ctx.caseTable && <p className="text-sm text-text-muted">Select a mapped case table to inspect this version’s thresholds.</p>}
                            {selected && <CalibrationNotice warning={uncalibrated.get(selected.id)} numeric={!!thresholdOf(selected)}
                              onRule={() => { setPane("rule"); setAttempted(false); }}
                              onApplicability={() => { setPane("applies"); setAttempted(false); if (!edited) setEdited(selected); }} /> }
                            {selected && thresholdOf(selected) && ctx.caseTable && dist.isPending && <><p role="status" className="text-sm text-text-muted">Loading calibration distribution…</p><LoadingBlock rows={5} /></>}
                            {selected && thresholdOf(selected) && dist.isError && <ErrorBlock error={dist.error} retry={() => void dist.refetch()} />}
                            {selected && (!edited || edited.id === selected.id) && dist.data && thresholdOf(selected) && (
                              <NormCalibrationChart
                                key={`${normVersionId}:${ctx.caseTable?.id}:${selected.id}:${search.selection ?? "all"}`}
                                projectId={ctx.projectId} versionId={normVersionId} caseTableId={ctx.caseTable!.id} selectionId={search.selection}
                                distribution={dist.data} constraint={selected} title={plainOf(selected)} populationName={evidenceName}
                                onCommit={next => { setAttempted(false); setPending(next); }}
                              />
                            )}
                          </section>
                        )}

                        {pane === "rule" && (edited || selected) && ctx.caseTable && (
                          <>
                            <RuleEditor key={selected?.id} projectId={ctx.projectId} caseTableId={ctx.caseTable.id} showSummary={false} constraint={(edited ?? selected)!} caseNoun={caseNoun} onChange={setEdited} nameInvalid={attempted && !((edited ?? selected)!.plain_name ?? (edited ?? selected)!.description ?? (edited ?? selected)!.id).trim()} />
                            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                              <CommitFieldsForm value={fields} onChange={setFields} attempted={attempted} optional={allowDraftWithoutDecision} />
                              {saveError}
                              <div className="flex gap-2">
                                <Button size="sm" disabled={create.isPending} onClick={() => commitEdited("the rule was changed")}>
                                  Save as the next version
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => { setEdited(undefined); setExclusion({ excluded: false, note: "" }); create.reset(); setPane("lens"); }}>
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
                              exclusion={exclusion}
                              onExclusionChange={setExclusion}
                              noteInvalid={attempted && exclusion.excluded && !exclusion.note.trim()}
                              flowTypes={(flowTypes.data?.types ?? []).map((f) => ({ name: f.name, cases: f.cases }))}
                              attributes={inventory.data?.attributes ?? []}
                              caseNoun={caseNoun}
                              onChange={setEdited}
                            />
                            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                              <CommitFieldsForm value={fields} onChange={setFields} attempted={attempted} optional={allowDraftWithoutDecision} />
                              {saveError}
                              <div className="flex gap-2">
                                <Button size="sm" disabled={create.isPending} onClick={() => commitEdited(exclusion.excluded ? "not applicable to this log" : "who it applies to was changed", exclusion.excluded)}>
                                  Save as the next version
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => { setEdited(undefined); setExclusion({ excluded: false, note: "" }); create.reset(); setPane("lens"); }}>
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

              <TabsContent value="structure" forceMount hidden={search.tab !== "structure"}>
                <div className="mb-3 flex gap-2" role="group" aria-label="Structure steps">
                  <Button size="sm" variant={structureStep === "layers" ? "default" : "outline"} aria-pressed={structureStep === "layers"} onClick={() => setStructureStep("layers")}>1 · Layers</Button>
                  <Button size="sm" variant={structureStep === "views" ? "default" : "outline"} aria-pressed={structureStep === "views"} onClick={() => setStructureStep("views")}>2 · Views</Button>
                </div>
                {json && <StructureEditor key={normVersionId} projectId={ctx.projectId} versionId={normVersionId} document={json} step={structureStep} selectedView={ctx.view} onView={ctx.setView}
                  onStep={step => { if (step !== "constraints") setStructureStep(step); }}
                  onConstraint={selectConstraint}
                  onSaved={id => void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: id }, search: { ...search, tab: "structure" } })} />}
              </TabsContent>

              <TabsContent value="review" forceMount hidden={search.tab !== "review"}>
                {json && <BatchNormDecisions key={normVersionId} projectId={ctx.projectId} versionId={normVersionId} document={json} caseTableId={ctx.caseTable?.id} selectionId={search.selection} onConstraint={selectConstraint} onSaved={id => void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: ctx.projectId, normVersionId: id }, search: { ...search, tab: "review" } })} />}
                <Card className="mt-4">
                  <CardTitle>Review readiness</CardTitle>
                  {calibration.isPending && <LoadingBlock rows={2} />}
                  {calibration.isError && <div role="alert" className="text-sm text-danger">Review requirements could not be checked. <Button size="sm" variant="outline" onClick={() => void calibration.refetch()}>Retry preflight</Button></div>}
                  {calibration.data && <>
                    <p className="mb-3 text-sm">{calibration.data.missingRationale?.length ? `${calibration.data.missingRationale.length} constraints need a reason, an owner, or confirmation of a changed decision.` : "All required reasons and owners are recorded."}</p>
                    {NEXT_STATUS[nv.status as "draft" | "reviewed"] && <Button size="sm" onClick={() => setSigning(true)}>{calibration.data.missingRationale?.length ? "Complete review decisions" : "Continue to signature"}</Button>}
                    {nv.status === "approved" && <p className="text-sm">Approved by {nv.author || "the recorded approver"}. Further edits create a new draft.</p>}
                  </>}
                </Card>
              </TabsContent>

              <TabsContent value="json">
                <JsonView value={nv.norm} ariaLabel={`Norm JSON v${nv.version}`} />
              </TabsContent>

              <TabsContent value="history">
                {json && <NormVersionComparison key={`compare:${normVersionId}`} projectId={ctx.projectId} parentId={nv.parentId} document={json} onConstraint={selectConstraint} />}
                <div className="grid gap-4 lg:grid-cols-2">
                  <Card>
                    <CardTitle>This version</CardTitle>
                    {calibration.isError && <p role="alert" className="mb-3 text-sm text-danger">Saved decisions could not be read. Reload to try again.</p>}
                    {!!calibration.data?.notApplicable?.length && (
                      <section className="mb-4" aria-label="Not applicable to this log" data-testid="saved-exclusions">
                        <h3 className="font-medium">Not applicable to this log</h3>
                        <ul className="mt-2 flex flex-col gap-2">
                          {calibration.data.notApplicable.map((entry) => {
                            const id = typeof entry.constraint_id === "string" ? entry.constraint_id : "";
                            const original = json?.metadata?.not_applicable?.[id]?.constraint;
                            const date = typeof entry.decidedAt === "string" ? entry.decidedAt : undefined;
                            return <li key={id}>
                              <p className="font-medium">{original ? plainOf(original) : id}</p>
                              <p>{typeof entry.note === "string" ? entry.note : "No note recorded"}</p>
                              <p className="text-xs text-text-muted">Decision by {typeof entry.author === "string" ? entry.author : "not recorded"} · {date ? <time dateTime={date}>{fmtDateTime(date)}</time> : "Date not recorded"}</p>
                            </li>;
                          })}
                        </ul>
                      </section>
                    )}
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

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename norm</DialogTitle><DialogDescription>The new name is saved as a new version. Existing rules and calibration decisions are preserved.</DialogDescription></DialogHeader>
          <Field label="Norm name" htmlFor="norm-name">
            <Input id="norm-name" value={normName} onChange={e => setNormName(e.target.value)} required aria-required="true" aria-invalid={renameAttempted && !normName.trim() || undefined} aria-describedby={renameAttempted && !normName.trim() ? "norm-name-error" : undefined} className={renameAttempted && !normName.trim() ? "border-danger ring-1 ring-danger" : undefined} />
            {renameAttempted && !normName.trim() && <p id="norm-name-error" className="text-xs text-danger">Enter a name for this norm.</p>}
          </Field>
          <CommitFieldsForm value={renameFields} onChange={setRenameFields} attempted={renameAttempted} prefix="rename" optional={allowDraftWithoutDecision} />
          {saveError}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>Cancel</Button>
            <Button onClick={renameVersion} disabled={create.isPending}>Save as the next version</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set this threshold</DialogTitle>
            <DialogDescription>
              {selected ? plainOf(selected) : ""}: {fmtNum(pending?.threshold, 2)}, {selected?.type === "lag" ? "tolerance width" : "tolerated to"} {fmtNum(pending?.width, 2)}. {allowDraftWithoutDecision ? "Save this target as a draft; its threshold decision remains pending." : "A threshold decision needs a reason and an owner."}
            </DialogDescription>
          </DialogHeader>
          <CommitFieldsForm value={fields} onChange={setFields} threshold attempted={attempted} optional={allowDraftWithoutDecision} />
          {saveError}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(undefined)}>
              Cancel
            </Button>
            <Button onClick={commit} disabled={create.isPending}>
              Save as the next version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
