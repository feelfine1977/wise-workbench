import { HelpCircle } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
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
  const set = useUiStore((s) => s.setHowToRead);
  return (
    <Sheet modal={false} open={open} onOpenChange={value => set(id, value)}>
      <SheetContent id={`how-to-read-${id}`} className={cn("overflow-y-auto p-6 text-sm leading-6", className)} data-testid="how-to-read"
        onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLElement>(`[data-how-to-read="${id}"]`)?.focus(); }}>
        <SheetTitle className="text-xl font-semibold">How to read this screen</SheetTitle>
        <SheetDescription className="mt-2 text-sm text-text-muted">Definitions, evidence and interpretation.</SheetDescription>
        <div className="mt-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** The ? beside a title that opens the paragraph. */
export function HowToReadToggle({ id, className }: { id: string; className?: string }) {
  const open = useUiStore((s) => s.howToReadOpen[id] ?? false);
  const set = useUiStore((s) => s.setHowToRead);
  return (
    <button
      type="button"
      data-how-to-read={id}
      aria-label={open ? "Hide how to read this screen" : "Show how to read this screen"}
      aria-expanded={open}
      aria-controls={`how-to-read-${id}`}
      onClick={() => set(id, !open)}
      className={cn("inline-flex min-h-8 items-center justify-center gap-1 rounded px-2 text-xs font-medium text-text-subtle hover:bg-surface-sunken hover:text-accent-text", className)}
    >
      <HelpCircle className="size-4" aria-hidden />
      <span aria-hidden="true">How to read</span>
    </button>
  );
}
