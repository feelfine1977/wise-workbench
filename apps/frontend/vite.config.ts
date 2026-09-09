/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mockApiPlugin } from "./src/mocks/vitePlugin";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
// Flow is a required, packaged dependency. A missing installation must fail the build
// instead of silently replacing the process map with a placeholder.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, "VITE_");
  const backend = env.VITE_API_URL || "http://127.0.0.1:8000";
  // Mocks unless a backend URL is given; `VITE_USE_MOCKS=1` forces them, `VITE_USE_MOCKS=0` selects the same origin.
  const mocks = env.VITE_USE_MOCKS === "1" || (env.VITE_USE_MOCKS !== "0" && !env.VITE_API_URL);
  return {
    plugins: [react(), mockApiPlugin(mocks)],
    resolve: {
      alias: [
        { find: "@", replacement: path.resolve(here, "src") },
        { find: "@wise/api-schema", replacement: path.resolve(repoRoot, "packages/api-schema/generated") },
        { find: "@wise/design-tokens", replacement: path.resolve(repoRoot, "packages/design-tokens") },
      ],
      dedupe: ["react", "react-dom", "@xyflow/react"],
    },
    optimizeDeps: {
      // elkjs itself is not pre-bundled: its entry requires the Node-only `web-worker`; the flow library imports the two browser files.
      include: ["@xyflow/react", "@wise/flow > @dagrejs/dagre", "@wise/flow > d3-scale", "@wise/flow > rbush", "@wise/flow > elkjs/lib/elk-api.js", "@wise/flow > elkjs/lib/elk.bundled.js"],
      exclude: ["elkjs"],
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: false,
      fs: { allow: [repoRoot] },
      // Dev proxy so the SPA can call /api/v1 on the same origin; the backend is reached without CORS.
      // With mocks on, the mock middleware answers /api/v1 before the proxy sees the request.
      proxy: { "/api": { target: backend, changeOrigin: true } },
    },
    build: {
      target: "es2022",
      sourcemap: true,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            tanstack: ["@tanstack/react-query", "@tanstack/react-router", "@tanstack/react-table", "@tanstack/react-virtual"],
            radix: [
              "@radix-ui/react-dialog",
              "@radix-ui/react-popover",
              "@radix-ui/react-select",
              "@radix-ui/react-tabs",
              "@radix-ui/react-tooltip",
              "@radix-ui/react-checkbox",
            ],
          },
        },
      },
    },
    test: {
      environment: "./vitest.environment.mjs",
      globals: false,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      css: false,
      restoreMocks: true,
      testTimeout: 15000,
      maxWorkers: 4,
    },
  };
});
