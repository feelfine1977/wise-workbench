import type { HotspotType, Kind, Stability } from "@wise/api-schema";
import tokens from "@wise/design-tokens";
import { useUiStore } from "@/lib/stores/ui";
import { HOTSPOT_OF_KIND, KIND_OF_HOTSPOT, confidenceOf, kindGlyph, kindReading, stabilityGlyph } from "@/lib/vocabulary";
import { cn, hashIndex } from "@/lib/utils";

/** Colour never carries meaning alone: every badge pairs a glyph with a text label. */

export { kindGlyph, stabilityGlyph };

/** The method's names of the kinds, kept as aliases. */
export const hotspotGlyph: Record<HotspotType, string> = {
  severity: kindGlyph.acute,
  mechanism: kindGlyph.systematic,
  reservoir: kindGlyph.widespread,
};

export interface KindBadgeProps {
  kind?: Kind | null;
  /** The method's name; used when `kind` is absent. */
  hotspotType?: HotspotType | null;
  /** Glyph and primary label only. */
  short?: boolean;
  /** Add the one-line reading ("few cases, far off"). */
  reading?: boolean;
  className?: string;
}

/**
 * Kind of problem: acute, systematic or widespread (plain, primary) with the method's hotspot type as a
 * muted secondary label, or the other way round when the vocabulary is switched.
 */
export function KindBadge({ kind, hotspotType, short, reading, className }: KindBadgeProps) {
  const vocabulary = useUiStore((s) => s.vocabulary);
  const k: Kind | undefined = kind ?? (hotspotType ? KIND_OF_HOTSPOT[hotspotType] : undefined);
  if (!k) {
    return (
      <span role="img" className={cn("inline-flex items-center gap-1 text-xs text-text-subtle", className)} aria-label="no kind of problem yet">
        <span aria-hidden>–</span>
        {!short && <span aria-hidden>{vocabulary === "plain" ? "no kind yet" : "not typed"}</span>}
      </span>
    );
  }
  const method = HOTSPOT_OF_KIND[k];
  const primary = vocabulary === "plain" ? k : method;
  const other = vocabulary === "plain" ? method : k;
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium leading-4", className)}
      style={{ color: `var(--kind-${k}-fg)`, background: `var(--kind-${k}-bg)` }}
      data-kind={k}
      data-hotspot={method}
      title={`${k}: ${kindReading(k)} (${method})`}
    >
      <span aria-hidden>{kindGlyph[k]}</span>
      <span>{primary}</span>
      {reading && <span className="font-normal">· {kindReading(k)}</span>}
      {!short && <span className="font-normal text-[11px] opacity-70">{other}</span>}
    </span>
  );
}

/** Alias for callers that still speak the method's vocabulary. */
export function HotspotBadge({ type, className, short }: { type: HotspotType | null | undefined; className?: string; short?: boolean }) {
  return <KindBadge hotspotType={type} className={className} short={short} />;
}

/** Confidence in the rank (the method's stability): dots plus words, never colour alone. */
export function ConfidenceMark({ value, className, words, title }: { value: Stability | null | undefined; className?: string; words?: boolean; title?: string }) {
  const vocabulary = useUiStore((s) => s.vocabulary);
  const v: Stability = value ?? "unknown";
  const plain = confidenceOf(v);
  const method = v.replace("_", " ");
  const text = vocabulary === "plain" ? `confidence ${plain}` : `stability ${method}`;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", className)} style={{ color: `var(--stability-${v})` }} title={`confidence in rank: ${plain} (stability: ${method})${title ? ` — ${title}` : ""}`} data-stability={v}>
      <span aria-hidden className="tracking-tighter">
        {stabilityGlyph[v]}
      </span>
      {words ? <span>{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  );
}

/** Alias of {@link ConfidenceMark}. */
export function StabilityDots(props: { value: Stability | null | undefined; className?: string }) {
  return <ConfidenceMark {...props} />;
}

export type GateState = "pending" | "passed" | "failed" | "waived";
export const gateGlyph: Record<GateState, string> = {
  pending: tokens.semantic.gate.pending.glyph,
  passed: tokens.semantic.gate.passed.glyph,
  failed: tokens.semantic.gate.failed.glyph,
  waived: tokens.semantic.gate.waived.glyph,
};

export function GateBadge({ state, label, className }: { state: GateState; label?: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium leading-4", className)}
      style={{ color: `var(--gate-${state}-fg)`, background: `var(--gate-${state}-bg)` }}
      data-gate={state}
    >
      <span aria-hidden>{gateGlyph[state]}</span>
      <span>{label ?? state}</span>
    </span>
  );
}

export function layerColor(layerId: string): string {
  return `var(--layer-${hashIndex(layerId)})`;
}
export function layerDecal(layerId: string): string {
  return tokens.semantic.categorical.layers.decals[hashIndex(layerId)] ?? "none";
}

export function LayerChip({ id, name, className }: { id: string | null | undefined; name?: string | null; className?: string }) {
  if (!id) return <span className={cn("text-xs text-text-subtle", className)}>–</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", className)} title={id}>
      <span aria-hidden className="layer-swatch" style={{ background: layerColor(id) }} />
      <span className="truncate">{name ?? id}</span>
    </span>
  );
}
