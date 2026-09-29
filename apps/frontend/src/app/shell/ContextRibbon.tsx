import { GroupingControl } from "@/components/GroupingControl";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Camera, HelpCircle, Settings2, Search } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Kbd } from "@/components/ui/misc";
import { flowTypeOf, selectionIdOf } from "@/lib/api/runs";
import { analysisSelectionsQuery } from "@/lib/api/analysisSelections";
import { notebookQuery } from "@/lib/api/notebook";
import { useMocks } from "@/lib/config";
import { fmtDate, fmtInt, fmtNum } from "@/lib/format";
import { projectsQuery } from "@/lib/queries";
import { useNavStore } from "@/lib/stores/nav";
import { useUiStore } from "@/lib/stores/ui";
import { VOCABULARIES, type Vocabulary } from "@/lib/vocabulary";
import type { WorkbenchContext } from "../context";
import { useNormScope } from "./normScope";
import { summarizeReadiness } from "./readiness";
import { useCurrentStep } from "./Stepper";

const compactQuery = "(max-width: 1023px)";
const subscribeCompact = (onChange: () => void) => {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};
const isCompact = () => window.matchMedia(compactQuery).matches;

interface SwitcherProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  options: { value: string; label: string; hint?: string; title?: string }[];
  onChange: (value: string) => void;
  /** Vertical layout inside the ⋯ menu. */
  stacked?: boolean;
  disabled?: boolean;
  blockedReason?: string;
}

