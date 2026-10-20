import pino from "pino";
import { redact } from "./security/redact";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  // Imports are hoisted above any assignment in the entry file, so detect the worker from argv.
  base: {
    service:
      process.env.OPENWA_PROCESS ?? (/worker\.(c?js|ts)$/.test(process.argv[1] ?? "") ? "worker" : "app"),
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.apiKey",
      "*.accessToken",
      "*.appSecret",
      "*.password",
      "*.token",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    log(object) {
      return redact(object as Record<string, unknown>);
    },
  },
  hooks: {
    logMethod(args, method) {
      // Redact secrets that may appear in free-text log messages.
      const redacted = args.map((a) => (typeof a === "string" ? redact(a) : a)) as typeof args;
      method.apply(this, redacted);
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
