import { Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Download, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useWorkbench } from "@/app/context";
import { notebookRoute } from "@/app/router";
import { notebookExportUrl, notebookQuery, snapshotImageUrl, useDeleteSnapshot, useReorderSnapshots, useUpdateSnapshot, type Snapshot, type SnapshotContext } from "@/lib/api/cycle2";
import { BackControl } from "@/components/guide/BackControl";
import { HowToRead, HowToReadToggle } from "@/components/guide/HowToRead";
import { NextStep } from "@/components/guide/NextStep";
import { EmptyState, ErrorBlock, LoadingBlock } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Card } from "@/components/ui/misc";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function SnapshotCard({ snapshot, index, count, projectId, highlighted, onMove }: { snapshot: Snapshot; index: number; count: number; projectId: string; highlighted: boolean; onMove: (dir: -1 | 1) => void }) {
  const router = useRouter();
  const update = useUpdateSnapshot(projectId);
  const remove = useDeleteSnapshot(projectId);
  const [title, setTitle] = useState(snapshot.title);
  const [note, setNote] = useState(snapshot.note ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setTitle(snapshot.title);
    setNote(snapshot.note ?? "");
  }, [snapshot.title, snapshot.note]);
  const dirty = title !== snapshot.title || note !== (snapshot.note ?? "");
  const src = snapshotImageUrl(snapshot);
  const context = (snapshot.context ?? {}) as Partial<SnapshotContext>;
  return (
    <li id={`snapshot-${snapshot.id}`}>
      <Card className={cn("flex flex-col gap-3 md:flex-row", highlighted && "border-accent")} data-snapshot={snapshot.id}>
        <div className="flex shrink-0 flex-col items-center gap-1 text-text-muted">
          <span className="tnum text-lg font-semibold">{index + 1}</span>
          <Button variant="ghost" size="iconSm" aria-label={`Move ${snapshot.title} up`} disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="iconSm" aria-label={`Move ${snapshot.title} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </Button>
        </div>
        <div className="w-full shrink-0 md:w-72">
          {src ? (
            <img src={src} alt={`Screen frozen as "${snapshot.title}"`} className="w-full rounded-md border border-border bg-surface" />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border text-xs text-text-subtle">no image (the screen could not be captured in the browser)</div>
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
              <h3 className="text-lg font-semibold">{snapshot.title}</h3>
              <p className="reading whitespace-pre-wrap text-base text-text-muted">{snapshot.note || <span className="italic text-text-subtle">no note yet</span>}</p>
            </>
          )}
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-subtle">
            <span>{context.screen ?? "screen"}</span>
            {context.run_id && <span className="font-mono">{context.run_id}</span>}
            {context.scope?.flow_type && <span>{context.scope.flow_type} flow</span>}
            {context.slicing && <span>{context.slicing.replace(/case /g, "").replace(/\+/g, " × ")}</span>}
            {context.view && <span>{context.view}</span>}
            {context.filters?.and?.length ? <span>{context.filters.and.length} filter clause(s)</span> : null}
            <span>{fmtDateTime(snapshot.createdAt)}</span>
            {snapshot.author && <span>{snapshot.author}</span>}
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {!editing && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit the note
              </Button>
            )}
            {context.url && (
              <Button size="sm" variant="outline" onClick={() => router.history.push((context.url ?? "").replace(/^https?:\/\/[^/]+/, ""))}>
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
    </li>
  );
}

/**
 * The analysis notebook (R2-O11): every frozen screen in order, with its image, note and context; reorder,
 * edit notes, export to Markdown with the images. PowerPoint export is cycle 4.
 */
export default function NotebookPage() {
  const ctx = useWorkbench();
  const search = notebookRoute.useSearch();
  const notebook = useQuery(notebookQuery(ctx.projectId));
  const reorder = useReorderSnapshots(ctx.projectId);
  const snapshots = [...(notebook.data?.snapshots ?? [])].sort((a, b) => a.order - b.order);

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

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide text-text-subtle">
          <BackControl className="normal-case tracking-normal" />
          <span>Notebook</span>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            Analysis notebook
            <HowToReadToggle id="notebook" />
          </h1>
          <Button asChild variant="outline" disabled={!snapshots.length}>
            <a href={notebookExportUrl(ctx.projectId)} download="notebook.zip">
              <Download aria-hidden />
              Export as Markdown
            </a>
          </Button>
        </div>
        <p className="reading text-base text-text-muted">
          {snapshots.length ? `${snapshots.length} frozen screen${snapshots.length === 1 ? "" : "s"}, in the order they tell the story.` : "Nothing frozen yet."}
        </p>
        <HowToRead id="notebook">
          Every analysis screen has a <strong>Freeze this</strong> button: it stores a picture of the screen, the numbers behind it and where you were, with your title and note. Here you put the snapshots in order, edit the notes and export the notebook as Markdown with the
          images; a PowerPoint export follows in cycle 4.
        </HowToRead>
      </header>
      {notebook.isPending && <LoadingBlock rows={6} />}
      {notebook.isError && <ErrorBlock error={notebook.error} retry={() => void notebook.refetch()} />}
      {notebook.data && snapshots.length === 0 && (
        <EmptyState
          title="No snapshot yet"
          reason="Freeze a screen while you analyse; the notebook keeps the steps as documentation."
          action={ctx.run?.status === "done" ? { label: "Open the ranked list", to: "/p/$projectId/runs/$runId/backlog", params: { projectId: ctx.projectId, runId: ctx.run.id }, search: { slicing: ctx.slicing, view: ctx.view } } : undefined}
        />
      )}
      {snapshots.length > 0 && (
        <>
          <NextStep label="Export as Markdown" because="the notebook is the documentation of this analysis; the images travel in the zip" onClick={() => window.open(notebookExportUrl(ctx.projectId), "_blank", "noopener")} />
          <ol className="flex flex-col gap-4" aria-label="Snapshots">
            {snapshots.map((s, i) => (
              <SnapshotCard key={s.id} snapshot={s} index={i} count={snapshots.length} projectId={ctx.projectId} highlighted={s.id === search.snapshot} onMove={(dir) => move(i, dir)} />
            ))}
          </ol>
        </>
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
