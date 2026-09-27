import { expect, it } from "vitest";
import { batchNumericRule, batchValue, batchVersionRequest, evidenceIssue, forEachBatchLimited, signalCoverage, thresholdSettingsIssue, type BatchSignal, type SignalEvidence } from "./normBatchPolicy";
import type { Constraint } from "./Builder";

const metric: Constraint = { id: "m", layer: "time", type: "metric", params: { attribute: "duration", threshold: 10, width: 4, direction: "high" } };
const signal: BatchSignal = { normVersionId: "v", caseTableId: "ct", constraintId: "m", type: "metric", unit: "duration", direction: "high", threshold: 10, width: 4, casesInScope: 100, stats: { n: 70, nCases: 100, casesMissing: 2 } };
const evidence: SignalEvidence = { data: signal, loadedAt: "2026-09-27T12:00:00Z" };

it("groups only matching measurement semantics while permitting different current targets", () => {
  const base = batchNumericRule(metric)!;
  expect(batchNumericRule({ ...metric, id: "m2", layer: "cost", params: { ...metric.params, threshold: 20 } })!.key).toBe(base.key);
  for (const params of [{ ...metric.params, direction: "low" }, { ...metric.params, attribute: "money" }]) {
    expect(batchNumericRule({ ...metric, params })!.key).not.toBe(base.key);
  }
  expect(batchNumericRule({ ...metric, applicability: { attr: "team", in: ["AP"] } })!.key).not.toBe(base.key);
  const lag: Constraint = { ...metric, type: "lag", params: { a: ["canonical:receipt"], b: ["canonical:pay"], unit: "D", delta: 10, width: 2 } };
  expect(batchNumericRule(lag)).toBeDefined();
  expect(batchNumericRule({ ...lag, params: { ...lag.params, b: ["canonical:approve"] } })!.key).not.toBe(batchNumericRule(lag)!.key);
  expect(batchNumericRule({ ...lag, params: { ...lag.params, unit: "h" } })!.key).not.toBe(batchNumericRule(lag)!.key);
  expect(batchNumericRule({ ...lag, params: { ...lag.params, activation: "each" } })).toBeUndefined();
  expect(batchNumericRule({ ...lag, params: { ...lag.params, delta: null } })).toBeUndefined();
  expect(batchNumericRule({ ...metric, type: "presence", params: { m: 2 } })).toBeUndefined();
});

it("uses finite-signal coverage, never the violating-case count, and rejects absent or inconsistent denominators", () => {
  expect(signalCoverage(signal)).toEqual({ measured: 70, scope: 100, missing: 30 });
  expect(signalCoverage({ ...signal, stats: { n: 101, nCases: 100 } })).toBeUndefined();
  expect(signalCoverage({ ...signal, stats: { n: 70, n_missing: 30 } })).toBeUndefined();
  expect(signalCoverage({ ...signal, casesInScope: 90 })).toBeUndefined();
  expect(evidenceIssue(metric, { ...evidence, data: { ...signal, normVersionId: "old" } }, "v", "ct")).toMatch(/different version/);
  expect(evidenceIssue(metric, { ...evidence, data: { ...signal, width: 8 } }, "v", "ct")).toMatch(/does not match/);
  expect(evidenceIssue(metric, { ...evidence, data: { ...signal, stats: { n: 0, nCases: 100 } } }, "v", "ct")).toMatch(/No finite/);
  expect(evidenceIssue(metric, { ...evidence, data: { ...signal, casesInScope: 0, stats: { n: 0, nCases: 0 } } }, "v", "ct")).toMatch(/No applicable/);
});

it("validates values by rule semantics, including zero-width metrics and balance tau", () => {
  expect(thresholdSettingsIssue(metric, "", "4")).toBeDefined();
  expect(thresholdSettingsIssue(metric, "Infinity", "4")).toBeDefined();
  expect(thresholdSettingsIssue(metric, "-5", "0")).toBeUndefined();
  expect(thresholdSettingsIssue(metric, "5", "-1")).toBeDefined();
  expect(thresholdSettingsIssue({ ...metric, type: "singularity" }, "2.5", "1")).toBeDefined();
  expect(thresholdSettingsIssue({ ...metric, type: "singularity" }, "2", "0")).toBeDefined();
  expect(thresholdSettingsIssue({ ...metric, type: "balance" }, "1.1", "0.2")).toBeDefined();
  expect(thresholdSettingsIssue({ ...metric, type: "lag" }, "-1", "2")).toBeDefined();
});

it("sends an explicit calibration decision even when only balance tau changes", () => {
  const c: Constraint = { id: "b", layer: "quality", type: "balance", params: { tau: 0.1, width: 0.3, attr_x: "x", attr_y: "y", activities_x: ["a"], activities_y: ["b"] } };
  const source = { constraints: [c], metadata: { calibration_pending: ["b"] }, custom: { keep: true } };
  const before = structuredClone(source);
  const row = { id: "b", name: "Balance", rationale: "Agreed reconciliation tolerance", owner: "Finance", rule: batchNumericRule(c)!, after: { target: 0.2, width: 0.3 }, evidence: { ...evidence, data: { ...signal, constraintId: "b", type: "balance", unit: "relative difference", threshold: 0.1, width: 0.3 } } };
  const body = batchVersionRequest(source, "v", "thresholds", [row], "ct");
  expect(body.norm.constraints).toEqual([{ ...c, params: { ...c.params, tau: 0.2 } }]);
  expect(body.calibration).toEqual({ b: { rationale: row.rationale, owner: row.owner } });
  expect(body.note).toContain("70/100 measured");
  expect(body.norm.metadata).toEqual(source.metadata);
  expect(source).toEqual(before);
});

it("bounds concurrent requests and stops scheduling when the context is no longer current", async () => {
  let active = 0, max = 0, current = true;
  const started: number[] = [];
  const release: Array<() => void> = [];
  const done = forEachBatchLimited(Array.from({ length: 12 }, (_, i) => i), async value => {
    started.push(value); active++; max = Math.max(max, active);
    await new Promise<void>(resolve => release.push(resolve));
    active--;
  }, () => current);
  expect(started).toEqual([0, 1, 2]);
  release[0]!(); await Promise.resolve(); await Promise.resolve();
  expect(started).toEqual([0, 1, 2, 3]);
  current = false; release.slice(1).forEach(resolve => resolve());
  await done;
  expect(max).toBe(3); expect(started).toHaveLength(4);
});

it("rejects a stale semantic preview instead of writing its parameter mapping", () => {
  const rule = batchNumericRule(metric)!;
  const row = { id: metric.id, name: "Duration", rationale: "Reviewed", owner: "Owner", rule, after: { target: 12, width: 3 }, evidence };
  const changed = { ...metric, params: { ...metric.params, attribute: "cost" } };
  expect(() => batchVersionRequest({ constraints: [changed] }, "v", "thresholds", [row], "ct")).toThrow(/no longer matches/);
  expect(() => batchVersionRequest({ constraints: [metric] }, "v", "thresholds", [row])).toThrow(/require measured evidence/);
  expect(batchValue(0.6 - 0.2)).toBe("0.4");
  expect(batchValue(0.000000001)).not.toBe("0");
});
