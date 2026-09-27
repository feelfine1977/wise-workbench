import { LABEL_PX, MIN_LABEL_PX, MAX_LABEL_PX, MAX_LABEL_UNITS, labelScreenPx, labelUnitsAt, mapScaleAt, smallLabelUnitsAt } from "@wise/flow";
import { describe, expect, it } from "vitest";
import {
  CELL_WIDTH,
  DETAIL,
  NODE_HEIGHT,
  NODE_WIDTH,
  abstractAt,
  activitiesAt,
  activitiesByCount,
  abstractToActivities,
  clampActivityCount,
  boundsOf,
  drawnNodeBox,
  fittedZoom,
  drawingRoom,
  layersAt,
  laneNameHeightAt,
  readableMaxLevel,
  stretchToFrame,
  withRoom,
  withoutRoutes,
  type Box,
  type LaidOut,
  type Scene,
} from "./frame";

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

describe("activity names at a constant size, whatever the width of the process (R3-06)", () => {
  /** The two zooms cycle 3 measured with the same code: the extract's five activities, and BPIC's six lanes. */
  const EXTRACT_ZOOM = 0.913;
  const BPIC_ZOOM = 0.395;

  it("draws the same number of pixels on both logs, where the old rule drew 11.0 and 4.7", () => {
    // what the library drew before the counter-scale
    expect(LABEL_PX * EXTRACT_ZOOM).toBeCloseTo(10.96, 1);
    expect(LABEL_PX * BPIC_ZOOM).toBeCloseTo(4.74, 1);
    // and what it draws now
    for (const zoom of [EXTRACT_ZOOM, BPIC_ZOOM]) {
      const px = labelScreenPx(labelUnitsAt(zoom), zoom);
      expect(px).toBeGreaterThanOrEqual(MIN_LABEL_PX);
      expect(px).toBeLessThanOrEqual(MAX_LABEL_PX);
    }
    // the two are within a rounding of each other: legibility no longer depends on the number of lanes
    expect(Math.abs(labelScreenPx(labelUnitsAt(EXTRACT_ZOOM), EXTRACT_ZOOM) - labelScreenPx(labelUnitsAt(BPIC_ZOOM), BPIC_ZOOM))).toBeLessThan(0.5);
  });

  it("holds 11 px over the whole range of zooms a fitted map reaches, and never shrinks a large map", () => {
    for (let zoom = 0.18; zoom <= 1.25; zoom += 0.01) {
      expect(labelScreenPx(labelUnitsAt(zoom), zoom)).toBeGreaterThanOrEqual(MIN_LABEL_PX - 1e-9);
    }
    // above zoom 1 the library's own size is already large enough; counter-scaling would only shrink it
    expect(labelUnitsAt(1.25)).toBe(LABEL_PX);
    expect(labelUnitsAt(1)).toBe(LABEL_PX);
    // and it stops at a zoom no fitted map of a readable process reaches
    expect(labelUnitsAt(0.05)).toBe(MAX_LABEL_UNITS);
    expect(labelUnitsAt(0)).toBe(LABEL_PX);
    expect(labelUnitsAt(Number.NaN)).toBe(LABEL_PX);
  });

  it("gives the box the room to hold the counter-scaled name, and shows eighteen characters of it", () => {
    expect(drawnNodeBox(LABEL_PX)).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT, lines: 1 });
    const wide = drawnNodeBox(labelUnitsAt(BPIC_ZOOM));
    expect(wide.height).toBeGreaterThan(NODE_HEIGHT);
    expect(wide.lines).toBeGreaterThan(1);
    // never wider than the cell the layout reserved, or the boxes would touch across
    expect(wide.width).toBeLessThan(CELL_WIDTH - 48);
    // an eighteen-character name is never cut where the drawing leaves the box its room
    for (const zoom of [0.26, 0.34, 0.4, 0.5, 0.7, 0.913]) {
      expect(drawnNodeBox(labelUnitsAt(zoom), [], 18).chars).toBeGreaterThanOrEqual(18);
    }
  });

  it("stops growing where the drawing has no room, so no two boxes ever touch", () => {
    const units = labelUnitsAt(BPIC_ZOOM);
    // two activities 20 units apart across and 56 down — the pair that overlapped on the purchase-to-pay map
    const tight: Box[] = [
      { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT },
      { x: NODE_WIDTH + 20, y: NODE_HEIGHT + 56, width: NODE_WIDTH, height: NODE_HEIGHT },
    ];
    const box = drawnNodeBox(units, tight);
    const grownX = box.width - NODE_WIDTH;
    const grownY = box.height - NODE_HEIGHT;
    // either they stay apart across, or they stay apart down the page — never neither
    expect(grownX < 20 || grownY < 56).toBe(true);
    // and with room on both sides the box takes what it asked for
    const roomy: Box[] = [
      { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT },
      { x: 900, y: 900, width: NODE_WIDTH, height: NODE_HEIGHT },
    ];
    expect(drawnNodeBox(units, roomy).chars).toBeGreaterThanOrEqual(drawnNodeBox(units, tight).chars);
  });

  it("offers the finer levels the counter-scale has made readable", () => {
    const graph = chain(20);
    // before the counter-scale the test was 12 × zoom ≥ 11, which no map of more than four columns passed
    const box = { width: 8 * CELL_WIDTH, height: 500 };
    expect(readableMaxLevel(graph, box)).toBe(DETAIL.length - 1);
    // a frame far too narrow for the process still says so
    expect(readableMaxLevel(chain(60), { width: 2 * CELL_WIDTH, height: 400 })).toBeLessThan(DETAIL.length - 1);
  });
});

