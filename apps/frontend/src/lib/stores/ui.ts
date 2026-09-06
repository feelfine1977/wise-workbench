import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Vocabulary } from "@/lib/vocabulary";

export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

interface UiState {
  theme: Theme;
  density: Density;
  /** Plain language first (default) or the method's terms first. */
  vocabulary: Vocabulary;
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
      openHelp: (helpTerm) => set({ helpOpen: true, helpTerm }),
      closeHelp: () => set({ helpOpen: false, helpTerm: undefined }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setTrayOpen: (trayOpen) => set({ trayOpen }),
    }),
    {
      name: "wise.ui",
      partialize: (s) => ({ theme: s.theme, density: s.density, vocabulary: s.vocabulary, trayOpen: s.trayOpen, howToReadOpen: s.howToReadOpen }),
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
