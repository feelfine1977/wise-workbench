/** Native finite-value ramp only. Missing-data and repeated-activation policies stay in the evaluator. */
export function penaltyAt(value: number, target: number, width: number, low = false): number {
  const excess = low ? target - value : value - target;
  return excess <= 0 ? 0 : width === 0 ? 1 : Math.min(1, excess / width);
}
