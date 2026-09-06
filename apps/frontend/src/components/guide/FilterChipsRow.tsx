import { X } from "lucide-react";
import type { Filter, FilterPreview } from "@/lib/api/cycle2";
import { describeClause, removeClause } from "@/lib/filter";
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
  className?: string;
}

/**
 * The filter bar of a screen: "cases in: n of N" after the active filters and one chip per clause with a
 * ×, "clear all" beside them. The chips are the only place the filters are visible; they never filter
 * themselves — removing one calls back with the changed filter, which lives in the address.
 */
export function FilterChipsRow({ filter, preview, noun = "cases", labelOf, onChange, className }: FilterChipsRowProps) {
  const clauses = filter?.and ?? [];
  const total = preview ? preview.cases_in + preview.cases_out : undefined;
  return (
    <div className={cn("flex flex-wrap items-center gap-2 text-sm", className)} data-testid="filter-bar">
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
      {clauses.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
          {clauses.map((c, i) => {
            const text = describeClause(c, labelOf);
            return (
              <li key={`${i}-${text}`}>
                <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-subtle py-0.5 pl-2.5 pr-1 text-xs text-accent-text">
                  {text}
                  <button type="button" aria-label={`Remove filter: ${text}`} onClick={() => onChange(removeClause(filter, i))} className="rounded-full p-0.5 hover:bg-surface">
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              </li>
            );
          })}
          <li>
            <button type="button" className="text-xs text-text-muted underline" onClick={() => onChange(undefined)}>
              clear all
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
