import { create } from "zustand";
import type { HubTarget } from "@/lib/api/cycle4";

interface HubState {
  /** The node the side panel is showing, or nothing. */
  open: HubTarget | undefined;
  openHub: (target: HubTarget) => void;
  closeHub: () => void;
}

/**
 * The hub's side panel is opened from anywhere — a card, a driver row, a caveat chip, a legend entry — so
 * the target lives in one store rather than in the props of every screen that carries a chip
 * (`docs/panel/knowledge_hub_panel.md` §3: *without leaving the screen*).
 */
export const useHubStore = create<HubState>((set) => ({
  open: undefined,
  openHub: (open) => set({ open }),
  closeHub: () => set({ open: undefined }),
}));
