import { Link } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { BacklogRow } from "@wise/api-schema";
import { ConfidenceMark, KindBadge, LayerChip } from "@/components/badges";
import { Term } from "@/components/Term";
import { Button } from "@/components/ui/button";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { sliceQuery } from "@/lib/queries";
import { cn, sliceLabel } from "@/lib/utils";

export interface ComparisonStripProps {
  projectId: string;
  runId: string;
  slicing: string;
  view: string | undefined;
  pins: string[];
  rows: BacklogRow[];
  layerNames: Record<string, string>;
  onUnpin: (key: string) => void;
  className?: string;
}

const metrics: { id: "n_cases" | "gap" | "stable_gap" | "PI" | "stable_PI"; term: string; fmt: (v: number) => string }[] = [
  { id: "n_cases", term: "n_cases", fmt: (v) => fmtInt(v) },
  { id: "gap", term: "gap", fmt: (v) => fmtPct(v, 1) },
  { id: "stable_gap", term: "stable_gap", fmt: (v) => fmtPct(v, 1) },
  { id: "PI", term: "PI", fmt: (v) => fmtNum(v, 1) },
  { id: "stable_PI", term: "stable_PI", fmt: (v) => fmtNum(v, 1) },
];

/** Pin and compare (UX-8): up to three groups in fixed slots so the layout never jumps. */
export function ComparisonStrip({ projectId, runId, slicing, view, pins, rows, layerNames, onUnpin, className }: ComparisonStripProps) {
  const slots = [pins[0], pins[1], pins[2]];
  const queries = useQueries({
    queries: slots.map((key) => ({ ...sliceQuery(projectId, runId, key ?? "", slicing, view), enabled: !!key && !rows.some((r) => r.key === key) })),
  });
  if (pins.length === 0) return null;
  return (
    <section aria-label="Comparison strip" className={cn("grid gap-3 md:grid-cols-3", className)}>
      {slots.map((key, i) => {
        const row = key ? (rows.find((r) => r.key === key) ?? queries[i]?.data?.row) : undefined;
        const label = row ? sliceLabel(row) : (key ?? "");
        return (
          <div key={i} className="surface flex min-h-[132px] flex-col p-3" aria-label={key ? `Pinned ${label}` : "Empty slot"}>
            {!key && <p className="m-auto text-xs text-text-subtle">Pin a group (p) to compare</p>}
            {key && (
              <>
                <div className="flex items-center gap-2">
                  <Link className="truncate text-xs font-medium text-accent-text underline" to="/p/$projectId/runs/$runId/slices/$sliceKey" params={{ projectId, runId, sliceKey: key }} search={{ slicing, view, tab: "drivers", pins }}>
                    {label}
                  </Link>
                  <Button variant="ghost" size="iconSm" className="ml-auto" aria-label={`Unpin ${label}`} onClick={() => onUnpin(key)}>
                    <X />
                  </Button>
                </div>
                {row ? (
                  <>
                    <dl className="tnum mt-2 grid grid-cols-5 gap-1 text-xs">
                      {metrics.map((m) => (
                        <div key={m.id} className="flex flex-col">
                          <dt className="truncate text-text-subtle">
                            <Term id={m.term} primaryOnly />
                          </dt>
                          <dd className="font-medium">{m.fmt(row[m.id])}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <KindBadge kind={row.kind} hotspotType={row.hotspot_type} short />
                      <ConfidenceMark value={row.stability} />
                      <LayerChip id={row.dominant_layer} name={row.dominant_layer_name ?? layerNames[row.dominant_layer ?? ""]} />
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-text-subtle">{queries[i]?.isError ? "not in this run" : "loading…"}</p>
                )}
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
