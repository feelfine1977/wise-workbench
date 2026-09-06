#!/usr/bin/env node
/**
 * Design-token build: tokens.json -> dist/tokens.css, dist/echarts-theme.{light,dark}.json,
 * dist/tokens.json (copy) and dist/contrast-report.json.
 *
 * The build fails when any text/background pair used by the UI falls below
 * WCAG 2.2 AA (4.5:1), so the palette cannot regress silently.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
const out = join(here, "dist");
mkdirSync(out, { recursive: true });

// ---------- helpers ----------
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
/** Entries of a semantic group without its `description` note. */
const entries = (group) => Object.entries(group).filter(([k]) => k !== "description");

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- CSS variables ----------
function paletteVars(theme) {
  const p = tokens.palette[theme];
  const lines = [];
  for (const [k, v] of Object.entries(p)) lines.push(`  --color-${kebab(k)}: ${v};`);
  for (const [k, v] of Object.entries(tokens.elevation[theme])) lines.push(`  --elevation-${k}: ${v};`);
  for (const [name, t] of entries(tokens.semantic.kind)) {
    lines.push(`  --kind-${name}-fg: ${t[theme].fg};`);
    lines.push(`  --kind-${name}-bg: ${t[theme].bg};`);
    lines.push(`  --kind-${name}-solid: ${t[theme].solid};`);
  }
  // the method's names stay usable as aliases of the kinds
  for (const [name, t] of entries(tokens.semantic.hotspot)) {
    lines.push(`  --hotspot-${name}-fg: var(--kind-${t.kind}-fg);`);
    lines.push(`  --hotspot-${name}-bg: var(--kind-${t.kind}-bg);`);
    lines.push(`  --hotspot-${name}-solid: var(--kind-${t.kind}-solid);`);
  }
  for (const [name, t] of entries(tokens.semantic.gate)) {
    lines.push(`  --gate-${name}-fg: ${t[theme].fg};`);
    lines.push(`  --gate-${name}-bg: ${t[theme].bg};`);
  }
  for (const [name, t] of entries(tokens.semantic.stability)) {
    lines.push(`  --stability-${name}: ${t[theme]};`);
  }
  lines.push(`  color-scheme: ${theme};`);
  return lines.join("\n");
}

