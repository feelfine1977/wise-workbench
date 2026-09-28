import type { CaseTable } from "@wise/api-schema";

/** Counts refer to recorded checks; absent details must never imply a pass. */
export function summarizeReadiness(readiness: CaseTable["readiness"]) {
  const failures = (readiness?.items ?? []).filter(item => item.level === "fail").length;
  const warnings = (readiness?.items ?? []).filter(item => item.level === "warn").length;
  const total = failures + warnings;
  const hasIssues = total > 0 || readiness?.status === "fail" || readiness?.status === "warn";
  const counts = `${failures} blocking ${failures === 1 ? "issue" : "issues"} · ${warnings} ${warnings === 1 ? "warning" : "warnings"}`;
  const incomplete = (readiness?.status === "fail" && failures === 0) || (readiness?.status === "warn" && warnings === 0 && failures === 0);
  const label = incomplete
    ? `${readiness?.status === "fail" ? "Blocking checks" : "Warnings"} reported · details unavailable${total ? ` (${counts} listed)` : ""}`
    : total ? counts : readiness?.status === "pass" ? "Checks passed" : "Checks unavailable";
  return { failures, warnings, total, label, hasIssues };
}
