import { expect, it } from "vitest";
import { penaltyAt } from "./penaltyCurve";

it("shows the finite-value ramp and sharp boundaries in both directions", () => {
  expect([8, 10, 15, 20, 30, 40].map(value => penaltyAt(value, 10, 20))).toEqual([0, 0, .25, .5, 1, 1]);
  expect([5, 10, 15].map(value => penaltyAt(value, 10, 5, true))).toEqual([1, 0, 0]);
  expect([9, 10, 11].map(value => penaltyAt(value, 10, 0))).toEqual([0, 0, 1]);
  expect(penaltyAt(3, 2, .5)).toBe(1);
});
