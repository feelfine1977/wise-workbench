/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mockApiPlugin } from "./src/mocks/vitePlugin";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
// `@wise/flow` is a file: link to the sibling checkout; its React and React Flow must be the app's copies.
const flowRoot = path.resolve(repoRoot, "../wise-flow");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, "VITE_");
  const backend = env.VITE_API_URL || "http://127.0.0.1:8000";
  const mocks = env.VITE_USE_MOCKS === "1" || !env.VITE_API_URL;
  return {
    plugins: [react(), mockApiPlugin(mocks)],
    resolve: {
      alias: {
        "@": path.resolve(here, "src"),
        "@wise/api-schema": path.resolve(repoRoot, "packages/api-schema/generated"),
        "@wise/design-tokens": path.resolve(repoRoot, "packages/design-tokens"),
      },
      dedupe: ["react", "react-dom", "@xyflow/react"],
    },
    optimizeDeps: {
      include: ["@xyflow/react", "elkjs", "@wise/flow > @dagrejs/dagre", "@wise/flow > d3-scale", "@wise/flow > rbush"],
    },
    server: {
      port: 5173,
      strictPort: false,
      fs: { allow: [repoRoot, flowRoot] },
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
      environment: "jsdom",
      globals: false,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      css: false,
      restoreMocks: true,
      testTimeout: 15000,
    },
  };
});
