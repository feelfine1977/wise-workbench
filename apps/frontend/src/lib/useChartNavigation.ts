import { useState, type KeyboardEvent } from "react";

/** One tab stop per chart; arrows inspect marks without changing the population. */
export function useChartNavigation(keys: readonly string[], activate: (key: string) => void) {
  const [focused, setFocused] = useState<string>();
  const current = focused !== undefined && keys.includes(focused) ? focused : keys[0];
  return (key: string) => ({
    tabIndex: key === current ? 0 : -1,
    "data-chart-mark": key,
    onFocus: () => setFocused(key),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!event.repeat) activate(key);
        return;
      }
      const position = keys.indexOf(key);
      const next = event.key === "Home" ? 0 : event.key === "End" ? keys.length - 1
        : ["ArrowLeft", "ArrowUp"].includes(event.key) ? Math.max(0, position - 1)
        : ["ArrowRight", "ArrowDown"].includes(event.key) ? Math.min(keys.length - 1, position + 1) : -1;
      if (next < 0) return;
      event.preventDefault();
      event.currentTarget.ownerSVGElement?.querySelectorAll<SVGGElement>("[data-chart-mark]")[next]?.focus();
    },
  });
}