describe("every text on the canvas, and the room the drawing needs (P1-4, P1-5)", () => {
  it("draws every secondary text at eleven pixels on the screen, at any zoom", () => {
    // the stage header, the item count, the markers, the path labels and both halves of a badge: 5.3, 8.7,
    // 4.6, 4.2, 3.9 and 3.8 px on the purchase-to-pay log before this
    for (const zoom of [0.2, 0.314, 0.331, 0.38, 0.757, 0.915, 1.0]) {
      expect(labelScreenPx(smallLabelUnitsAt(zoom), zoom)).toBeGreaterThanOrEqual(MIN_LABEL_PX - 1e-9);
    }
    // a map drawn larger than life keeps the library's own size rather than shrinking its text
    expect(smallLabelUnitsAt(2)).toBe(MIN_LABEL_PX);
    expect(mapScaleAt(1)).toBeCloseTo(1, 6);
    expect(mapScaleAt(0.5)).toBeCloseTo(2, 6);
  });

  it("counts the lane, its name and the badge as room around the drawing, never as drawing", () => {
    const room = drawingRoom(0.4, true, 30);
    expect(room.top).toBeGreaterThan(laneNameHeightAt(0.4));
    // the lane's margin below and the room the box grew into are the same room, counted once
    expect(room.bottom).toBe(30);
    const without = drawingRoom(0.4, false, 0);
    expect(without.top).toBeLessThan(room.top);
    const box = withRoom({ x: 0, y: 0, width: 1000, height: 200 }, room);
    expect(box).toEqual({ x: -room.x / 2, y: -room.top, width: 1000 + room.x, height: 200 + room.top + room.bottom });
  });

  it("spreads the drawing to the shape its frame asks of everything drawn, not of the boxes alone", () => {
    // eight activities over 2,700 units and 200 down, in a 1,158 x 586 frame: the drawing has to become
    // about half as tall as it is wide, and the spread moves boxes without making them taller
    const nodes: Record<string, Box> = {};
    for (let i = 0; i < 8; i++) nodes[`a${i}`] = { x: i * 340, y: (i % 3) * 76, width: NODE_WIDTH, height: NODE_HEIGHT };
    const positions: LaidOut = { nodes, groups: {}, edges: {}, bounds: boundsOf(Object.values(nodes)) as Box };
    const frame = { width: 1158, height: 586 };
    const room = drawingRoom(0.4, true, 0);
    const spread = stretchToFrame(positions, positions.bounds, frame, { x: room.x, y: room.top + room.bottom });
    const after = boundsOf(Object.values(spread?.nodes ?? {})) as Box;
    const held = withRoom(after, room) as Box;
    // both sides of the fit bind at once: the drawing fills the frame instead of leaving a band on one axis
    const byWidth = (frame.width * 0.96) / held.width;
    const byHeight = (frame.height * 0.92) / held.height;
    expect(byHeight / byWidth).toBeGreaterThan(0.9);
    expect(byHeight / byWidth).toBeLessThan(1.1);
    // and nothing is ever squeezed
    expect(after.height).toBeGreaterThanOrEqual(positions.bounds.height);
  });

  it("hands the map its paths as curves once the drawing has been spread", () => {
    const positions: LaidOut = {
      nodes: { a: { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT } },
      groups: {},
      edges: { e1: { points: [{ x: 0, y: 0 }, { x: 40, y: -900 }, { x: 80, y: 0 }] } },
      bounds: { x: 0, y: 0, width: 180, height: 48 },
    };
    // the routes belong to the layout the engine chose; spread by ten they describe nothing, and the lanes
    // drawn around them made the fit small
    expect(withoutRoutes(positions)?.edges.e1?.points).toEqual([]);
  });
});


