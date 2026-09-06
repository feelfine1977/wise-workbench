import { ArrowRight } from "lucide-react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NextStepProps {
  /** The one suggested action, as a verb phrase. */
  label: string;
  /** Why this is the next step, one clause. */
  because: string;
  to?: LinkProps["to"];
  params?: LinkProps["params"];
  search?: LinkProps["search"];
  onClick?: () => void;
  className?: string;
}

/** The next best action (UX-21): one suggested step with its reason, on every screen. */
export function NextStep({ label, because, to, params, search, onClick, className }: NextStepProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-border bg-surface px-4 py-3", className)} data-testid="next-step">
      <span className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">Next step</span>
      {to ? (
        <Button asChild>
          <Link to={to} params={params} search={search}>
            {label}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      ) : (
        <Button onClick={onClick}>
          {label}
          <ArrowRight aria-hidden />
        </Button>
      )}
      <span className="reading text-sm text-text-muted">because {because}</span>
    </div>
  );
}
