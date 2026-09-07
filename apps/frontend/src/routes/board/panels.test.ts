import { describe, expect, it } from "vitest";
import type { Kpis, KpiTile } from "@wise/api-schema";
import { filterCount, groupingLabel } from "@/lib/sentences";
import { boardTiles, belowExpectationSentence, tileValue } from "./panels";

const tile = (id: string, label: string, value: number, format: KpiTile["format"], text: string): KpiTile => ({ id, label, value, format, text });

const kpis = {
  tiles: [
    tile("items", "Purchase order items", 251734, "count", "251,734 purchase order items in this selection (all 251,734)."),
    tile("share_below_expectation", "Below expectation", 0.9994518, "share", "99.9 % of the 251,734 scored purchase order items miss at least one expectation."),
    tile("priority_at_stake", "Priority at stake", 1674.9, "index", "1,674.9 priority carried by the 30 groups."),
    tile("open_share", "Still open", 0.1388, "share", "14 % of these purchase order items are still open."),
    tile("mean_score", "Score", 84.4359, "points", "84.4 points on average against 84.4 over the whole run (+0.0)."),
  ],
} as unknown as Kpis;

describe("the board's four tiles (§4.3)", () => {
  it("prints a share with the precision it needs, so 99.945 % never reads 100 %", () => {
    expect(tileValue(kpis.tiles[1] as KpiTile)).toMatch(/^99\.9\d?\s?%$/);
    expect(tileValue({ ...(kpis.tiles[1] as KpiTile), value: 0.5 })).toMatch(/^50\s?%$/);
    expect(tileValue({ ...(kpis.tiles[1] as KpiTile), value: 0.04 })).toMatch(/^4\.0\s?%$/);
    expect(tileValue({ ...(kpis.tiles[1] as KpiTile), value: 0.004 })).toMatch(/^0\.4\d?\s?%$/);
  });

  it("carries the score as the second tile, and no tile reads 100 % on this run", () => {
    const tiles = boardTiles(kpis);
    expect(tiles.map((t) => t.id)).toEqual(["items", "mean_score", "priority_at_stake", "open_share"]);
    expect(tiles[1]?.label).toBe("Average score");
    expect(tiles.map((t) => tileValue(t)).join(" ")).not.toMatch(/100\s?%/);
  });

  it("keeps the share that left the tile's face in the tile's own explanation and in the header", () => {
    const second = boardTiles(kpis)[1];
    expect(second?.text).toContain("miss at least one expectation");
    expect(belowExpectationSentence(kpis)).toContain("99.9 %");
  });

  it("names what the share counts on a backend that serves no score", () => {
    const withoutScore = { tiles: kpis.tiles.filter((t) => t.id !== "mean_score") } as unknown as Kpis;
    const tiles = boardTiles(withoutScore);
    expect(tiles[1]?.label).toBe("Items missing at least one expectation");
    expect(tiles[1]?.label).not.toContain("Below expectation");
  });
});

describe("the board's source line (§4.9)", () => {
  it("reads the grouping in words, without the log's column suffixes", () => {
    expect(groupingLabel("case Company+case Spend area text")).toBe("Company × Spend area");
    expect(groupingLabel(undefined, ["case Company", "case Spend area text"])).toBe("Company × Spend area");
    expect(groupingLabel("case Vendor")).toBe("Vendor");
  });

  it("counts the filters in English", () => {
    expect(filterCount(0)).toBe("no filter");
    expect(filterCount(1)).toBe("1 filter");
    expect(filterCount(3)).toBe("3 filters");
  });
});
