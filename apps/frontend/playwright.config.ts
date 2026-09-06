import { defineConfig, devices } from "@playwright/test";

/**
 * `npm run e2e` builds the app into `dist-e2e` and serves it with `vite preview` on 127.0.0.1:4173; `dist`
 * stays the build that the backend serves (`npm run build:live`).
 * Without `E2E_API_URL` the build runs on the MSW mocks (e2e/smoke.spec.ts); with it the build calls that
 * backend directly (e2e/real-backend.spec.ts), so the backend must allow the 4173 origin (it does by default).
 */
const liveApi = process.env.E2E_API_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: liveApi ? 240_000 : 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build -- --outDir dist-e2e && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 180_000,
    env: liveApi ? { ...process.env, VITE_API_URL: liveApi, VITE_USE_MOCKS: "" } : { ...process.env, VITE_API_URL: "", VITE_USE_MOCKS: "1" },
  },
});
