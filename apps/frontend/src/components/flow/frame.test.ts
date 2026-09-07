import { describe, expect, it } from "vitest";
import { CELL_WIDTH, DETAIL, abstractAt, activitiesAt, boundsOf, fittedZoom, layersAt, readableMaxLevel, stretchToFrame, type LaidOut, type Scene } from "./frame";

/** A chain of `n` activities with a start and an end marker, each activity weaker than the one before it. */
function chain(n: number): Scene {
  const nodes = [
    { id: "__start__", kind: "event" },
    ...Array.from({ length: n }, (_, i) => ({ id: `a${i}`, kind: "activity", metrics: { cases: 1000 - i * (900 / n) } })),
    { id: "__end__", kind: "event" },
  ];
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ id: `e${i}`, source: `a${i}`, target: `a${i + 1}`, kind: "follows", metrics: { count: 1000 - i * (900 / n) } }));
  return { nodes, edges, groups: [], overlays: [] };
}

describe("the detail levels of the map (§3.2, §3.4)", () => {
  it("draws fewer activities the coarser the level", () => {
    const graph = chain(20);
    const counts = [1, 2, 3, 4].map((level) => activitiesAt(graph, level).length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0] ?? 0).toBeLessThan(counts[3] ?? 0);
  });

  it("counts the columns a level draws, not its activities: a chain is as wide as it is long", () => {
    expect(layersAt(chain(6), DETAIL.length - 1)).toBe(6 + 2);
  });

  it("offers only levels whose labels still reach 11 px, and says so with the frame it is given", () => {
    const graph = chain(20);
    // a frame wide enough for four columns at full zoom offers a coarse level only
    const narrow = readableMaxLevel(graph, { width: 4 * CELL_WIDTH, height: 500 });
    const wide = readableMaxLevel(graph, { width: 40 * CELL_WIDTH, height: 500 });
    expect(narrow).toBeLessThanOrEqual(wide);
    expect(wide).toBe(DETAIL.length - 1);
    expect(readableMaxLevel(graph, { width: 0, height: 0 })).toBe(DETAIL.length - 1);
  });

  it("applies the level to the graph before it is laid out, keeping the structural nodes and the paths", () => {
    const graph = chain(20);
    const coarse = abstractAt(graph, 1);
    expect(coarse.nodes.length).toBeLessThan(graph.nodes.length);
    expect(coarse.nodes.some((n) => n.id === "__start__")).toBe(true);
    const ids = new Set(coarse.nodes.map((n) => n.id));
    for (const e of coarse.edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
    // every activity keeps at least one path, so the drawing is not a field of loose boxes
    for (const n of coarse.nodes.filter((x) => x.kind === "activity")) {
      expect(coarse.edges.some((e) => e.source === n.id || e.target === n.id)).toBe(true);
    }
  });
});

describe("the fit", () => {
  const box = { width: 1000, height: 400 };

  it("keeps the drawing inside the canvas on all four sides", () => {
    const bounds = { width: 4000, height: 300 };
    const zoom = fittedZoom(bounds, box);
    expect(bounds.width * zoom).toBeLessThanOrEqual(box.width);
    expect(bounds.height * zoom).toBeLessThanOrEqual(box.height);
  });

  it("never zooms past 1.25, so a two-box map is not a wall of text", () => {
    expect(fittedZoom({ width: 10, height: 10 }, box)).toBe(1.25);
  });

  it("stretches a wide drawing to the shape of its frame, so the fit leaves no wide empty band", () => {
    // a drawing wide enough that the fit is not held back by the largest zoom it allows
    const positions: LaidOut = {
      nodes: { a: { x: 0, y: 0, width: 180, height: 48 }, b: { x: 3820, y: 300, width: 180, height: 48 } },
      groups: { g: { x: 0, y: 0, width: 4000, height: 348 } },
      edges: { e: { points: [{ x: 90, y: 24 }, { x: 3910, y: 324 }], labelY: 174 } },
      bounds: { x: 0, y: 0, width: 4000, height: 348 },
    };
    const stretched = stretchToFrame(positions, positions.bounds, box) as LaidOut;
    expect(stretched.bounds.height).toBeGreaterThan(positions.bounds.height);
    // the drawing is now close to the frame's own shape, so the fit fills it in both directions
    const zoom = fittedZoom(stretched.bounds, box);
    const emptyBelow = (box.height - stretched.bounds.height * zoom) / box.height;
    const emptyBeside = (box.width - stretched.bounds.width * zoom) / box.width;
    expect(Math.max(emptyBelow, emptyBeside)).toBeLessThan(0.16);
    // and it only ever spreads: the nodes keep their size and their order
    expect(stretched.nodes.a?.height).toBe(48);
    expect((stretched.nodes.b?.y ?? 0) > (stretched.nodes.a?.y ?? 0)).toBe(true);
    expect(stretched.edges.e?.points[1]?.y).toBeGreaterThan(positions.edges.e?.points[1]?.y ?? 0);
  });

  it("leaves a drawing that is already the frame's shape alone", () => {
    const positions: LaidOut = {
      nodes: { a: { x: 0, y: 0, width: 180, height: 48 } },
      groups: {},
      edges: {},
      bounds: { x: 0, y: 0, width: 1000, height: 400 },
    };
    expect(stretchToFrame(positions, positions.bounds, box)).toBe(positions);
  });

  it("measures the box a set of elements occupies", () => {
    expect(boundsOf([{ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 0, width: 5, height: 5 }])).toEqual({ x: 0, y: 0, width: 40, height: 60 });
    expect(boundsOf([])).toBeUndefined();
  });
});
