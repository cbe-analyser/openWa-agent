// Bundles the background worker and the operational scripts into dist/*.cjs so the production
// image can run them with plain `node` (no TypeScript tooling). npm packages stay external and
// are resolved from node_modules at runtime.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  packages: "external",
  tsconfig: "tsconfig.json",
  sourcemap: true,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: {
    worker: "src/worker/index.ts",
    seed: "scripts/seed.ts",
    "reencrypt-secrets": "scripts/reencrypt-secrets.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
});
