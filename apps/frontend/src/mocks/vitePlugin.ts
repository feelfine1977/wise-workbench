/**
 * Dev-server mock middleware.
 *
 * The browser normally runs the MSW service worker. Where service workers are unavailable
 * (embedded browsers, some privacy settings), requests to /api/v1 reach the Vite dev server and
 * this middleware answers them with the same handlers and fixtures through `msw/node`.
 * Only active in `vite dev` when mocks are on; production builds use the worker or the real backend.
 * Handler or fixture edits are picked up on the next request (the interceptor stays, handlers swap).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RequestHandler as Handler } from "msw";
import type { SetupServer as MswServer } from "msw/node";
import type { Plugin, ViteDevServer } from "vite";

export function mockApiPlugin(enabled: boolean): Plugin {
  let msw: MswServer | undefined;
  let ready: Promise<void> | undefined;

  const ensure = (server: ViteDevServer) => {
    if (!ready) {
      ready = (async () => {
        const mod = (await server.ssrLoadModule("/src/mocks/handlers.ts")) as { handlers: Handler[] };
        if (!msw) {
          const { setupServer } = await import("msw/node");
          msw = setupServer(...mod.handlers);
          msw.listen({ onUnhandledRequest: "bypass" });
        } else {
          msw.resetHandlers(...mod.handlers);
        }
      })().catch((err) => {
        ready = undefined;
        throw err;
      });
    }
    return ready;
  };

  return {
    name: "wise-mock-api",
    apply: "serve",
    handleHotUpdate({ file }) {
      if (enabled && file.includes("/src/mocks/")) ready = undefined;
    },
    configureServer(server) {
      if (!enabled) return;
      server.config.logger.info("  ➜  mocks: /api/v1 is answered by MSW handlers in the dev server (fallback when the service worker is unavailable)");
      server.httpServer?.once("close", () => {
        msw?.close();
        msw = undefined;
        ready = undefined;
      });
      server.middlewares.use("/api/v1", (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
        void (async () => {
          try {
            await ensure(server);
            const url = `http://localhost${(req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? ""}`;
            const method = (req.method ?? "GET").toUpperCase();
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && !["host", "connection", "content-length"].includes(k)) headers.set(k, v);
            const body = method === "GET" || method === "HEAD" ? undefined : new Uint8Array(Buffer.concat(chunks));
            const response = await fetch(url, { method, headers, body });
            res.statusCode = response.status;
            response.headers.forEach((v, k) => {
              if (k !== "content-encoding" && k !== "content-length") res.setHeader(k, v);
            });
            if (response.body) {
              const reader = response.body.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
              }
            }
            res.end();
          } catch (err) {
            next(err);
          }
        })();
      });
    },
  };
}
