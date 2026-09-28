import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@wise/design-tokens/dist/tokens.css";
import "./styles/globals.css";
import { useMocks } from "./lib/config";
import { prepareLiveBackend } from "./lib/liveBackend";
import { App, makeQueryClient } from "./app/providers";

async function bootstrap() {
  if (useMocks) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  } else if (!await prepareLiveBackend(navigator.serviceWorker, window.location)) {
    return;
  }
  const queryClient = makeQueryClient();
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <App queryClient={queryClient} />
    </StrictMode>,
  );
}

void bootstrap().catch(() => {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <main className="mx-auto max-w-xl p-6" role="alert">
      <h1 className="text-xl font-semibold">Unable to connect safely to the live application</h1>
      <p className="my-3">The previous demo could not be disconnected. Reload to retry before working with your projects.</p>
      <button type="button" className="rounded border px-3 py-2" onClick={() => window.location.reload()}>Reload application</button>
    </main>,
  );
});
