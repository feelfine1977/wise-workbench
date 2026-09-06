import { describe, expect, it } from "vitest";
import { buildBacklog } from "./fixtures/backlog";
import { buildSlice } from "./fixtures/slice";
import { buildTrace } from "./fixtures/trace";

describe("worst cases and traces agree", () => {
  it("every constraint listed for a worst case is marked on an event of its trace", () => {
    const { rows, globalMean } = buildBacklog("case Vendor", "Finance", 50, 20);
    const detail = buildSlice(rows[0]!, "case Vendor", "Finance", globalMean);
    for (const w of detail.worstCases ?? []) {
      const trace = buildTrace(w.caseId as string);
      const marked = new Set((trace.events ?? []).flatMap((e) => e.violates ?? []));
      for (const c of w.violated ?? []) expect(marked.has(c), `${w.caseId} ${c}`).toBe(true);
      expect((w.violated ?? []).length).toBeGreaterThan(0);
    }
  });
});
