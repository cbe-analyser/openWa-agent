import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// The E2E suite runs the production build (`npm run build` first) and the background worker
// against a separate database, seeded with the demo organization. No real credentials are used:
// the demo organization uses the simulator channel and the offline mock AI provider.
const PORT = 3100;
const e2eEnv = {
  NODE_ENV: "production" as const,
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://openwa:openwa@localhost:5432/openwa_e2e",
  ENCRYPTION_KEY: process.env.E2E_ENCRYPTION_KEY ?? randomBytes(32).toString("base64"),
  APP_URL: `http://localhost:${PORT}`,
  DEPLOYMENT_MODE: "sandbox",
  LOG_LEVEL: "warn",
  WORKER_POLL_INTERVAL_MS: "200",
  // A fresh admin per run keeps runs independent without wiping the database.
  SEED_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL ?? `e2e-${Date.now()}@example.com`,
  SEED_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? `E2e-${randomBytes(9).toString("base64url")}`,
};
// Shared with globalSetup and the tests (same process tree).
Object.assign(process.env, {
  E2E_ENCRYPTION_KEY: e2eEnv.ENCRYPTION_KEY,
  E2E_ADMIN_PASSWORD: e2eEnv.SEED_ADMIN_PASSWORD,
  E2E_ADMIN_EMAIL: e2eEnv.SEED_ADMIN_EMAIL,
});

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      // Standalone server, as in the Docker image (static assets are copied next to it).
      command:
        "rm -rf .next/standalone/.next/static && cp -r .next/static .next/standalone/.next/static && node .next/standalone/server.js",
      url: `http://localhost:${PORT}/api/health`,
      env: { ...e2eEnv, PORT: String(PORT), HOSTNAME: "127.0.0.1" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    { command: "node dist/worker.cjs", env: e2eEnv, reuseExistingServer: false },
  ],
});
