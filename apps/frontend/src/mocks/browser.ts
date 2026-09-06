import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);

/**
 * Starts the service worker. When the browser cannot register one, requests fall through to the
 * dev server, where the same handlers answer (see vitePlugin.ts); the app keeps working either way.
 */
export async function startMocks(): Promise<"worker" | "server"> {
  try {
    await worker.start({ onUnhandledRequest: "bypass", serviceWorker: { url: "/mockServiceWorker.js" }, quiet: true });
    return "worker";
  } catch (err) {
    console.warn("[mocks] service worker unavailable; the dev server answers /api/v1 with the same mocks.", err);
    return "server";
  }
}
