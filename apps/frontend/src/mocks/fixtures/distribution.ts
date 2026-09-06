import type { Distribution } from "@wise/api-schema";
import { bpic19Norm } from "./norm";
import { rng, round } from "./seed";

/** Histogram + ECDF of a constraint's raw signal, shifted right for a slice key. */
export function buildDistribution(constraintId: string, sliceKey?: string): Distribution {
  const c = bpic19Norm.constraints.find((x) => x.id === constraintId);
  const r = rng(`dist:${constraintId}:${sliceKey ?? "all"}`);
  const p = (c?.params ?? {}) as Record<string, unknown>;
  const type = c?.type ?? "metric";
  let unit = "count";
  let threshold = 1;
  let width = 1;
  let xMax = 12;
  let binWidth = 1;
  let n = sliceKey ? r.int(150, 5000) : 251734;
  let mode = 2;
  if (type === "lag") {
    unit = "days";
    threshold = Number(p.delta ?? 10);
    width = Number(p.width ?? 20);
    xMax = Math.max(60, Math.ceil((threshold + width) * 2.5 / 10) * 10);
    binWidth = xMax > 100 ? 5 : xMax > 40 ? 2 : 1;
    mode = threshold * (sliceKey ? 1.6 : 0.8);
  } else if (type === "metric") {
    const attr = String(p.attribute ?? "");
    unit = attr.includes("share") ? "share" : attr.includes("cv") || attr.includes("exposure") ? "ratio" : "count";
    threshold = Number(p.threshold ?? 1);
    width = Number(p.width ?? 1);
    xMax = unit === "share" ? 1 : unit === "ratio" ? Math.max(3, (threshold + width) * 2) : Math.max(12, (threshold + width) * 2);
    binWidth = unit === "share" ? 0.05 : unit === "ratio" ? 0.1 : 1;
    mode = threshold * (sliceKey ? 1.3 : 0.7);
  } else if (type === "singularity") {
    threshold = Number(p.k ?? 1);
    width = Number(p.K ?? 2);
    xMax = 10;
    mode = threshold * (sliceKey ? 1.5 : 0.6);
  } else {
    // presence / precedence / exclusion: count of the activity in the case
    threshold = 0.5;
    width = 0.5;
    xMax = 6;
    mode = sliceKey ? 1.1 : 0.4;
  }
  n = Math.max(n, 40);
  const bins: { x0: number; x1: number; n: number }[] = [];
  const count = Math.round(xMax / binWidth);
  const sigma = Math.max(0.35, Math.log(1 + mode / (threshold || 1)) + 0.4);
  const muLog = Math.log(Math.max(mode, binWidth * 0.5));
  let total = 0;
  const raw: number[] = [];
  for (let i = 0; i < count; i++) {
    const mid = (i + 0.5) * binWidth;
    const z = (Math.log(mid) - muLog) / sigma;
    const density = Math.exp(-0.5 * z * z) / (mid * sigma);
    const v = density * (1 + r.range(-0.08, 0.08));
    raw.push(v);
    total += v;
  }
  let assigned = 0;
  raw.forEach((v, i) => {
    const cnt = i === count - 1 ? n - assigned : Math.round((v / total) * n);
    assigned += cnt;
    bins.push({ x0: round(i * binWidth, 4), x1: round((i + 1) * binWidth, 4), n: Math.max(0, cnt) });
  });
  let cum = 0;
  const ecdf: number[][] = [[0, 0]];
  for (const b of bins) {
    cum += b.n;
    ecdf.push([b.x1, round(cum / n, 5)]);
  }
  const mean = bins.reduce((s, b) => s + ((b.x0 + b.x1) / 2) * b.n, 0) / n;
  const quantile = (q: number) => {
    const target = q * n;
    let acc = 0;
    for (const b of bins) {
      if (acc + b.n >= target) return round(b.x0 + ((target - acc) / Math.max(b.n, 1)) * (b.x1 - b.x0), 3);
      acc += b.n;
    }
    return xMax;
  };
  const over = bins.filter((b) => (b.x0 + b.x1) / 2 > threshold).reduce((s, b) => s + b.n, 0) / n;
  return {
    unit,
    bins,
    ecdf,
    threshold,
    width,
    stats: { n, mean: round(mean, 3), median: quantile(0.5), p90: quantile(0.9), share_over_threshold: round(over, 4) },
  };
}
