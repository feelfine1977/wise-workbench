import { Link } from "@tanstack/react-router";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Pin } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { BacklogRow } from "@wise/api-schema";
import { ConfidenceMark, KindBadge, LayerChip } from "@/components/badges";
import { Explain, backlogExplain } from "@/components/explain";
import { Term } from "@/components/Term";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";
import { useUiStore } from "@/lib/stores/ui";
import { cn, sliceLabel } from "@/lib/utils";

export interface BacklogTableProps {
  rows: BacklogRow[];
  projectId: string;
  runId: string;
  slicing: string;
  view: string | undefined;
  gamma: number;
  minCases: number;
  globalMean: number | undefined;
  sort: string;
  offset: number;
  pins: string[];
  activeKey: string | undefined;
  layerNames: Record<string, string>;
  onSort: (sort: string) => void;
  onActive: (key: string | undefined) => void;
  onTogglePin: (key: string) => void;
  onOpen: (key: string, focus?: "finding") => void;
  onFocusFilter: () => void;
}

const NUMERIC: (keyof BacklogRow)[] = ["n_cases", "mean_score", "gap", "stable_gap", "PI", "stable_PI", "PI_lower"];

/** Virtualised metric table with roving-tabindex keyboard navigation (↑↓ move, ↵ open, p pin, f finding, / filter). */
export function BacklogTable(props: BacklogTableProps) {
  const { rows, sort, offset, pins, activeKey, onSort, onActive, onTogglePin, onOpen, onFocusFilter, projectId, runId, slicing, view, gamma, minCases, globalMean, layerNames } = props;
  const density = useUiStore((s) => s.density);
  const rowHeight = density === "compact" ? 28 : 36;
  const scrollRef = useRef<HTMLDivElement>(null);
  const fmt = useMemo(() => ({ num: fmtNum, int: fmtInt }), []);
  const params = useMemo(() => ({ globalMean, gamma, view, minCases }), [globalMean, gamma, view, minCases]);

  const columns = useMemo<ColumnDef<BacklogRow>[]>(() => {
    const numeric = (id: "n_cases" | "mean_score" | "gap" | "stable_gap" | "PI" | "stable_PI", format: (v: number) => string, size = 110): ColumnDef<BacklogRow> => ({
      id,
      accessorKey: id,
      header: () => <Term id={id} />,
      size,
      meta: { numeric: true, explainKey: id },
      cell: ({ row }) => (
        <span className="flex items-center justify-end gap-1">
          <span>{format(row.original[id])}</span>
          <Explain {...backlogExplain(id, row.original, params, fmt)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-[[data-active=true]]:opacity-100" />
        </span>
      ),
    });
    return [
      { id: "rank", header: "#", size: 48, meta: { numeric: true }, cell: ({ row }) => <span className="text-text-subtle">{row.original.rank ?? offset + row.index + 1}</span> },
      {
        id: "key",
        accessorKey: "key",
        header: () => <Term id="slice" />,
        size: 220,
        cell: ({ row }) => {
          const label = sliceLabel(row.original);
          return (
            <span className="flex items-center gap-1">
              <button type="button" aria-label={`${pins.includes(row.original.key) ? "Unpin" : "Pin"} ${label}`} aria-pressed={pins.includes(row.original.key)} onClick={(e) => { e.stopPropagation(); onTogglePin(row.original.key); }} className="pin-glyph rounded-sm p-0.5 text-text-subtle hover:text-accent-text focus-visible:text-accent-text" tabIndex={-1}>
                <Pin className={cn("size-3.5", pins.includes(row.original.key) && "fill-current")} aria-hidden />
              </button>
              <Link to="/p/$projectId/runs/$runId/slices/$sliceKey" params={{ projectId, runId, sliceKey: row.original.key }} search={{ slicing, view, tab: "flow", pins: pins.length ? pins : undefined }} className="truncate text-xs font-medium text-accent-text hover:underline" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()} title={row.original.key}>
                {label}
              </Link>
            </span>
          );
        },
      },
      numeric("n_cases", (v) => fmtInt(v), 96),
      numeric("mean_score", (v) => fmtNum(v, 3), 130),
      numeric("gap", (v) => fmtPct(v, 1), 96),
      numeric("stable_gap", (v) => fmtPct(v, 1), 150),
      numeric("PI", (v) => fmtNum(v, 1), 96),
      numeric("stable_PI", (v) => fmtNum(v, 1), 150),
      { id: "kind", accessorKey: "kind", header: () => <Term id="kind" />, size: 150, cell: ({ row }) => <KindBadge kind={row.original.kind} hotspotType={row.original.hotspot_type} /> },
      { id: "stability", accessorKey: "stability", header: () => <Term id="stability" />, size: 120, cell: ({ row }) => <ConfidenceMark value={row.original.stability} /> },
      { id: "dominant_layer", accessorKey: "dominant_layer", header: () => <Term id="dominant_layer" />, size: 200, cell: ({ row }) => <LayerChip id={row.original.dominant_layer} name={row.original.dominant_layer_name ?? layerNames[row.original.dominant_layer ?? ""]} /> },
      { id: "reading", accessorKey: "reading", header: () => <Term id="reading" />, size: 480, cell: ({ row }) => <span className="block truncate text-xs text-text-muted" title={row.original.reading ?? undefined}>{row.original.reading}</span> },
    ];
  }, [offset, pins, onTogglePin, projectId, runId, slicing, view, params, fmt, layerNames]);

  const sorting = useMemo<SortingState>(() => [{ id: sort.replace(/^-/, ""), desc: sort.startsWith("-") }], [sort]);
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const s = next[0];
      if (s) onSort(`${s.desc ? "-" : ""}${s.id}`);
    },
  });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    initialRect: { width: 1200, height: 560 },
    // Falls back to the initial rect where layout is not computed (jsdom, print) so rows still render.
    observeElementRect: (instance, cb) => {
      const el = instance.scrollElement;
      if (!el) return;
      const measure = () => {
        const r = el.getBoundingClientRect();
        cb(r.height > 0 ? { width: r.width, height: r.height } : { width: 1200, height: 560 });
      };
      measure();
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
      ro?.observe(el);
      return () => ro?.disconnect();
    },
  });
  const activeIndex = Math.max(0, rows.findIndex((r) => r.key === activeKey));
  // Only keyboard moves scroll the active row into view: a mouse click must not move the row under the
  // pointer between mousedown (focus, activation) and click, or the click on its link is lost (R2-O4).
  const keyboardMove = useRef(false);

  useEffect(() => {
    if (activeKey && activeIndex >= 0 && keyboardMove.current) virtualizer.scrollToIndex(activeIndex, { align: "auto" });
    keyboardMove.current = false;
  }, [activeKey, activeIndex, virtualizer]);

  const focusRow = useCallback((index: number) => {
    const key = rows[index]?.key;
    if (!key) return;
    keyboardMove.current = true;
    onActive(key);
    virtualizer.scrollToIndex(index, { align: "auto" });
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
      el?.focus();
    });
  }, [rows, onActive, virtualizer]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const i = activeIndex;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusRow(Math.min(rows.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        focusRow(Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        focusRow(0);
        break;
      case "End":
        e.preventDefault();
        focusRow(rows.length - 1);
        break;
      case "PageDown":
        e.preventDefault();
        focusRow(Math.min(rows.length - 1, i + 10));
        break;
      case "PageUp":
        e.preventDefault();
        focusRow(Math.max(0, i - 10));
        break;
      case "Enter": {
        const key = rows[i]?.key;
        if (key) {
          e.preventDefault();
          onOpen(key);
        }
        break;
      }
      case "p":
      case "P": {
        const key = rows[i]?.key;
        if (key && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          onTogglePin(key);
        }
        break;
      }
      case "f":
      case "F": {
        const key = rows[i]?.key;
        if (key && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          onOpen(key, "finding");
        }
        break;
      }
      case "/":
        e.preventDefault();
        onFocusFilter();
        break;
      default:
        break;
    }
  };

  const headerGroups = table.getHeaderGroups();
  const gridTemplate = columns.map((c) => `${c.size ?? 120}px`).join(" ");
  const totalWidth = columns.reduce((s, c) => s + (c.size ?? 120), 0);
  const UNSORTABLE = new Set(["reading", "kind", "stability", "dominant_layer"]);

  return (
    <div role="grid" aria-label="Backlog" aria-rowcount={rows.length + 1} aria-colcount={columns.length} className="surface overflow-hidden" onKeyDown={onKeyDown}>
      <div className="overflow-x-auto">
        <div style={{ minWidth: totalWidth }}>
          {headerGroups.map((hg) => (
            <div key={hg.id} role="row" aria-rowindex={1} className="grid border-b border-border bg-surface-sunken text-xs font-medium text-text-muted" style={{ gridTemplateColumns: gridTemplate }}>
              {hg.headers.map((h) => {
                const meta = h.column.columnDef.meta as { numeric?: boolean; explainKey?: string } | undefined;
                const canSort = !UNSORTABLE.has(h.column.id);
                const sorted = h.column.getIsSorted();
                return (
                  <div key={h.id} role="columnheader" aria-sort={sorted ? (sorted === "desc" ? "descending" : "ascending") : canSort ? "none" : undefined} className={cn("flex h-9 items-center gap-1 px-2", meta?.numeric && "justify-end")}>
                    {canSort ? (
                      <button type="button" className="inline-flex items-center gap-1 text-left hover:text-text" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "desc" && <ArrowDown className="size-3" aria-hidden />}
                        {sorted === "asc" && <ArrowUp className="size-3" aria-hidden />}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                    {meta?.explainKey && <Explain term={meta.explainKey} />}
                  </div>
                );
              })}
            </div>
          ))}
          <div ref={scrollRef} className="relative overflow-y-auto" style={{ maxHeight: "56vh" }}>
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const row = table.getRowModel().rows[vi.index];
                if (!row) return null;
                const key = row.original.key;
                const isActive = activeKey ? key === activeKey : vi.index === 0;
                return (
                  <div
                    key={key}
                    role="row"
                    aria-rowindex={vi.index + 2}
                    aria-selected={isActive}
                    data-row-key={key}
                    data-active={isActive}
                    data-pinned={pins.includes(key)}
                    tabIndex={isActive ? 0 : -1}
                    onFocus={() => onActive(key)}
                    onClick={() => onActive(key)}
                    onDoubleClick={() => onOpen(key)}
                    className="grid-row group absolute left-0 grid w-full cursor-default items-center border-b border-border text-sm outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                    style={{ gridTemplateColumns: gridTemplate, height: vi.size, transform: `translateY(${vi.start}px)` }}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as { numeric?: boolean } | undefined;
                      return (
                        <div key={cell.id} role="gridcell" className={cn("min-w-0 px-2", meta?.numeric && "tnum text-right", NUMERIC.includes(cell.column.id as keyof BacklogRow) && "tnum")}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
