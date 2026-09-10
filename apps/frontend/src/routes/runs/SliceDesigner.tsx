import { Plus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { slicingPreviewQuery, type BandSpec, type SlicingSpec as SlicingSpecC2 } from "@/lib/api/exploration";
import { fmtInt } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NUMERIC = /^(exposure|n_events|header_event_count|.*(days|hours|count|value|amount|net worth|quantity).*)$/i;
export const isNumericAttribute = (a: string) => NUMERIC.test(a);
const NONE = "__none__";

export const slicingId = (attributes: string[]) => attributes.join("+");

export interface SliceDesignerProps {
  attributes: string[];
  value: SlicingSpecC2[];
  onChange: (next: SlicingSpecC2[]) => void;
  className?: string;
  /** A finished run whose case table previews the groupings (`GET …/slicings/preview`). */
  preview?: { projectId: string; runId: string; minCases: number };
}

/** "1,975 groups, 1,709 below 20 cases" — what a grouping yields on the run's case table. */
function SlicingPreviewLine({ projectId, runId, attributes, bands, minCases }: { projectId: string; runId: string; attributes: string[]; bands: BandSpec[] | undefined; minCases: number }) {
  const q = useQuery({ ...slicingPreviewQuery(projectId, runId, attributes, bands, minCases), enabled: attributes.length > 0 });
  if (!attributes.length) return null;
  if (q.isPending) return <span className="text-xs text-text-subtle">counting the groups…</span>;
  if (q.isError) return <span className="text-xs text-text-subtle">no preview: {q.error instanceof Error ? q.error.message : "unavailable"}</span>;
  const p = q.data;
  return (
    <span className="tnum text-xs text-text-muted" data-testid="slicing-preview">
      {fmtInt(p.groups)} groups over {fmtInt(p.cases)} cases; {fmtInt(p.belowMinCases)} below {fmtInt(p.minCases)} cases stay unranked
    </span>
  );
}

/**
 * The slice designer (R2-O2): every grouping combines one to three case attributes; numeric attributes are
 * banded (quantiles or explicit cut points) so that "exposure band × spend area" is one grouping. Rule-based
 * and saved groupings are cycle 3.
 */
export function SliceDesigner({ attributes, value, onChange, className, preview }: SliceDesignerProps) {
  const update = (i: number, patch: Partial<SlicingSpecC2>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch, id: slicingId(patch.attributes ?? s.attributes) } : s)));
  const setAttribute = (i: number, pos: number, attr: string) => {
    const current = value[i]!;
    const next = [...current.attributes];
    if (attr === NONE) next.splice(pos, 1);
    else next[pos] = attr;
    const bands = (current.bands ?? []).filter((b) => next.includes(b.attribute));
    for (const a of next) if (isNumericAttribute(a) && !bands.some((b) => b.attribute === a)) bands.push({ attribute: a, method: "quantile", q: 4 });
    update(i, { attributes: next.filter(Boolean).slice(0, 3), bands: bands.length ? bands : undefined });
  };
  const setBand = (i: number, attr: string, patch: Partial<BandSpec>) => {
    const current = value[i]!;
    update(i, { bands: (current.bands ?? []).map((b) => (b.attribute === attr ? { ...b, ...patch } : b)) });
  };
  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="slice-designer">
      {value.map((s, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-text-muted">grouping {i + 1}</span>
            {[0, 1, 2].map((pos) => {
              const chosen = s.attributes[pos];
              if (pos > 0 && !s.attributes[pos - 1]) return null;
              return (
                <span key={pos} className="flex items-center gap-1">
                  {pos > 0 && <span className="text-xs text-text-subtle">×</span>}
                  <Select value={chosen ?? NONE} onValueChange={(v) => setAttribute(i, pos, v)}>
                    <SelectTrigger compact aria-label={`grouping ${i + 1}, attribute ${pos + 1}`} className="w-auto min-w-[150px] font-mono text-xs">
                      <SelectValue placeholder={pos === 0 ? "attribute" : "add an attribute"} />
                    </SelectTrigger>
                    <SelectContent>
                      {pos > 0 && <SelectItem value={NONE}>none</SelectItem>}
                      {attributes
                        .filter((a) => a === chosen || !s.attributes.includes(a))
                        .map((a) => (
                          <SelectItem key={a} value={a}>
                            <span className="font-mono text-xs">{a}</span>
                            {isNumericAttribute(a) && <span className="ml-1 text-xs text-text-subtle">(banded)</span>}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </span>
              );
            })}
            <span className="ml-auto font-mono text-[11px] text-text-subtle">{s.id}</span>
            {value.length > 1 && (
              <Button variant="ghost" size="iconSm" aria-label={`Remove grouping ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <X />
              </Button>
            )}
          </div>
          {preview && <SlicingPreviewLine projectId={preview.projectId} runId={preview.runId} attributes={s.attributes} bands={s.bands} minCases={preview.minCases} />}
          {(s.bands ?? []).map((b) => (
            <div key={b.attribute} className="flex flex-wrap items-center gap-2 pl-2 text-xs">
              <span className="font-mono">{b.attribute}</span>
              <span className="text-text-muted">in bands:</span>
              <Select value={b.method ?? "quantile"} onValueChange={(v) => setBand(i, b.attribute, { method: v as BandSpec["method"] })}>
                <SelectTrigger compact aria-label={`band method for ${b.attribute}`} className="w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quantile">equal-count bands (quantiles)</SelectItem>
                  <SelectItem value="cuts">cut points</SelectItem>
                </SelectContent>
              </Select>
              {b.method === "quantile" ? (
                <Input type="number" min={2} max={20} step={1} value={b.q ?? 4} aria-label={`number of bands for ${b.attribute}`} className="w-16" onChange={(e) => setBand(i, b.attribute, { q: Math.max(2, Math.min(20, Number(e.target.value) || 4)) })} />
              ) : (
                <Input value={(b.cuts ?? []).join(", ")} placeholder="1000, 10000, 100000" aria-label={`cut points for ${b.attribute}`} className="w-52 font-mono" onChange={(e) => setBand(i, b.attribute, { cuts: e.target.value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)) })} />
              )}
            </div>
          ))}
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" disabled={value.length >= 6} onClick={() => onChange([...value, { id: attributes[0] ?? "", attributes: attributes[0] ? [attributes[0]] : [] }])}>
        <Plus aria-hidden />
        another grouping
      </Button>
    </div>
  );
}
