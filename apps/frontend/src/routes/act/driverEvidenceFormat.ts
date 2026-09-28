import { fmtNum } from "@/lib/format";

export function eventShare(events: number, total: number): string {
  if (total <= 0) return "Unavailable";
  const percent = events / total * 100;
  return percent > 0 && percent < 0.1 ? "<0.1%" : `${fmtNum(percent, 1)}%`;
}

