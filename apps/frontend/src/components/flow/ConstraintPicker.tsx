import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtInt, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { constraintLayerName, type ConstraintEvidence } from "./sceneEvidence";

const NO_LAYER = "__no_layer__";

/** Layer selection adds its constraints; checkboxes refine the selection without changing case scope. */
export function ConstraintPicker({ constraints, selected, onChange }: {
  constraints: ConstraintEvidence[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const layerName = (id: string) => id === NO_LAYER ? "No business layer supplied" : constraints.find((constraint) => constraint.layer === id)?.layerName ?? constraintLayerName(id);
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState("");
  const layers = [...new Set(constraints.map((constraint) => constraint.layer ?? NO_LAYER))].sort();
  const inLayer = constraints.filter((constraint) => !layer || (constraint.layer ?? NO_LAYER) === layer);
  const needle = query.trim().toLocaleLowerCase();
  const visible = inLayer.filter((constraint) => `${constraint.name} ${constraint.description} ${constraint.id} ${layerName(constraint.layer ?? NO_LAYER)}`.toLocaleLowerCase().includes(needle));
  const chosen = new Set(selected);
  const add = (ids: string[]) => onChange([...new Set([...selected, ...ids])]);
  const remove = (ids: string[]) => { const removed = new Set(ids); onChange(selected.filter((id) => !removed.has(id))); };
  return <Popover>
    <PopoverTrigger asChild><Button variant="outline" size="sm">Choose constraints</Button></PopoverTrigger>
    <PopoverContent align="start" className="max-h-[var(--radix-popover-content-available-height)] w-[min(32rem,90vw)] space-y-3 overflow-y-auto" role="dialog" aria-label="Choose constraints">
      <label className="block space-y-1 text-sm">
        <span>Search constraints</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded border border-border bg-surface px-2 py-1.5" placeholder="Name or meaning" />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Business layer</span>
        <select value={layer} onChange={(event) => {
          const next = event.target.value;
          setLayer(next);
          if (next) add(constraints.filter((constraint) => (constraint.layer ?? NO_LAYER) === next).map((constraint) => constraint.id));
        }} className="w-full rounded border border-border bg-surface px-2 py-1.5">
          <option value="">All layers</option>
          {layers.map((id) => <option key={id} value={id}>{layerName(id)} ({constraints.filter((constraint) => (constraint.layer ?? NO_LAYER) === id).length})</option>)}
        </select>
      </label>
      <p className="text-xs text-text-muted">Choosing a layer adds all its constraints. Refine with the checkboxes.</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button variant="outline" size="sm" disabled={!visible.length || visible.every((constraint) => chosen.has(constraint.id))} onClick={() => add(visible.map((constraint) => constraint.id))}>Select shown ({visible.length})</Button>
        <Button variant="outline" size="sm" disabled={!visible.some((constraint) => chosen.has(constraint.id))} onClick={() => remove(visible.map((constraint) => constraint.id))}>Clear shown</Button>
        <Button variant="outline" size="sm" disabled={!selected.length} onClick={() => onChange([])}>Clear all</Button>
        <span aria-live="polite">{selected.length} selected</span>
      </div>
      <div className="max-h-64 space-y-1 overflow-y-auto" role="group" aria-label="Available constraints">
        {visible.map((constraint) => <label key={constraint.id} className="flex items-start gap-2 rounded px-1 py-2 text-sm hover:bg-surface-sunken">
          <input type="checkbox" className="mt-1 shrink-0" checked={chosen.has(constraint.id)} onChange={(event) => event.target.checked ? add([constraint.id]) : remove([constraint.id])} aria-label={constraint.name} />
          <span className="min-w-0 break-words"><span className="block text-text">{constraint.name}</span><span className="block text-xs text-text-muted">{layerName(constraint.layer ?? NO_LAYER)}</span></span>
        </label>)}
        {!visible.length && <p className="py-3 text-sm text-text-muted">No matching constraints.</p>}
      </div>
    </PopoverContent>
  </Popover>;
}

/** Compact individual results; never calculate a combined share or denominator. */
export function ConstraintResultsList({ constraints, focusedId, onFocus, noun, placement }: {
  constraints: ConstraintEvidence[];
  focusedId: string;
  onFocus: (id: string) => void;
  noun: string;
  placement: (id: string) => string;
}) {
  return <div className="h-28 overflow-y-auto rounded border border-border bg-surface" role="region" aria-label="Selected constraint results" tabIndex={0}>
    <ul>
      {constraints.map((constraint) => {
        const { evaluated, cases, violationShare } = constraint;
        const consistent = evaluated !== undefined && (cases === undefined || evaluated <= cases);
        const result = !consistent ? "Evaluated denominator unavailable or inconsistent"
          : evaluated === 0 ? `No evaluated ${noun}; compliance unknown`
            : `${violationShare === undefined ? "Missed share unavailable" : `${fmtPct(violationShare, 1)} miss this constraint`} · ${fmtInt(evaluated)} evaluated ${noun}`;
        return <li key={constraint.id}>
          <button type="button" aria-pressed={focusedId === constraint.id} onClick={() => onFocus(constraint.id)} className={cn("w-full border-b border-border px-2 py-1.5 text-left text-xs last:border-b-0 hover:bg-surface-sunken", focusedId === constraint.id && "bg-accent-subtle")}>
            <span className="block break-words font-medium text-text">{constraint.name}</span>
            <span className="block text-text">{result}</span>
            <span className="block text-text-muted">{placement(constraint.id)}</span>
          </button>
        </li>;
      })}
    </ul>
  </div>;
}
