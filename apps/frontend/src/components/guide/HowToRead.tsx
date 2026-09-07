import { HelpCircle, X } from "lucide-react";
import type { ReactNode } from "react";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

/**
 * "How to read this": one paragraph per screen, collapsed by default, opened from the ? beside the title
 * (`HowToReadToggle` with the same id) and closed again with ×. A plain surface with an accent left border,
 * no tinted background.
 */
export function HowToRead({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const open = useUiStore((s) => s.howToReadOpen[id] ?? false);
  const guided = useUiStore((s) => s.mode === "guided");
  const set = useUiStore((s) => s.setHowToRead);
  // guided mode is explanations on (R3-10): the paragraph opens with the screen rather than on a click
  if (!open && !guided) return null;
  return (
    <aside id={`how-to-read-${id}`} aria-label="How to read this" className={cn("reading relative rounded-md border border-border border-l-[3px] border-l-accent bg-surface px-4 py-3 pr-10 text-sm leading-6 text-text", className)} data-testid="how-to-read">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-subtle">How to read this</p>
      <div>{children}</div>
      {!guided && (
        <button type="button" aria-label="Close the how-to-read paragraph" onClick={() => set(id, false)} className="absolute right-2 top-2 rounded-sm p-1 text-text-muted hover:bg-surface-sunken hover:text-text">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </aside>
  );
}

/** The ? beside a title that opens the paragraph. */
export function HowToReadToggle({ id, className }: { id: string; className?: string }) {
  const open = useUiStore((s) => s.howToReadOpen[id] ?? false);
  const set = useUiStore((s) => s.setHowToRead);
  return (
    <button
      type="button"
      aria-label={open ? "Hide how to read this screen" : "Show how to read this screen"}
      aria-expanded={open}
      aria-controls={`how-to-read-${id}`}
      onClick={() => set(id, !open)}
      className={cn("inline-flex size-6 items-center justify-center rounded-full text-text-subtle hover:bg-surface-sunken hover:text-accent-text", className)}
    >
      <HelpCircle className="size-4" aria-hidden />
    </button>
  );
}
