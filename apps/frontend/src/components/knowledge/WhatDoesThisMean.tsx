/**
 * *What does this mean?* (RK-4): the chip that sits on every missed label, driver row, caveat chip and
 * kind chip, and the side panel it opens over the screen without leaving it. The chip carries either a hub
 * node id or the kind and id of an entry (an expectation, an expectation area, a failure mode); the panel
 * resolves the second through `GET …/guidance/{kind}/{id}`, which names the hub node to open.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HelpCircle } from "lucide-react";
import { useWorkbench } from "@/app/context";
import { guidanceQuery, hubPageQuery, hubQuery, hubNodeOf, type HubPage, type HubTarget } from "@/lib/api/knowledge";
import { notServed } from "@/lib/api/compatibility";
import { HubTemplate } from "@/components/knowledge/HubTemplate";
import { LoadingBlock } from "@/components/states";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useHubStore } from "@/lib/stores/hub";
import { cn } from "@/lib/utils";

export interface WhatDoesThisMeanProps extends HubTarget {
  /** A word instead of the glyph, for a place where the chip stands on its own. */
  words?: boolean;
  className?: string;
}

/**
 * The chip. It is a button, never a link, so it never takes the reader off the screen they are reading; the
 * hub's own route is reachable from the panel and from the stepper's `⋯`.
 */
export function WhatDoesThisMean({ nodeId, kind, entryId, label, words, className }: WhatDoesThisMeanProps) {
  const openHub = useHubStore((s) => s.openHub);
  if (!nodeId && !entryId) return null;
  const name = label ? `What does “${label}” mean?` : "What does this mean?";
  return (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 align-middle text-[11px] leading-4 text-text-muted hover:border-accent hover:text-accent-text",
        className,
      )}
      aria-label={name}
      title={name}
      data-testid="what-does-this-mean"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        openHub({ nodeId, kind, entryId, label });
      }}
    >
      <HelpCircle className="size-3" aria-hidden />
      {words && <span>What does this mean?</span>}
    </button>
  );
}

/**
 * The panel the chips open, mounted once in the shell. The reader closes it with `Escape` or the ×; the
 * screen behind it does not move.
 */
export function HubPanel() {
  const ctx = useWorkbench();
  const target = useHubStore((s) => s.open);
  const openHub = useHubStore((s) => s.openHub);
  const closeHub = useHubStore((s) => s.closeHub);
  const projectId = ctx.projectId;

  // an entry (kind + id) resolves to a hub node through the guidance endpoint; the index is the fallback
  const guidance = useQuery({ ...guidanceQuery(projectId, target?.kind ?? "constraint", target?.nodeId ? "" : (target?.entryId ?? "")), enabled: !!target && !target.nodeId && !!target.entryId });
  const index = useQuery({ ...hubQuery(projectId), enabled: !!target && !target.nodeId && !guidance.data?.hub_node });
  const nodeId = target?.nodeId ?? guidance.data?.hub_node ?? (target?.entryId ? hubNodeOf(index.data, target.kind ?? "constraint", target.entryId) : undefined) ?? "";
  const page = useQuery({ ...hubPageQuery(projectId, nodeId), enabled: !!target && !!nodeId });

  // the panel of the previous chip must not be shown under the next one's title
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeHub();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, closeHub]);

  const fallbackPage = useMemo<HubPage | undefined>(() => {
    const g = guidance.data?.generic;
    if (!g) return undefined;
    return { node: { id: guidance.data?.id ?? "", kind: guidance.data?.kind ?? "constraint", plain_name: g.plain_name ?? null, method_name: g.method_name ?? null, missed_label: g.missed_label ?? null }, guidance: g, related: {}, overlay: guidance.data?.overlay ?? null };
  }, [guidance.data]);

  const shown = page.data ?? fallbackPage;
  const pending = (page.isPending && !!nodeId) || guidance.isPending || index.isPending;
  const missing = !pending && !shown;
  const notOnThisBackend = missing && (notServed(page.error) || notServed(guidance.error) || notServed(index.error));

  return (
    <Sheet open={!!target} onOpenChange={(o) => !o && closeHub()}>
      <SheetContent className="max-w-xl gap-0 p-0" aria-describedby={undefined} data-testid="hub-panel">
        <SheetTitle className="sr-only">{target?.label ? `What ${target.label} means` : "What this means"}</SheetTitle>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <span className="text-xs uppercase tracking-wide text-text-subtle">Knowledge hub</span>
          {nodeId && (
            <Link
              to="/p/$projectId/knowledge/$nodeId"
              params={{ projectId, nodeId }}
              className="mr-8 text-xs text-accent-text underline"
              onClick={() => closeHub()}
            >
              Open the full page →
            </Link>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {pending && <LoadingBlock rows={6} />}
          {shown && <HubTemplate projectId={projectId} page={shown} compact onOpen={(id) => openHub({ nodeId: id })} />}
          {missing && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="reading font-medium text-text">There is no hub page for {target?.label ?? "this"} yet.</p>
              <p className="reading text-text-muted">
                {notOnThisBackend
                  ? "This workspace's process pack does not carry a page for it. The pack's own words are added when the pack is updated."
                  : "The page could not be read. Open the hub and search for the word instead."}
              </p>
              <Link to="/p/$projectId/knowledge" params={{ projectId }} className="text-accent-text underline" onClick={() => closeHub()}>
                Open the knowledge hub →
              </Link>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
