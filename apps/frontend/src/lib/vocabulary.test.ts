import { describe, expect, it } from "vitest";
import { KINDS, STABILITIES, TERMS, confidenceOf, definition, kindGlyph, kindLabel, kindOf, kindReading, label, rankingRule, secondary, stabilityLabel } from "./vocabulary";

describe("vocabulary: the plain-language layer", () => {
  it("holds the panel's translation table with plain label, method term and definition", () => {
    const ids = new Set(TERMS.map((t) => t.id));
    for (const id of ["slice", "constraint", "layer", "view", "violation_share", "score", "gap", "stable_gap", "PI", "stable_PI", "gamma", "kind_acute", "kind_systematic", "kind_widespread", "stability_stable", "stability_fragile", "stability_insufficient_support", "dominant_layer", "driver", "contribution", "applicability", "in_scope", "censoring", "replication", "headroom", "readiness"]) {
      expect(ids.has(id), id).toBe(true);
    }
    for (const t of TERMS) {
      expect(t.plain.length).toBeGreaterThan(0);
      expect(t.method.length).toBeGreaterThan(0);
      expect(t.definition.length).toBeGreaterThan(10);
    }
    expect(new Set(TERMS.map((t) => t.id)).size).toBe(TERMS.length);
  });

  it("puts the plain label first by default and the method term first when switched", () => {
    expect(label("slice")).toBe("group");
    expect(label("slice", "method")).toBe("slice");
    expect(secondary("slice")).toBe("slice");
    expect(secondary("slice", "method")).toBe("group");
    expect(label("dominant_layer")).toBe("most-missed expectation area");
    expect(label("stable_PI")).toBe("priority, small groups discounted");
    expect(label("stable_PI", "method")).toBe("stable PI");
    expect(definition("gap")).toBe("how far the group's average is below the overall average");
    expect(label("nope")).toBe("nope");
    expect(secondary("nope")).toBeUndefined();
  });

  it("maps the method's hotspot types onto the kinds of problem and back", () => {
    expect(kindOf({ hotspot_type: "severity" })).toBe("acute");
    expect(kindOf({ hotspot_type: "mechanism" })).toBe("systematic");
    expect(kindOf({ hotspot_type: "reservoir" })).toBe("widespread");
    expect(kindOf({ kind: "acute", hotspot_type: "reservoir" })).toBe("acute");
    expect(kindOf({ hotspot_type: null })).toBeUndefined();
    expect(kindOf(undefined)).toBeUndefined();
    for (const kind of KINDS) {
      expect(kindGlyph[kind]).toMatch(/[▲◆●]/);
      expect(kindReading(kind).length).toBeGreaterThan(5);
      expect(kindLabel(kind, "plain")).toBe(kind);
    }
    expect(kindLabel("acute", "method")).toBe("severity");
    expect(kindReading("widespread")).toBe("many cases, slightly off");
  });

  it("translates stability into confidence words", () => {
    expect(confidenceOf("stable")).toBe("high");
    expect(confidenceOf("fragile")).toBe("medium");
    expect(confidenceOf("insufficient_support")).toBe("not enough cases to be sure");
    expect(confidenceOf(undefined)).toBe("not computed");
    expect(stabilityLabel("insufficient_support", "method")).toBe("insufficient support");
    expect(STABILITIES).toHaveLength(4);
  });

  it("states the ranking rule in one sentence in both vocabularies", () => {
    expect(rankingRule("plain", 20)).toBe("Ranked by how many cases × how far below expectation, with small groups discounted (γ = 20).");
    expect(rankingRule("method", 20)).toContain("stable PI");
  });
});
