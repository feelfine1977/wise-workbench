import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import "@/lib/i18n";
import { server } from "@/mocks/node";
import { resetDb } from "@/mocks/db";

// jsdom lacks a few browser APIs the shell relies on.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false });
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!window.HTMLElement.prototype.hasPointerCapture) window.HTMLElement.prototype.hasPointerCapture = () => false;
if (!window.HTMLElement.prototype.releasePointerCapture) window.HTMLElement.prototype.releasePointerCapture = () => {};
if (!window.HTMLElement.prototype.scrollTo) window.HTMLElement.prototype.scrollTo = () => {};
window.scrollTo = () => {};
// jsdom's selector engine (nwsapi) evaluates the top-layer pseudo-classes by walking the whole
// document; with an open Radix popover that costs ~10 s per query. The app never relies on them.
{
  const nativeMatches = Element.prototype.matches;
  const TOP_LAYER = /:(modal|fullscreen|popover-open)\b/;
  Element.prototype.matches = function (this: Element, selector: string) {
    if (TOP_LAYER.test(selector)) return false;
    return nativeMatches.call(this, selector);
  };
}
if (typeof (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS === "undefined") {
  (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) };
}

// Canvas-based charts do not render in jsdom: the wrapper becomes an accessible placeholder.
vi.mock("@/components/charts/EChart", async () => {
  const React = await import("react");
  const EChart = React.forwardRef<unknown, { ariaLabel: string; height?: number | string }>(function EChartMock(props, ref) {
    React.useImperativeHandle(ref, () => ({ instance: () => undefined }), []);
    return React.createElement("div", { role: "img", "aria-label": props.ariaLabel, "data-testid": "echart", style: { height: props.height ?? 260 } });
  });
  return { EChart };
});

// The process map (React Flow, ELK in a worker) has no place in jsdom: a labelled placeholder stands in.
vi.mock("@/components/flow/FlowMap", async () => {
  const React = await import("react");
  const FlowMap = (props: { title: string; graph: { nodes: unknown[] } }) => React.createElement("div", { role: "img", "aria-label": props.title, "data-testid": "flow-map" }, `${props.graph.nodes.length} nodes`);
  return { FlowMap, default: FlowMap };
});

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetDb();
  window.localStorage.clear();
});
afterAll(() => server.close());
