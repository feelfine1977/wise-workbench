import { Link } from "@tanstack/react-router";
import type { Readiness } from "@wise/api-schema";
import { Alert } from "@/components/ui/misc";
import { GateBadge } from "./badges";

/** Readiness banner (S1): shown on the data screen and on every screen afterwards while items are open. */
export function ReadinessBanner({ readiness, projectId, datasetId, compact }: { readiness: Readiness | null | undefined; projectId: string; datasetId?: string; compact?: boolean }) {
  if (!readiness || !readiness.status) return null;
  const items = readiness.items ?? [];
  const warns = items.filter((i) => i.level === "warn");
  const fails = items.filter((i) => i.level === "fail");
  const level = readiness.status === "fail" ? "fail" : readiness.status === "warn" ? "warn" : "success";
  const title =
    readiness.status === "pass"
      ? "Data readiness: no blocking issue"
      : readiness.status === "warn"
        ? `Data readiness: ${warns.length} caveat${warns.length === 1 ? "" : "s"} travel with every result`
        : `Data readiness: ${fails.length} blocking issue${fails.length === 1 ? "" : "s"}`;
  void datasetId;
  if (compact) {
    return (
      <Alert level={level} className="rounded-none border-x-0 border-t-0 py-1.5">
        <span className="text-sm">
          {title}
          {datasetId && (
            <>
              {" · "}
              <Link className="text-accent-text underline" to="/p/$projectId/data/$datasetId" params={{ projectId, datasetId }}>
                open report
              </Link>
            </>
          )}
        </span>
      </Alert>
    );
  }
  return (
    <Alert level={level} title={title}>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.id} className="flex items-start gap-2 text-sm">
            <GateBadge state={it.level === "fail" ? "failed" : it.level === "warn" ? "pending" : "passed"} label={it.level} className="mt-0.5" />
            <span>
              {it.message}
              {it.evidence && Object.keys(it.evidence).length > 0 && (
                <span className="ml-2 font-mono text-xs text-text-muted">
                  {Object.entries(it.evidence)
                    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                    .join(" · ")}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
