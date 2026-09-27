import type { ReviewItem } from "@/lib/api/review";

const points = (value: number) => (value * 100).toLocaleString(undefined, { maximumFractionDigits: 1, signDisplay: "exceptZero" });

export function HypothesisEvidence({ test }: { test: ReviewItem["test"] }) {
  if (!test) return <p className="text-xs text-text-muted">No computed comparison is available for this hypothesis.</p>;
  const interval = test.interval ?? [];
  const hasInterval = interval.length === 2 && interval.every((x) => typeof x === "number" && Number.isFinite(x));
  const confidence = test.confidence_level;
  const hasMethod = typeof confidence === "number" && confidence > 0 && confidence < 1 && test.interval_method;
  return (
    <div className="mt-2 space-y-1 text-sm" data-testid="hypothesis-evidence">
      {test.reading && <p className="reading">{test.reading}</p>}
      {test.median_reading && <p className="reading text-text-muted">{test.median_reading}</p>}
      {typeof test.risk_difference === "number" && Number.isFinite(test.risk_difference) && (
        <p>Difference in the share missing this constraint: {points(test.risk_difference)} percentage points.</p>
      )}
      {hasInterval && hasMethod ? (
        <p className="text-xs text-text-muted">{(confidence * 100).toLocaleString()}% interval: {points(interval[0]!)} to {points(interval[1]!)} percentage points · {test.interval_method}.</p>
      ) : <p className="text-xs text-text-muted">Interval details are unavailable for this saved hypothesis.</p>}
      {test.n_group != null && test.n_rest != null && (
        <p className="text-xs text-text-muted">Evaluated items: {test.n_group.toLocaleString()} in this group · {test.n_rest.toLocaleString()} in the rest of the run.</p>
      )}
      <p className="text-xs text-text-muted">This is an observed difference. It does not establish its cause.</p>
    </div>
  );
}
