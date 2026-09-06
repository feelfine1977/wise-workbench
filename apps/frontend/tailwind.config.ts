import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import tokens from "../../packages/design-tokens/tokens.json";

const spacing = Object.fromEntries(Object.entries(tokens.spacing.scale).map(([k, v]) => [k, `${v}px`]));
const fontSize = Object.fromEntries(
  Object.entries(tokens.typography.scale).map(([k, v]) => [k, [`${v.size}px`, { lineHeight: `${v.lineHeight}px`, letterSpacing: `${v.tracking}px` }]]),
);

export default {
  darkMode: [
    "variant",
    [":root[data-theme='dark'] &", "@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) & }"],
  ],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    spacing,
    fontSize: fontSize as Config["theme"] extends { fontSize: infer T } ? T : never,
    fontFamily: {
      sans: ["var(--font-ui)"],
      mono: ["var(--font-mono)"],
    },
    borderRadius: {
      none: "0",
      sm: "var(--radius-sm)",
      DEFAULT: "var(--radius-sm)",
      md: "var(--radius-md)",
      lg: "var(--radius-lg)",
      full: "var(--radius-full)",
    },
    boxShadow: {
      none: "none",
      1: "var(--elevation-1)",
      2: "var(--elevation-2)",
      3: "var(--elevation-3)",
    },
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: {
          DEFAULT: "var(--color-surface)",
          raised: "var(--color-surface-raised)",
          sunken: "var(--color-surface-sunken)",
        },
        border: {
          DEFAULT: "var(--color-border)",
          strong: "var(--color-border-strong)",
        },
        text: {
          DEFAULT: "var(--color-text)",
          muted: "var(--color-text-muted)",
          subtle: "var(--color-text-subtle)",
          inverse: "var(--color-text-inverse)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          hover: "var(--color-accent-hover)",
          subtle: "var(--color-accent-subtle)",
          text: "var(--color-accent-text)",
          on: "var(--color-on-accent)",
        },
        focus: "var(--color-focus)",
        selection: "var(--color-selection)",
        info: { DEFAULT: "var(--color-info)", subtle: "var(--color-info-subtle)" },
        success: { DEFAULT: "var(--color-success)", subtle: "var(--color-success-subtle)" },
        warning: { DEFAULT: "var(--color-warning)", subtle: "var(--color-warning-subtle)" },
        danger: { DEFAULT: "var(--color-danger)", subtle: "var(--color-danger-subtle)" },
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--easing-standard)",
        emphasized: "var(--easing-emphasized)",
      },
      zIndex: {
        ribbon: "var(--z-ribbon)",
        rail: "var(--z-rail)",
        pane: "var(--z-pane)",
        tray: "var(--z-tray)",
        overlay: "var(--z-overlay)",
        toast: "var(--z-toast)",
      },
      height: { control: "var(--control-height)", row: "var(--row-height)" },
      minHeight: { control: "var(--control-height)", row: "var(--row-height)" },
    },
  },
  plugins: [animate],
} satisfies Config;