it("reserves multiple lines for full business activity names at ordinary map zoom", () => {
  for (const zoom of [0.5, 0.6, 0.7, 0.9]) {
    const box = drawnNodeBox(labelUnitsAt(zoom));
    expect(box.chars).toBeGreaterThanOrEqual("Create Purchase Order Item".length);
    expect(box.chars).toBeGreaterThanOrEqual("Change Approval for Purchase Order".length);
    expect(box.width).toBeLessThan(CELL_WIDTH);
  }
});


it("retains the common route when a rare cohort produces many repeated transitions", () => {
  const graph = {
    nodes: [{ id: "a", kind: "activity", metrics: { cases: 100 } }, { id: "b", kind: "activity", metrics: { cases: 100 } }],
    edges: [{ id: "common", kind: "follows", source: "a", target: "b", metrics: { cases: 90, count: 90 } }, { id: "repeat", kind: "follows", source: "a", target: "a", metrics: { cases: 1, count: 10000 } }],
  };
  const drawn = abstractAt(graph, 2);
  expect(drawn.edges.map((e) => e.id)).toContain("common");
  expect(DETAIL[2]?.abstraction.edgeMetric).toBe("cases");
});


describe("recorded connections across detail levels", () => {
  it("shows every supplied activity and observed edge at maximum detail, including rare returns and loops", () => {
    const graph: Scene = {
      nodes: [
        { id: "order", kind: "activity", metrics: { cases: 14498 } },
        { id: "confirmation", kind: "activity", metrics: { cases: 741 } },
        { id: "receipt", kind: "activity", metrics: { cases: 13000 } },
        { id: "rare", kind: "activity", metrics: { cases: 1 } },
      ],
      edges: [
        { id: "order-receipt", kind: "follows", source: "order", target: "receipt", metrics: { cases: 12000, count: 13000 } },
        { id: "order-confirmation", kind: "follows", source: "order", target: "confirmation", metrics: { cases: 718, count: 718 } },
        { id: "confirmation-receipt", kind: "follows", source: "confirmation", target: "receipt", metrics: { cases: 637, count: 637 } },
        { id: "receipt-rare", kind: "follows", source: "receipt", target: "rare", metrics: { cases: 1, count: 1 } },
        { id: "rare-return", kind: "follows", source: "rare", target: "order", metrics: { cases: 1, count: 1 } },
        { id: "receipt-loop", kind: "follows", source: "receipt", target: "receipt", metrics: { cases: 1, count: 2 } },
      ],
    };
    const before = structuredClone(graph);
    const full = abstractAt(graph, DETAIL.length - 1);
    expect(activitiesAt(graph, DETAIL.length - 1)).toHaveLength(4);
    expect(full.nodes).toEqual(graph.nodes);
    expect(full.edges).toEqual(graph.edges);
    expect(graph).toEqual(before);
  });

  it("restores real incoming and outgoing connections even when a loop or constraint touches the node", () => {
    const graph: Scene = {
      nodes: ["a", "b", "c"].map((id) => ({ id, kind: "activity", metrics: { cases: 1000 } })),
      edges: [
        { id: "ac", kind: "follows", source: "a", target: "c", metrics: { cases: 1000, count: 1000 } },
        { id: "bb", kind: "follows", source: "b", target: "b", metrics: { cases: 900, count: 9000 } },
        { id: "rule", kind: "constraint", source: "b", target: "c", metrics: {} },
        { id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 120, count: 123 } },
        { id: "bc", kind: "follows", source: "b", target: "c", metrics: { cases: 110, count: 111 } },
      ],
    };
    const coarse = abstractAt(graph, 1);
    expect(coarse.edges).toContain(graph.edges[3]);
    expect(coarse.edges).toContain(graph.edges[4]);
    expect(coarse.edges.find((e) => e.id === "ab")?.metrics).toEqual({ cases: 120, count: 123 });
    expect(coarse.edges.find((e) => e.id === "bc")?.metrics).toEqual({ cases: 110, count: 111 });
  });

  it("does not invent a bridge through an omitted activity or a genuinely isolated node", () => {
    const graph: Scene = {
      nodes: [
        ...["a", "b", "isolated"].map((id) => ({ id, kind: "activity", metrics: { cases: 1000 } })),
        { id: "rare", kind: "activity", metrics: { cases: 1 } },
      ],
      edges: [
        { id: "a-rare", kind: "follows", source: "a", target: "rare", metrics: { cases: 1 } },
        { id: "rare-b", kind: "follows", source: "rare", target: "b", metrics: { cases: 1 } },
      ],
    };
    const coarse = abstractAt(graph, 1);
    expect(coarse.nodes.some((n) => n.id === "rare")).toBe(false);
    expect(coarse.edges).toEqual([]);
    expect(abstractAt(graph, DETAIL.length - 1).edges).toEqual(graph.edges);
  });
});


