import { describe, expect, it } from "vitest";
import type { Distribution } from "@wise/api-schema";
import { ecdfAt, lensStats, violation } from "./lens";

const uniform: Distribution = {
  unit: "days",
  bins: Array.from({ length: 10 }, (_, i) => ({ x0: i * 10, x1: (i + 1) * 10, n: 100 })),
  ecdf: Array.from({ length: 11 }, (_, i) => [i * 10, i / 10]),
  threshold: 30,
  width: 20,
};

describe("distribution lens statistics", () => {
  it("interpolates the ECDF linearly", () => {
    expect(ecdfAt(uniform.ecdf, 0)).toBe(0);
    expect(ecdfAt(uniform.ecdf, 25)).toBeCloseTo(0.25, 10);
    expect(ecdfAt(uniform.ecdf, 100)).toBe(1);
    expect(ecdfAt(uniform.ecdf, 500)).toBe(1);
  });
  it("clips the soft violation to [0, 1]", () => {
    expect(violation(20, 30, 20)).toBe(0);
    expect(violation(40, 30, 20)).toBeCloseTo(0.5);
    expect(violation(90, 30, 20)).toBe(1);
    expect(violation(10, 30, 20, "low")).toBe(1);
  });
  it("computes live shares from the ECDF and the mean violation from bins", () => {
    const s = lensStats(uniform, 30, 20);
    expect(s.n).toBe(1000);
    expect(s.shareViolating).toBeCloseTo(0.7, 10);
    expect(s.shareFull).toBeCloseTo(0.5, 10);
    // bins with mids 35 and 45 contribute 0.25 and 0.75; five bins beyond 50 contribute 1 each
    expect(s.meanViolation).toBeCloseTo((0.25 + 0.75 + 5) / 10, 10);
  });
  it("moving the threshold changes the share monotonically", () => {
    const a = lensStats(uniform, 30, 20).shareViolating;
    const b = lensStats(uniform, 60, 20).shareViolating;
    expect(b).toBeLessThan(a);
  });
});


it("uses exact saved shares over finite observations, not a compressed curve or only visible bins", () => {
  const dist: Distribution = { ...uniform, threshold: 12, width: 20, stats: { n: 4, shareBeyondThreshold: 0.25, shareBeyondSaturation: 0, ecdfAtThreshold: 0.75 }, bins: [{ x0: 0, x1: 10, n: 3 }], beyond: { n: 1, x0: 10, x1: 25, share: 0.25 }, ecdf: [[5, 0], [25, 1]] };
  const saved = lensStats(dist, 12, 20);
  expect(saved.n).toBe(4);
  expect(saved.shareViolating).toBe(0.25);
  expect(saved.shareFull).toBe(0);
  expect(saved.shareIsExact).toBe(true);
  expect(saved.cdfAtThreshold).toBe(0.75);
  const exploring = lensStats(dist, 13, 20);
  expect(exploring.shareIsExact).toBe(false);
  expect(exploring.shareViolating).not.toBe(saved.shareViolating);
});

it("keeps strict low-direction saved counts exact even for tied observations", () => {
  const dist: Distribution = { threshold: 10, width: 2, direction: "low", bins: [{ x0: 9, x1: 11, n: 3 }], ecdf: [[10, 0], [10, 1]], stats: { n: 3, shareBeyondThreshold: 0, shareBeyondSaturation: 0 } };
  expect(lensStats(dist, 10, 2, "low").shareViolating).toBe(0);
  expect(lensStats(dist, 10, 2, "high").shareIsExact).toBe(false);
  expect(lensStats(dist, 10, 3, "low").fullShareIsExact).toBe(false);
});
