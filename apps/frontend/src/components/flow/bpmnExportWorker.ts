/** Generate BPMN outside the UI thread; the host cancels obsolete scenes. */
import { exportBpmn } from "@wise/flow/bpmn";
import type { FlowGraph } from "@wise/flow";

self.onmessage = async (event: MessageEvent<FlowGraph>) => {
  try {
    const { xml } = await exportBpmn(event.data);
    self.postMessage({ xml });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "The BPMN layout could not be generated." });
  }
};
