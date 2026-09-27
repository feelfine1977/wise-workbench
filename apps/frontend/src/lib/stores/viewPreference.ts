import { create } from "zustand";
import { persist } from "zustand/middleware";
/** An exploration preference only; it never edits the Process norm or an existing run. */
export const useViewPreference = create<{
  byProject: Record<string, string>;
  choose: (projectId: string, view: string) => void;
}>()(persist((set) => ({
  byProject: {},
  choose: (projectId, view) => set((s) => s.byProject[projectId] === view ? s : ({ byProject: { ...s.byProject, [projectId]: view } })),
}), { name: "wise-view-preference" }));
