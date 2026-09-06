import { describe, expect, it } from "vitest";
import { fmtBytes, fmtDays, fmtInt, fmtNum, fmtPct, fmtSig } from "./format";

describe("Intl formatting", () => {
  it("formats counts with grouping and no decimals", () => {
    expect(fmtInt(1595923)).toBe("1,595,923");
    expect(fmtInt(undefined)).toBe("–");
  });
  it("formats fixed decimals and significant figures", () => {
    expect(fmtNum(0.18342, 3)).toBe("0.183");
    expect(fmtSig(945.72)).toBe("950");
    expect(fmtSig(0.1834)).toBe("0.18");
  });
  it("formats shares as percentages", () => {
    expect(fmtPct(0.18)).toBe("18%");
    expect(fmtPct(0.4812, 1)).toBe("48.1%");
  });
  it("formats durations and bytes", () => {
    expect(fmtDays(3.5)).toBe("3.5 d");
    expect(fmtDays(0.5)).toBe("12.0 h");
    expect(fmtBytes(1536)).toBe("1.5 KB");
  });
});
