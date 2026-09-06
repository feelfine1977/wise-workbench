import { HelpCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

/**
 * "How to read this" (RG-5): one collapsible paragraph per screen, open the first time, closed with ×,
 * reopened from the ? beside the title (`HowToReadToggle` with the same id).
 */
export function HowToRead({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const closed = useUiStore((s) => s.howToReadClosed[id] ?? false);
  const set = useUiStore((s) => s.setHowToRead);
  if (closed) return null;
  return (
    <aside id={`how-to-read-${id}`} aria-label="How to read this" className={cn("reading relative rounded-md border border-info/30 bg-info-subtle px-4 py-3 pr-10 text-sm leading-6 text-text", className)} data-testid="how-to-read">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-info">How to read this</p>
      <div>{children}</div>
      <button type="button" aria-label="Close the how-to-read paragraph" onClick={() => set(id, false)} className="absolute right-2 top-2 rounded-sm p-1 text-text-muted hover:bg-surface hover:text-text">
        <X className="size-4" aria-hidden />
      </button>
    </aside>
  );
}

/** The ? beside a title that reopens the paragraph. */
export function HowToReadToggle({ id, className }: { id: string; className?: string }) {
  const closed = useUiStore((s) => s.howToReadClosed[id] ?? false);
  const set = useUiStore((s) => s.setHowToRead);
  return (
    <button
      type="button"
      aria-label={closed ? "Show how to read this screen" : "Hide how to read this screen"}
      aria-expanded={!closed}
      aria-controls={`how-to-read-${id}`}
      onClick={() => set(id, closed)}
      className={cn("inline-flex size-6 items-center justify-center rounded-full text-text-subtle hover:bg-surface-sunken hover:text-accent-text", className)}
    >
      <HelpCircle className="size-4" aria-hidden />
    </button>
  );
}
