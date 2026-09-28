/** Live backend by default; fixture responses require explicit demo mode or VITE_USE_MOCKS=1. */
import { runtimeMode } from "./runtimeMode";

const env = import.meta.env;
const mode = runtimeMode(env);
const apiUrl = mode.apiUrl;
export const useMocks = mode.useMocks;

function origin(): string {
  if (typeof window !== "undefined" && window.location && window.location.origin !== "null") {
    return window.location.origin;
  }
  return "http://localhost";
}

export const apiBase: string = useMocks || env.DEV || !apiUrl ? `${origin()}/api/v1` : `${apiUrl.replace(/\/$/, "")}/api/v1`;

export const appVersion = "0.1.0";
