/**
 * Pinned scenes (§3.7) and saved boards (§4.8). A pinned scene is what the reader was looking at — the
 * context, the chips, the detail level and the selection — kept so two selections can be put side by side;
 * at most three. A saved board is the same, named, per project. Boards are kept in the browser until the
 * backend serves boards of its own; nothing autosaves.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Scene {
  id: string;
  projectId: string;
  runId: string;
  /** The whole address of the scene, so opening it again reproduces it exactly. */
  href: string;
  label: string;
  /** The chips as words, for the strip and the board's *modified* comparison. */
  chips: string[];
  createdAt: string;
}

export interface SavedBoard extends Scene {
  name: string;
  /** Whether the chips were saved with the board or the board opens empty. */
  withSelection: boolean;
}

interface SceneState {
  pins: Scene[];
  boards: SavedBoard[];
  pin: (scene: Omit<Scene, "id" | "createdAt">) => void;
  unpin: (id: string) => void;
  clearPins: (runId?: string) => void;
  saveBoard: (board: Omit<SavedBoard, "id" | "createdAt">) => SavedBoard;
  removeBoard: (id: string) => void;
}

const sceneId = (runId: string, href: string) => `${runId}:${href}`;

export const useSceneStore = create<SceneState>()(
  persist(
    (set) => ({
      pins: [],
      boards: [],
      pin: (scene) =>
        set((s) => {
          const id = sceneId(scene.runId, scene.href);
          if (s.pins.some((p) => p.id === id)) return s;
          return { pins: [...s.pins, { ...scene, id, createdAt: new Date().toISOString() }].slice(-3) };
        }),
      unpin: (id) => set((s) => ({ pins: s.pins.filter((p) => p.id !== id) })),
      clearPins: (runId) => set((s) => ({ pins: runId ? s.pins.filter((p) => p.runId !== runId) : [] })),
      saveBoard: (board) => {
        const saved: SavedBoard = { ...board, id: `board_${Date.now().toString(36)}`, createdAt: new Date().toISOString() };
        set((s) => ({ boards: [...s.boards.filter((b) => !(b.projectId === board.projectId && b.name === board.name)), saved] }));
        return saved;
      },
      removeBoard: (id) => set((s) => ({ boards: s.boards.filter((b) => b.id !== id) })),
    }),
    { name: "wise.scenes", partialize: (s) => ({ boards: s.boards, pins: [] }) as unknown as SceneState },
  ),
);
