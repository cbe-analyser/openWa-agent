import { execFileSync } from "node:child_process";

/** Applies migrations (non-destructive) and seeds a demo organization for this run's admin account. */
export default function globalSetup() {
  const env = {
    ...process.env,
    NODE_ENV: "development" as const,
    DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://openwa:openwa@localhost:5432/openwa_e2e",
    ENCRYPTION_KEY: process.env.E2E_ENCRYPTION_KEY!,
    SEED_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL!,
    SEED_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD!,
    APP_URL: "http://localhost:3100",
    DEPLOYMENT_MODE: "sandbox",
  };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env });
  execFileSync("npx", ["tsx", "scripts/seed.ts"], { stdio: "pipe", env });
}
