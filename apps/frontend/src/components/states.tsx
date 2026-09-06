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

export function ErrorBlock({ error, retry, className }: { error: unknown; retry?: () => void; className?: string }) {
  const { t } = useTranslation();
  const message = error instanceof ApiError ? `${error.status}: ${error.problem?.detail ?? error.message}` : error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className={cn("rounded-md border border-danger/40 bg-danger-subtle p-3 text-sm", className)}>
      <p className="font-semibold text-danger">{t("app.error")}</p>
      <p className="mt-1 font-mono text-xs text-text">{message}</p>
      {retry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={retry}>
          {t("app.retry")}
        </Button>
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
