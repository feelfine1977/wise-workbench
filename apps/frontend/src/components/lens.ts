import type { Distribution } from "@wise/api-schema";

export type Direction = "high" | "low";

export interface LensStats {
  n: number;
  shareIsExact: boolean;
  fullShareIsExact: boolean;
  /** Share of cases beyond the threshold (partial or full violation). */
  shareViolating: number;
  /** Share of cases beyond threshold + width (full violation). */
  shareFull: number;
  /** Mean violation ν̄ = mean(clip((x − ϑ)/W, 0, 1)) for direction "high". */
  meanViolation: number;
  /** Empirical CDF at the threshold. */
  cdfAtThreshold: number;
}

/** Linear interpolation of an ECDF given as [x, F] pairs sorted by x. */
export function ecdfAt(ecdf: number[][] | undefined, x: number): number {
  if (!ecdf || ecdf.length === 0) return 0;
  const first = ecdf[0] as number[];
  const last = ecdf[ecdf.length - 1] as number[];
  if (x <= (first[0] as number)) return 0;
  if (x >= (last[0] as number)) return last[1] as number;
  let lo = 0;
  let hi = ecdf.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (((ecdf[mid] as number[])[0] as number) <= x) lo = mid;
    else hi = mid;
  }
  const [x0, y0] = ecdf[lo] as [number, number];
  const [x1, y1] = ecdf[hi] as [number, number];
  if (x1 === x0) return y1;
  return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
}

/** Violation ν of a signal value under a soft threshold with width W. */
export function violation(x: number, threshold: number, width: number, direction: Direction = "high"): number {
  const w = Math.max(width, 1e-12);
  const d = direction === "high" ? x - threshold : threshold - x;
  return Math.min(1, Math.max(0, d / w));
}

/** Saved shares use exact observed counts when available; exploratory shares and the bin mean are estimates. */
export function lensStats(dist: Distribution, threshold: number, width: number, direction: Direction = "high"): LensStats {
  const bins = dist.bins ?? [];
  const recordedN = dist.stats?.n;
  const n = typeof recordedN === "number" ? recordedN : bins.reduce((s, b) => s + (b.n ?? 0), 0) + (dist.beyond?.n ?? 0) + (dist.below?.n ?? 0);
  let weighted = 0;
  for (const b of bins) {
    const mid = ((b.x0 ?? 0) + (b.x1 ?? 0)) / 2;
    weighted += (b.n ?? 0) * violation(mid, threshold, width, direction);
  }
  const F = ecdfAt(dist.ecdf, threshold);
  const Ffull = ecdfAt(dist.ecdf, direction === "high" ? threshold + width : threshold - width);
  // The compressed ECDF is an approximation. At the saved threshold use
  // the backend's direct count of finite observations, including overflow.
  const sameThreshold = threshold === dist.threshold && direction === (dist.direction ?? "high");
  const recordedShare = dist.stats?.shareBeyondThreshold;
  const recordedFull = dist.stats?.shareBeyondSaturation;
  const shareIsExact = sameThreshold && typeof recordedShare === "number" && Number.isFinite(recordedShare);
  const fullShareIsExact = sameThreshold && width === dist.width && typeof recordedFull === "number" && Number.isFinite(recordedFull);
  const shareViolating = shareIsExact ? recordedShare : direction === "high" ? 1 - F : F;
  const shareFull = fullShareIsExact ? recordedFull : direction === "high" ? 1 - Ffull : Ffull;
  return {
    n,
    shareIsExact,
    fullShareIsExact,
    shareViolating: Math.max(0, Math.min(1, shareViolating)),
    shareFull: Math.max(0, Math.min(1, shareFull)),
    meanViolation: bins.reduce((s, b) => s + (b.n ?? 0), 0) > 0 ? weighted / bins.reduce((s, b) => s + (b.n ?? 0), 0) : 0,
    cdfAtThreshold: sameThreshold && typeof dist.stats?.ecdfAtThreshold === "number" ? dist.stats.ecdfAtThreshold : F,
  };
}
