/**
 * The `Model` rendering of the flow (§3.9): the same scene as a BPMN diagram through the flow library's
 * `BpmnView`, with the same overlays, the same selection and the stages as lanes in the same order as the
 * map's bands. The diagram is generated from the log at the current detail level when the project has no
 * model of its own; a chip says so. Loaded on demand, because bpmn-js is large.
 */
import { useEffect, useMemo, useState } from "react";
import type { FlowGraph } from "@wise/api-schema";
import { liteFromGraph } from "@wise/flow/bpmn";
import type { FlowGraph as LibraryGraph, Overlay } from "@wise/flow";
import { BpmnView } from "@wise/flow/react";
import "@wise/flow/bpmn.css";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ModelViewProps {
  /** The scene already in the library's model (the same object the map draws). */
  scene: LibraryGraph;
  /** The detail level of the map, so the diagram shows the same activities. */
  abstraction?: { minNodeShare?: number; minEdgeShare?: number; keepConnected?: boolean; collapse?: "all" };
  overlays?: Overlay[];
  /** The activity selected on the map; the same element stays selected here and is scrolled into view. */
  selected?: string;
  onSelect?: (activityId: string | undefined) => void;
  height: number;
  /** The graph as the contract serves it, for the list of activities without a task. */
  graph: FlowGraph;
  className?: string;
}

export default function ModelView({ scene, abstraction, overlays, selected, onSelect, height, graph, className }: ModelViewProps) {
  const [error, setError] = useState<Error>();
  const lite = useMemo(() => {
    try {
      return liteFromGraph(scene, { abstraction, lanes: "groups", selfLoops: "marker" });
    } catch (e) {
      setError(e as Error);
      return undefined;
    }
  }, [scene, abstraction]);

  // activities of the scene that no task in the diagram carries (§3.9)
  const unmapped = useMemo(() => {
    if (!lite) return [];
    const tasks = new Set(lite.nodes.map((n) => n.id));
    return graph.nodes.filter((n) => n.kind === "activity" && !tasks.has(n.id)).map((n) => n.label);
  }, [lite, graph]);

  useEffect(() => setError(undefined), [scene]);

  if (error || !lite) {
    return (
      <div className={cn("flex flex-col gap-2 p-4 text-sm", className)} role="alert" style={{ height }}>
        <p className="font-medium">This process cannot be drawn as a model.</p>
        <p className="text-text-muted">{error?.message ?? "The diagram could not be generated from the log."}</p>
        <Button variant="outline" size="sm" onClick={() => onSelect?.(undefined)}>
          Back to the map
        </Button>
      </div>
    );
  }

  return (
    // The host hides the editing palette; bpmn-js attribution remains visible.
    <div className={cn("wise-model flex h-full min-w-0 flex-col", className)} data-testid="model-view">
      <BpmnView
        graph={lite}
        overlays={overlays}
        locale="en"
        controls={false}
        legend={false}
        selection={{ tasks: selected ? [selected] : [], flows: [], lanes: [] }}
        onSelect={(s) => onSelect?.(s.tasks[0])}
        onError={setError}
        ariaLabel="The same process as a BPMN model, with the same expectations drawn on it"
        containerStyle={{ height: "100%" }}
        className="min-h-0 flex-1"
      />
      <p className="border-t border-border px-3 py-1.5 text-xs text-text-subtle" data-testid="model-note">
        <span className="mr-2 rounded-full border border-border px-2 py-0.5">model from the log · generated</span>
        {unmapped.length > 0
          ? `${unmapped.length} ${unmapped.length === 1 ? "activity has" : "activities have"} no task in the model: ${unmapped.slice(0, 3).join(", ")}${unmapped.length > 3 ? ", …" : ""}.`
          : "Every activity of this scene has a task in the model."}{" "}
        The overlays show missed expectations, not conformance.
      </p>
    </div>
  );
}
