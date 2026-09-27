import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ErrorBlock, LoadingBlock } from "@/components/states";
import { variantsQuery, type VariantsParams } from "@/lib/api/variants";
import { traceQuery } from "@/lib/queries";
import { useRunConstraintNames } from "@/lib/useRunConstraintNames";
import { fmtInt } from "@/lib/format";
import { TraceTimeline } from "@/routes/slice/TraceTimeline";

interface Props extends VariantsParams {
  projectId: string;
  runId: string;
}

// Avoid rounding partial coverage up to "100%".
const percent = (share: number) => `${share > 0 && share < 0.001 ? "<0.1" : share < 1 ? (share > 0.999 ? ">99.9" : Math.round(share * 1000) / 10) : 100}%`;

export function ProcessVariants({ projectId, runId, ...params }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Common process paths</Button></DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-6xl flex-col">
        <DialogHeader>
          <DialogTitle>Common process paths</DialogTitle>
          <DialogDescription>Complete recorded activity sequences for this run and the current filters, including repeated steps.</DialogDescription>
        </DialogHeader>
        {open && <VariantList key={JSON.stringify([projectId, runId, params])} projectId={projectId} runId={runId} {...params} />}
        <div className="mt-3 flex justify-end"><DialogClose asChild><Button variant="outline" size="sm">Return to analysis</Button></DialogClose></div>
      </DialogContent>
    </Dialog>
  );
}

function VariantList({ projectId, runId, ...params }: Props) {
  const variants = useQuery(variantsQuery(projectId, runId, params));
  const [sample, setSample] = useState<string>();
  const plainOf = useRunConstraintNames(projectId, runId, sample !== undefined);
  const trace = useQuery({ ...traceQuery(projectId, runId, sample ?? ""), enabled: sample !== undefined });

  if (variants.isPending) return <LoadingBlock rows={4} />;
  if (variants.isError) return <ErrorBlock error={variants.error} retry={() => void variants.refetch()} />;
  const data = variants.data;

  return (
    <div className="min-h-0 space-y-4 overflow-auto pr-1">
      <div className={sample ? "sr-only" : "space-y-1 text-sm"}>
        <p className="font-medium" role="status">
          Showing {fmtInt(data.variants.length)} of {fmtInt(data.totalVariants)} paths · {fmtInt(data.coveredCount)} of {fmtInt(data.totalSelectedCases)} selected cases ({percent(data.coverage)} coverage).
        </p>
        <p className="text-text-muted">{fmtInt(data.excludedZeroEventCases)} selected cases have no events and are excluded from paths; shares still use all selected cases.</p>
        <details className="text-xs text-text-muted">
          <summary className="cursor-pointer">How paths and durations are counted</summary>
          <p className="mt-1">{data.ordering}</p>
          <p className="mt-1">{data.durationDescription}</p>
        </details>
      </div>
      {data.variants.length === 0 && <p>{data.totalSelectedCases === 0 ? "No cases match this selection." : "No event sequences are available for the selected cases."}</p>}
      {sample !== undefined ? (
        <section aria-label={`Sample trace ${sample}`} className="space-y-3">
          <Button variant="outline" size="sm" onClick={() => setSample(undefined)}>Back to common paths</Button>
          {trace.isPending && <LoadingBlock rows={4} />}
          {trace.isError && <ErrorBlock error={trace.error} retry={() => void trace.refetch()} />}
          {trace.isSuccess && <TraceTimeline trace={trace.data} plainOf={plainOf} />}
        </section>
      ) : (
        <ol aria-label="Most common exact paths" className="space-y-3">
          {data.variants.map((variant, i) => (
            <li key={variant.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <h3 className="font-semibold">Path {i + 1}</h3>
                <span className="tnum">{fmtInt(variant.count)} cases · {percent(variant.share)} of selected cases</span>
              </div>
              <p className="my-3 flex flex-wrap items-center gap-y-2 break-words text-sm" aria-label={`Path ${i + 1} activity sequence`}>
                {variant.activities.map((activity, step) => <span key={step}>{step > 0 && <span aria-hidden="true" className="px-1 text-text-subtle">→</span>}<span className="inline-block rounded-md border border-border bg-surface-sunken px-2 py-1">{activity ?? "(missing activity)"}</span></span>)}
              </p>
              <p className="text-xs text-text-muted">
                Median first-to-last span: {variant.medianDurationHours === null ? "unavailable" : `${(variant.medianDurationHours >= 24 ? variant.medianDurationHours / 24 : variant.medianDurationHours).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${variant.medianDurationHours >= 24 ? "days" : "hours"}`} · {fmtInt(variant.durationCases)} of {fmtInt(variant.count)} cases with complete timestamps.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {variant.exampleCaseIds.map((caseId) => <Button key={caseId} variant="outline" size="sm" onClick={() => setSample(caseId)}>Open sample {caseId}</Button>)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
