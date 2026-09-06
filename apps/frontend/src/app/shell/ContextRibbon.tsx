import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, HelpCircle, Moon, Rows3, Search, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/misc";
import { flowTypeOf } from "@/lib/api/cycle2";
import { useMocks } from "@/lib/config";
import { projectsQuery } from "@/lib/queries";
import { useUiStore } from "@/lib/stores/ui";
import { VOCABULARIES, type Vocabulary } from "@/lib/vocabulary";
import type { WorkbenchContext } from "../context";

interface SwitcherProps {
  label: string;
  value: string | undefined;
  placeholder?: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (value: string) => void;
  mono?: boolean;
}

function Switcher({ label, value, options, onChange, placeholder, mono }: SwitcherProps) {
  const { t } = useTranslation();
  const disabled = options.length === 0;
  return (
    <li className="flex items-center gap-1">
      <span className="text-xs text-text-subtle">{label}</span>
      <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger compact aria-label={t("ribbon.switch", { what: label })} className={mono ? "font-mono" : undefined}>
          <SelectValue placeholder={placeholder ?? "–"} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className={mono ? "font-mono text-xs" : undefined}>{o.label}</span>
              {o.hint && <span className="ml-2 text-xs text-text-subtle">{o.hint}</span>}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </li>
  );
}

/** Context ribbon (UX-1): project · dataset · mapping · norm · run · view · slice key · period; every element switches. */
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
  const setVocabulary = useUiStore((s) => s.setVocabulary);
  const pid = ctx.projectId;
  // The flow-type switcher (R2-O10): the unscoped run and the runs forked from it.
  const current = ctx.run;
  const parent = current && !flowTypeOf(current) ? current : [...ctx.runs].reverse().find((r) => r.status === "done" && !flowTypeOf(r) && r.caseTableId === current?.caseTableId && r.normVersionId === current?.normVersionId);
  const family = ctx.runs.filter((r) => r.status === "done" && flowTypeOf(r) && r.caseTableId === current?.caseTableId && r.normVersionId === current?.normVersionId);
  const flowOptions = current && (family.length > 0 || flowTypeOf(current)) ? [...(parent ? [{ value: parent.id, label: "all flow types" }] : []), ...family.map((r) => ({ value: r.id, label: `${flowTypeOf(r)} only`, hint: r.id }))] : [];

  return (
    <header role="banner" className="sticky top-0 z-ribbon flex h-12 items-center gap-3 border-b border-border bg-surface px-3 shadow-1">
      <a href="/" className="mr-1 flex items-center gap-2 whitespace-nowrap text-sm font-semibold" aria-label={t("app.name")}>
        <span aria-hidden className="inline-flex size-6 items-center justify-center rounded bg-accent font-mono text-xs text-accent-on">
          W
        </span>
        <span className="hidden lg:inline">WISE</span>
      </a>
      <nav aria-label="Context" className="min-w-0 flex-1 overflow-x-auto">
        <ul className="flex items-center gap-3 whitespace-nowrap">
          <Switcher
            label={t("ribbon.project")}
            value={pid}
            options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => void navigate({ to: "/p/$projectId", params: { projectId: v } })}
          />
          <Switcher
            label={t("ribbon.dataset")}
            value={ctx.dataset?.id}
            options={ctx.datasets.map((d) => ({ value: d.id, label: d.name, hint: d.status }))}
            onChange={(v) => void navigate({ to: "/p/$projectId/data/$datasetId", params: { projectId: pid, datasetId: v }, search: {} })}
          />
          <Switcher
            label={t("ribbon.mapping")}
            value={ctx.caseTable?.id}
            mono
            options={ctx.caseTableIds.map((id) => ({ value: id, label: id === ctx.caseTable?.id && ctx.caseTable?.mappingId ? `${ctx.caseTable.mappingId} · ${id}` : id }))}
            onChange={(v) => {
              const datasetId = ctx.dataset?.id ?? ctx.datasets[0]?.id;
              if (datasetId) void navigate({ to: "/p/$projectId/data/$datasetId", params: { projectId: pid, datasetId }, search: { caseTable: v } });
            }}
          />
          <Switcher
            label={t("ribbon.norm")}
            value={ctx.norm?.id}
            options={ctx.norms.map((n) => ({ value: n.id, label: `v${n.version}`, hint: n.status }))}
            onChange={(v) => void navigate({ to: "/p/$projectId/norms/$normVersionId", params: { projectId: pid, normVersionId: v }, search: { tab: "constraints" } })}
          />
          <Switcher
            label={t("ribbon.run")}
            value={ctx.run?.id}
            mono
            placeholder={t("ribbon.noRun")}
            options={ctx.runs.map((r) => ({ value: r.id, label: r.id, hint: `${r.note ?? ""} · ${r.status}` }))}
            onChange={(v) => ctx.navigateRun(v)}
          />
          <Switcher label={vocabulary === "plain" ? t("ribbon.perspective") : t("ribbon.view")} value={ctx.view} options={(ctx.run?.views ?? []).map((v) => ({ value: v, label: v }))} onChange={ctx.setView} />
          <Switcher
            label={vocabulary === "plain" ? t("ribbon.grouping") : t("ribbon.sliceKey")}
            value={ctx.slicing}
            options={(ctx.run?.slicings ?? []).map((s) => ({ value: s.id ?? "", label: (s.attributes ?? []).map((a) => a.replace(/^case /, "")).join(" × ") || (s.id ?? ""), hint: s.id ?? undefined }))}
            onChange={ctx.setSlicing}
          />
          {flowOptions.length > 0 && <Switcher label={t("ribbon.flowType")} value={ctx.run?.id} options={flowOptions} onChange={(v) => ctx.navigateRun(v)} />}
          <Switcher label={t("ribbon.period")} value={ctx.run?.id} options={ctx.periods.filter((p) => !flowTypeOf(ctx.runs.find((r) => r.id === p.runId))).map((p) => ({ value: p.runId, label: p.label }))} onChange={(v) => ctx.navigateRun(v)} />
          <Switcher
            label={t("ribbon.vocabulary")}
            value={vocabulary}
            options={VOCABULARIES.map((v) => ({ value: v, label: t(`ribbon.vocabularies.${v}`), hint: v === "plain" ? "method terms as secondary labels" : "plain words as secondary labels" }))}
            onChange={(v) => setVocabulary(v as Vocabulary)}
          />
        </ul>
      </nav>
      <div className="flex items-center gap-1">
        <Badge variant={useMocks ? "warning" : "success"} title={useMocks ? "Responses come from MSW mocks generated from the contract" : "Responses come from the backend"}>
          <span aria-hidden>{useMocks ? "◌" : "●"}</span>
          {useMocks ? t("app.mocks") : t("app.backend")}
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label={t("ribbon.notebook")} onClick={() => void navigate({ to: "/p/$projectId/notebook", params: { projectId: pid }, search: {} })}>
              <BookOpen />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("ribbon.notebook")}</TooltipContent>
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label={t("ribbon.density")} aria-pressed={density === "compact"} onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}>
              <Rows3 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("ribbon.density")}: {density}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label={`${t("ribbon.theme")}: ${theme}`} onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}>
              {theme === "dark" ? <Moon /> : <Sun />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("ribbon.theme")}: {theme}</TooltipContent>
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
      </div>
    </header>
  );
}
