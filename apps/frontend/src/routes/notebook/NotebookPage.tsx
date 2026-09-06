import { Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useWorkbench } from "@/app/context";
import { notebookRoute } from "@/app/router";
import { notebookExportUrl, notebookQuery, snapshotImageUrl, useDeleteSnapshot, useReorderSnapshots, useUpdateSnapshot, type Snapshot, type SnapshotContext } from "@/lib/api/cycle2";
import { BackControl } from "@/components/guide/BackControl";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/format";
import { useNavStore } from "@/lib/stores/nav";
import { cn } from "@/lib/utils";

const SCREEN_NAME: Record<string, string> = {
  dashboard: "Dashboard",
  signals: "Where is it worst?",
  why: "Why?",
  norm: "Norm",
  run: "Run",
  "run-flow": "Run · process map",
  "compare-flow-types": "Flow types side by side",
  readiness: "Data caveats",
  "flow-types": "Your process",
  mapping: "Column mapping",
};

/** The context line of a snapshot: the screen, the run's note and date, the perspective, the grouping, the filters. */
function contextLine(context: Partial<SnapshotContext>, runNote: string | undefined, created: string): string {
  const parts: string[] = [];
  parts.push(SCREEN_NAME[context.screen ?? ""] ?? context.screen ?? "screen");
  if (context.slice_key) {
    try {
      const parsed = JSON.parse(context.slice_key) as unknown;
      if (Array.isArray(parsed)) parts.push(parsed.map(String).join(" × "));
    } catch {
      parts.push(context.slice_key);
    }
  }
  if (runNote) parts.push(runNote);
  if (context.scope?.flow_type) parts.push(`${context.scope.flow_type} flow`);
  if (context.view) parts.push(context.view);
  if (context.slicing) parts.push(context.slicing.replace(/case /g, "").replace(/\+/g, " × "));
  if (context.filters?.and?.length) parts.push(`${context.filters.and.length} filter${context.filters.and.length === 1 ? "" : "s"}`);
  parts.push(fmtDateTime(created));
  return parts.join(" · ");
}

