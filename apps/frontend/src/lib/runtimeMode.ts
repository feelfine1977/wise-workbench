/** Shared by the browser and Vite middleware: fixture data always needs an explicit opt-in. */
export function runtimeMode(env: { MODE?: string; VITE_API_URL?: unknown; VITE_USE_MOCKS?: unknown }) {
  const apiUrl = typeof env.VITE_API_URL === "string" ? env.VITE_API_URL.trim().replace(/\/$/, "") : "";
  const flag = String(env.VITE_USE_MOCKS ?? "").trim();
  const useMocks = flag === "1" || (flag !== "0" && env.MODE === "demo" && !apiUrl);
  return { apiUrl, useMocks };
}
