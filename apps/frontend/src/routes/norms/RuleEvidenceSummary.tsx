import { useQuery } from "@tanstack/react-query";
import { normPreviewQuery } from "@/lib/api/norms";
import type { ConstraintRelevance } from "@/lib/api/normRelevance";
import { fmtInt } from "@/lib/format";
import type { Constraint } from "./Builder";

/** Scope, policy evaluation and native measurement have different denominators. */
export function RuleEvidenceSummary({ projectId, versionId, caseTableId, selectionId, constraint, relevance, readyForCounts = true }: {
  projectId: string; versionId: string; caseTableId?: string; selectionId?: string;
  constraint: Constraint; relevance?: ConstraintRelevance; readyForCounts?: boolean;
}) {
  const query = useQuery({
    ...normPreviewQuery(projectId, versionId, constraint.id, { caseTableId: caseTableId ?? "", selectionId, constraint: { ...constraint } }),
    staleTime: 30 * 60 * 1000,
    // A numeric rule already loads its distribution; do not compete with that full-log read.
    enabled: !!caseTableId && readyForCounts,
  });
  const result = query.data;
  const exact = result?.normVersionId === versionId && result.caseTableId === caseTableId && result.constraintId === constraint.id
    && (result.scope.selectionId ?? undefined) === selectionId ? result.saved.counts : undefined;
  const count = (n: number | null | undefined) => n == null ? (query.isFetching || !readyForCounts) ? "Checking…" : "Unavailable" : fmtInt(n);
  return <section aria-label="Saved rule evidence" className="my-4">
    <dl className="wise-facts">
      <div className="wise-fact"><dt>In scope</dt><dd>{count(exact?.applicableCases ?? relevance?.casesInScope)}<small>{exact ? `of ${fmtInt(exact.populationCases)} population cases` : "saved applicability conditions"}</small></dd></div>
      <div className="wise-fact"><dt>Evaluated by policy</dt><dd>{count(exact?.evaluatedCases)}<small>includes the missing-data policy</small></dd></div>
      <div className="wise-fact"><dt>{constraint.type === "lag" ? "Measured pairs" : "Measured values"}</dt><dd>{count(exact?.observedCases)}<small>finite native measurements</small></dd></div>
    </dl>
    <p className="mt-2 text-xs text-text-muted">Saved version evidence; counts do not approve the rule.{exact && exact.missingSignalCases != null && exact.missingSignalCases > 0 ? ` ${fmtInt(exact.missingSignalCases)} applicable cases lack a native measurement.` : ""}</p>
    {query.isError && <button type="button" className="mt-1 text-xs text-accent-text underline" onClick={() => void query.refetch()}>Retry evaluation counts</button>}
  </section>;
}
