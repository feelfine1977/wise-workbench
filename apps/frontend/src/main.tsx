import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@wise/design-tokens/dist/tokens.css";
import "./styles/globals.css";
import { useMocks } from "./lib/config";
import { App, makeQueryClient } from "./app/providers";

async function bootstrap() {
  if (useMocks) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }
  const queryClient = makeQueryClient();
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <App queryClient={queryClient} />
    </StrictMode>,
  );
}

void bootstrap();
