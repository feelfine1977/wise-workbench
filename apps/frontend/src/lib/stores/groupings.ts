import { create } from "zustand";
import { persist } from "zustand/middleware";
interface SavedGrouping { token: string; label: string }
interface State { saved: Record<string, SavedGrouping[]>; save: (scope: string, value: SavedGrouping) => void }
/** Remember definitions per project and case table, without copying case data. */
export const useGroupingStore = create<State>()(persist((set) => ({
  saved: {},
  save: (scope, value) => set((state) => ({ saved: { ...state.saved, [scope]: [value, ...(state.saved[scope] ?? []).filter((s) => s.token !== value.token)].slice(0, 30) } })),
}), { name: "wise.groupings", version: 1 }));
