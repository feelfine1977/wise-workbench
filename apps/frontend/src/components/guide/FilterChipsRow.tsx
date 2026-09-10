import { X } from "lucide-react";
import type { Filter } from "@/lib/api/filter-types";
import type { FilterPreview } from "@/lib/api/exploration";
import { changesCases, describeClause, removeClause } from "@/lib/filter";
import { fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface FilterChipsRowProps {
  filter: Filter | undefined;
  preview?: FilterPreview;
  /** The business name of a case. */
  noun?: string;
  /** Activity references in the clauses are labels already; `labelOf` maps ids when a host still holds them. */
  labelOf?: (id: string) => string;
  onChange: (filter: Filter | undefined) => void;
  /** Show the "items in: n of N" count before the chips (off where the screen's own count line says it). */
  counts?: boolean;
  className?: string;
}

/**
 * The chips are the only visible representation of the filter (§2.2): one chip per clause in the order it was
 * added, in plain words, with a × that removes it; a clause that changes what a case contains carries the
 * second style and the words *changes cases*; `Reset all` appears from the second chip on. The row is there
 * even when it is empty, as one muted line, so nothing moves when the first chip appears.
 */
export function FilterChipsRow({ filter, preview, noun = "cases", labelOf, onChange, counts = true, className }: FilterChipsRowProps) {
  const clauses = filter?.and ?? [];
  const total = preview ? preview.cases_in + preview.cases_out : undefined;
  const perClause = (preview as unknown as { per_clause?: { clause: number; removed_marginally: number }[] } | undefined)?.per_clause;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm", className)} data-testid="filter-bar">
      {counts && (
        <span className="text-text-muted">
          {noun} in:{" "}
          {preview && clauses.length ? (
            <span className="tnum" data-testid="filter-preview">
              <strong className="text-text">{fmtInt(preview.cases_in)}</strong> of {fmtInt(total)}
            </span>
          ) : (
            <span className="text-text-subtle">{clauses.length ? "counting…" : "all"}</span>
          )}
        </span>
      )}
      {clauses.length === 0 ? (
        <span className="text-text-subtle" data-testid="no-filter">
          no filter yet
        </span>
      ) : (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {clauses.map((c, i) => {
            const text = describeClause(c, labelOf);
            const marginal = perClause?.find((p) => p.clause === i)?.removed_marginally;
            const changes = changesCases(c);
            return (
              <li key={`${i}-${text}`}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs",
                    changes ? "border-warning/50 bg-warning-subtle text-warning" : "border-accent/40 bg-accent-subtle text-accent-text",
                  )}
                  title={marginal !== undefined ? `removes ${fmtInt(marginal)} ${noun} on its own` : undefined}
                >
                  {text}
                  {changes && <span className="text-[10px] uppercase tracking-wide">changes cases</span>}
                  <button type="button" aria-label={`Remove filter: ${text}`} onClick={() => onChange(removeClause(filter, i))} className="rounded-full p-0.5 hover:bg-surface">
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              </li>
            );
          })}
          {clauses.length > 1 && (
            <li>
              <button type="button" className="text-xs text-text-muted underline" onClick={() => onChange(undefined)}>
                Reset all
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
