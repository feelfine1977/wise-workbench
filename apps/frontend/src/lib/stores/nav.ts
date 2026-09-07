import { create } from "zustand";

/**
 * Where the reader came from: the shell records every location as a stack; a sub-screen's back control
 * returns to the last location on another screen, with the exact search params, and cuts the stack back to
 * that entry (`popTo`), so that after list → Why → lens → back the control on Why still names the list. The
 * browser's own back button is untouched because every move is a normal history push.
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
  /** The second line under the current step for a sub-screen ("Packaging · lens of “Paid within terms”"). */
  subline: string | undefined;
  /** How many "Freeze this" buttons the current screen offers; the ribbon's camera presses the first. */
  freezeButtons: number;
  record: (href: string, pathname: string) => void;
  /** Cuts the stack back to the entry with this address (inclusive). */
  popTo: (href: string) => void;
  setLastSlice: (href: string, label: string) => void;
  setSubline: (text: string | undefined) => void;
  registerFreeze: (delta: 1 | -1) => void;
}

export const useNavStore = create<NavState>()((set) => ({
  visited: [],
  lastSlice: undefined,
  subline: undefined,
  freezeButtons: 0,
  record: (href, pathname) =>
    set((s) => {
      const last = s.visited[s.visited.length - 1];
      if (last?.href === href) return s;
      return { visited: [...s.visited.slice(-30), { href, pathname, at: Date.now() }] };
    }),
  popTo: (href) =>
    set((s) => {
      for (let i = s.visited.length - 1; i >= 0; i--) {
        if (s.visited[i]!.href === href) return { visited: s.visited.slice(0, i + 1) };
      }
      return s;
    }),
  setLastSlice: (href, label) => set({ lastSlice: { href, label } }),
  setSubline: (subline) => set({ subline }),
  registerFreeze: (delta) => set((s) => ({ freezeButtons: Math.max(0, s.freezeButtons + delta) })),
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
  if (/\/flow$/.test(pathname)) return "Where in the flow";
  if (/\/board$/.test(pathname)) return "Explore";
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

/**
 * The state a back control restores when the origin is the ranked list, in words: " (page 2, widespread
 * only, high-confidence ranks only)". Empty for every other origin.
 */
export function originState(href: string): string {
  if (!/\/backlog(\?|$)/.test(href)) return "";
  let params: URLSearchParams;
  try {
    params = new URL(href, "http://localhost").searchParams;
  } catch {
    return "";
  }
  const parts: string[] = [];
  const page = Number(params.get("page") ?? "1");
  parts.push(`page ${Number.isFinite(page) && page > 0 ? page : 1}`);
  const kind = params.get("kind");
  if (kind) parts.push(`${kind} only`);
  if (params.get("layer")) parts.push("one expectation area only");
  if (params.get("confident")) parts.push("high-confidence ranks only");
  if (params.get("filter")) parts.push("filtered");
  return ` (${parts.join(", ")})`;
}
