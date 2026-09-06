/**
 * Runtime configuration.
 *
 * - `VITE_API_URL` unset, or `VITE_USE_MOCKS=1`  -> the SPA runs on MSW mocks generated from the contract.
 * - `VITE_API_URL` set                             -> real backend. In `vite dev` requests go to `/api/v1`
 *   on the same origin and the dev proxy forwards them to `VITE_API_URL`; production builds call the
 *   absolute URL.
 */
const env = import.meta.env;
const apiUrl: string | undefined = env.VITE_API_URL ? String(env.VITE_API_URL) : undefined;

export const useMocks: boolean = env.VITE_USE_MOCKS === "1" || !apiUrl;

function origin(): string {
  if (typeof window !== "undefined" && window.location && window.location.origin !== "null") {
    return window.location.origin;
  }
  return "http://localhost";
}

export const apiBase: string =
  useMocks || env.DEV ? `${origin()}/api/v1` : `${(apiUrl as string).replace(/\/$/, "")}/api/v1`;

export const appVersion = "0.1.0";
