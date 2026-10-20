import { randomBytes } from "node:crypto";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests run against a separate PostgreSQL database (TEST_DATABASE_URL). No real credentials are
// needed: AI calls use the mock provider or stubbed HTTP, WhatsApp calls use stubbed fetch.
const testEnv = {
  NODE_ENV: "test" as const,
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://openwa:openwa@localhost:5432/openwa_test",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  APP_URL: "http://localhost:3000",
  DEPLOYMENT_MODE: "multi",
  ALLOW_SIGNUP: "true",
  LOG_LEVEL: "silent",
};
Object.assign(process.env, testEnv);

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    env: testEnv,
    globalSetup: ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup.ts"],
    // One shared database: run test files one at a time.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
