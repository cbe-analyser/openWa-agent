import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().min(1).default("OpenWa Agent"),
  DEPLOYMENT_MODE: z.enum(["single", "multi", "sandbox"]).default("single"),
  ALLOW_SIGNUP: bool,
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  AI_KILL_SWITCH: bool,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(750),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(10),
  ALLOW_PRIVATE_NETWORK_FETCH: bool,
  WHATSAPP_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated environment. Throws a readable error (without values) when misconfigured. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

/** For tests that change process.env between cases. */
export function resetEnvCache() {
  cached = null;
}
