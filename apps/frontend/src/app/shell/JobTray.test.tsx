import { QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type * as Router from "@tanstack/react-router";
import { useJobStore } from "@/lib/stores/jobs";
import { createJob, db } from "@/mocks/db";
import { makeTestQueryClient } from "@/test/utils";
import { JobTray, useTrackJob } from "./JobTray";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof Router>();
  return { ...actual, useNavigate: () => vi.fn() };
});

function renderTray() {
  const qc = makeTestQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <JobTray projectId="p2p2018" />
    </QueryClientProvider>,
  );
}

describe("job tray", () => {
  it.each(["done", "running", "queued"] as const)("retains returned %s status before the tray requests job progress", status => {
    const { result } = renderHook(() => useTrackJob("p2p2018"));
    result.current({ id: "returned-job", kind: "score_run", status, progress: status === "done" ? 1 : 0, attempts: 1, cancelRequested: false, createdAt: "2026-09-28T00:00:00Z", updatedAt: "2026-09-28T00:00:00Z" }, "Returned assessment", { kind: "run", id: "run_41" });
    expect(useJobStore.getState().jobs[0]).toMatchObject({ id: "returned-job", lastStatus: status });
  });
  it("shows progress, announces the finished state and offers the result", async () => {
    const job = createJob("score_run", "Scoring run_99", { kind: "run", id: "run_41" }, 0.5);
    useJobStore.getState().track({ id: job.id, kind: job.kind, label: "Score run_99", projectId: "p2p2018" });
    renderTray();
    expect(await screen.findByText("Score run_99")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("job-announcer")).toHaveTextContent(/is done/), { timeout: 6000 });
    expect(screen.getByRole("button", { name: "Open result" })).toBeInTheDocument();
    expect(db.jobs.get(job.id)?.status).toBe("done");
  }, 10000);

  it("cancels a running job", async () => {
    const user = userEvent.setup();
    const job = createJob("ingest", "Ingesting log", { kind: "dataset", id: "ds_1" }, 0.05);
    useJobStore.getState().track({ id: job.id, kind: job.kind, label: "Ingest log.csv", projectId: "p2p2018" });
    renderTray();
    const cancel = await screen.findByRole("button", { name: "Cancel job" });
    await user.click(cancel);
    await waitFor(() => expect(screen.getByTestId("job-announcer")).toHaveTextContent(/is cancelled/), { timeout: 6000 });
    expect(db.jobs.get(job.id)?.status).toBe("cancelled");
  }, 10000);
});