describe("exact activity counts", () => {
  const graph: Scene = {
    nodes: [
      { id: "start", kind: "event" },
      { id: "b", kind: "activity", group: "stage", metrics: { cases: 100, events: 9000 } },
      { id: "rare", kind: "activity", metrics: { cases: 1, events: 99999 } },
      { id: "a", kind: "activity", group: "stage", metrics: { cases: 100 } },
      { id: "isolated", kind: "activity", metrics: { cases: 0 } },
      { id: "end", kind: "event" },
    ],
    edges: [
      { id: "start-a", kind: "flow", source: "start", target: "a" },
      { id: "a-b", kind: "follows", source: "a", target: "b", metrics: { cases: 1, count: 2 } },
      { id: "a-rare", kind: "follows", source: "a", target: "rare", metrics: { cases: 1 } },
      { id: "rare-b", kind: "follows", source: "rare", target: "b", metrics: { cases: 1 } },
      { id: "loop", kind: "follows", source: "b", target: "b", metrics: { cases: 1, count: 9000 } },
      { id: "b-end", kind: "flow", source: "b", target: "end" },
    ],
    groups: [{ id: "stage", kind: "stage" }],
    overlays: [{ kind: "badge", target: "rare" }, { kind: "arc", target: "rule", payload: { source: "a", target: "rare" } }],
  };
  it("adds exactly one activity in stable case-frequency order, including ties and structural nodes", () => {
    const before = structuredClone(graph);
    const ranking = ["a", "b", "rare", "isolated"];
    for (let count = 1; count <= ranking.length; count++) {
      const ids = activitiesByCount(graph, count);
      expect(ids).toEqual(ranking.slice(0, count));
      expect(activitiesByCount({ ...graph, nodes: [...graph.nodes].reverse() }, count)).toEqual(ids);
      const scene = abstractToActivities(graph, ids);
      expect(scene.nodes.filter((node) => node.kind === "activity")).toHaveLength(count);
      expect(scene.nodes.filter((node) => node.kind === "event")).toHaveLength(2);
      expect(scene.edges.every((edge) => graph.edges.includes(edge))).toBe(true);
    }
    expect(graph).toEqual(before);
  });
  it("retains rare links and loops without projecting paths, and restores the entire graph at maximum", () => {
    const partial = abstractToActivities(graph, activitiesByCount(graph, 2));
    expect(partial.edges.map((edge) => edge.id)).toEqual(["start-a", "a-b", "loop", "b-end"]);
    expect(partial.overlays).toEqual([]);
    expect(partial.groups).toEqual(graph.groups);
    const withoutDirectLink = { ...graph, edges: graph.edges.filter((edge) => edge.id !== "a-b") };
    expect(abstractToActivities(withoutDirectLink, ["a", "b"]).edges.some((edge) => edge.source === "a" && edge.target === "b")).toBe(false);
    expect(abstractToActivities(graph, activitiesByCount(graph, 4))).toBe(graph);
  });
  it("clamps boundaries and handles empty graphs", () => {
    expect([-5, 0, 1, 2.6, 100, NaN, Infinity].map((count) => clampActivityCount(count, 4))).toEqual([1, 1, 1, 3, 4, 1, 1]);
    expect(activitiesByCount({ nodes: [{ id: "start", kind: "event" }], edges: [] }, 99)).toEqual([]);
  });
});
