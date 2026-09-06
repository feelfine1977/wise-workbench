import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { JobStatus } from "@wise/api-schema";

export interface TrackedJob {
  id: string;
  kind: string;
  label: string;
  projectId: string;
  startedAt: string;
  /** Last status seen by the tray; used to announce transitions once. */
  lastStatus?: JobStatus;
  /** Where "open result" should navigate once the job is done. */
  resultRoute?: { kind: "dataset" | "caseTable" | "run"; id: string };
}

interface JobState {
  jobs: TrackedJob[];
  track: (job: Omit<TrackedJob, "startedAt">) => void;
  markStatus: (id: string, status: JobStatus) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
}

export const useJobStore = create<JobState>()(
  persist(
    (set) => ({
      jobs: [],
      track: (job) =>
        set((s) =>
          s.jobs.some((j) => j.id === job.id)
            ? s
            : { jobs: [{ ...job, startedAt: new Date().toISOString() }, ...s.jobs].slice(0, 20) },
        ),
      markStatus: (id, status) =>
        set((s) => ({ jobs: s.jobs.map((j) => (j.id === id && j.lastStatus !== status ? { ...j, lastStatus: status } : j)) })),
      dismiss: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
      clearFinished: () =>
        set((s) => ({ jobs: s.jobs.filter((j) => !j.lastStatus || j.lastStatus === "queued" || j.lastStatus === "running") })),
    }),
    { name: "wise.jobs", storage: undefined },
  ),
);
