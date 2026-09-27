import { useSyncExternalStore } from "react";

export type NormAuthoringMode = "guided" | "expert";
export const NORM_AUTHORING_PREFERENCES_KEY = "wise-norm-authoring-preferences";
const changeEvent = "wise-norm-authoring-preferences-changed";
interface Preferences { mode: NormAuthoringMode; skipReasonOwner: boolean }
const defaults: Preferences = { mode: "guided", skipReasonOwner: true };
// If browser storage is unavailable, the setting still works for this session.
let fallback: { previous: string | null; value: string } | undefined;

function snapshot(): string | null {
  try {
    const stored = window.localStorage.getItem(NORM_AUTHORING_PREFERENCES_KEY);
    if (fallback?.previous === stored) return fallback.value;
    fallback = undefined;
    return stored;
  } catch { return fallback?.value ?? null; }
}
function read(value: string | null): Preferences {
  try {
    const saved: unknown = JSON.parse(value ?? "null");
    if (!saved || typeof saved !== "object") return defaults;
    const preferences = saved as Partial<Preferences>;
    return {
      mode: preferences.mode === "expert" ? "expert" : "guided",
      skipReasonOwner: typeof preferences.skipReasonOwner === "boolean" ? preferences.skipReasonOwner : true,
    };
  } catch { return defaults; }
}
function update(patch: Partial<Preferences>) {
  const previous = snapshot();
  const value = JSON.stringify({ ...read(previous), ...patch });
  try { window.localStorage.setItem(NORM_AUTHORING_PREFERENCES_KEY, value); fallback = undefined; }
  catch { fallback = { previous: fallback?.previous ?? previous, value }; }
  window.dispatchEvent(new Event(changeEvent));
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === NORM_AUTHORING_PREFERENCES_KEY) { fallback = undefined; notify(); }
  };
  window.addEventListener(changeEvent, notify);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(changeEvent, notify); window.removeEventListener("storage", onStorage); };
}
const setMode = (mode: NormAuthoringMode) => update({ mode });
const setSkipReasonOwner = (skipReasonOwner: boolean) => update({ skipReasonOwner });

/** Shared by all norm editors. Expert requirements do not depend on the Guided preference. */
export function useNormAuthoringPreferences() {
  const preferences = read(useSyncExternalStore(subscribe, snapshot, () => null));
  return {
    ...preferences, setMode, setSkipReasonOwner,
    allowDraftWithoutDecision: preferences.mode === "guided" && preferences.skipReasonOwner,
  };
}
