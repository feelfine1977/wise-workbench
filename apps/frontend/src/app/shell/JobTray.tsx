import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Job } from "@wise/api-schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";
import { isJobActive, jobTransport, useCancelJob, useJob } from "@/lib/queries";
import { useJobStore, type TrackedJob } from "@/lib/stores/jobs";
import { useUiStore } from "@/lib/stores/ui";
import { cn, parseResultRef } from "@/lib/utils";

const statusVariant: Record<Job["status"], "info" | "accent" | "success" | "danger" | "warning"> = {
  queued: "info",
  running: "accent",
  done: "success",
  failed: "danger",
  cancelled: "warning",
};
const statusGlyph: Record<Job["status"], string> = { queued: "○", running: "◐", done: "●", failed: "✕", cancelled: "⊘" };

function JobRow({ tracked, announce }: { tracked: TrackedJob; announce: (text: string) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const markStatus = useJobStore((s) => s.markStatus);
  const dismiss = useJobStore((s) => s.dismiss);
  const cancel = useCancelJob();
  const job = useJob(tracked.id);
  const data = job.data;
  const status = data?.status ?? tracked.lastStatus ?? "queued";

  useEffect(() => {
    if (!data) return;
    if (tracked.lastStatus !== data.status) {
      markStatus(data.id, data.status);
      if (data.status !== "queued") announce(t("jobs.announce", { label: tracked.label, status: t(`jobs.status.${data.status}`) }));
      if (data.status === "done" || data.status === "failed" || data.status === "cancelled") {
        void qc.invalidateQueries({ queryKey: ["projects"] });
      }
    }
  }, [data, tracked.lastStatus, tracked.label, markStatus, announce, qc, t]);

  const openResult = () => {
    const ref = parseResultRef(data?.resultRef ?? undefined);
    const pid = tracked.projectId;
    if (!ref) return;
    if (ref.kind === "run") void navigate({ to: "/p/$projectId/runs/$runId/backlog", params: { projectId: pid, runId: ref.id }, search: {} });
    else if (ref.kind === "dataset") void navigate({ to: "/p/$projectId/data/$datasetId", params: { projectId: pid, datasetId: ref.id }, search: {} });
    else if ((ref.kind === "caseTable" || ref.kind === "case_table") && tracked.resultRoute?.kind === "dataset")
      void navigate({ to: "/p/$projectId/data/$datasetId", params: { projectId: pid, datasetId: tracked.resultRoute.id }, search: { caseTable: ref.id } });
  };

  return (
    <li className="flex flex-col gap-1 border-t border-border px-3 py-2 text-sm" data-job-status={status}>
      <div className="flex items-center gap-2">
        <Badge variant={statusVariant[status]}>
          <span aria-hidden>{statusGlyph[status]}</span>
          {t(`jobs.status.${status}`)}
        </Badge>
        <span className="min-w-0 flex-1 truncate" title={tracked.label}>
          {tracked.label}
        </span>
        <Button variant="ghost" size="iconSm" aria-label={`${t("jobs.dismiss")}: ${tracked.label}`} onClick={() => dismiss(tracked.id)}>
          <X />
        </Button>
      </div>
      {isJobActive(data) && <Progress value={data?.progress ?? 0} label={`${tracked.label} progress`} />}
      {isJobActive(data) && (
        <span className="text-[11px] text-text-subtle" data-testid="job-transport">
          {t(`jobs.transport.${jobTransport()}`)}
        </span>
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
        <span className="truncate">{data?.error ? data.message ?? data.error : data?.message ?? "…"}</span>
        <span className="flex shrink-0 gap-1">
          {isJobActive(data) && (
            <Button variant="outline" size="sm" onClick={() => cancel.mutate(tracked.id)} disabled={cancel.isPending}>
              {t("jobs.cancel")}
            </Button>
          )}
          {status === "done" && data?.resultRef && (
            <Button variant="default" size="sm" onClick={openResult}>
              {t("jobs.openResult")}
            </Button>
          )}
        </span>
      </div>
    </li>
  );
}

/** Job tray (UX-22): running and finished jobs with progress, cancel and "open result"; announces state changes. */
export function JobTray({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const jobs = useJobStore((s) => s.jobs).filter((j) => j.projectId === projectId);
  const open = useUiStore((s) => s.trayOpen);
  const setOpen = useUiStore((s) => s.setTrayOpen);
  const [announcement, setAnnouncement] = useState("");
  const active = jobs.filter((j) => !j.lastStatus || j.lastStatus === "queued" || j.lastStatus === "running").length;

  return (
    <section aria-label={t("jobs.title")} className={cn("fixed bottom-3 right-3 z-tray w-80 overflow-hidden rounded-md border border-border bg-surface-raised shadow-3", jobs.length === 0 && "hidden")}>
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="job-announcer">
        {announcement}
      </div>
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          {t("jobs.title")}
          {active > 0 && (
            <Badge variant="accent" className="ml-2">
              <span aria-hidden>◐</span>
              {active}
            </Badge>
          )}
        </span>
        {open ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
      </button>
      {open && (
        <ul className="max-h-72 overflow-y-auto">
          {jobs.map((j) => (
            <JobRow key={j.id} tracked={j} announce={setAnnouncement} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Hook for screens that start jobs: track the job so the tray shows it. */
export function useTrackJob(projectId: string) {
  const track = useJobStore((s) => s.track);
  const setOpen = useUiStore((s) => s.setTrayOpen);
  return (job: Job, label: string, resultRoute?: TrackedJob["resultRoute"]) => {
    track({ id: job.id, kind: job.kind, label, projectId, resultRoute });
    setOpen(true);
  };
}
