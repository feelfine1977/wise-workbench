import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import type { BacklogRow } from "@wise/api-schema";
import { SignalCard } from "./SignalCard";

export interface SignalsListProps {
  rows: BacklogRow[];
  maxPI: number;
  view?: string;
  layerNames?: Record<string, string>;
  pins: string[];
  activeKey: string | undefined;
  onActive: (key: string | undefined) => void;
  onTogglePin: (key: string) => void;
  onOpen: (key: string, focus?: "finding") => void;
  onFocusFilter: () => void;
}

/** Ranked sentence cards with roving-tabindex keyboard navigation (↑↓ move, ↵ Why?, p pin, f finding, / filter). */
export function SignalsList({ rows, maxPI, view, layerNames, pins, activeKey, onActive, onTogglePin, onOpen, onFocusFilter }: SignalsListProps) {
  const ref = useRef<HTMLDivElement>(null);
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
    <div ref={ref} role="listbox" aria-label="Signals" aria-activedescendant={undefined} className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <SignalCard
          key={row.key}
          row={row}
          maxPI={maxPI}
          view={view}
          layerNames={layerNames}
          active={activeKey ? row.key === activeKey : i === 0}
          pinned={pins.includes(row.key)}
          onWhy={(key) => onOpen(key)}
          onActivate={onActive}
          onTogglePin={onTogglePin}
          onKeyDown={onKeyDown}
        />
      ))}
    </div>
  );
}
