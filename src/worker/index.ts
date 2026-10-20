import { env } from "../server/env";
import { logger } from "../server/logger";
import { Worker } from "../server/jobs/worker";

env(); // fail fast on configuration errors
const worker = new Worker();
let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Shutdown requested");
  await worker.stop();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "Unhandled rejection"));

worker.start().catch((err) => {
  logger.fatal({ err }, "Worker crashed");
  process.exit(1);
});
