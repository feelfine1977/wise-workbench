import { Link } from "@tanstack/react-router";
import type { WorkbenchContext } from "../context";
import { viewColor } from "@/lib/viewColors";
import { useViewSelection } from "./viewSelection";
import { cn } from "@/lib/utils";

/** Labelled bookmarks: view colours identify a business lens, never good/bad performance. */
export function ViewBookmarks({ ctx }: { ctx: WorkbenchContext }) {
  const selection = useViewSelection(ctx);
  if (!selection) return null;
  const norm = ctx.norm;
  const { names } = selection;
  return <section aria-label="Business views" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface px-5 py-1.5">
    <span className="text-xs font-semibold text-text-muted">View</span>
    <div role="group" aria-label="Choose a business view" className="flex min-w-0 flex-wrap gap-1">
      {names.map((name) => <button type="button" key={name} aria-pressed={ctx.view === name} onClick={() => ctx.setView(name)}
        className={cn("inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors", ctx.view === name ? "border-current bg-accent-subtle font-bold text-text shadow-sm" : "border-transparent text-text-muted hover:bg-surface-sunken")}
        style={{ borderBottomColor: viewColor(name), borderBottomWidth: 3 }}>
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: viewColor(name) }} />{name}
      </button>)}
    </div>
    <span className="text-xs text-text-muted">{selection.kind === "structure" ? "Define what matters in each view" : "Weights determine the score and priorities"}</span>
    {norm && <Link className="ml-auto text-xs text-accent-text underline" to="/p/$projectId/norms/$normVersionId" params={{ projectId: ctx.projectId, normVersionId: norm.id }} search={{ caseTable: ctx.caseTable?.id, tab: "structure", view: ctx.view }}>Layers in each view</Link>}
  </section>;
}
