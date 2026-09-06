import { Camera } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { useCreateSnapshot, type SnapshotContext } from "@/lib/api/cycle2";
import { captureElement, screenElement } from "@/lib/capture";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { ErrorBlock } from "@/components/states";
import { cn } from "@/lib/utils";

export interface FreezeProps {
  projectId: string;
  /** Which screen this is (goes into the snapshot's context). */
  screen: string;
  context?: Partial<Omit<SnapshotContext, "screen" | "url">>;
  /** The numbers behind the screen, stored as JSON next to the image. */
  data?: unknown;
  defaultTitle: string;
  className?: string;
  /** Capture this element instead of the screen's main region. */
  target?: () => HTMLElement | null;
}

/**
 * "Freeze this" (R2-O11): captures the screen, asks for a title and a note, and stores the snapshot in the
 * project's notebook. When the client capture fails the context is sent alone and the backend renders it.
 */
export function FreezeButton({ projectId, screen, context, data, defaultTitle, className, target }: FreezeProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ id: string; rendered: boolean }>();
  const href = useRouterState({ select: (s) => s.location.href });
  const create = useCreateSnapshot(projectId);

  const freeze = async () => {
    const el = target?.() ?? screenElement();
    const image = el ? await captureElement(el) : undefined;
    create.mutate(
      { title: title.trim() || defaultTitle, note: note.trim(), context: { screen, url: href, ...context }, data, image },
      {
        onSuccess: (snap) => {
          setResult({ id: snap.id, rendered: !!snap.hasImage });
          setOpen(false);
          setNote("");
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("gap-1.5", className)}
        data-no-capture
        onClick={() => {
          setTitle(defaultTitle);
          setOpen(true);
        }}
        aria-label={`Freeze this screen into the notebook: ${defaultTitle}`}
      >
        <Camera aria-hidden />
        Freeze this
      </Button>
      {result && (
        <span className="text-xs text-text-muted" role="status" data-no-capture>
          Frozen{result.rendered ? "" : " (without a picture: the screen could not be captured)"} ·{" "}
          <Link className="text-accent-text underline" to="/p/$projectId/notebook" params={{ projectId }} search={{ snapshot: result.id }}>
            open the notebook
          </Link>
        </span>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Freeze this screen</DialogTitle>
            <DialogDescription>A picture of the screen, the numbers behind it and where you were (run, grouping, perspective, filters) go into the project's notebook.</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void freeze();
            }}
          >
            <Field label="title" htmlFor="freeze-title">
              <Input id="freeze-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </Field>
            <Field label="note" htmlFor="freeze-note" hint="What this step shows and what you read from it; one or two sentences.">
              <Textarea id="freeze-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Packaging carries the largest shortfall; invoices wait 83 days before clearing." />
            </Field>
            {create.isError && <ErrorBlock error={create.error} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !title.trim()}>
                {create.isPending ? "Freezing…" : "Freeze"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
