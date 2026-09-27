import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 8001;
const STUB_PORT = 8011;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/openrouter-stub.mjs",
      url: `http://127.0.0.1:${STUB_PORT}`,
      env: { STUB_PORT: String(STUB_PORT) },
      reuseExistingServer: false,
    },
    // Serves the built frontend through the real backend with a fresh database per run.
    {
      command: `npm run build && uv run --directory ../backend uvicorn app.main:app --host 127.0.0.1 --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      env: {
        KANBAN_DB_PATH: path.join(os.tmpdir(), `kanban-e2e-${Date.now()}.db`),
        OPENROUTER_URL: `http://127.0.0.1:${STUB_PORT}`,
        OPENROUTER_API_KEY: "e2e-test-key",
      },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
