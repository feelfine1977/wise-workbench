import type { BandSpec } from "./api/exploration";

export interface GroupingDefinition { attributes: string[]; bands?: BandSpec[] }
/** A shareable definition; grouping never changes a completed run or its norm. */
export function groupingToken(spec: GroupingDefinition): string {
  return "group:" + JSON.stringify({ attributes: spec.attributes, bands: spec.bands ?? [] });
}
export function readGrouping(token: string | undefined): GroupingDefinition | undefined {
  if (!token?.startsWith("group:")) return undefined;
  try {
    const value = JSON.parse(token.slice(6)) as GroupingDefinition;
    if (!Array.isArray(value.attributes) || !value.attributes.length || value.attributes.length > 3 || !value.attributes.every((a) => typeof a === "string" && a.length)) return undefined;
    if (value.bands !== undefined && !Array.isArray(value.bands)) return undefined;
    return value;
  } catch { return undefined; }
}
export function groupingAttributes(token: string): string[] {
  return readGrouping(token)?.attributes ?? token.split(/[+,]/).map((a) => a.trim()).filter(Boolean);
}
export function cutPoints(text: string): number[] | undefined {
  const parts = text.split(",").map((v) => v.trim());
  if (!parts.length || parts.some((v) => !v)) return undefined;
  const values = parts.map(Number);
  return values.every((v, i) => Number.isFinite(v) && (i === 0 || v > values[i - 1]!)) ? values : undefined;
}
