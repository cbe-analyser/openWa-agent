import { execFileSync } from "node:child_process";

/** Applies all migrations to the test database once before the suite. */
export default function setup() {
  execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: process.env });
}
