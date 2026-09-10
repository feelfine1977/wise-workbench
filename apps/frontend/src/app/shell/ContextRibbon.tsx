import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Camera, HelpCircle, MoreHorizontal, Search } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/misc";
import { flowTypeOf } from "@/lib/api/runs";
import { notebookQuery } from "@/lib/api/notebook";
import { useMocks } from "@/lib/config";
import { fmtDate, fmtInt, fmtNum } from "@/lib/format";
import { projectsQuery } from "@/lib/queries";
import { groupingLabel } from "@/lib/sentences";
import { useNavStore } from "@/lib/stores/nav";
import { useUiStore } from "@/lib/stores/ui";
import { VOCABULARIES, type Vocabulary } from "@/lib/vocabulary";
import type { WorkbenchContext } from "../context";
import { useCurrentStep } from "./Stepper";

interface SwitcherProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  options: { value: string; label: string; hint?: string; title?: string }[];
  onChange: (value: string) => void;
  /** Vertical layout inside the ⋯ menu. */
  stacked?: boolean;
  disabled?: boolean;
}

function Switcher({ label, value, options, onChange, placeholder, stacked, disabled }: SwitcherProps) {
  const { t } = useTranslation();
  const current = options.find((o) => o.value === value);
  const control = (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled || options.length === 0}>
      <SelectTrigger compact aria-label={t("ribbon.switch", { what: label })} title={current?.title} className={stacked ? "w-full" : undefined}>
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
      <li className="flex flex-col gap-1">
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
 * No id is visible: the run switcher reads the run's note and date, the mapping switcher "case table v2 ·
 * 251,734 cases"; ids sit in the tooltips. On the right: the caveats chip, the notebook with its snapshot
 * count, the camera, help and the command palette.
 */
export function ContextRibbon({ ctx }: { ctx: WorkbenchContext }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projects = useQuery(projectsQuery);
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const density = useUiStore((s) => s.density);
  const setDensity = useUiStore((s) => s.setDensity);
  const openHelp = useUiStore((s) => s.openHelp);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const vocabulary = useUiStore((s) => s.vocabulary);
  const guided = useUiStore((s) => s.mode === "guided");
  const setVocabulary = useUiStore((s) => s.setVocabulary);
  const freezeButtons = useNavStore((s) => s.freezeButtons);
  const pid = ctx.projectId;
  const step = useCurrentStep(ctx);
  const notebook = useQuery({ ...notebookQuery(pid), enabled: !!pid, retry: false });
  const snapshots = notebook.data?.snapshots.length;

  // The flow-type scope: the unscoped run and the runs forked from it.
  const current = ctx.run;
  const parent = current && !flowTypeOf(current) ? current : [...ctx.runs].reverse().find((r) => r.status === "done" && !flowTypeOf(r) && r.caseTableId === current?.caseTableId && r.normVersionId === current?.normVersionId);
  const family = ctx.runs.filter((r) => r.status === "done" && flowTypeOf(r) && r.caseTableId === current?.caseTableId && r.normVersionId === current?.normVersionId);
  const scopeOptions = current ? [...(parent ? [{ value: parent.id, label: "all flows" }] : []), ...family.map((r) => ({ value: r.id, label: `${flowTypeOf(r)} only`, title: r.id }))] : [];

  const readiness = ctx.caseTable?.readiness;
  const caveats = (readiness?.items ?? []).filter((i) => i.level === "warn" || i.level === "fail").length;
  const runLabel = (r: (typeof ctx.runs)[number]) => (r.note?.trim() ? `${r.note.trim()} · ${fmtDate(r.manifest?.finishedAt ?? r.createdAt)}` : `Run of ${fmtDate(r.manifest?.finishedAt ?? r.createdAt)}`);

  const project = <Switcher key="project" label={t("ribbon.project")} value={pid} options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name, title: p.id }))} onChange={(v) => void navigate({ to: "/p/$projectId", params: { projectId: v } })} />;
  const dataset = (stacked?: boolean) => (
    <Switcher key="dataset" stacked={stacked} label={t("ribbon.dataset")} value={ctx.dataset?.id} options={ctx.datasets.map((d) => ({ value: d.id, label: d.name, hint: d.status, title: d.id }))} onChange={(v) => void navigate({ to: "/p/$projectId/data/$datasetId", params: { projectId: pid, datasetId: v }, search: {} })} />
  );
  const mapping = (stacked?: boolean) => (
    <Switcher
      key="mapping"
      stacked={stacked}
      label={t("ribbon.mapping")}
      value={ctx.caseTable?.id}
      options={ctx.caseTableIds.map((id, i) => ({ value: id, label: `case table v${i + 1}${id === ctx.caseTable?.id ? ` · ${fmtInt(ctx.caseTable.cases)} cases` : ""}`, title: `${id}${id === ctx.caseTable?.id && ctx.caseTable?.mappingId ? ` · mapping ${ctx.caseTable.mappingId}` : ""}` }))}
      onChange={(v) => {
        const datasetId = ctx.dataset?.id ?? ctx.datasets[0]?.id;
        if (datasetId) void navigate({ to: "/p/$projectId/data/$datasetId", params: { projectId: pid, datasetId }, search: { caseTable: v } });
      }}
    />
  );
  const norm = (stacked?: boolean) => (
    <Switcher key="norm" stacked={stacked} label={t("ribbon.norm")} value={ctx.norm?.id} options={ctx.norms.map((n) => ({ value: n.id, label: `v${n.version}`, hint: n.status, title: n.id }))} onChange={(v) => void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: pid, normVersionId: v }, search: { tab: "constraints" } })} />
  );
  const run = (stacked?: boolean) => (
    <Switcher key="run" stacked={stacked} label={t("ribbon.run")} value={ctx.run?.id} placeholder={t("ribbon.noRun")} options={ctx.runs.filter((r) => !flowTypeOf(r)).map((r) => ({ value: r.id, label: runLabel(r), hint: r.status === "done" ? undefined : r.status, title: r.id }))} onChange={(v) => ctx.navigateRun(v)} />
  );
  const perspective = <Switcher key="perspective" label={vocabulary === "plain" ? t("ribbon.perspective") : t("ribbon.view")} value={ctx.view} options={(ctx.run?.views ?? []).map((v) => ({ value: v, label: v }))} onChange={ctx.setView} />;
  const grouping = (
    <Switcher key="grouping" label={vocabulary === "plain" ? t("ribbon.grouping") : t("ribbon.sliceKey")} value={ctx.slicing} options={(ctx.run?.slicings ?? []).map((s) => ({ value: s.id ?? "", label: groupingLabel(s.id ?? undefined, s.attributes ?? undefined) || (s.id ?? ""), title: s.id ?? undefined }))} onChange={ctx.setSlicing} />
  );
  const scope = <Switcher key="scope" label={t("ribbon.scope")} value={scopeOptions.length ? ctx.run?.id : undefined} placeholder="all flows" options={scopeOptions} onChange={(v) => ctx.navigateRun(v)} disabled={scopeOptions.length <= 1} />;
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
      more = guided ? [mapping(true)] : [mapping(true), words];
      break;
    case "norm":
      shown = [project, norm()];
      more = guided ? [dataset(true)] : [dataset(true), words];
      break;
    case "run":
      shown = [project, run()];
      more = guided ? [norm(true), mapping(true)] : [norm(true), mapping(true), words];
      break;
    // the Flow step and the board are one step of the analysis and need the same context as Signals and Why:
    // a perspective or a grouping changed there re-reads the map and every panel without leaving the screen
    case "flow":
    case "signals":
    case "why":
    case "act":
      shown = guided ? [project, run(), scope] : [project, run(), perspective, grouping, scope];
      more = guided ? [perspective, grouping] : [dataset(true), mapping(true), norm(true), gamma, words];
      break;
    default:
      shown = [project];
      more = guided ? [] : [words];
  }

  return (
    <header role="banner" className="sticky top-0 z-ribbon flex h-12 items-center gap-3 border-b border-border bg-surface px-3">
      <a href="/" className="mr-1 flex items-center gap-2 whitespace-nowrap text-sm font-semibold" aria-label={t("app.name")}>
        <span aria-hidden className="inline-flex size-6 items-center justify-center rounded bg-accent font-mono text-xs text-accent-on">
          W
        </span>
        <span className="hidden lg:inline">WISE</span>
      </a>
      <nav aria-label="Context" className="min-w-0 flex-1 overflow-x-auto">
        <ul className="flex items-center gap-3 whitespace-nowrap">{shown}</ul>
      </nav>
      <div className="flex items-center gap-1">
        <Badge variant={useMocks ? "warning" : "success"} title={useMocks ? "Responses come from MSW mocks generated from the contract" : "Responses come from the backend"}>
          <span aria-hidden>{useMocks ? "◌" : "●"}</span>
          {useMocks ? t("app.mocks") : t("app.backend")}
        </Badge>
        {caveats > 0 && ctx.caseTable && (
          <Link
            to="/p/$projectId/data/$datasetId"
            params={{ projectId: pid, datasetId: ctx.caseTable.datasetId }}
            search={{ caseTable: ctx.caseTable.id, tab: "readiness" }}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-warning/40 bg-warning-subtle px-2 text-xs font-medium text-warning hover:underline"
            data-testid="caveats-chip"
            title="Data caveats travel with every result until you decide about them"
          >
            <span aria-hidden>⚠</span>
            {caveats} caveat{caveats === 1 ? "" : "s"}
          </Link>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 px-1.5" aria-label={`${t("ribbon.notebook")}${snapshots !== undefined ? `: ${snapshots} snapshot${snapshots === 1 ? "" : "s"}` : ""}`} onClick={() => void navigate({ to: "/p/$projectId/notebook", params: { projectId: pid }, search: {} })}>
              <BookOpen />
              {snapshots !== undefined && snapshots > 0 && <span className="tnum text-xs" data-testid="notebook-count">{snapshots}</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("ribbon.notebook")}{snapshots !== undefined ? ` · ${snapshots} snapshot${snapshots === 1 ? "" : "s"}` : ""}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Camera: freeze this screen"
              disabled={freezeButtons === 0}
              onClick={() => document.querySelector<HTMLElement>("[data-freeze-trigger]")?.click()}
            >
              <Camera />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{freezeButtons ? "Freeze this screen" : "Nothing to freeze on this screen"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label={t("ribbon.help")} onClick={() => openHelp()}>
              <HelpCircle />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("ribbon.help")} <Kbd>?</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label={t("ribbon.palette")} onClick={() => setPaletteOpen(true)}>
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t("ribbon.palette")} <Kbd>⌘K</Kbd>
          </TooltipContent>
        </Tooltip>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="More context and settings">
              <MoreHorizontal />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80" data-testid="ribbon-more">
            <ul className="flex flex-col gap-3">
              {more}
              {/* the knowledge hub is reachable from every screen (RK-3): one page per word of this process */}
              <li className="flex items-center justify-between gap-2 text-sm">
                <span className="text-xs text-text-subtle">what the words mean</span>
                <Button variant="outline" size="sm" data-testid="ribbon-knowledge" onClick={() => void navigate({ to: "/p/$projectId/knowledge", params: { projectId: pid }, search: {} })}>
                  Knowledge hub
                </Button>
              </li>
              <li className="flex items-center justify-between gap-2 text-sm">
                <span className="text-xs text-text-subtle">{t("ribbon.density")}</span>
                <Button variant="outline" size="sm" aria-pressed={density === "compact"} onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}>
                  {density}
                </Button>
              </li>
              <li className="flex items-center justify-between gap-2 text-sm">
                <span className="text-xs text-text-subtle">{t("ribbon.theme")}</span>
                <Button variant="outline" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}>
                  {theme}
                </Button>
              </li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}
