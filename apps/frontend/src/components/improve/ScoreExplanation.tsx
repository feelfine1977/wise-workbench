import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ContributionIcicle } from "./ContributionIcicle";
import { scoreWaterfallData } from "./chartData";
import { ScoreWaterfall, type ScoreWaterfallProps } from "./ScoreWaterfall";

export function ScoreExplanation(props: ScoreWaterfallProps) {
  const [mode, setMode] = useState<"waterfall" | "icicle">("waterfall");
  const exact = scoreWaterfallData(props.drivers, props.baseline, props.groupScore);
  return <div className="min-w-0 space-y-2" data-testid="score-explanation">
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Score explanation chart">
      <Button size="sm" variant={mode === "waterfall" ? "secondary" : "ghost"} aria-pressed={mode === "waterfall"} onClick={() => setMode("waterfall")}>Waterfall · score change</Button>
      <Button size="sm" variant={mode === "icicle" ? "secondary" : "ghost"} aria-pressed={mode === "icicle"} onClick={() => setMode("icicle")}>Icicle · penalty breakdown</Button>
    </div>
    <div hidden={mode !== "waterfall"}><ScoreWaterfall {...props} /></div>
    <div hidden={mode !== "icicle"}><ContributionIcicle drivers={props.drivers} signedGap={exact ? exact.baseline - exact.groupScore : undefined} view={props.view} selected={props.selected} plainOf={props.plainOf} layerNames={props.layerNames} onSelect={props.onSelect} /></div>
  </div>;
}
