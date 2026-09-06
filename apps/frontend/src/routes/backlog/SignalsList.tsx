import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import type { BacklogRow } from "@wise/api-schema";
import { groupLabel, sharedKeyValues } from "@/lib/sentences";
import { SignalCard } from "./SignalCard";

export interface SignalsListProps {
  rows: BacklogRow[];
  maxPI: number;
  view?: string;
  layerNames?: Record<string, string>;
  caseNoun?: string;
  /** Caveat ids the page states once in its header. */
  hideCaveats?: Set<string>;
  pins: string[];
  activeKey: string | undefined;
  onActive: (key: string | undefined) => void;
  onTogglePin: (key: string) => void;
  onOpen: (key: string, focus?: "finding") => void;
  onDrill?: (key: string) => void;
  onFocusFilter: () => void;
}

/**
 * Ranked sentence cards with roving-tabindex keyboard navigation (↑↓ move, ↵ Why?, p pin, f finding, / filter).
 * A plain list of focusable articles: the cards carry buttons, so they are not options of a listbox. The part
 * of the name that every group on the page shares is dropped from the cards.
 */
export function SignalsList({ rows, maxPI, view, layerNames, caseNoun, hideCaveats, pins, activeKey, onActive, onTogglePin, onOpen, onDrill, onFocusFilter }: SignalsListProps) {
  const ref = useRef<HTMLOListElement>(null);
  // the part of the name every group on the page shares (the company on BPIC 2019) is dropped
  const shared = useMemo(() => sharedKeyValues(rows), [rows]);
  const activeIndex = Math.max(0, rows.findIndex((r) => r.key === activeKey));

  const focusCard = useCallback(
    (index: number) => {
      const key = rows[index]?.key;
      if (!key) return;
      onActive(key);
      requestAnimationFrame(() => {
        const el = ref.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`);
        el?.focus();
        el?.scrollIntoView({ block: "nearest" });
      });
    },
    [rows, onActive],
  );

  useEffect(() => {
    if (activeKey && !rows.some((r) => r.key === activeKey)) onActive(undefined);
  }, [rows, activeKey, onActive]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (rows.length === 0) return;
    const i = activeIndex;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusCard(Math.min(rows.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCard(Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        focusCard(0);
        break;
      case "End":
        e.preventDefault();
        focusCard(rows.length - 1);
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

  return (
    <ol ref={ref} role="list" aria-label="Signals" className="m-0 flex list-none flex-col gap-[var(--card-gap)] p-0">
      {rows.map((row, i) => (
        <li key={row.key}>
          <SignalCard
            row={row}
            maxPI={maxPI}
            view={view}
            layerNames={layerNames}
            caseNoun={caseNoun}
            label={groupLabel(row, shared)}
            hideCaveats={hideCaveats}
            active={activeKey ? row.key === activeKey : i === 0}
            pinned={pins.includes(row.key)}
            onWhy={(key) => onOpen(key)}
            onActivate={onActive}
            onTogglePin={onTogglePin}
            onDrill={onDrill}
            onKeyDown={onKeyDown}
          />
        </li>
      ))}
    </ol>
  );
}
