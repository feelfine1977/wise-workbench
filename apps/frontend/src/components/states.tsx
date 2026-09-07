import type { ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Empty state with a next best action and one alternative (UX-21). */
export function EmptyState({
  title,
  reason,
  action,
  alternative,
  className,
}: {
  title: string;
  reason: string;
  action?: { label: string; to?: LinkProps["to"]; params?: LinkProps["params"]; search?: LinkProps["search"]; onClick?: () => void; why?: string };
  alternative?: { label: string; to?: LinkProps["to"]; params?: LinkProps["params"]; search?: LinkProps["search"]; onClick?: () => void };
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("surface flex flex-col items-start gap-3 p-6", className)}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 max-w-prose text-sm text-text-muted">{reason}</p>
      </div>
      {action && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-text-subtle">{t("empty.nextStep")}</span>
          {action.to ? (
            <Button asChild>
              <Link to={action.to} params={action.params} search={action.search}>
                {action.label}
              </Link>
            </Button>
          ) : (
            <Button onClick={action.onClick}>{action.label}</Button>
          )}
          {action.why && <span className="text-xs text-text-subtle">{action.why}</span>}
        </div>
      )}
      {alternative && (
        <div className="text-sm text-text-muted">
          {t("empty.alternative")}{" "}
          {alternative.to ? (
            <Link className="text-accent-text underline" to={alternative.to} params={alternative.params} search={alternative.search}>
              {alternative.label}
            </Link>
          ) : (
            <button type="button" className="text-accent-text underline" onClick={alternative.onClick}>
              {alternative.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function LoadingBlock({ rows = 4, className }: { rows?: number; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-col gap-2", className)} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{t("app.loading")}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

/**
 * What went wrong, in the reader's words (R3-12).
 *
 * A screen that prints `422: unknown clause kind` has told the reader nothing they can act on, and a screen
 * that keeps its skeleton has told them less. Every failure that ends a screen gets one sentence and one way
 * out; the server's own detail and its status stay behind *what the server said*, for the person who wants
 * them. The sentences are keyed on what the reader did, not on the number: a filter in the address that this
 * run does not understand is the case §7.5 found, and it is the first one here.
 */
export function errorReading(error: unknown): { sentence: string; detail?: string; kind: "filter" | "missing" | "refused" | "unreachable" } {
  if (error instanceof ApiError) {
    const detail = error.problem?.detail ?? error.message;
    const code = error.problem?.code ?? "";
    if (error.status === 422 && /filter|clause/i.test(`${code} ${detail}`)) {
      return { sentence: "This link carries a filter this run does not understand.", detail, kind: "filter" };
    }
    if (error.status === 404) return { sentence: "This is not in the workspace any more.", detail, kind: "missing" };
    if (error.status === 422 || error.status === 409) return { sentence: "The workbench could not answer this request as it was asked.", detail, kind: "refused" };
    if (error.status >= 500) return { sentence: "The workbench could not answer just now.", detail, kind: "unreachable" };
    return { sentence: "The workbench could not answer this request.", detail, kind: "refused" };
  }
  return { sentence: "The workbench could not be reached just now.", detail: error instanceof Error ? error.message : String(error), kind: "unreachable" };
}

/**
 * A failure that ends: one sentence, one way out, and the server's own words behind a disclosure. `action`
 * is the way out the screen knows about — *open the run without the filter* on a screen whose address
 * carries one; without it the block offers to try again, which is the way out of a failure that may pass.
 */
export function ErrorBlock({
  error,
  retry,
  action,
  className,
}: {
  error: unknown;
  retry?: () => void;
  action?: { label: string; onClick?: () => void; to?: LinkProps["to"]; params?: LinkProps["params"]; search?: LinkProps["search"] };
  className?: string;
}) {
  const { t } = useTranslation();
  const reading = errorReading(error);
  return (
    <div role="alert" className={cn("rounded-md border border-danger/40 bg-danger-subtle p-3 text-sm", className)} data-error-kind={reading.kind}>
      <p className="reading font-medium text-text" data-testid="error-sentence">
        {reading.sentence}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {action &&
          (action.to ? (
            <Button asChild size="sm">
              <Link to={action.to} params={action.params} search={action.search}>
                {action.label}
              </Link>
            </Button>
          ) : (
            <Button size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        {retry && reading.kind !== "filter" && (
          <Button variant="outline" size="sm" onClick={retry}>
            {t("app.retry")}
          </Button>
        )}
      </div>
      {reading.detail && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-text-muted">what the server said</summary>
          <p className="mt-1 font-mono text-xs text-text-muted">{reading.detail}</p>
        </details>
      )}
    </div>
  );
}

/** Renders loading / error / content for a query result. */
export function QueryState<T>({
  query,
  children,
  rows,
  className,
}: {
  query: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  children: (data: T) => ReactNode;
  rows?: number;
  className?: string;
}) {
  if (query.isPending) return <LoadingBlock rows={rows} className={className} />;
  if (query.isError) return <ErrorBlock error={query.error} retry={() => void query.refetch()} className={className} />;
  return <>{children(query.data as T)}</>;
}
