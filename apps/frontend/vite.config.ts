/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { mockApiPlugin } from "./src/mocks/vitePlugin";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
// `@wise/flow` is an optional file: link to the sibling checkout; its React and React Flow must be the app's copies.
// When the checkout or its `dist` is absent (a fresh clone, CI) the stub in `stubs/wise-flow` takes its place and the
// process map shows a notice instead of a map. `WISE_FLOW_STUB=1` forces the stub for testing that path.
const flowRoot = path.resolve(repoRoot, "../wise-flow");
const flowStub = path.resolve(here, "stubs/wise-flow");
const flowLinked = fs.existsSync(path.join(here, "node_modules/@wise/flow/dist/react/index.js"));
const useFlowStub = process.env.WISE_FLOW_STUB === "1" || !flowLinked;
const flowAlias = useFlowStub
  ? [
      { find: /^@wise\/flow$/, replacement: path.join(flowStub, "index.js") },
      { find: /^@wise\/flow\/react$/, replacement: path.join(flowStub, "react.js") },
      { find: /^@wise\/flow\/bpmn$/, replacement: path.join(flowStub, "bpmn.js") },
      { find: /^@wise\/flow\/tokens\.css$/, replacement: path.join(flowStub, "tokens.css") },
      { find: /^@wise\/flow\/style\.css$/, replacement: path.join(flowStub, "style.css") },
    ]
  : [];
// The BPMN view draws on bpmn-js, a dependency of the flow library rather than of the application: its
// stylesheets are read from the linked checkout, and the stub's empty sheet takes their place without it.
const bpmnAssets = useFlowStub
  ? [{ find: /^bpmn-js\/dist\/assets\/.*\.css$/, replacement: path.join(flowStub, "style.css") }]
  : [{ find: /^bpmn-js\/dist\/assets\/(.*)$/, replacement: path.join(flowRoot, "node_modules/bpmn-js/dist/assets/$1") }];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, "VITE_");
  const backend = env.VITE_API_URL || "http://127.0.0.1:8000";
  // Mocks unless a backend URL is given; `VITE_USE_MOCKS=1` forces them, `VITE_USE_MOCKS=0` selects the same origin.
  const mocks = env.VITE_USE_MOCKS === "1" || (env.VITE_USE_MOCKS !== "0" && !env.VITE_API_URL);
  return {
    plugins: [react(), mockApiPlugin(mocks)],
    resolve: {
      alias: [
        ...flowAlias,
        ...bpmnAssets,
        { find: "@", replacement: path.resolve(here, "src") },
        { find: "@wise/api-schema", replacement: path.resolve(repoRoot, "packages/api-schema/generated") },
        { find: "@wise/design-tokens", replacement: path.resolve(repoRoot, "packages/design-tokens") },
      ],
      dedupe: ["react", "react-dom", "@xyflow/react"],
    },
    optimizeDeps: {
      // elkjs itself is not pre-bundled: its entry requires the Node-only `web-worker`; the flow library imports the two browser files.
      include: useFlowStub
        ? ["@xyflow/react"]
        : ["@xyflow/react", "@wise/flow > @dagrejs/dagre", "@wise/flow > d3-scale", "@wise/flow > rbush", "@wise/flow > elkjs/lib/elk-api.js", "@wise/flow > elkjs/lib/elk.bundled.js"],
      exclude: ["elkjs"],
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: false,
      fs: { allow: fs.existsSync(flowRoot) ? [repoRoot, flowRoot] : [repoRoot] },
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
