/**
 * The plain sentences of a group, built from the backend's row: the share below expectation, the phrase of
 * the most-missed expectation, the real-unit comparison normalised into one form, and the group's name
 * without the part every group on the page shares.
 */
import type { BacklogRow } from "@wise/api-schema";
import type { GuidanceRef } from "@/lib/api/cycle2";
import { fmtNum, fmtPct } from "@/lib/format";
import { confidenceOf } from "@/lib/vocabulary";

/** "0.9 %" — how far the group's score sits below the overall score, in score points (whole per cent above 10 %, one decimal below). */
export function belowExpectation(row: { gap: number }): string {
  const points = row.gap * 100;
  return `${fmtNum(points, points >= 10 ? 0 : 1)} %`;
}

/** The plain phrase of what is missed: the top expectation's missed label, else the area's, else the expectation's name. */
export function missedPhrase(row: BacklogRow, refs?: GuidanceRef[] | null): string | undefined {
  const ref = row.top_constraint ? refs?.find((g) => g.kind === "constraint" && g.id === row.top_constraint) : undefined;
  const label = (ref as { missed_label?: string | null } | undefined)?.missed_label ?? row.layer_missed_label ?? row.top_constraint_plain?.toLowerCase();
  return label ?? undefined;
}

/**
 * The backend's comparison sentence as the card prints it. The backend serves one form for every kind of
 * number — "<expectation>: <here> here against <elsewhere> elsewhere (<difference>)" — and says
 * "No material difference on the top expectation (<expectation>)" when the numbers round to the same value,
 * so nothing is rewritten here: the sentence is trimmed and ends with one full stop.
 */
export function comparisonSentence(row: Pick<BacklogRow, "comparison">): string | undefined {
  const raw = row.comparison?.trim();
  if (!raw) return undefined;
  return `${raw.replace(/\.+$/, "")}.`;
}

/** The backend's reading sentence with the confidence clause made to agree with the card's confidence word. */
export function readingSentence(row: Pick<BacklogRow, "reading" | "stability">): string | undefined {
  if (!row.reading) return undefined;
  const stability = row.stability ?? "unknown";
  if (stability === "unknown") return row.reading;
  return row.reading.replace(/confidence in rank: not computed( for this run)?/i, `confidence in rank: ${confidenceOf(stability)}`);
}

/**
 * The key value most groups on a page share, per attribute (only for groupings with more than one attribute
 * and never for the last one): on BPIC 2019 the company, "case Company" → "companyID_0000".
 */
export function sharedKeyValues(rows: { key?: string; keys?: Record<string, string> | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  const first = rows.find((r) => r.keys && Object.keys(r.keys).length > 1)?.keys;
  if (!first || rows.length < 2) return out;
  const attributes = Object.keys(first);
  for (const attribute of attributes.slice(0, -1)) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r.keys?.[attribute];
      if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const [value, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (value !== undefined && count !== undefined && count >= rows.length / 2) out.set(attribute, value);
  }
  return out;
}

const plainAttribute = (attribute: string) => attribute.replace(/^case /, "").replace(/\s*(text|id)$/i, "").toLowerCase();
/** "companyID_0003" for the attribute "case Company" → "0003". */
const shortValue = (attribute: string, value: string) => {
  const stem = plainAttribute(attribute).replace(/\s+/g, "");
  const m = new RegExp(`^${stem}(?:id)?[_\\-:. ]?(.+)$`, "i").exec(value);
  return m?.[1] ?? value;
};

/**
 * The group's name without the part most groups on the page share: "Packaging" instead of "companyID_0000 ×
 * Packaging"; a group outside the shared part keeps it as a suffix, "Real Estate · company 0003".
 */
export function groupLabel(row: { key: string; keys?: Record<string, string> | null }, shared?: Map<string, string>): string {
  const entries = Object.entries(row.keys ?? {});
  if (entries.length) {
    const main: string[] = [];
    const suffix: string[] = [];
    for (const [attribute, value] of entries) {
      const dominant = shared?.get(attribute);
      if (dominant === undefined) main.push(value);
      else if (dominant !== value) suffix.push(`${plainAttribute(attribute)} ${shortValue(attribute, value)}`);
    }
    if (!main.length) return entries.map(([, v]) => v).join(" × ");
    return suffix.length ? `${main.join(" × ")} · ${suffix.join(" · ")}` : main.join(" × ");
  }
  try {
    const parsed = JSON.parse(row.key) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).join(" × ");
  } catch {
    /* a bare key */
  }
  return row.key;
}

/** Caveats that hold on nearly every row of a page (nine of ten) belong in the header once, with their median share. */
export function pageWideCaveats(rows: BacklogRow[]): { id: string; share: number | undefined; text: string }[] {
  if (rows.length < 3) return [];
  const byId = new Map<string, { shares: number[]; text: string; count: number }>();
  for (const r of rows) {
    for (const c of r.caveats ?? []) {
      if (c.share !== null && c.share !== undefined && c.share <= 0.005) continue;
      const entry = byId.get(c.id) ?? { shares: [], text: c.text, count: 0 };
      entry.count += 1;
      if (c.share !== null && c.share !== undefined) entry.shares.push(c.share);
      byId.set(c.id, entry);
    }
  }
  const out: { id: string; share: number | undefined; text: string }[] = [];
  for (const [id, e] of byId) {
    if (e.count / rows.length < 0.9) continue;
    const sorted = [...e.shares].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
    out.push({ id, share: median, text: e.text });
  }
  return out;
}

export const shareWord = (share: number | undefined) => (share === undefined ? "" : fmtPct(share, share < 0.1 ? 1 : 0));