function SnapshotCard({ snapshot, index, count, projectId, runNote, highlighted, onMove }: { snapshot: Snapshot; index: number; count: number; projectId: string; runNote?: string; highlighted: boolean; onMove: (dir: -1 | 1) => void }) {
  const router = useRouter();
  const update = useUpdateSnapshot(projectId);
  const remove = useDeleteSnapshot(projectId);
  const [title, setTitle] = useState(snapshot.title);
  const [note, setNote] = useState(snapshot.note ?? "");
  const [editing, setEditing] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  useEffect(() => {
    setTitle(snapshot.title);
    setNote(snapshot.note ?? "");
  }, [snapshot.title, snapshot.note]);
  const dirty = title !== snapshot.title || note !== (snapshot.note ?? "");
  const src = snapshotImageUrl(snapshot);
  const context = (snapshot.context ?? {}) as Partial<SnapshotContext>;
  const line = contextLine(context, runNote, snapshot.createdAt);
  const reopen = () => context.url && router.history.push((context.url ?? "").replace(/^https?:\/\/[^/]+/, ""));
  return (
    <li id={`snapshot-${snapshot.id}`}>
      <Card className={cn("flex items-start gap-4 overflow-hidden", highlighted && "border-accent")} data-snapshot={snapshot.id}>
        <div className="flex shrink-0 flex-col items-center gap-1 text-text-muted">
          <span className="tnum text-lg font-semibold">{index + 1}</span>
          <Button variant="ghost" size="iconSm" aria-label={`Move ${snapshot.title} up`} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="iconSm" aria-label={`Move ${snapshot.title} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </Button>
        </div>
        <div className="w-40 shrink-0">
          {src ? (
            <button type="button" className="block w-40 rounded-md focus-visible:ring-2 focus-visible:ring-focus" onClick={() => setLightbox(true)} aria-label={`Open the picture of "${snapshot.title}"`}>
              <img src={src} alt={`Screen frozen as "${snapshot.title}"`} className="aspect-[16/10] w-40 rounded-md border border-border bg-surface object-cover object-top" />
            </button>
          ) : (
            <div className="flex aspect-[16/10] w-40 items-center justify-center rounded-md border border-dashed border-border p-2 text-center text-xs text-text-subtle">no picture (the screen could not be captured)</div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {editing ? (
            <>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Snapshot title" className="text-base font-semibold" />
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Snapshot note" />
              <div className="flex gap-2">
                <Button size="sm" disabled={!dirty || update.isPending} onClick={() => update.mutate({ id: snapshot.id, title, note }, { onSuccess: () => setEditing(false) })}>
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTitle(snapshot.title);
                    setNote(snapshot.note ?? "");
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <h3 className="min-w-0 truncate text-lg font-semibold" title={snapshot.title}>
                {snapshot.title}
              </h3>
              <p className="reading max-w-[64ch] whitespace-pre-wrap break-words text-base text-text-muted">
                {snapshot.note || <span className="italic text-text-subtle">no note yet</span>}
              </p>
            </>
          )}
          <p className="truncate text-xs text-text-subtle" title={line} data-testid="snapshot-context">
            {line}
            {snapshot.author ? ` · ${snapshot.author}` : ""}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {!editing && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit the note
              </Button>
            )}
            {context.url && (
              <Button size="sm" variant="outline" onClick={reopen}>
                Go to this screen
              </Button>
            )}
            <Button size="sm" variant="ghost" className="ml-auto text-danger" aria-label={`Delete ${snapshot.title}`} disabled={remove.isPending} onClick={() => remove.mutate(snapshot.id)}>
              <Trash2 aria-hidden />
              Delete
            </Button>
          </div>
          {(update.isError || remove.isError) && <ErrorBlock error={update.error ?? remove.error} />}
        </div>
      </Card>
      {src && (
        <Dialog open={lightbox} onOpenChange={setLightbox}>
          <DialogContent className="max-w-[min(1200px,92vw)]">
            <DialogTitle className="pr-8">{snapshot.title}</DialogTitle>
            <DialogDescription className="text-xs text-text-subtle">{line}</DialogDescription>
            <img src={src} alt={`Screen frozen as "${snapshot.title}"`} className="mt-3 max-h-[70vh] w-full rounded-md border border-border object-contain" />
            <div className="mt-3 flex justify-end gap-2">
              {context.url && (
                <Button
                  onClick={() => {
                    setLightbox(false);
                    reopen();
                  }}
                >
                  Open this screen again
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}

/**
 * The analysis notebook: every frozen screen in order with a 160 px thumbnail (the full picture in a
 * lightbox), the note, the context line with the run's note and date; reorder, edit notes, export to
 * Markdown with the images. The notebook is a sub-screen of the step it was opened from.
 */
export default function NotebookPage() {
  const ctx = useWorkbench();
  const search = notebookRoute.useSearch();
  const notebook = useQuery(notebookQuery(ctx.projectId));
  const reorder = useReorderSnapshots(ctx.projectId);
  const setSubline = useNavStore((s) => s.setSubline);
  const snapshots = [...(notebook.data?.snapshots ?? [])].sort((a, b) => a.order - b.order);

  useEffect(() => {
    setSubline("Notebook");
    return () => setSubline(undefined);
  }, [setSubline]);

  useEffect(() => {
    if (search.snapshot && snapshots.length) document.getElementById(`snapshot-${search.snapshot}`)?.scrollIntoView({ block: "center" });
  }, [search.snapshot, snapshots.length]);

  const move = (i: number, dir: -1 | 1) => {
    const order = snapshots.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    reorder.mutate(order);
  };
  const runNote = (id: string | null | undefined) => {
    const run = id ? ctx.runs.find((r) => r.id === id) : undefined;
    return run?.note?.trim() || undefined;
  };
  const last = snapshots[snapshots.length - 1];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-text-subtle">
          <BackControl className="normal-case tracking-normal" />
          <span>Notebook</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Notebook{ctx.project ? ` · ${ctx.project.name}` : ""}
            <HowToReadToggle id="notebook" />
          </h1>
          {snapshots.length > 0 && (
            <Button asChild>
              <a href={notebookExportUrl(ctx.projectId)} download="notebook.zip">
                <Download aria-hidden />
                Export Markdown
              </a>
            </Button>
          )}
        </div>
        <p className="reading text-base text-text-muted">
          {snapshots.length ? `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"}${last ? ` · last frozen ${fmtDateTime(last.createdAt)}` : ""}` : "Nothing frozen yet. Press the camera on any analysis screen to keep it here with a note."}
        </p>
        <HowToRead id="notebook">
          Every analysis screen has a <strong>Freeze this</strong> button (and the camera in the ribbon): it stores a picture of the screen, the numbers behind it and where you were, with your title and note. Here you put the snapshots in order, edit the notes, open
          the picture at full size and export the notebook as Markdown with the images.
        </HowToRead>
      </header>
      {notebook.isPending && <LoadingBlock rows={6} />}
      {notebook.isError && <ErrorBlock error={notebook.error} retry={() => void notebook.refetch()} />}
      {notebook.data && snapshots.length === 0 && (
        <EmptyState
          title="Nothing frozen yet"
          reason="Press the camera on any analysis screen to keep it here with a note; the notebook keeps the steps as documentation."
          action={ctx.run?.status === "done" ? { label: "Open the ranked list", to: "/p/$projectId/runs/$runId/backlog", params: { projectId: ctx.projectId, runId: ctx.run.id }, search: { slicing: ctx.slicing, view: ctx.view } } : undefined}
        />
      )}
      {snapshots.length > 0 && (
        <ol className="flex flex-col gap-4" aria-label="Snapshots">
          {snapshots.map((s, i) => (
            <SnapshotCard key={s.id} snapshot={s} index={i} count={snapshots.length} projectId={ctx.projectId} runNote={runNote(((s.context ?? {}) as Partial<SnapshotContext>).run_id)} highlighted={s.id === search.snapshot} onMove={(dir) => move(i, dir)} />
          ))}
        </ol>
      )}
      {reorder.isError && <ErrorBlock error={reorder.error} />}
      <p className="text-xs text-text-subtle">
        Snapshots are stored per project by the backend under the workspace folder.{" "}
        <Link className="underline" to="/p/$projectId" params={{ projectId: ctx.projectId }}>
          Back to the dashboard
        </Link>
        .
      </p>
    </div>
  );
}