function sharedVars() {
  const lines = [];
  for (const [k, v] of Object.entries(tokens.spacing.scale)) lines.push(`  --space-${String(k).replace(".", "_")}: ${v}px;`);
  for (const [k, v] of Object.entries(tokens.radius)) lines.push(`  --radius-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(tokens.motion.duration)) lines.push(`  --duration-${k}: ${v}ms;`);
  for (const [k, v] of Object.entries(tokens.motion.easing)) lines.push(`  --easing-${k}: ${v};`);
  for (const [k, v] of Object.entries(tokens.zIndex)) lines.push(`  --z-${k}: ${v};`);
  lines.push(`  --font-ui: ${tokens.typography.family.ui};`);
  lines.push(`  --font-mono: ${tokens.typography.family.mono};`);
  lines.push(`  --font-features-numeric: ${tokens.typography.features.numeric};`);
  for (const [k, v] of Object.entries(tokens.typography.scale)) {
    lines.push(`  --text-${k}-size: ${v.size}px;`);
    lines.push(`  --text-${k}-leading: ${v.lineHeight}px;`);
    lines.push(`  --text-${k}-tracking: ${v.tracking}px;`);
  }
  for (const [mode, d] of Object.entries(tokens.density)) {
    for (const [k, v] of Object.entries(d)) lines.push(`  --density-${mode}-${kebab(k)}: ${v}px;`);
  }
  for (const [k, v] of Object.entries(tokens.typography.measure ?? {})) lines.push(`  --measure-${k}: ${v};`);
  tokens.semantic.sequential.score.steps.forEach((c, i) => lines.push(`  --scale-score-${i}: ${c};`));
  tokens.semantic.sequential.violation.steps.forEach((c, i) => lines.push(`  --scale-violation-${i}: ${c};`));
  tokens.semantic.diverging.delta.steps.forEach((c, i) => lines.push(`  --scale-delta-${i}: ${c};`));
  tokens.semantic.categorical.layers.colors.forEach((c, i) => lines.push(`  --layer-${i}: ${c};`));
  return lines.join("\n");
}

const css = `/* Generated from packages/design-tokens/tokens.json. Do not edit by hand. */
:root {
${sharedVars()}
${paletteVars("light")}
}
:root[data-theme="dark"] {
${paletteVars("dark")}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${paletteVars("dark")}
  }
}
:root[data-density="compact"] {
  --row-height: var(--density-compact-row-height);
  --control-height: var(--density-compact-control-height);
  --cell-padding-x: var(--density-compact-cell-padding-x);
  --card-padding: var(--density-compact-card-padding);
  --card-gap: var(--density-compact-card-gap);
}
:root {
  --row-height: var(--density-comfortable-row-height);
  --control-height: var(--density-comfortable-control-height);
  --cell-padding-x: var(--density-comfortable-cell-padding-x);
  --card-padding: var(--density-comfortable-card-padding);
  --card-gap: var(--density-comfortable-card-gap);
}
@media (prefers-reduced-motion: reduce) {
  :root { --duration-fast: 0ms; --duration-base: 0ms; --duration-slow: 0ms; }
}
`;
writeFileSync(join(out, "tokens.css"), css);

// ---------- ECharts theme ----------
function echartsTheme(theme) {
  const p = tokens.palette[theme];
  const layers = tokens.semantic.categorical.layers;
  const font = tokens.typography.family.ui;
  const text = { color: p.text, fontFamily: font, fontSize: tokens.typography.scale.sm.size };
  const axis = {
    axisLine: { lineStyle: { color: p.chartAxis } },
    axisTick: { lineStyle: { color: p.chartAxis } },
    axisLabel: { color: p.textMuted, fontFamily: font, fontSize: tokens.typography.scale.xs.size },
    nameTextStyle: { color: p.textMuted, fontFamily: font, fontSize: tokens.typography.scale.xs.size },
    splitLine: { lineStyle: { color: p.chartGrid } },
  };
  return {
    color: layers.colors,
    backgroundColor: "transparent",
    textStyle: text,
    title: { textStyle: { ...text, fontWeight: tokens.typography.weight.semibold }, subtextStyle: { color: p.textMuted, fontFamily: font } },
    legend: { textStyle: { color: p.textMuted, fontFamily: font, fontSize: tokens.typography.scale.xs.size } },
    tooltip: {
      backgroundColor: p.surfaceRaised,
      borderColor: p.border,
      textStyle: { color: p.text, fontFamily: font, fontSize: tokens.typography.scale.sm.size },
      extraCssText: `box-shadow: ${tokens.elevation[theme]["2"]}; font-variant-numeric: tabular-nums;`,
    },
    categoryAxis: axis,
    valueAxis: axis,
    logAxis: axis,
    timeAxis: axis,
    line: { symbolSize: 6, lineStyle: { width: 2 } },
    bar: { itemStyle: { borderRadius: [2, 2, 0, 0] } },
    scatter: { symbolSize: 8 },
    visualMap: { textStyle: { color: p.textMuted, fontFamily: font } },
    markLine: { lineStyle: { color: p.chartReference, type: "dashed" } },
    aria: { enabled: true, decal: { show: true } },
    wise: {
      score: tokens.semantic.sequential.score.steps,
      violation: tokens.semantic.sequential.violation.steps,
      delta: tokens.semantic.diverging.delta.steps,
      layers: layers.colors,
      decals: layers.decals,
      kind: Object.fromEntries(entries(tokens.semantic.kind).map(([k, v]) => [k, v[theme].solid])),
      hotspot: Object.fromEntries(entries(tokens.semantic.hotspot).map(([k, v]) => [k, v[theme].solid])),
      gate: Object.fromEntries(entries(tokens.semantic.gate).map(([k, v]) => [k, v[theme].fg])),
      stability: Object.fromEntries(entries(tokens.semantic.stability).map(([k, v]) => [k, v[theme]])),
      reference: p.chartReference,
      muted: p.textMuted,
      grid: p.chartGrid,
      surface: p.surface,
      accent: p.accent,
    },
  };
}
writeFileSync(join(out, "echarts-theme.light.json"), JSON.stringify(echartsTheme("light"), null, 2));
writeFileSync(join(out, "echarts-theme.dark.json"), JSON.stringify(echartsTheme("dark"), null, 2));
writeFileSync(join(out, "tokens.json"), JSON.stringify(tokens, null, 2));

// ---------- contrast audit ----------
const pairs = [];
for (const theme of ["light", "dark"]) {
  const p = tokens.palette[theme];
  const add = (name, fg, bg) => pairs.push({ theme, name, fg, bg, ratio: Math.round(contrast(fg, bg) * 100) / 100 });
  for (const bg of ["bg", "surface", "surfaceRaised", "surfaceSunken"]) {
    add(`text on ${bg}`, p.text, p[bg]);
    add(`textMuted on ${bg}`, p.textMuted, p[bg]);
    add(`textSubtle on ${bg}`, p.textSubtle, p[bg]);
    add(`accentText on ${bg}`, p.accentText, p[bg]);
  }
  add("onAccent on accent", p.onAccent, p.accent);
  add("onAccent on accentHover", p.onAccent, p.accentHover);
  add("accentText on accentSubtle", p.accentText, p.accentSubtle);
  add("text on selection", p.text, p.selection);
  for (const s of ["info", "success", "warning", "danger"]) {
    add(`${s} on ${s}Subtle`, p[s], p[`${s}Subtle`]);
    add(`${s} on surface`, p[s], p.surface);
  }
  for (const [k, v] of entries(tokens.semantic.kind)) {
    add(`kind ${k} fg on bg`, v[theme].fg, v[theme].bg);
    add(`kind ${k} fg on surface`, v[theme].fg, p.surface);
  }
  for (const [k, v] of entries(tokens.semantic.hotspot)) {
    add(`hotspot ${k} fg on bg`, v[theme].fg, v[theme].bg);
    add(`hotspot ${k} fg on surface`, v[theme].fg, p.surface);
  }
  for (const [k, v] of entries(tokens.semantic.gate)) {
    add(`gate ${k} fg on bg`, v[theme].fg, v[theme].bg);
    add(`gate ${k} fg on surface`, v[theme].fg, p.surface);
  }
  for (const [k, v] of entries(tokens.semantic.stability)) add(`stability ${k} on surface`, v[theme], p.surface);
}
const failing = pairs.filter((x) => x.ratio < 4.5);
writeFileSync(join(out, "contrast-report.json"), JSON.stringify({ minimum: 4.5, pairs, failing }, null, 2));
if (failing.length) {
  console.error("Contrast below 4.5:1 for:");
  for (const f of failing) console.error(`  [${f.theme}] ${f.name}: ${f.fg} on ${f.bg} = ${f.ratio}`);
  process.exit(1);
}
console.log(`design-tokens: wrote ${out} (${pairs.length} contrast pairs, all >= 4.5:1)`);
