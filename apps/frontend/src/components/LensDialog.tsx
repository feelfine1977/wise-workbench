/**
 * The distribution lens over the map or the board (§3.6 *Distribution*, R3-O10): one expectation in real
 * units with its line and its tolerance band, opened from an activity or a bar without leaving the screen.
 * It has the same full-window control as the map, and `Escape` leaves — the lens was the second place the
 * owner could not make larger.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Maximize2, Minimize2 } from "lucide-react";
import { DistributionLens } from "@/components/DistributionLens";
import { ErrorBlock, LoadingBlock } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { distributionQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function LensDialog({
  projectId,
  runId,
  constraintId,
  title,
  slicing,
  sliceKey,
  onClose,
  onOpenNorm,
}: {
  projectId: string;
  runId: string;
  constraintId: string | undefined;
  title: string;
  slicing?: string;
  sliceKey?: string;
  onClose: () => void;
  onOpenNorm?: (constraintId: string) => void;
}) {
  const [full, setFull] = useState(false);
  const dist = useQuery({ ...distributionQuery(projectId, runId, constraintId ?? "", slicing, sliceKey), enabled: !!constraintId });
  const rest = useQuery({ ...distributionQuery(projectId, runId, constraintId ?? ""), enabled: !!constraintId && !!sliceKey });
  return (
    <Dialog open={!!constraintId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(full ? "h-[92vh] w-[96vw] max-w-none" : "max-w-3xl")} data-testid="lens-dialog" data-full={full ? "1" : undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{title}</span>
            <Button variant="outline" size="sm" aria-pressed={full} aria-label={full ? "Leave the full window" : "Fill the window with the lens"} onClick={() => setFull((v) => !v)}>
              {full ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
            </Button>
          </DialogTitle>
          <DialogDescription>How far the items are from this expectation, against everyone else. Escape closes.</DialogDescription>
        </DialogHeader>
        {dist.isPending && <LoadingBlock rows={5} />}
        {dist.isError && <ErrorBlock error={dist.error} retry={() => void dist.refetch()} />}
        {dist.data && (
          <DistributionLens
            distribution={dist.data}
            rest={rest.data}
            constraintId={constraintId}
            mode="plain"
            sliders="never"
            height={full ? Math.round(window.innerHeight * 0.6) : 320}
          />
        )}
        {constraintId && onOpenNorm && (
          <button type="button" className="mt-2 self-start text-sm text-accent-text underline" onClick={() => onOpenNorm(constraintId)}>
            Open this expectation in the norm →
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
