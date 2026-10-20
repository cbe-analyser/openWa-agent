import { hostname } from "node:os";
import type { Job } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { logger, errorMessage } from "../logger";
import { handlers, onDead, RetryLaterError } from "./handlers";
import { claimJobs, completeJob, enqueue, failJob, PermanentJobError, recoverStaleJobs } from "./queue";

export async function runJob(job: Job): Promise<void> {
  const handler = handlers[job.type];
  const log = logger.child({ jobId: job.id, jobType: job.type, orgId: job.orgId, attempt: job.attempts });
  if (!handler) {
    await failJob(job, `Unknown job type ${job.type}`, true);
    return;
  }
  try {
    await handler(job.payload as Record<string, unknown>, job);
    await completeJob(job.id);
  } catch (err) {
    const permanent = err instanceof PermanentJobError;
    const status = await failJob(job, errorMessage(err), permanent);
    if (status === "DEAD") {
      log.error({ err: errorMessage(err) }, "Job moved to dead-letter queue");
      await onDead(job, errorMessage(err)).catch((e) =>
        log.error({ err: errorMessage(e) }, "onDead hook failed"),
      );
    } else if (!(err instanceof RetryLaterError)) {
      log.warn({ err: errorMessage(err) }, "Job failed; retry scheduled");
    }
  }
}

/** Processes every currently due job once (used by tests and the CLI). */
export async function drainJobs(maxRounds = 50): Promise<number> {
  let processed = 0;
  for (let i = 0; i < maxRounds; i++) {
    const jobs = await claimJobs("drain", 10);
    if (jobs.length === 0) break;
    for (const job of jobs) await runJob(job);
    processed += jobs.length;
  }
  return processed;
}

export class Worker {
  private running = false;
  private inflight = new Set<Promise<void>>();
  private readonly id = `${hostname()}:${process.pid}`;
  private timers: NodeJS.Timeout[] = [];

  async start() {
    this.running = true;
    const { WORKER_CONCURRENCY, WORKER_POLL_INTERVAL_MS } = env();
    logger.info({ workerId: this.id, concurrency: WORKER_CONCURRENCY }, "Worker started");
    await this.maintenance();
    this.timers.push(setInterval(() => void this.maintenance(), 60_000));
    while (this.running) {
      try {
        const free = WORKER_CONCURRENCY - this.inflight.size;
        const jobs = await claimJobs(this.id, free);
        for (const job of jobs) {
          const p = runJob(job).finally(() => this.inflight.delete(p));
          this.inflight.add(p);
        }
        if (jobs.length === 0 || this.inflight.size >= WORKER_CONCURRENCY) {
          await Promise.race([new Promise((r) => setTimeout(r, WORKER_POLL_INTERVAL_MS)), ...this.inflight]);
        }
      } catch (err) {
        logger.error({ err: errorMessage(err) }, "Worker loop error");
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  private async maintenance() {
    try {
      const recovered = await recoverStaleJobs();
      if (recovered) logger.warn({ recovered }, "Recovered stale jobs");
      const hour = Math.floor(Date.now() / 3600_000);
      await enqueue("retention_sweep", {}, { dedupeKey: `retention:${hour}`, maxAttempts: 3 });
    } catch (err) {
      logger.error({ err: errorMessage(err) }, "Worker maintenance failed");
    }
  }

  /** Graceful shutdown: stop claiming, wait for in-flight jobs (bounded), disconnect. */
  async stop(timeoutMs = 25_000) {
    this.running = false;
    this.timers.forEach(clearInterval);
    logger.info({ inflight: this.inflight.size }, "Worker stopping");
    await Promise.race([
      Promise.allSettled([...this.inflight]),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
    await prisma.$disconnect();
  }
}
