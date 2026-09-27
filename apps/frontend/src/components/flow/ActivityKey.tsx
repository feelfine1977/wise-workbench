import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { FlowGraph } from "@wise/api-schema";
import { fmtInt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** An overlay: opening the key must not narrow or refit the process map. */
export function ActivityKey({ graph, references, drawnIds, selectedId, noun, onSelect, onClose }: {
  graph: FlowGraph;
  references: Record<string, string>;
  drawnIds: Set<string>;
  selectedId?: string;
  noun: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const activities = graph.nodes.filter((n) => n.kind === "activity");
  const rows = activities.filter((n) => `${references[n.id] ?? ""} ${n.label}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <aside className="absolute bottom-3 right-3 top-3 z-20 flex w-80 max-w-[calc(100%-1.5rem)] flex-col rounded-md border border-border bg-surface shadow-2" aria-label="Activity key" data-testid="activity-key" onKeyDownCapture={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
      <strong className="text-sm">Activity key</strong>
      <button type="button" aria-label="Close activity key" className="rounded p-2 hover:bg-surface-sunken" onClick={onClose}><X className="size-4" aria-hidden /></button>
    </div>
    <div className="space-y-2 p-3">
      <p className="text-xs text-text-muted">References identify activities, not their order. Selecting a row shows its details.</p>
      <input ref={input} aria-label="Find an activity in the key" placeholder="Find name or reference…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded border border-border bg-surface px-2 py-2 text-sm" />
      <p className="text-xs text-text-muted">{rows.length} of {activities.length} activities in this scope</p>
    </div>
    <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {rows.map((n) => <li key={n.id}>
        <button type="button" aria-pressed={selectedId === n.id} onClick={() => onSelect(n.id)} className={cn("flex w-full gap-3 rounded px-2 py-2 text-left text-sm hover:bg-surface-sunken", selectedId === n.id && "bg-accent-subtle")}>
          <span className="font-mono text-xs text-accent-text">{references[n.id]}</span>
          <span className="min-w-0 flex-1 break-words"><span className="block font-medium">{n.label}</span>
            <span className="block text-xs text-text-muted">{n.metrics?.cases !== undefined ? `${fmtInt(n.metrics.cases)} ${noun}` : "Item count unavailable"}{n.metrics?.events !== undefined ? ` · ${fmtInt(n.metrics.events)} events` : ""}</span>
            {!drawnIds.has(n.id) && <span className="block text-xs text-accent-text">Hidden at this detail level · select to inspect</span>}
          </span>
        </button>
      </li>)}
    </ul>
  </aside>;
}
