import { ArrowLeft } from "lucide-react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useVocabulary } from "@/components/Term";
import { originState, returnTarget, screenLabel, useNavStore } from "@/lib/stores/nav";
import { cn } from "@/lib/utils";

/**
 * "← Back to …" as the first element of a sub-screen's header: returns to the exact place the reader came
 * from (the last location on another screen, search params included) and cuts the navigation stack back to
 * it, so the control on the origin still names its own origin. When the origin is the ranked list the label
 * carries the state it restores: "Back to Where is it worst? (page 1, widespread only)". `fallback` is used
 * when nothing was visited yet (a deep link, a reload). `Alt+←` presses the same control.
 */
export function BackControl({ fallback, className }: { fallback?: { href: string; label: string }; className?: string }) {
  const router = useRouter();
  const { vocabulary } = useVocabulary();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visited = useNavStore((s) => s.visited);
  const popTo = useNavStore((s) => s.popTo);
  const target = returnTarget(visited, pathname);
  const href = target?.href ?? fallback?.href;
  const label = target ? `${screenLabel(target.pathname, vocabulary === "plain")}${originState(target.href)}` : fallback?.label;
  if (!href) return null;
  return (
    <button
      type="button"
      data-testid="back-control"
      title="Back (Alt+←)"
      onClick={() => {
        if (target) popTo(target.href);
        router.history.push(href);
      }}
      className={cn("inline-flex items-center gap-1 rounded-sm text-sm text-accent-text hover:underline", className)}
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back to {label}
    </button>
  );
}
