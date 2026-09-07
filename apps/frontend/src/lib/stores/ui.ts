import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Vocabulary } from "@/lib/vocabulary";

export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
/**
 * How much of the workbench a reader is shown (R3-10). *Analyst* is everything; *guided* is the one path a
 * person who does not do this every day can walk — the dashboard, the ranked list, the reason screen and
 * *What can we do?* — with the explanations on, the method's controls out of the way, and every number
 * inside a sentence. The order-desk employee scored 67 % on the analyst screens in cycle 3.
 */
export type Mode = "analyst" | "guided";

interface UiState {
  theme: Theme;
  density: Density;
  /** Plain language first (default) or the method's terms first. */
  vocabulary: Vocabulary;
  /** The reader's profile; `?mode=guided` in the address sets it and it is remembered. */
  mode: Mode;
  helpOpen: boolean;
  helpTerm: string | undefined;
  paletteOpen: boolean;
  trayOpen: boolean;
  /** "How to read this" paragraphs the reader has opened from the ? beside a title, by screen id; closed by default. */
  howToReadOpen: Record<string, boolean>;
  setHowToRead: (id: string, open: boolean) => void;
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
  setVocabulary: (v: Vocabulary) => void;
  setMode: (m: Mode) => void;
  openHelp: (term?: string) => void;
  closeHelp: () => void;
  setPaletteOpen: (open: boolean) => void;
  setTrayOpen: (open: boolean) => void;
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem("wise.theme");
    else localStorage.setItem("wise.theme", theme);
  } catch {
    /* storage may be unavailable */
  }
}
function applyDensity(d: Density) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (d === "compact") root.setAttribute("data-density", "compact");
  else root.removeAttribute("data-density");
  try {
    localStorage.setItem("wise.density", d);
  } catch {
    /* ignore */
  }
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      density: "comfortable",
      vocabulary: "plain",
      mode: "analyst",
      helpOpen: false,
      helpTerm: undefined,
      paletteOpen: false,
      trayOpen: true,
      howToReadOpen: {},
      setHowToRead: (id, open) => set((s) => ({ howToReadOpen: { ...s.howToReadOpen, [id]: open } })),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setDensity: (density) => {
        applyDensity(density);
        set({ density });
      },
      setVocabulary: (vocabulary) => set({ vocabulary }),
      // guided mode reads plain words by definition: the method's terms are what it takes away
      setMode: (mode) => set(mode === "guided" ? { mode, vocabulary: "plain" } : { mode }),
      openHelp: (helpTerm) => set({ helpOpen: true, helpTerm }),
      closeHelp: () => set({ helpOpen: false, helpTerm: undefined }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setTrayOpen: (trayOpen) => set({ trayOpen }),
    }),
    {
      name: "wise.ui",
      partialize: (s) => ({ theme: s.theme, density: s.density, vocabulary: s.vocabulary, mode: s.mode, trayOpen: s.trayOpen, howToReadOpen: s.howToReadOpen }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme);
          applyDensity(state.density);
        }
      },
    },
  ),
);

/** Resolves the effective theme (light/dark) for chart theming. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/**
 * Guided mode (R3-10): the one path, the explanations on, and none of the method's controls.
 *
 * The mode is a profile, not a screen: it is set by `?mode=guided` in any address and remembered, so a link
 * given to a reader who does not run analyses every day opens the whole workbench in their words. What it
 * takes away is listed here rather than in each screen, so there is one answer to *what does guided hide?*.
 */
export const GUIDED_STEPS = ["signals", "why", "act"] as const;

export function useGuided(): boolean {
  return useUiStore((s) => s.mode === "guided");
}
