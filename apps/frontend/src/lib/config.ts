/**
 * Runtime configuration.
 *
 * - `VITE_API_URL` unset, or `VITE_USE_MOCKS=1`  -> the SPA runs on MSW mocks generated from the contract.
 * - `VITE_API_URL` set                             -> real backend. In `vite dev` requests go to `/api/v1`
 *   on the same origin and the dev proxy forwards them to `VITE_API_URL`; production builds call the
 *   absolute URL.
 * - `VITE_USE_MOCKS=0` without `VITE_API_URL`      -> real backend on the same origin: the build that the
 *   backend serves itself (`npm run build:live`, `wise-workbench serve`).
 */
const env = import.meta.env;
const apiUrl: string | undefined = env.VITE_API_URL ? String(env.VITE_API_URL) : undefined;
const mocksFlag = env.VITE_USE_MOCKS === undefined ? "" : String(env.VITE_USE_MOCKS);

export const useMocks: boolean = mocksFlag === "1" || (mocksFlag !== "0" && !apiUrl);

function origin(): string {
  if (typeof window !== "undefined" && window.location && window.location.origin !== "null") {
    return window.location.origin;
  }
  return "http://localhost";
}

export const apiBase: string = useMocks || env.DEV || !apiUrl ? `${origin()}/api/v1` : `${apiUrl.replace(/\/$/, "")}/api/v1`;

export const appVersion = "0.1.0";