function Switcher({ label, value, options, onChange, placeholder, stacked, disabled, blockedReason }: SwitcherProps) {
  const { t } = useTranslation();
  const current = options.find((o) => o.value === value);
  const control = (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled || options.length === 0}>
      <SelectTrigger compact aria-label={t("ribbon.switch", { what: label })} title={blockedReason ?? (current ? `${current.label}${current.title ? ` · ${current.title}` : ""}` : undefined)} className={stacked ? "w-full min-w-0 [&>span:first-child]:whitespace-normal" : "max-w-[26rem] [&>span:first-child]:whitespace-normal"}>
        <SelectValue placeholder={placeholder ?? "–"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} title={o.title}>
            <span>{o.label}</span>
            {o.hint && <span className="ml-2 text-xs text-text-subtle">{o.hint}</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  if (stacked) {
    return (
      <li className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-text-subtle">{label}</span>
        {control}
      </li>
    );
  }
  return (
    <li className="flex items-center gap-1">
      <span className="text-xs text-text-subtle">{label}</span>
      {control}
    </li>
  );
}

/**
 * The context ribbon, reduced per step: only the switchers a step needs (project · dataset on Data; project ·
 * norm on Norm; project · run on Run; project · run · perspective · grouping · scope on Signals and Why;
 * project on the notebook), everything else in the ⋯ menu together with density, theme and the words switch.
 * The run switcher reads the run's note and date, the mapping switcher "case table v2 ·
 * 251,734 cases"; ids sit in the tooltips. On the right: the caveats chip, the notebook with its snapshot
 * count, the camera, help and the command palette.
 */
export function ContextRibbon({ ctx }: { ctx: WorkbenchContext }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const normScope = useNormScope(ctx);
  const compact = useSyncExternalStore(subscribeCompact, isCompact, () => false);
  const [moreOpen, setMoreOpen] = useState(false);
  const projects = useQuery(projectsQuery);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const density = useUiStore((s) => s.density);
  const setDensity = useUiStore((s) => s.setDensity);
  const openHelp = useUiStore((s) => s.openHelp);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const vocabulary = useUiStore((s) => s.vocabulary);
  const guided = useUiStore((s) => s.mode === "guided");
  const setMode = useUiStore((s) => s.setMode);
  const setVocabulary = useUiStore((s) => s.setVocabulary);
  const freezeButtons = useNavStore((s) => s.freezeButtons);
  const pid = ctx.projectId;
  const step = useCurrentStep(ctx);
  const notebook = useQuery({ ...notebookQuery(pid), enabled: !!pid, retry: false });
  const snapshots = notebook.data?.snapshots.length;

  // The flow-type scope: the unscoped run and the runs forked from it.
  const current = ctx.run;
  const selectionId = selectionIdOf(current);
  const selections = useQuery({ ...analysisSelectionsQuery(pid, current?.caseTableId ?? ""), enabled: !!selectionId && !!current?.caseTableId });
  const selection = selections.data?.find((item) => item.id === selectionId);
  const selectedCases = current?.manifest?.cases;
  const cohort = selectionId ? <li key="cohort" data-testid="ribbon-saved-selection" className="text-xs" title="The saved filter is baked into this assessment; changing flow keeps the same saved filter.">Saved analysis filter: {selection?.name ? `${selection.name} · ` : ""}{selectionId}{typeof selectedCases === "number" && Number.isFinite(selectedCases) ? ` · ${fmtInt(selectedCases)} cases in this assessment` : " · case count unavailable"}</li> : null;
  const scopeRuns = ctx.scopeRuns ?? [];
  const parent = scopeRuns.find((r) => !flowTypeOf(r));
  const family = scopeRuns.filter((r) => flowTypeOf(r));
  const scopeOptions = current ? [...(parent ? [{ value: parent.id, label: "all flows" }] : []), ...family.map((r) => ({ value: r.id, label: `${flowTypeOf(r)} only`, title: r.id }))] : [];

  const readiness = ctx.caseTable?.readiness;
  const readinessSummary = summarizeReadiness(readiness);
  const runLabel = (r: (typeof ctx.runs)[number]) => (r.note?.trim() ? `${r.note.trim()} · ${fmtDate(r.manifest?.finishedAt ?? r.createdAt)}` : `Run of ${fmtDate(r.manifest?.finishedAt ?? r.createdAt)}`);

  const project = <Switcher key="project" stacked={compact} label={t("ribbon.project")} value={pid} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name, title: p.id }))} onChange={(v) => void navigate({ to: "/p/$projectId", params: { projectId: v } })} />;
  const historical = ctx.datasetBindingConflict?.kind === "run";
  const fixedDatasetId = ctx.datasetBinding?.datasetId;
  const dataset = () => (
    <li key="dataset" className={compact ? "flex min-w-0 flex-col gap-1 break-words text-xs" : "flex min-w-0 items-center gap-1 text-xs"} data-testid="ribbon-project-dataset">
      {historical ? <span>Assessment dataset: {ctx.dataset?.name ?? ctx.datasetBindingConflict?.datasetId}</span>
        : fixedDatasetId ? <><span>Project dataset (fixed):</span><Link to="/p/$projectId/data/$datasetId" params={{ projectId: pid, datasetId: fixedDatasetId }} search={{}} className="break-words font-medium text-accent-text hover:underline" title={ctx.projectDataset?.name ?? fixedDatasetId}>{ctx.projectDataset?.name ?? fixedDatasetId}</Link></>
        : ctx.datasetBindingState === "error" ? <span>Project dataset unavailable</span>
        : ctx.datasetBindingState === "loading" ? <span>Loading project dataset…</span>
        : <><span>{ctx.dataset ? `Preview: ${ctx.dataset.name} · ` : ""}Project dataset not fixed.</span><Link to="/p/$projectId/data" params={{ projectId: pid }} className="text-accent-text hover:underline">Choose project dataset</Link></>}
    </li>
  );
  const mapping = (stacked?: boolean) => historical ? (
    <li key="mapping" className="text-xs">Historical case table: {ctx.caseTable?.id ?? ctx.run?.caseTableId}</li>
  ) : (
    <Switcher
      key="mapping"
      stacked={stacked}
      label={t("ribbon.mapping")}
      value={ctx.caseTable?.id}
      options={ctx.caseTableIds.map((id, i) => ({ value: id, label: `case table v${i + 1}${id === ctx.caseTable?.id ? ` · ${fmtInt(ctx.caseTable.cases)} cases` : ""}`, title: `${id}${id === ctx.caseTable?.id && ctx.caseTable?.mappingId ? ` · mapping ${ctx.caseTable.mappingId}` : ""}` }))}
      onChange={(v) => {
        const datasetId = ctx.datasetBinding?.datasetId ?? ctx.dataset?.id;
        if (datasetId) void navigate({ to: "/p/$projectId/data/$datasetId", params: { projectId: pid, datasetId }, search: { caseTable: v } });
      }}
    />
  );
  const norm = (stacked?: boolean) => (
    <Switcher key="norm" stacked={stacked} disabled={!!normScope.blockedReason} blockedReason={normScope.blockedReason} label={t("ribbon.norm")} value={ctx.norm?.id} options={ctx.norms.map((n) => ({ value: n.id, label: `v${n.version}`, hint: n.status, title: n.id }))} onChange={(v) => void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: pid, normVersionId: v }, search: { caseTable: normScope.caseTableId, selection: normScope.selection, tab: "guide" } })} />
  );
  const run = (stacked?: boolean) => (
    <Switcher key="run" stacked={stacked} label={t("ribbon.run")} value={parent?.id ?? ctx.run?.id} placeholder={t("ribbon.noRun")} options={ctx.runs.filter((r) => !flowTypeOf(r) && (ctx.projectRuns?.some((candidate) => candidate.id === r.id) || r.id === parent?.id || r.id === ctx.run?.id)).map((r) => ({ value: r.id, label: runLabel(r), hint: r.id === ctx.run?.id && historical ? "historical dataset" : r.status === "done" ? undefined : r.status, title: r.id }))} onChange={(v) => ctx.navigateRun(v)} />
  );
  const grouping = <li key="grouping" className="shrink-0"><GroupingControl ctx={ctx} compact /></li>;
  const scope = <Switcher key="scope" stacked={compact} label={t("ribbon.scope")} value={scopeOptions.length ? ctx.run?.id : undefined} placeholder="all flows" options={scopeOptions} onChange={(v) => ctx.navigateRun(v)} disabled={scopeOptions.length <= 1} />;
  const words = (
    <Switcher key="words" stacked label={t("ribbon.vocabulary")} value={vocabulary} options={VOCABULARIES.map((v) => ({ value: v, label: t(`ribbon.vocabularies.${v}`), hint: v === "plain" ? "method terms as secondary labels" : "plain words as secondary labels" }))} onChange={(v) => setVocabulary(v as Vocabulary)} />
  );
  const gamma = ctx.run?.gamma !== undefined && ctx.run?.gamma !== null ? (
    <li key="gamma" className="flex items-center justify-between gap-2 text-sm">
      <span className="text-xs text-text-subtle">caution against small groups (γ)</span>
      <span className="tnum">{fmtNum(ctx.run.gamma, 0)}</span>
    </li>
  ) : null;

  let shown: ReactNode[];
  let more: ReactNode[];
  /**
   * Guided mode keeps the reader's own context — the project, the run and the scope — and puts the method's
   * switchers away: γ is a discount rate, a perspective is a weighting of expectation areas and a grouping
   * is a slicing key, and none of the three is a question the reader of the guided path came to answer
   * (R3-10). They are one click away under ⋯, so nothing is lost.
   */
  switch (step) {
    case "data":
      shown = [project, dataset()];
      more = guided ? [mapping(true)] : [mapping(true)];
      break;
    case "norm":
      shown = [project, dataset(), norm(compact)];
      more = [];
      break;
    case "run":
      shown = [project, dataset(), run(compact), scope, cohort];
      more = guided ? [norm(true), mapping(true)] : [norm(true), mapping(true)];
      break;
    // the Flow step and the board are one step of the analysis and need the same context as Signals and Why:
    // a perspective or a grouping changed there re-reads the map and every panel without leaving the screen
    case "flow":
    case "signals":
    case "why":
    case "act":
      shown = guided ? [project, dataset(), run(compact), scope, cohort] : [project, dataset(), run(compact), grouping, scope, cohort];
      more = guided ? [grouping] : [mapping(true), norm(true), gamma];
      break;
    default:
      shown = [project, dataset()];
      more = [];
  }

  const backendBadge = <Badge variant={useMocks ? "warning" : "success"} title={useMocks ? "Responses come from MSW mocks generated from the contract" : "Responses come from the backend"}>
    <span aria-hidden>{useMocks ? "◌" : "●"}</span>{useMocks ? t("app.mocks") : t("app.backend")}
  </Badge>;
  const checksLink = ctx.caseTable && readinessSummary.hasIssues ? <Link to="/p/$projectId/data/$datasetId" params={{ projectId: pid, datasetId: ctx.caseTable.datasetId }} search={{caseTable: ctx.caseTable.id, tab: "readiness"}}
    className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning-subtle px-2 py-1 text-xs font-medium text-warning hover:underline"
    data-testid="caveats-chip" title="Data checks describe this preparation; ranking stability is a separate result." onClick={() => setMoreOpen(false)}>
    <span aria-hidden>⚠</span>{readinessSummary.label}
  </Link> : null;
  const tools = <>
    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size={compact ? "sm" : "iconSm"} className={compact ? "justify-start gap-2" : ""} aria-label={`${t("ribbon.notebook")}${snapshots !== undefined ? `: ${snapshots} snapshot${snapshots === 1 ? "" : "s"}` : ""}`} onClick={() => { setMoreOpen(false); void navigate({to:"/p/$projectId/notebook",params:{projectId:pid},search:{}}); }}>
      <BookOpen />{compact && t("ribbon.notebook")}{snapshots !== undefined && snapshots > 0 && <span className="tnum text-xs">{snapshots}</span>}
    </Button></TooltipTrigger><TooltipContent>{t("ribbon.notebook")}</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size={compact ? "sm" : "iconSm"} className={compact ? "justify-start gap-2" : ""} aria-label="Camera: freeze this screen" disabled={freezeButtons === 0} onClick={() => { setMoreOpen(false); document.querySelector<HTMLElement>("[data-freeze-trigger]")?.click(); }}><Camera />{compact && "Freeze this screen"}</Button></TooltipTrigger><TooltipContent>{freezeButtons ? "Freeze this screen" : "Nothing to freeze on this screen"}</TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size={compact ? "sm" : "iconSm"} className={compact ? "justify-start gap-2" : ""} aria-label={t("ribbon.help")} onClick={() => { setMoreOpen(false); openHelp(); }}><HelpCircle />{compact && t("ribbon.help")}</Button></TooltipTrigger><TooltipContent>{t("ribbon.help")} <Kbd>?</Kbd></TooltipContent></Tooltip>
    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size={compact ? "sm" : "iconSm"} className={compact ? "justify-start gap-2" : ""} aria-label={t("ribbon.palette")} onClick={() => { setMoreOpen(false); setPaletteOpen(true); }}><Search />{compact && t("ribbon.palette")}</Button></TooltipTrigger><TooltipContent>{t("ribbon.palette")} <Kbd>⌘K</Kbd></TooltipContent></Tooltip>
  </>;
  return (
    <>
    <header role="banner" className="wise-context sticky top-0 z-ribbon flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-1.5 sm:flex-nowrap md:px-6">
      <a href="/" className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-semibold" aria-label={t("app.name")}>
        <span aria-hidden className="inline-flex size-6 items-center justify-center rounded bg-accent font-mono text-xs text-accent-on">W</span><span className="hidden lg:inline">WISE</span>
      </a>
      <Link to="/projects" className="shrink-0 text-sm font-medium text-accent-text hover:underline">{compact ? "Projects" : "Projects / new"}</Link>
      {compact ? <div className="order-last min-w-0 basis-full text-xs sm:order-none sm:flex-1 sm:basis-auto"><p className="break-words font-medium" title={ctx.project?.name}>{ctx.project?.name ?? "Project"}</p>{ctx.caseTable && <p className="text-text-muted" title={readinessSummary.label}>{readinessSummary.label}</p>}</div>
        : <nav aria-label="Context" className="min-w-0 flex-1"><ul className="wise-context-list">{shown}</ul></nav>}
      <div className="ml-auto flex shrink-0 items-center gap-1">{useMocks && backendBadge}
        {!compact && checksLink}
        <Sheet><SheetTrigger asChild><Button variant="ghost" size="sm">Provenance</Button></SheetTrigger><SheetContent className="overflow-y-auto p-6"><SheetTitle className="text-xl font-semibold">Analysis provenance</SheetTitle><SheetDescription className="mt-2 text-sm text-text-muted">The data and saved definitions behind this screen.</SheetDescription><dl className="mt-6 grid gap-4 text-sm">{Object.entries({Project: ctx.project?.name ?? pid, Dataset: ctx.dataset?.name ?? "Not selected", "Dataset ID": ctx.dataset?.id ?? "—", "Case table": ctx.caseTable?.id ?? "Not prepared", "Prepared cases": ctx.caseTable ? fmtInt(ctx.caseTable.cases) : "Unavailable", "Norm version": ctx.norm ? `v${ctx.norm.version} · ${ctx.norm.status}` : "Not selected", "Norm ID": ctx.norm?.id ?? "—", Run: ctx.run ? runLabel(ctx.run) : "Not selected", "Run ID": ctx.run?.id ?? "—", Population: selection?.name ?? (selectionId ? "Saved selection" : "All prepared cases"), "Selection ID": selectionId ?? "None", View: ctx.view ?? "Not selected", Grouping: ctx.slicing ?? "Not selected"}).map(([label, value]) => <div key={label}><dt className="text-xs text-text-muted">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl><div className="mt-6">{backendBadge}</div></SheetContent></Sheet>
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild><Button variant="ghost" size="sm" aria-label="More context and settings" className="shrink-0 gap-1"><Settings2 />Settings</Button></PopoverTrigger>
          <PopoverContent aria-label="Context and tools" align="end" className="max-h-[75vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto" data-testid="ribbon-more">
            <h2 className="mb-2 text-sm font-semibold">Analysis context</h2>
            <ul className="flex min-w-0 flex-col gap-3">{compact ? shown : dataset()}{more}</ul>
            {compact && <div className="mt-3 flex flex-wrap gap-2">{backendBadge}{checksLink}</div>}
            <h2 className="mb-2 mt-4 border-t border-border pt-3 text-sm font-semibold">Tools</h2>
            <div className="flex flex-col items-stretch gap-1">{tools}<Button variant="outline" size="sm" data-testid="ribbon-knowledge" onClick={() => { setMoreOpen(false); void navigate({ to: "/p/$projectId/knowledge", params: { projectId: pid }, search: {} }); }}>Knowledge hub · what the words mean</Button></div>
            <h2 className="mb-2 mt-4 border-t border-border pt-3 text-sm font-semibold">Display preferences</h2>
            <ul className="flex flex-col gap-3">
              <li className="flex items-center justify-between gap-2 text-sm"><span>Working mode</span><Button variant="outline" size="sm" aria-pressed={guided} onClick={() => setMode(guided ? "analyst" : "guided")}>{guided ? "Guided" : "Analyst"}</Button></li>
              {!guided && words}
              <li className="flex items-center justify-between gap-2 text-sm"><span className="text-xs text-text-subtle">{t("ribbon.density")}</span><Button variant="outline" size="sm" aria-pressed={density === "compact"} onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}>{density}</Button></li>
              <li className="flex items-center justify-between gap-2 text-sm"><span className="text-xs text-text-subtle">{t("ribbon.theme")}</span><Button variant="outline" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}>{theme}</Button></li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>
    </header>
    {ctx.datasetBindingState === "error" && <p role="alert" className="border-b border-warning/40 bg-warning-subtle px-4 py-2 text-sm">The project dataset binding could not be verified. Reload before continuing.</p>}
    {ctx.datasetBindingConflict && <p role="alert" data-testid="dataset-binding-conflict" className="border-b border-warning/40 bg-warning-subtle px-4 py-2 text-sm">{historical ? `This historical assessment uses ${ctx.dataset?.name ?? ctx.datasetBindingConflict.datasetId}.` : "The dataset or case table in this address does not match this project."} Project dataset remains fixed to {ctx.projectDataset?.name ?? ctx.datasetBindingConflict.boundDatasetId}. <Link to="/p/$projectId/data/$datasetId" params={{ projectId: pid, datasetId: ctx.datasetBindingConflict.boundDatasetId }} search={{}} className="text-accent-text underline">Open project dataset</Link></p>}
    </>
  );
}
