import { SlidersHorizontal, X } from "lucide-react";
import { forwardRef, useCallback, useRef, useState, type ReactNode } from "react";
import type { Filter } from "@/lib/api/filter-types";
import type { FilterPreview, Within } from "@/lib/api/exploration";
import { BACKLOG_DEFAULTS, type BacklogSearch } from "@/app/search";
import { useVocabulary } from "@/components/Term";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { describeClause, removeClause, serializeFilter } from "@/lib/filter";
import { fmtInt, fmtNum } from "@/lib/format";
import { useUiStore } from "@/lib/stores/ui";
import { kindReading } from "@/lib/vocabulary";
import { cn, sliceLabel } from "@/lib/utils";
import { Filters } from "./Filters";

export interface RefineProps {
  search: BacklogSearch;
  layers: { id: string; name: string }[];
  runGamma: number;
  filter: Filter | undefined;
  preview: FilterPreview | undefined;
  within: Within | undefined;
  labelOf?: (activityId: string) => string;
  onChange: (patch: Partial<BacklogSearch>) => void;
  onReset: () => void;
  caseNoun?: string;
  /** Rendered beside the Refine button (perspective and grouping switchers). */
  children?: ReactNode;
}

interface Chip {
  key: string;
  text: string;
  remove: () => void;
}

/**
 * The filters collapsed into one "Refine" drawer (R2-O9) with the active filters as removable chips above the
 * list; the cases in / out of the filter model are printed beside the chips (RF-10).
 */
export const Refine = forwardRef<HTMLInputElement, RefineProps>(function Refine({ search, layers, runGamma, filter, preview, within, labelOf, onChange, onReset, caseNoun = "cases", children }, searchRef) {
  const [open, setOpen] = useState(false);
  const guided = useUiStore((st) => st.mode === "guided");
  // The drawer opens on the search box (not on the first tooltip trigger), so Escape closes the drawer at once.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      if (typeof searchRef === "function") searchRef(el);
      else if (searchRef) searchRef.current = el;
    },
    [searchRef],
  );
  const { vocabulary } = useVocabulary();
  const plain = vocabulary === "plain";
  const chips: Chip[] = [];
  if (within) chips.push({ key: "within", text: `inside ${sliceLabel({ key: within.key })}`, remove: () => onChange({ within: undefined }) });
  if (search.q) chips.push({ key: "q", text: `group contains "${search.q}"`, remove: () => onChange({ q: undefined }) });
  if (search.minCases !== BACKLOG_DEFAULTS.minCases) chips.push({ key: "minCases", text: `at least ${fmtInt(search.minCases)} ${caseNoun}`, remove: () => onChange({ minCases: BACKLOG_DEFAULTS.minCases }) });
  if (search.layer) chips.push({ key: "layer", text: `about ${layers.find((l) => l.id === search.layer)?.name ?? search.layer}`, remove: () => onChange({ layer: undefined }) });
  if (search.kind) chips.push({ key: "kind", text: plain ? `${search.kind}: ${kindReading(search.kind)}` : search.kind, remove: () => onChange({ kind: undefined }) });
  if (search.confident) chips.push({ key: "confident", text: plain ? "high-confidence ranks only" : "stable only", remove: () => onChange({ confident: undefined }) });
  if (search.gamma !== undefined && search.gamma !== runGamma) chips.push({ key: "gamma", text: `γ = ${fmtNum(search.gamma, 0)} (run: ${fmtNum(runGamma, 0)})`, remove: () => onChange({ gamma: undefined }) });
  (filter?.and ?? []).forEach((c, i) => chips.push({ key: `clause-${i}`, text: describeClause(c, labelOf), remove: () => onChange({ filter: serializeFilter(removeClause(filter, i)) }) }));
  const active = chips.length;

  return (
    <div className="flex flex-col gap-2" data-testid="refine">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className="gap-1.5">
          <SlidersHorizontal aria-hidden />
          Refine
          {active > 0 && <span className="tnum rounded-full bg-accent px-1.5 text-xs text-accent-on">{active}</span>}
        </Button>
        {children}
        {preview && filter && (
          <span className="tnum text-sm text-text-muted" data-testid="filter-preview">
            <strong className="text-text">{fmtInt(preview.cases_in)}</strong> {caseNoun} in · {fmtInt(preview.cases_out)} out
          </span>
        )}
      </div>
      {active > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {chips.map((c) => (
            <li key={c.key}>
              <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-subtle py-0.5 pl-2.5 pr-1 text-xs text-accent-text">
                {c.text}
                <button type="button" aria-label={`Remove filter: ${c.text}`} onClick={c.remove} className="rounded-full p-0.5 hover:bg-surface">
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
          <li>
            <button type="button" className="text-xs text-text-muted underline" onClick={onReset}>
              clear all
            </button>
          </li>
        </ul>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          className={cn("max-w-sm")}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="border-b border-border px-5 py-4">
            <SheetTitle className="text-lg font-semibold">Refine the list</SheetTitle>
            <SheetDescription className="text-sm text-text-muted">Every choice lives in the address bar and shows as a chip above the list.</SheetDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {guided ? (
              /**
               * Guided mode offers three questions instead of the whole drawer (R3-10): the ones a reader of
               * the guided path asks. γ, the sort, the stability filter and the expectation-area picker are
               * the analyst's, and *Show everything* in the banner brings them back.
               */
              <ul className="flex flex-col gap-3 text-sm" data-testid="guided-filters">
                {(
                  [
                    { id: "big", label: "Only the groups with many items", on: (search.minCases ?? BACKLOG_DEFAULTS.minCases) > BACKLOG_DEFAULTS.minCases, patch: { minCases: (search.minCases ?? BACKLOG_DEFAULTS.minCases) > BACKLOG_DEFAULTS.minCases ? BACKLOG_DEFAULTS.minCases : 100 } },
                    { id: "sure", label: "Only the ranks we are sure of", on: !!search.confident, patch: { confident: search.confident ? undefined : true } },
                    { id: "acute", label: "Only the sharpest problems", on: search.kind === "acute", patch: { kind: search.kind === "acute" ? undefined : ("acute" as const) } },
                  ] as const
                ).map((f) => (
                  <li key={f.id}>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={f.on} onChange={() => onChange(f.patch as Partial<BacklogSearch>)} />
                      <span>{f.label}</span>
                    </label>
                  </li>
                ))}
                <li>
                  <Button variant="outline" size="sm" onClick={onReset}>
                    Show every group again
                  </Button>
                </li>
              </ul>
            ) : (
              <Filters ref={setInputRef} search={search} layers={layers} runGamma={runGamma} onChange={onChange} onReset={onReset} />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
});
