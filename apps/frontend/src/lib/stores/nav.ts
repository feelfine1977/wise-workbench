import { create } from "zustand";

/**
 * Where the reader came from (R2-O6): the shell records every location; a sub-screen's back control returns
 * to the last location on another screen, with the exact search params. The browser's own back button is
 * untouched because every move is a normal history push.
 */
export interface Visited {
  href: string;
  pathname: string;
  at: number;
}

interface NavState {
  visited: Visited[];
  /** The last group opened with Why?, so the stepper's "Why" step can return to it. */
  lastSlice: { href: string; label: string } | undefined;
  record: (href: string, pathname: string) => void;
  setLastSlice: (href: string, label: string) => void;
}

export const useNavStore = create<NavState>()((set) => ({
  visited: [],
  lastSlice: undefined,
  record: (href, pathname) =>
    set((s) => {
      const last = s.visited[s.visited.length - 1];
      if (last?.href === href) return s;
      return { visited: [...s.visited.slice(-30), { href, pathname, at: Date.now() }] };
    }),
  setLastSlice: (href, label) => set({ lastSlice: { href, label } }),
}));

/** The last visited location whose screen (pathname) differs from the current one. */
export function returnTarget(visited: Visited[], currentPathname: string): Visited | undefined {
  for (let i = visited.length - 1; i >= 0; i--) {
    const v = visited[i]!;
    if (v.pathname !== currentPathname) return v;
  }
  return undefined;
}

/** A plain name for a screen from its pathname. */
export function screenLabel(pathname: string, plain = true): string {
  if (/\/slices\//.test(pathname)) return plain ? "Why?" : "Slice";
  if (/\/backlog$/.test(pathname)) return plain ? "Where is it worst?" : "Backlog";
  if (/\/runs\/[^/]+\/compare$/.test(pathname)) return "Flow types side by side";
  if (/\/runs\/[^/]+$/.test(pathname)) return "Run";
  if (/\/runs$/.test(pathname)) return "Runs";
  if (/\/norms\/[^/]+$/.test(pathname)) return "Norm";
  if (/\/norms$/.test(pathname)) return "Norms";
  if (/\/data\/[^/]+$/.test(pathname)) return "Data and mapping";
  if (/\/data$/.test(pathname)) return "Data";
  if (/\/notebook$/.test(pathname)) return "Notebook";
  return "Dashboard";
}
