import { forwardRef } from "react";
import { useTranslation } from "react-i18next";
import type { Kind } from "@wise/api-schema";
import { LayerChip } from "@/components/badges";
import { Explain } from "@/components/explain";
import { Term, useVocabulary } from "@/components/Term";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HOTSPOT_OF_KIND, KINDS, kindGlyph, kindReading } from "@/lib/vocabulary";
import type { BacklogSearch } from "@/app/search";

const ALL = "__all__";

export interface FiltersProps {
  search: BacklogSearch;
  layers: { id: string; name: string }[];
  runGamma: number;
  onChange: (patch: Partial<BacklogSearch>) => void;
  onReset: () => void;
}

/** Filter sidebar phrased as questions; every control writes to the URL (UX-1). */
export const Filters = forwardRef<HTMLInputElement, FiltersProps>(function Filters({ search, layers, runGamma, onChange, onReset }, searchRef) {
  const { t } = useTranslation();
  const { vocabulary } = useVocabulary();
  const plain = vocabulary === "plain";
  return (
    <form className="flex flex-col gap-3" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
      <div className="flex flex-col gap-1">
        <Label htmlFor="f-q">
          <Term id="slice">{plain ? "Which group? (/)" : "search slice (/)"}</Term>
        </Label>
        <Input id="f-q" ref={searchRef} type="search" placeholder="Packaging" defaultValue={search.q ?? ""} key={search.q ?? ""} onKeyDown={(e) => e.key === "Enter" && onChange({ q: (e.target as HTMLInputElement).value || undefined })} onBlur={(e) => e.target.value !== (search.q ?? "") && onChange({ q: e.target.value || undefined })} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="f-min">
          <Term id="min_cases">{plain ? "Only groups with at least … cases" : "min cases"}</Term>
        </Label>
        <Input id="f-min" type="number" min={1} step={1} value={search.minCases} onChange={(e) => onChange({ minCases: Math.max(1, Number(e.target.value) || 1) })} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="f-layer">
          <Term id="dominant_layer">{plain ? "Only problems about …" : "dominant layer"}</Term>
        </Label>
        <Select value={search.layer ?? ALL} onValueChange={(v) => onChange({ layer: v === ALL ? undefined : v })}>
          <SelectTrigger id="f-layer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{plain ? "any expectation area" : t("app.all")}</SelectItem>
            {layers.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                <LayerChip id={l.id} name={l.name} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="f-kind">
          <Term id="kind">{plain ? "Only acute / systematic / widespread" : "hotspot type"}</Term>
        </Label>
        <Select value={search.kind ?? ALL} onValueChange={(v) => onChange({ kind: v === ALL ? undefined : (v as Kind) })}>
          <SelectTrigger id="f-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{plain ? "any kind of problem" : t("app.all")}</SelectItem>
            {KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                <span aria-hidden className="mr-1">{kindGlyph[k]}</span>
                {plain ? `${k}: ${kindReading(k)}` : HOTSPOT_OF_KIND[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="f-confident" checked={!!search.confident} onCheckedChange={(c) => onChange({ confident: c ? true : undefined })} />
        <Label htmlFor="f-confident" className="font-normal">
          <Term id="stability">{plain ? "Only high-confidence ranks" : "stability: stable only"}</Term>
        </Label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1 text-xs font-medium text-text-muted">
            <label htmlFor="f-gamma">
              <Term id="gamma">{plain ? "caution against small groups" : "γ"}</Term>
            </label>
            <Explain term="gamma" inputs={[{ label: "run default", value: String(runGamma) }]} caveats={["An ad-hoc value is recomputed on the case scores; the run's value stays in its manifest."]} />
          </span>
          <Input id="f-gamma" type="number" min={0} step={1} value={search.gamma ?? runGamma} onChange={(e) => onChange({ gamma: Number(e.target.value) === runGamma ? undefined : Math.max(0, Number(e.target.value) || 0) })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="f-size">{plain ? "per page" : "rows per page"}</Label>
          <Select value={String(search.pageSize)} onValueChange={(v) => onChange({ pageSize: Number(v), page: 1 })}>
            <SelectTrigger id="f-size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100, 200, 500].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onReset}>
        Reset filters
      </Button>
    </form>
  );
});
