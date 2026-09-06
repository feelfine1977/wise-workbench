# packages/design-tokens

`tokens.json` is the single source: the 4 px spacing scale (complete from 0 to 96 units since 0.2.1, so
every `w-40`, `h-1.5` or `size-7` utility of the frontend resolves; earlier builds dropped the keys between
the round numbers and the utilities were silent), 8-step type scale with
tabular numerals (base 15 px since 0.2, the reading measure of 68 characters),
card padding and gap per density, radii, three elevations, motion, light and dark palettes, and
the semantic scales (sequential score / violation, diverging delta, categorical
layers with decal twins, fixed colours and glyphs for hotspot types, gate states,
stability and journey stage states).

```sh
node build.mjs
```

writes `dist/tokens.css` (CSS variables for `:root`, `[data-theme="dark"]`,
`prefers-color-scheme` and density modes), `dist/echarts-theme.light.json`,
`dist/echarts-theme.dark.json`, a copy of `tokens.json` and
`dist/contrast-report.json`. The build fails when any text/background pair used by
the UI falls below WCAG AA 4.5:1. The frontend runs this build before `dev`,
`build` and `test`.
