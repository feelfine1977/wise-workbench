import { ArrowLeft } from "lucide-react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useVocabulary } from "@/components/Term";
import { returnTarget, screenLabel, useNavStore } from "@/lib/stores/nav";
import { cn } from "@/lib/utils";

/**
 * "Back to …" on every sub-screen (R2-O6): returns to the exact place the reader came from (the last
 * location on another screen, search params included). `fallback` is used when nothing was visited yet.
 */
export function BackControl({ fallback, className }: { fallback?: { href: string; label: string }; className?: string }) {
  const router = useRouter();
  const { vocabulary } = useVocabulary();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const visited = useNavStore((s) => s.visited);
  const target = returnTarget(visited, pathname);
  const href = target?.href ?? fallback?.href;
  const label = target ? screenLabel(target.pathname, vocabulary === "plain") : fallback?.label;
  if (!href) return null;
  return (
    <button
      type="button"
      data-testid="back-control"
      onClick={() => router.history.push(href)}
      className={cn("inline-flex items-center gap-1 rounded-sm text-sm text-accent-text hover:underline", className)}
    >
      <ArrowLeft className="size-4" aria-hidden />
      Back to {label}
    </button>
  );
}
